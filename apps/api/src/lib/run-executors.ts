import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  ApprovalRules,
  LocalRepository,
  TaskCatalogEntry,
  WorkflowDocument,
  WorkflowNetworkKind,
  WorkflowNode,
  WorkflowRunContext,
  WorkflowRunNetworkActivity
} from '@flow-machine/shared-types';

import { AppConfig } from './config';
import { executeBrowserAutomation } from './browser-runtime';
import { executeMcpCall } from './mcp-runtime';
import { ensurePathInsideRoot, resolveRepositoryRuntimeRoot } from './repositories';
import { SecretStore } from './secret-store';
import { WorkflowStore } from './workflow-store';

const ignoredDirectories = new Set(['.git', '.flow-machine', '.yarn', 'dist', 'node_modules']);

interface StepLogger {
  (level: 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}

export interface StepExecutionContext {
  config: AppConfig;
  input: Record<string, unknown>;
  node: WorkflowNode;
  repository: LocalRepository | null;
  secretStore: SecretStore;
  signal: AbortSignal;
  task: TaskCatalogEntry | null;
  workflow: WorkflowDocument;
  workflowStore: WorkflowStore;
  log: StepLogger;
}

export interface StepExecutionResult {
  context?: Partial<WorkflowRunContext>;
  output: unknown;
  network?: WorkflowRunNetworkActivity[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }

    if (character === '*') {
      source += '[^/]*';
      continue;
    }

    source += escapeRegex(character);
  }

  source += '$';

