import { FastifyInstance, FastifyReply } from 'fastify';

import { CustomTask, PromptAttachmentPayload, TaskCatalogEntry, TaskDraft } from '@flow-machine/shared-types';

import { AppConfig } from '../lib/config';
import { parseModelGeneratedJson } from '../lib/model-generated-json';
import { buildPromptAttachmentContext } from '../lib/prompt-attachments';
import {
  inferExecutionStrategy,
  isCustomTask,
  normalizeTaskDefinition,
  normalizeTaskDraft,
  toCustomTaskInput
} from '../lib/task-drafts';
import { WorkflowStore } from '../lib/workflow-store';

interface GenerateTaskRequest {
  attachments?: PromptAttachmentPayload[];
  description: string;
}

interface RefineTaskRequest {
  attachments?: PromptAttachmentPayload[];
  instructions: string;
}

interface RefineTaskDraftRequest {
  attachments?: PromptAttachmentPayload[];
  instructions: string;
  task: TaskDraft;
}

interface SaveTaskDraftRequest {
  task: TaskDraft;
}

interface OllamaGenerateResponse {
  response?: string;
  eval_count?: number;
  prompt_eval_count?: number;
  done?: boolean;
}

type TaskOperationStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'token'; text: string }
  | { type: 'draft'; message: string; taskDraft: TaskDraft }
  | { type: 'result'; message: string; customTask: CustomTask }
  | { type: 'error'; message: string };

const taskModelTimeoutMs = 5 * 60_000;

async function readOllamaErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };

    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }

    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    return text.trim();
  }

  return text.trim() || fallback;
}

function assertNetworkAllowed(isAllowed: boolean, url: string): URL {
  if (!isAllowed) {
    throw new Error('Network access is not allowed in strict-local privacy mode.');
  }

  return new URL(url);
}

function buildGenerateTaskPrompts(description: string, attachmentContext = ''): { fullPrompt: string; systemPrompt: string } {
  const systemPrompt = `You are a task generator for a workflow engine. Generate a valid task draft as JSON.
The generated task must be executable by a generic agent system.

Output ONLY valid JSON with these fields (all required):
{
  "key": "unique-lowercase-with-hyphens",
  "name": "Human Readable Name",
  "description": "What this task does",
  "reason": "Why this task is needed",
  "capabilities": [],
  "requiresApprovalByDefault": false,
  "resourceDefaults": {
    "cpuShares": 128,
    "memoryMb": 512,
    "timeoutMs": 60000,
    "concurrency": 1
  }
}

Make the key URL-safe and stable.
Use capabilities from: ["filesystem:read", "filesystem:write", "shell", "git:read", "git:write", "network:http", "network:mcp", "secrets", "browser", "llm"].
Mark requiresApprovalByDefault as true for tasks that modify state or access sensitive data.
Return raw JSON only, with no markdown fences or commentary.`;

  const userPrompt = `Generate a task based on this description: ${description}`;

  return {
    systemPrompt,
    fullPrompt: `${systemPrompt}\n\nUser Request: ${userPrompt}${attachmentContext ? `\n\n${attachmentContext}` : ''}`
  };
}

function buildRefineTaskPrompts(
  currentTask: TaskCatalogEntry | TaskDraft,
  instructions: string,
  attachmentContext = ''
): { fullPrompt: string; systemPrompt: string } {
  const systemPrompt = `You are editing a workflow task definition.
Return ONLY valid JSON for this exact schema:
{
  "key": "${currentTask.key}",
  "name": "Human Readable Name",
  "description": "What this task does",
  "reason": "Why this task is needed",
  "capabilities": [],
  "requiresApprovalByDefault": false,
  "resourceDefaults": {
    "cpuShares": 128,
    "memoryMb": 512,
    "timeoutMs": 60000,
    "concurrency": 1
  }
}

Rules:
- Keep the key exactly "${currentTask.key}".
- Do not add any explanation or markdown.
- Only use capabilities from: ["filesystem:read", "filesystem:write", "shell", "git:read", "git:write", "network:http", "network:mcp", "secrets", "browser", "llm"].
- Preserve the task's runtime intent. You may refine its metadata, approval default, and resource defaults.`;

  return {
    systemPrompt,
    fullPrompt: `${systemPrompt}

Current task JSON:
${JSON.stringify(currentTask, null, 2)}

Requested edits:
${instructions.trim()}${attachmentContext ? `\n\n${attachmentContext}` : ''}`
  };
}

