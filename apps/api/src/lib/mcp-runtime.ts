import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WorkflowNode, WorkflowRunNetworkActivity } from '@flow-machine/shared-types';

import { AppConfig } from './config';
import { SecretStore } from './secret-store';
import { WorkflowStore } from './workflow-store';

type RuntimeLogger = (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;

interface McpRuntimeContext {
  config: AppConfig;
  input: Record<string, unknown>;
  log: RuntimeLogger;
  node: WorkflowNode;
  secretStore: SecretStore;
  signal: AbortSignal;
  timeoutMs: number;
  workflowStore: WorkflowStore;
}

interface McpExecutionResult {
  output: unknown;
  network: WorkflowRunNetworkActivity[];
}

type NormalizedMcpConnection =
  | {
      allowSseFallback: false;
      args: string[];
      command: string;
      cwd?: string;
      env?: Record<string, string>;
      requestInit?: never;
      sessionId?: never;
      target: string;
      transport: 'stdio';
    }
  | {
      allowSseFallback: boolean;
      args?: never;
      command?: never;
      cwd?: never;
      env?: never;
      requestInit?: RequestInit;
      sessionId?: string;
      target: string;
      transport: 'streamable-http';
      url: URL;
    }
  | {
      allowSseFallback: false;
      args?: never;
      command?: never;
      cwd?: never;
      env?: never;
      requestInit?: RequestInit;
      sessionId?: never;
      target: string;
      transport: 'sse';
      url: URL;
    };

interface ResolvedServerDefinition {
  definition: Record<string, unknown>;
  inlineTransport: boolean;
  serverId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function truncateText(value: string, maxLength = 4_000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...[truncated]`;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function resolveSecretTokensInString(value: string, secretStore: SecretStore): string {
  return value.replace(/\{\{\s*secret:([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const secret = secretStore.getSecretValue(key);

    if (secret === null) {
      throw new Error(`Missing secret ${key}.`);
    }

    return secret;
  });
}

function interpolateVariables(value: string, config: AppConfig): string {
  return value
    .replace(/\$\{workspaceFolder\}/g, config.repoRoot)
    .replace(/\$\{workspaceFolderBasename\}/g, path.basename(config.repoRoot))
    .replace(/\$\{env:([^}]+)\}/g, (_match, key: string) => process.env[key] ?? '');
}

function resolveDynamicValues(value: unknown, config: AppConfig, secretStore: SecretStore): unknown {
  if (typeof value === 'string') {
    return interpolateVariables(resolveSecretTokensInString(value, secretStore), config);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveDynamicValues(entry, config, secretStore));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveDynamicValues(entry, config, secretStore)])
    );
  }

  return value;
}

function normalizeRelativePath(rootPath: string, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(rootPath, value);
}

function normalizeCommand(rootPath: string, value: string): string {
  if (path.isAbsolute(value) || value.includes(path.sep) || value.startsWith('.')) {
    return normalizeRelativePath(rootPath, value);
  }

  return value;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => [key, String(entry)]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);

      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      cleanup();
      reject(createAbortError(signal!));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    operation
      .then((value) => {
        cleanup();
        resolve(value);
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}

function assertMcpUrlAllowed(config: AppConfig, rawUrl: string): URL {
  const url = new URL(rawUrl);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported MCP transport URL protocol ${url.protocol}. Expected http or https.`);
  }

  if (config.privacyMode === 'strict-local' && !isLoopbackHostname(url.hostname)) {
    throw new Error(`Strict local-only mode blocks MCP access to ${url.origin}.`);
  }

  return url;
}

function hasInlineTransportDefinition(config: Record<string, unknown>): boolean {
  return typeof config.command === 'string' || typeof config.url === 'string';
}

function resolveServerDefinition(context: McpRuntimeContext): ResolvedServerDefinition {
  const inlineDefinition = isRecord(context.node.config.connection) ? context.node.config.connection : null;
  const serverId = asString(context.node.config.server);

  if (inlineDefinition) {
    return {
      definition: resolveDynamicValues(inlineDefinition, context.config, context.secretStore) as Record<string, unknown>,
      inlineTransport: false,
      serverId: serverId ?? 'inline'
    };
  }

  if (serverId) {
    const managedDefinition = context.workflowStore.getMcpConfig().servers[serverId];

    if (!isRecord(managedDefinition)) {
      throw new Error(`MCP server ${serverId} is not configured.`);
    }

    return {
      definition: resolveDynamicValues(managedDefinition, context.config, context.secretStore) as Record<string, unknown>,
      inlineTransport: false,
      serverId
    };
  }

  if (hasInlineTransportDefinition(context.node.config)) {
    return {
      definition: resolveDynamicValues(context.node.config, context.config, context.secretStore) as Record<string, unknown>,
      inlineTransport: true,
      serverId: 'inline'
    };
  }

  throw new Error('MCP Call requires config.server or an inline MCP connection definition.');
}