  return new RegExp(source);
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function toJsonIfPossible(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function truncateText(value: string, maxLength = 12_000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...[truncated]`;
}

function abortMessage(signal: AbortSignal): string {
  if (signal.reason instanceof Error && signal.reason.message) {
    return signal.reason.message;
  }

  if (typeof signal.reason === 'string' && signal.reason.trim().length > 0) {
    return signal.reason;
  }

  return 'Run stopped by user.';
}

function createAbortError(signal: AbortSignal): Error {
  const error = new Error(abortMessage(signal));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError(signal);
  }
}

function createExecutionSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function resolvePathValue(source: unknown, expression: string): unknown {
  return expression.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token: string) => {
    const value = resolvePathValue(context, token.trim());

    if (value === null || value === undefined) {
      return '';
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function resolveSecretTokensInString(value: string, secretStore: SecretStore): string {
  return value.replace(/\{\{\s*secret:([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const secret = secretStore.getSecretValue(key);

    if (secret === null) {
      throw new Error(`Missing secret ${key}.`);
    }

    return secret;
  });
}

function resolveSecretTokens(value: unknown, secretStore: SecretStore): unknown {
  if (typeof value === 'string') {
    return resolveSecretTokensInString(value, secretStore);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveSecretTokens(entry, secretStore));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveSecretTokens(entry, secretStore)])
    );
  }

  return value;
}

function resolveRepositoryRoot(context: StepExecutionContext): string {
  return resolveRepositoryRuntimeRoot(context.config, context.repository);
}

function buildNetworkActivity(kind: WorkflowNetworkKind, target: string, method?: string): WorkflowRunNetworkActivity[] {
  return [
    {
      kind,
      target,
      method
    }
  ];
}

function assertNetworkAllowed(config: AppConfig, rawUrl: string): URL {
  const url = new URL(rawUrl);

  if (config.privacyMode === 'strict-local' && !isLoopbackHostname(url.hostname)) {
    throw new Error(`Strict local-only mode blocks network access to ${url.origin}.`);
  }

  return url;
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(createAbortError(options.signal));
      return;
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      clearTimeout(timeout);

      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }

      if (options.signal) {
        options.signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 1_500);
      reject(createAbortError(options.signal!));
    };

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);

    options.signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    });

    child.once('close', (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `Command exited with code ${exitCode}.`));
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 0
      });
    });
  });
}

async function walkDirectory(rootPath: string, currentPath: string, collector: string[], signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    throwIfAborted(signal);

    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(rootPath, entryPath, collector, signal);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    collector.push(normalizeRelativePath(path.relative(rootPath, entryPath)));
  }
}

async function executeReadFile(context: StepExecutionContext): Promise<StepExecutionResult> {
  const targetPath = asString(context.node.config.path);
  const repositoryRoot = resolveRepositoryRoot(context);

  if (!targetPath) {
    throw new Error('Read File requires config.path.');
  }

  context.log('info', 'Opening repository file for reading.', {
    path: targetPath,
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  throwIfAborted(context.signal);
  const resolvedPath = ensurePathInsideRoot(repositoryRoot, targetPath);
  const content = await fs.readFile(resolvedPath, 'utf8');
  throwIfAborted(context.signal);

  context.log('info', 'Read file from repository.', { path: targetPath, repository: context.repository?.hostPath ?? context.config.repoMountSource });

  return {
    output: {
      path: targetPath,
      content: truncateText(content)
    }
  };
}

async function executeWriteFile(context: StepExecutionContext): Promise<StepExecutionResult> {
  const targetPath = asString(context.node.config.path);
  const repositoryRoot = resolveRepositoryRoot(context);

  if (!targetPath) {
    throw new Error('Write File requires config.path.');
  }

  context.log('info', 'Preparing to write a repository file.', {
    path: targetPath,
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  throwIfAborted(context.signal);
  const resolvedPath = ensurePathInsideRoot(repositoryRoot, targetPath);
  const content = asString(context.node.config.content) ?? JSON.stringify(context.input, null, 2);

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf8');
  throwIfAborted(context.signal);

  context.log('info', 'Wrote file into repository.', {
    path: targetPath,
    bytes: content.length,
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  return {
    output: {
      path: targetPath,
      bytesWritten: content.length
    }
  };
}

async function executeSearchRepo(context: StepExecutionContext): Promise<StepExecutionResult> {
  const query = asString(context.node.config.query);
  const repositoryRoot = resolveRepositoryRoot(context);

  if (!query) {
    throw new Error('Search Repository requires config.query.');
  }

  const includePattern = asString(context.node.config.includePattern);
  const matcher = includePattern ? globToRegExp(includePattern) : null;
  const expression = new RegExp(query, 'i');
  const files: string[] = [];

  context.log('info', 'Enumerating repository files for search.', {
    query,
    includePattern,
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  await walkDirectory(repositoryRoot, repositoryRoot, files, context.signal);

  context.log('info', 'Prepared repository file list for search.', {
    query,
    includePattern,
    repository: context.repository?.hostPath ?? context.config.repoMountSource,
    fileCount: files.length
  });

  const matches: Array<{ path: string; lineNumber: number; line: string }> = [];
  const progressInterval = files.length > 2_000 ? 500 : files.length > 500 ? 200 : 100;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    throwIfAborted(context.signal);
    const relativePath = files[fileIndex];

    if (fileIndex > 0 && fileIndex % progressInterval === 0) {
      context.log('info', 'Repository search still running.', {
        filesScanned: fileIndex,
        filesTotal: files.length,
        matchCount: matches.length,
        repository: context.repository?.hostPath ?? context.config.repoMountSource
      });
    }

    if (matcher && !matcher.test(relativePath)) {
      continue;
    }

    const absolutePath = path.join(repositoryRoot, relativePath);
    const content = await fs.readFile(absolutePath, 'utf8').catch(() => null);

    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      throwIfAborted(context.signal);

      if (!expression.test(lines[index])) {
        continue;
      }

      matches.push({
        path: relativePath,
        lineNumber: index + 1,
        line: lines[index].trim()
      });

      if (matches.length >= 100) {
        context.log('info', 'Reached repository search result cap.', {
          filesScanned: fileIndex + 1,
          filesTotal: files.length,
          matchCount: matches.length
        });
        break;
      }
    }

    if (matches.length >= 100) {
      break;
    }
  }

  context.log('info', 'Searched repository files.', {
    query,
    includePattern,
    matchCount: matches.length,
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  return {
    output: {
      query,
      includePattern,
      matchCount: matches.length,
      matches
    }
  };
}

async function executeShellCommand(context: StepExecutionContext): Promise<StepExecutionResult> {
  const command = asString(context.node.config.command);
  const commandString = asString(context.node.config.commandString);
  const timeoutMs = asNumber(context.node.config.timeoutMs) ?? context.task?.resourceDefaults.timeoutMs ?? 120_000;
  const repositoryRoot = resolveRepositoryRoot(context);

  if (!command && !commandString) {
    throw new Error('Shell Command requires config.command or config.commandString.');
  }

  const args = Array.isArray(context.node.config.args)
    ? context.node.config.args.filter((value): value is string => typeof value === 'string')
    : [];

  context.log('info', 'Starting shell command inside repository.', {
    command: commandString ?? [command, ...args].join(' '),
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  const result = commandString
    ? await runProcess('sh', ['-lc', commandString], {
        cwd: repositoryRoot,
        signal: context.signal,
        timeoutMs
      })
    : await runProcess(command!, args, {
        cwd: repositoryRoot,
        signal: context.signal,
        timeoutMs
      });

  context.log('info', 'Executed shell command.', {
    command: commandString ?? [command, ...args].join(' '),
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });

  return {
    output: {
      command: commandString ?? [command, ...args].join(' '),
      stdout: truncateText(result.stdout),
      stderr: truncateText(result.stderr),
      exitCode: result.exitCode
    }
  };
}

async function executeGitSummary(context: StepExecutionContext): Promise<StepExecutionResult> {
  const repositoryRoot = resolveRepositoryRoot(context);
  context.log('info', 'Collecting git summary for repository.', {
    repository: context.repository?.hostPath ?? context.config.repoMountSource
  });
  throwIfAborted(context.signal);
  const [status, diffStat, lastCommit] = await Promise.all([
    runProcess('git', ['-C', repositoryRoot, 'status', '--short'], {
      cwd: repositoryRoot,
      signal: context.signal,
      timeoutMs: 20_000
    }),
    runProcess('git', ['-C', repositoryRoot, 'diff', '--stat', '--no-ext-diff'], {
      cwd: repositoryRoot,
      signal: context.signal,
      timeoutMs: 20_000
    }),
    runProcess('git', ['-C', repositoryRoot, 'log', '-1', '--pretty=format:%h %s'], {
      cwd: repositoryRoot,
      signal: context.signal,
      timeoutMs: 20_000
    }).catch(() => ({ exitCode: 0, stderr: '', stdout: '' }))
  ]);
  throwIfAborted(context.signal);

  context.log('info', 'Collected git summary.', {
    repository: context.repository?.hostPath ?? context.config.repoMountSource,
    changed: status.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length
  });

  return {
    output: {
      status: truncateText(status.stdout.trim()),
      diffStat: truncateText(diffStat.stdout.trim()),
      lastCommit: lastCommit.stdout.trim()
    }
  };
}

async function executeHttpRequest(context: StepExecutionContext): Promise<StepExecutionResult> {
  const url = asString(context.node.config.url);

  if (!url) {
    throw new Error('HTTP Request requires config.url.');
  }

  const method = asString(context.node.config.method)?.toUpperCase() ?? 'GET';
  const target = assertNetworkAllowed(context.config, url);
  const body = context.node.config.body;
  const headers = isRecord(context.node.config.headers) ? Object.fromEntries(Object.entries(context.node.config.headers).map(([key, value]) => [key, String(value)])) : undefined;

  const timeoutMs = asNumber(context.node.config.timeoutMs) ?? context.task?.resourceDefaults.timeoutMs ?? 60_000;
  context.log('info', 'Starting HTTP request.', {
    method,
    target: target.origin
  });

  const response = await fetch(target, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: createExecutionSignal(context.signal, timeoutMs)
  });

  const responseText = await response.text();

  context.log('info', 'Completed HTTP request.', {
    method,
    target: target.origin,
    status: response.status
  });

  return {
    output: {
      method,
      url: target.toString(),
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      body: typeof responseText === 'string' ? toJsonIfPossible(truncateText(responseText)) : null
    },
    network: buildNetworkActivity('http', target.origin, method)
  };
}

function buildAgentPrompt(context: StepExecutionContext): string {
  const objective = asString(context.node.config.objective) ?? `Complete the task for workflow node ${context.node.name}.`;

  return [
    'You are running inside Flow Machine.',
    `Workflow: ${context.workflow.name}`,
    `Node: ${context.node.name}`,
    `Objective: ${objective}`,
    'Available input JSON:',
    JSON.stringify(context.input, null, 2)
  ].join('\n\n');
}

async function resolveOllamaModel(context: StepExecutionContext): Promise<string> {
  const configuredModel = asString(context.node.config.model);

  if (configuredModel) {
    return configuredModel;
  }

  const selectedModel = context.workflowStore.getModelManifest().selectedModel;

  if (selectedModel) {
    return selectedModel;
  }

  const baseUrl = assertNetworkAllowed(context.config, context.config.ollamaBaseUrl);
  const response = await fetch(new URL('/api/tags', baseUrl), {
    signal: createExecutionSignal(context.signal, 5_000)
  });

  if (!response.ok) {
    throw new Error(`Could not list Ollama models: HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { models?: Array<{ name?: string }> };
  const modelName = body.models?.find((entry) => typeof entry.name === 'string' && entry.name.length > 0)?.name;

  if (!modelName) {
    throw new Error('No installed Ollama models are available. Configure config.model or install a host model.');
  }

  return modelName;
}

async function executeAgent(context: StepExecutionContext): Promise<StepExecutionResult> {
  const baseUrl = assertNetworkAllowed(context.config, context.config.ollamaBaseUrl);
  const model = await resolveOllamaModel(context);
  const prompt = buildAgentPrompt(context);
  const timeoutMs = asNumber(context.node.config.timeoutMs) ?? context.task?.resourceDefaults.timeoutMs ?? 180_000;

  context.log('info', 'Preparing agent prompt for Ollama.', {
    model,
    workflow: context.workflow.name,
    node: context.node.name
  });

  context.log('info', 'Sending agent request to Ollama.', {
    model,
    target: baseUrl.origin
  });

  const response = await fetch(new URL('/api/generate', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false
    }),
    signal: createExecutionSignal(context.signal, timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Ollama generation failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { response?: string; eval_count?: number; prompt_eval_count?: number };

  context.log('info', 'Completed Ollama agent generation.', {
    model,
    evalCount: body.eval_count ?? null
  });

  return {
    output: {
      model,
      prompt,
      response: body.response ?? '',
      promptEvalCount: body.prompt_eval_count ?? null,
      evalCount: body.eval_count ?? null
    },
    network: buildNetworkActivity('ollama', baseUrl.origin, 'POST')
  };
}

async function executeJsonTransform(context: StepExecutionContext): Promise<StepExecutionResult> {
  throwIfAborted(context.signal);
  const value = context.node.config.value;
  const merge = isRecord(context.node.config.merge) ? context.node.config.merge : null;
  const output = merge ? { ...context.input, ...merge } : value ?? context.input;

  context.log('info', 'Produced JSON transform output.');

  return {
    output
  };
}

async function executeTemplate(context: StepExecutionContext): Promise<StepExecutionResult> {
  const template = asString(context.node.config.template);

  if (!template) {
    throw new Error('Template requires config.template.');
  }

  throwIfAborted(context.signal);
  const rendered = renderTemplate(template, {
    workflow: {
      id: context.workflow.id,
      name: context.workflow.name,
      description: context.workflow.description,
      tags: context.workflow.tags
    },
    input: context.input,
    steps: context.input
  });

  context.log('info', 'Rendered template output.');

  return {
    output: {
      template,
      rendered
    }
  };
}

async function executeCondition(context: StepExecutionContext): Promise<StepExecutionResult> {
  throwIfAborted(context.signal);
  const sourceNodeId = asString(context.node.config.sourceNodeId);
  const propertyPath = asString(context.node.config.path);
  const operator = asString(context.node.config.operator) ?? 'exists';
  const expected = context.node.config.equals ?? context.node.config.value;
  const source = sourceNodeId ? context.input[sourceNodeId] : context.input;
  const inspectedValue = propertyPath ? resolvePathValue(source, propertyPath) : source;

  let result = false;

  if (operator === 'exists') {
    result = inspectedValue !== null && inspectedValue !== undefined && inspectedValue !== '';
  } else if (operator === 'not-equals') {
    result = inspectedValue !== expected;
  } else {
    result = inspectedValue === expected;
  }

  context.log('info', 'Evaluated condition node.', {
    operator,
    result
  });

  return {
    output: {
      result,
      operator,
      expected,
      inspectedValue
    }
  };
}

async function executeSelectRepository(context: StepExecutionContext): Promise<StepExecutionResult> {
  throwIfAborted(context.signal);
  const repositoryId = asString(context.node.config.repositoryId);
  const repositoryPath = asString(context.node.config.path) ?? asString(context.node.config.repositoryPath);
  context.log('info', 'Resolving repository context for downstream steps.', {
    repositoryId,
    repositoryPath: repositoryPath ?? null
  });
  const repository = repositoryPath
    ? context.workflowStore.resolveAdHocRepository(repositoryPath)
    : repositoryId
      ? context.workflowStore.getRepository(repositoryId)
      : context.workflowStore.getRepository('mounted-root');

  if (!repository) {
    throw new Error(repositoryId ? `Repository ${repositoryId} is not registered.` : 'Could not resolve repository selection.');
  }

  context.log('info', 'Selected repository context.', {
    repositoryId: repository.id,
    repository: repository.hostPath,
    source: repository.source
  });

  return {
    output: {
      repository
    },
    context: {
      repository
    }
  };
}

async function executeApproval(context: StepExecutionContext): Promise<StepExecutionResult> {
  throwIfAborted(context.signal);
  const prompt = asString(context.node.config.prompt) ?? 'Approval granted.';

  context.log('info', 'Approval node completed after manual approval.', {
    prompt
  });

  return {
    output: {
      approved: true,
      prompt
    }
  };
}

export function buildApprovalPrompt(node: WorkflowNode, task: TaskCatalogEntry | null): string {
  if (node.taskKey === 'approval') {
    return asString(node.config.prompt) ?? `Approve workflow node ${node.name}.`;
  }

  return `${task?.name ?? node.taskKey} requires approval before execution.`;
}

export function requiresApproval(node: WorkflowNode, task: TaskCatalogEntry | null, rules?: ApprovalRules): boolean {
  if (node.taskKey === 'approval') {
    return true;
  }

  const explicitApproval = asBoolean(node.config.requiresApproval);

  if (explicitApproval !== null) {
    return explicitApproval;
  }

  if (asBoolean(node.config.autoApprove) === true) {
    return false;
  }

  if (rules?.globalDefaults.includes(node.taskKey)) {
    return false;
  }

  return Boolean(task?.requiresApprovalByDefault);
}

export async function executeTaskNode(context: StepExecutionContext): Promise<StepExecutionResult> {
  const resolvedContext: StepExecutionContext = {
    ...context,
    node: {
      ...context.node,
      config: resolveSecretTokens(context.node.config, context.secretStore) as Record<string, unknown>
    }
  };

  switch (resolvedContext.node.taskKey) {
    case 'select-repository':
      return executeSelectRepository(resolvedContext);
    case 'read-file':
      return executeReadFile(resolvedContext);
    case 'write-file':
      return executeWriteFile(resolvedContext);
    case 'search-repo':
      return executeSearchRepo(resolvedContext);
    case 'shell-command':
      return executeShellCommand(resolvedContext);
    case 'git-summary':
      return executeGitSummary(resolvedContext);
    case 'http-request':
      return executeHttpRequest(resolvedContext);
    case 'mcp-call':
      return executeMcpCall({
        config: resolvedContext.config,
        input: resolvedContext.input,
        log: resolvedContext.log,
        node: resolvedContext.node,
        secretStore: resolvedContext.secretStore,
        signal: resolvedContext.signal,
        timeoutMs: asNumber(resolvedContext.node.config.timeoutMs) ?? resolvedContext.task?.resourceDefaults.timeoutMs ?? 60_000,
        workflowStore: resolvedContext.workflowStore
      });
    case 'json-transform':
      return executeJsonTransform(resolvedContext);
    case 'template':
      return executeTemplate(resolvedContext);
    case 'condition':
      return executeCondition(resolvedContext);
    case 'approval':
      return executeApproval(resolvedContext);
    case 'agent':
      return executeAgent(resolvedContext);
    case 'browser-automation':
      return executeBrowserAutomation({
        config: resolvedContext.config,
        log: resolvedContext.log,
        node: resolvedContext.node,
        signal: resolvedContext.signal,
        timeoutMs: asNumber(resolvedContext.node.config.timeoutMs) ?? resolvedContext.task?.resourceDefaults.timeoutMs ?? 180_000
      });
    default: {
      // Try to handle custom tasks
      const customTasks = resolvedContext.workflowStore.listCustomTasks();
      const customTask = customTasks.find((t) => t.key === resolvedContext.node.taskKey);

      if (customTask && customTask.executionStrategy === 'agent') {
        // For custom tasks, use the agent executor with task-specific instruction
        const taskInstruction = `You are executing a custom task: ${customTask.name}
Description: ${customTask.description}

Task Objective: ${resolvedContext.node.config.objective ?? 'Complete the specified task'}

Use the available tools and context to accomplish this objective. Return structured results.`;

        return executeAgent({
          ...resolvedContext,
          node: {
            ...resolvedContext.node,
            config: {
              ...resolvedContext.node.config,
              objective: taskInstruction
            }
          }
        });
      }

      throw new Error(`Unknown task key ${resolvedContext.node.taskKey}.`);
    }
  }
}