async function requestOllamaCompletion(baseUrl: URL, model: string, prompt: string, images: string[] = []): Promise<string> {
  const response = await fetch(new URL('/api/generate', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      images: images.length > 0 ? images : undefined,
      model,
      prompt,
      stream: false
    }),
    signal: AbortSignal.timeout(taskModelTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Ollama generation failed with HTTP ${response.status}.`));
  }

  const body = (await response.json()) as OllamaGenerateResponse;
  return body.response ?? '';
}

function startTaskStream(reply: FastifyReply): (event: TaskOperationStreamEvent) => void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });

  return (event: TaskOperationStreamEvent) => {
    reply.raw.write(`${JSON.stringify(event)}\n`);
  };
}

async function streamOllamaCompletion(
  baseUrl: URL,
  model: string,
  prompt: string,
  images: string[],
  writeEvent: (event: TaskOperationStreamEvent) => void
): Promise<string> {
  writeEvent({ type: 'status', message: 'Contacting Ollama…' });

  const response = await fetch(new URL('/api/generate', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      images: images.length > 0 ? images : undefined,
      model,
      prompt,
      stream: true
    }),
    signal: AbortSignal.timeout(taskModelTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Ollama generation failed with HTTP ${response.status}.`));
  }

  if (!response.body) {
    throw new Error('Ollama did not return a readable response stream.');
  }

  writeEvent({ type: 'status', message: 'Model stream opened. Waiting for output…' });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let hasSentTokenStatus = false;

  const handleLine = (line: string) => {
    const parsed = JSON.parse(line) as OllamaGenerateResponse;

    if (parsed.response) {
      fullResponse += parsed.response;
      writeEvent({ type: 'token', text: parsed.response });

      if (!hasSentTokenStatus) {
        hasSentTokenStatus = true;
        writeEvent({ type: 'status', message: 'Receiving model output…' });
      }
    }

    if (parsed.done) {
      const metricParts: string[] = [];

      if (typeof parsed.prompt_eval_count === 'number') {
        metricParts.push(`${parsed.prompt_eval_count} prompt tokens`);
      }

      if (typeof parsed.eval_count === 'number') {
        metricParts.push(`${parsed.eval_count} generated tokens`);
      }

      writeEvent({
        type: 'status',
        message: metricParts.length > 0 ? `Model finished streaming (${metricParts.join(', ')}).` : 'Model finished streaming.'
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      handleLine(trimmed);
    }
  }

  const trailing = `${buffer}${decoder.decode()}`.trim();

  if (trailing) {
    handleLine(trailing);
  }

  return fullResponse;
}

export async function registerCustomTaskRoutes(server: FastifyInstance, workflowStore: WorkflowStore, config: AppConfig): Promise<void> {
  server.get('/api/tasks/custom', async () => {
    const customTasks = workflowStore.listCustomTasks();

    return {
      customTasks
    };
  });

  server.post<{ Body: SaveTaskDraftRequest }>('/api/tasks/custom', async (request, reply) => {
    try {
      const taskDraft = normalizeTaskDraft(request.body.task);
      const customTask = workflowStore.upsertCustomTask(toCustomTaskInput(taskDraft));

      return reply.code(201).send({ customTask });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Could not save task draft.'
      });
    }
  });

  server.post<{ Body: GenerateTaskRequest }>('/api/tasks/preview/generate/stream', async (request, reply) => {
    const { attachments, description } = request.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return reply.code(400).send({ error: 'Description is required' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ error: 'No model selected. Please select a default model in Settings.' });
    }

    const writeEvent = startTaskStream(reply);

    try {
      writeEvent({ type: 'status', message: 'Preparing task draft request…' });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const { fullPrompt, systemPrompt } = buildGenerateTaskPrompts(description, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const taskDefinitionText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating generated task draft…' });

      const taskDraft = normalizeTaskDraft(parseModelGeneratedJson(taskDefinitionText), {
        executionStrategy: 'agent',
        reasonFallback: 'Generated from your prompt.',
        source: 'generated',
        systemPrompt
      });

      writeEvent({ type: 'draft', message: `Task draft ready: ${taskDraft.name}`, taskDraft });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to generate task draft.'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Body: RefineTaskDraftRequest }>('/api/tasks/preview/refine/stream', async (request, reply) => {
    const { attachments, instructions, task } = request.body;

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      return reply.code(400).send({ error: 'Edit instructions are required.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ error: 'No model selected. Please select a default model in Settings.' });
    }

    let currentTask: TaskDraft;

    try {
      currentTask = normalizeTaskDraft(task);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Task draft is invalid.' });
    }

    const writeEvent = startTaskStream(reply);

    try {
      writeEvent({ type: 'status', message: `Preparing task draft refinement for ${currentTask.key}…` });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const { fullPrompt } = buildRefineTaskPrompts(currentTask, instructions, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const refinedTaskText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating refined task draft…' });

      const taskDraft = normalizeTaskDraft(parseModelGeneratedJson(refinedTaskText), {
        currentTask,
        executionStrategy: currentTask.executionStrategy,
        reasonFallback: currentTask.reason,
        source: currentTask.source,
        systemPrompt: currentTask.systemPrompt
      });

      writeEvent({ type: 'draft', message: `Updated task draft: ${taskDraft.name}`, taskDraft });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to refine task draft.'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Body: GenerateTaskRequest }>('/api/tasks/generate', async (request, reply) => {
    const { attachments, description } = request.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return reply.code(400).send({ error: 'Description is required' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ error: 'No model selected. Please select a default model in Settings.' });
    }

    try {
      const attachmentContext = await buildPromptAttachmentContext(attachments);
      const { fullPrompt, systemPrompt } = buildGenerateTaskPrompts(description, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const taskDefinitionText = await requestOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images);

      const taskDraft = normalizeTaskDraft(parseModelGeneratedJson(taskDefinitionText), {
        executionStrategy: 'agent',
        reasonFallback: 'Generated from your prompt.',
        source: 'generated',
        systemPrompt
      });
      const customTask = workflowStore.upsertCustomTask(toCustomTaskInput(taskDraft));

      return {
        customTask
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate task';
      return reply.code(500).send({ error: message });
    }
  });

  server.post<{ Body: RefineTaskRequest; Params: { key: string } }>('/api/tasks/:key/refine', async (request, reply) => {
    const { key } = request.params;
    const { attachments, instructions } = request.body;

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      return reply.code(400).send({ error: 'Edit instructions are required.' });
    }

    const currentTask = workflowStore.getTaskCatalogEntry(key);

    if (!currentTask) {
      return reply.code(404).send({ error: 'Task not found.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ error: 'No model selected. Please select a default model in Settings.' });
    }

    try {
      const attachmentContext = await buildPromptAttachmentContext(attachments);
      const { fullPrompt } = buildRefineTaskPrompts(currentTask, instructions, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const refinedTaskText = await requestOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images);
      const refinedTask = normalizeTaskDefinition(parseModelGeneratedJson(refinedTaskText), currentTask);
      const customTask = workflowStore.upsertCustomTask({
        ...refinedTask,
        source: isCustomTask(currentTask) ? currentTask.source : 'manual',
        executionStrategy: inferExecutionStrategy(currentTask),
        systemPrompt: isCustomTask(currentTask) ? currentTask.systemPrompt : undefined
      });

      return {
        customTask
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update task';
      return reply.code(500).send({ error: message });
    }
  });

  server.post<{ Body: GenerateTaskRequest }>('/api/tasks/generate/stream', async (request, reply) => {
    const { attachments, description } = request.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return reply.code(400).send({ error: 'Description is required' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ error: 'No model selected. Please select a default model in Settings.' });
    }

    const writeEvent = startTaskStream(reply);

    try {
      writeEvent({ type: 'status', message: 'Preparing task generation request…' });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const { fullPrompt, systemPrompt } = buildGenerateTaskPrompts(description, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const taskDefinitionText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating generated task JSON…' });

      const taskDraft = normalizeTaskDraft(parseModelGeneratedJson(taskDefinitionText), {
        executionStrategy: 'agent',
        reasonFallback: 'Generated from your prompt.',
        source: 'generated',
        systemPrompt
      });
      const customTask = workflowStore.upsertCustomTask(toCustomTaskInput(taskDraft));

      writeEvent({ type: 'status', message: 'Saving generated task to the local catalog…' });
      writeEvent({ type: 'result', message: `Generated custom task: ${customTask.name}`, customTask });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to generate task'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Body: RefineTaskRequest; Params: { key: string } }>('/api/tasks/:key/refine/stream', async (request, reply) => {
    const { key } = request.params;
    const { attachments, instructions } = request.body;

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      return reply.code(400).send({ error: 'Edit instructions are required.' });
    }

    const currentTask = workflowStore.getTaskCatalogEntry(key);

    if (!currentTask) {
      return reply.code(404).send({ error: 'Task not found.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ error: 'No model selected. Please select a default model in Settings.' });
    }

    const writeEvent = startTaskStream(reply);

    try {
      writeEvent({ type: 'status', message: `Preparing task refinement for ${currentTask.key}…` });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const { fullPrompt } = buildRefineTaskPrompts(currentTask, instructions, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const refinedTaskText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating refined task JSON…' });

      const refinedTask = normalizeTaskDefinition(parseModelGeneratedJson(refinedTaskText), currentTask);
      const customTask = workflowStore.upsertCustomTask({
        ...refinedTask,
        source: isCustomTask(currentTask) ? currentTask.source : 'manual',
        executionStrategy: inferExecutionStrategy(currentTask),
        systemPrompt: isCustomTask(currentTask) ? currentTask.systemPrompt : undefined
      });

      writeEvent({ type: 'status', message: 'Saving refined task override to the local catalog…' });
      writeEvent({ type: 'result', message: `Updated task: ${customTask.name}`, customTask });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to update task'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.delete<{ Params: { key: string } }>('/api/tasks/custom/:key', async (request, reply) => {
    const { key } = request.params;

    const deleted = workflowStore.deleteCustomTask(key);

    if (!deleted) {
      return reply.code(404).send({ error: 'Custom task not found' });
    }

    return reply.code(204).send();
  });
}