function normalizeMcpConnection(context: McpRuntimeContext, definition: Record<string, unknown>): NormalizedMcpConnection {
  const transport = asString(definition.transport) ?? asString(definition.type);
  const command = asString(definition.command);
  const rawUrl = asString(definition.url);
  const headers = stringRecord(definition.headers) ?? {};
  const bearerToken =
    asString(definition.authorization) ??
    (asString(definition.bearerToken) ?? asString(definition.authToken) ?? asString(definition.token)
      ? `Bearer ${asString(definition.bearerToken) ?? asString(definition.authToken) ?? asString(definition.token)}`
      : null);

  if (bearerToken && !headers.Authorization) {
    headers.Authorization = bearerToken;
  }

  const requestInit = Object.keys(headers).length > 0 ? { headers } satisfies RequestInit : undefined;

  if (command) {
    const args = Array.isArray(definition.args)
      ? definition.args.filter((value): value is string => typeof value === 'string')
      : [];
    const cwd = asString(definition.cwd);

    return {
      allowSseFallback: false,
      args,
      command: normalizeCommand(context.config.repoRoot, command),
      cwd: cwd ? normalizeRelativePath(context.config.repoRoot, cwd) : undefined,
      env: stringRecord(definition.env),
      target: `stdio:${command}`,
      transport: 'stdio'
    };
  }

  if (!rawUrl) {
    throw new Error('MCP connection definition must include command or url.');
  }

  const url = assertMcpUrlAllowed(context.config, rawUrl);
  const sessionId = asString(definition.sessionId) ?? undefined;

  if (transport === 'sse') {
    return {
      allowSseFallback: false,
      requestInit,
      target: url.origin,
      transport: 'sse',
      url
    };
  }

  return {
    allowSseFallback: asBoolean(definition.allowSseFallback) ?? true,
    requestInit,
    sessionId,
    target: url.origin,
    transport: 'streamable-http',
    url
  };
}

function buildToolArguments(context: McpRuntimeContext, inlineTransport: boolean): Record<string, unknown> | undefined {
  const explicitArguments = context.node.config.arguments;

  if (explicitArguments !== undefined && !isRecord(explicitArguments)) {
    throw new Error('MCP Call config.arguments must be an object when provided.');
  }

  const excludedKeys = new Set(['server', 'tool', 'arguments', 'argumentsFromInput', 'connection', 'timeoutMs', 'allowSseFallback']);

  if (inlineTransport) {
    for (const key of ['command', 'args', 'env', 'cwd', 'url', 'headers', 'transport', 'type', 'sessionId', 'authorization', 'bearerToken', 'authToken', 'token']) {
      excludedKeys.add(key);
    }
  }

  const inferredArguments = Object.fromEntries(
    Object.entries(context.node.config).filter(([key]) => !excludedKeys.has(key))
  );

  const includeInput = asBoolean(context.node.config.argumentsFromInput) === true;
  const mergedBase = includeInput ? { ...context.input, ...inferredArguments } : inferredArguments;

  if (explicitArguments) {
    return resolveDynamicValues(
      Object.keys(mergedBase).length > 0 ? { ...mergedBase, ...explicitArguments } : explicitArguments,
      context.config,
      context.secretStore
    ) as Record<string, unknown>;
  }

  return Object.keys(mergedBase).length > 0
    ? (resolveDynamicValues(mergedBase, context.config, context.secretStore) as Record<string, unknown>)
    : undefined;
}

async function connectWithTransport(
  client: Client,
  connection: NormalizedMcpConnection,
  timeoutMs: number,
  signal: AbortSignal
): Promise<{ stderrChunks: string[]; transport: SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport }> {
  if (connection.transport === 'stdio') {
    const transport = new StdioClientTransport({
      command: connection.command,
      args: connection.args,
      cwd: connection.cwd,
      env: connection.env,
      stderr: 'pipe'
    });
    const stderrChunks: string[] = [];
    const stderrStream = transport.stderr;

    if (stderrStream) {
      stderrStream.on('data', (chunk) => {
        stderrChunks.push(chunk.toString());
      });
    }

    await withTimeout(client.connect(transport), timeoutMs, 'Connecting to MCP stdio server', signal);

    return {
      stderrChunks,
      transport
    };
  }

  if (connection.transport === 'sse') {
    const transport = new SSEClientTransport(connection.url, {
      requestInit: connection.requestInit
    });

    await withTimeout(client.connect(transport), timeoutMs, 'Connecting to MCP SSE server', signal);

    return {
      stderrChunks: [],
      transport
    };
  }

  const transport = new StreamableHTTPClientTransport(connection.url, {
    requestInit: connection.requestInit,
    sessionId: connection.sessionId
  });

  await withTimeout(client.connect(transport), timeoutMs, 'Connecting to MCP HTTP server', signal);

  return {
    stderrChunks: [],
    transport
  };
}

export async function executeMcpCall(context: McpRuntimeContext): Promise<McpExecutionResult> {
  const resolvedServer = resolveServerDefinition(context);
  const connection = normalizeMcpConnection(context, resolvedServer.definition);
  const toolName = asString(context.node.config.tool);

  if (!toolName) {
    throw new Error('MCP Call requires config.tool.');
  }

  const toolArguments = buildToolArguments(context, resolvedServer.inlineTransport);
  const client = new Client({
    name: 'flow-machine',
    version: context.config.appVersion
  });
  const transportErrors: string[] = [];
  let stderrChunks: string[] = [];
  let transport: SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport | null = null;
  let usedTransport = connection.transport;
  const handleAbort = () => {
    void Promise.allSettled([client.close(), transport?.close()]);
  };

  context.signal.addEventListener('abort', handleAbort, { once: true });

  try {
    context.log('info', 'Connecting to MCP server.', {
      server: resolvedServer.serverId,
      target: connection.target,
      transport: connection.transport
    });

    try {
      const result = await connectWithTransport(client, connection, context.timeoutMs, context.signal);
      stderrChunks = result.stderrChunks;
      transport = result.transport;
    } catch (error) {
      if (connection.transport !== 'streamable-http' || !connection.allowSseFallback) {
        throw error;
      }

      context.log('warn', 'Streamable HTTP MCP connection failed. Retrying with legacy SSE transport.', {
        server: resolvedServer.serverId,
        target: connection.target,
        error: stringifyError(error)
      });

      const fallbackResult = await connectWithTransport(
        client,
        {
          allowSseFallback: false,
          requestInit: connection.requestInit,
          target: connection.target,
          transport: 'sse',
          url: connection.url
        },
        context.timeoutMs,
        context.signal
      );

      stderrChunks = fallbackResult.stderrChunks;
      transport = fallbackResult.transport;
      usedTransport = 'sse';
    }

    transport.onerror = (error) => {
      transportErrors.push(stringifyError(error));
    };

    const toolsResult = await withTimeout(client.listTools(), context.timeoutMs, 'Listing MCP tools', context.signal);
    const availableTools = toolsResult.tools.map((tool) => tool.name);

    if (!availableTools.includes(toolName)) {
      throw new Error(
        `MCP server ${resolvedServer.serverId} does not expose tool ${toolName}. Available tools: ${availableTools.join(', ') || 'none'}.`
      );
    }

    const toolResult = await withTimeout(
      client.callTool(
        toolArguments
          ? {
              arguments: toolArguments,
              name: toolName
            }
          : {
              name: toolName
            }
      ),
      context.timeoutMs,
      `Calling MCP tool ${toolName}`,
      context.signal
    );

    const stderrOutput = stderrChunks.join('');

    if (stderrOutput.trim().length > 0) {
      context.log('warn', 'MCP server emitted stderr during execution.', {
        server: resolvedServer.serverId,
        stderr: truncateText(stderrOutput)
      });
    }

    context.log('info', 'Completed MCP tool call.', {
      server: resolvedServer.serverId,
      tool: toolName,
      transport: usedTransport
    });

    return {
      network: [
        {
          kind: 'mcp',
          method: toolName,
          target: connection.target
        }
      ],
      output: {
        arguments: toolArguments ?? null,
        availableTools,
        diagnostics:
          stderrOutput.trim().length > 0 || transportErrors.length > 0
            ? {
                stderr: stderrOutput.trim().length > 0 ? truncateText(stderrOutput) : null,
                transportErrors
              }
            : null,
        result: toolResult,
        server: resolvedServer.serverId,
        serverInfo: client.getServerVersion() ?? null,
        tool: toolName,
        transport: usedTransport
      }
    };
  } finally {
    context.signal.removeEventListener('abort', handleAbort);
    await Promise.allSettled([client.close(), transport?.close()]);
  }
}