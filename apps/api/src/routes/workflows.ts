import { FastifyInstance, FastifyReply } from 'fastify';

import {
  PromptAttachmentPayload,
  TaskCatalogEntry,
  TaskDraft,
  WorkflowDefinition,
  WorkflowDocument,
  WorkflowDraft,
  WorkflowDraftProposal
} from '@flow-machine/shared-types';

import { AppConfig } from '../lib/config';
import { parseModelGeneratedJson } from '../lib/model-generated-json';
import { buildPromptAttachmentContext } from '../lib/prompt-attachments';
import { stableStringify } from '../lib/stable-json';
import { normalizeTaskDraft, toCustomTaskInput } from '../lib/task-drafts';
import {
  WorkflowMutationInput,
  parseWorkflowMutationInput,
  sanitizeTags,
  sanitizeWorkflowDefinition
} from '../lib/workflow-validation';
import { WorkflowStore } from '../lib/workflow-store';

interface GenerateWorkflowRequest {
  attachments?: PromptAttachmentPayload[];
  description: string;
}

interface RefineWorkflowRequest {
  attachments?: PromptAttachmentPayload[];
  instructions: string;
  workflow?: WorkflowMutationInput;
}

interface RefineWorkflowDraftRequest {
  attachments?: PromptAttachmentPayload[];
  instructions: string;
  proposal: WorkflowDraftProposal;
}

interface ApplyWorkflowDraftRequest {
  proposal: WorkflowDraftProposal;
}

interface OllamaGenerateResponse {
  done?: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
  response?: string;
}

type WorkflowOperationStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'token'; text: string }
  | { type: 'draft'; message: string; proposal: WorkflowDraftProposal }
  | { type: 'result'; message: string; workflow: WorkflowDocument }
  | { type: 'error'; message: string };

const workflowModelTimeoutMs = 5 * 60_000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function assertNetworkAllowed(isAllowed: boolean, url: string): URL {
  if (!isAllowed) {
    throw new Error('Network access is not allowed in strict-local privacy mode.');
  }

  return new URL(url);
}

function toWorkflowMutationInput(workflow: WorkflowDocument): WorkflowMutationInput {
  return {
    name: workflow.name,
    description: workflow.description,
    tags: workflow.tags,
    definition: workflow.definition
  };
}

function buildTaskCatalogReference(taskCatalog: TaskCatalogEntry[]): string {
  return taskCatalog
    .map(
      (task) =>
        `- ${task.key}: ${task.name} | ${task.description} | capabilities=${task.capabilities.join(',') || 'none'} | approval=${task.requiresApprovalByDefault}`
    )
    .join('\n');
}

function buildAllowedTaskKeySet(taskCatalog: TaskCatalogEntry[], taskDrafts: TaskDraft[] = []): Set<string> {
  return new Set([...taskCatalog.map((task) => task.key), ...taskDrafts.map((task) => task.key)]);
}

function layoutWorkflowDefinition(definition: WorkflowDefinition, fallbackDefinition?: WorkflowDefinition): WorkflowDefinition {
  if (definition.nodes.length === 0) {
    return definition;
  }

  const fallbackPositions = new Map((fallbackDefinition?.nodes ?? []).map((node) => [node.id, node.position]));
  let nextIndex = fallbackPositions.size;

  return {
    ...definition,
    startNodeId: definition.startNodeId ?? definition.nodes[0].id,
    nodes: definition.nodes.map((node) => {
      const fallbackPosition = fallbackPositions.get(node.id);

      if (fallbackPosition) {
        return {
          ...node,
          position: fallbackPosition
        };
      }

      const index = nextIndex;
      nextIndex += 1;

      return {
        ...node,
        position: {
          x: 48 + (index % 3) * 232,
          y: 48 + Math.floor(index / 3) * 148
        }
      };
    })
  };
}

function normalizeWorkflowMutationCandidate(
  candidate: unknown,
  allowedTaskKeys: Set<string>,
  fallback?: Pick<WorkflowDraft, 'definition' | 'description' | 'name' | 'tags'>
): WorkflowDraft {
  if (!isRecord(candidate)) {
    throw new Error('The model did not return a valid workflow object.');
  }

  const hasDefinition = 'definition' in candidate;

  if (!hasDefinition && !fallback?.definition) {
    throw new Error('The model did not return a workflow definition.');
  }

  const normalizedDefinition = layoutWorkflowDefinition(
    sanitizeWorkflowDefinition(hasDefinition ? candidate.definition : fallback?.definition),
    fallback?.definition
  );
  const invalidTaskKeys = normalizedDefinition.nodes
    .map((node) => node.taskKey)
    .filter((taskKey) => !allowedTaskKeys.has(taskKey));

  if (invalidTaskKeys.length > 0) {
    throw new Error(`Workflow includes unknown task keys: ${Array.from(new Set(invalidTaskKeys)).join(', ')}.`);
  }

  return {
    name: readString(candidate.name, fallback?.name ?? 'Generated workflow'),
    description: typeof candidate.description === 'string' ? candidate.description.trim() : fallback?.description ?? '',
    tags: Array.isArray(candidate.tags) ? sanitizeTags(candidate.tags) : fallback?.tags ?? [],
    definition: normalizedDefinition
  };
}

function normalizeWorkflowDraftProposalCandidate(
  candidate: unknown,
  taskCatalog: TaskCatalogEntry[],
  fallback?: WorkflowDraftProposal
): WorkflowDraftProposal {
  if (!isRecord(candidate)) {
    throw new Error('The model did not return a valid workflow draft proposal.');
  }

  const fallbackTasksByKey = new Map((fallback?.taskDrafts ?? []).map((task) => [task.key, task]));
  const rawTaskDrafts = Array.isArray(candidate.taskDrafts) ? candidate.taskDrafts : fallback?.taskDrafts ?? [];
  const normalizedTaskDrafts = rawTaskDrafts.reduce<TaskDraft[]>((accumulator, entry) => {
    const fallbackKey = isRecord(entry) && typeof entry.key === 'string' ? entry.key.trim() : '';
    const fallbackTask = fallbackKey ? fallbackTasksByKey.get(fallbackKey) : undefined;
    const taskDraft = normalizeTaskDraft(entry, {
      currentTask: fallbackTask,
      executionStrategy: fallbackTask?.executionStrategy ?? 'agent',
      reasonFallback: fallbackTask?.reason ?? 'Explain why this task is needed instead of reusing an existing catalog task.',
      source: fallbackTask?.source ?? 'generated',
      systemPrompt: fallbackTask?.systemPrompt
    });

    if (!accumulator.some((existing) => existing.key === taskDraft.key)) {
      accumulator.push(taskDraft);
    }

    return accumulator;
  }, []);

  const workflowCandidate = isRecord(candidate.workflow) ? candidate.workflow : candidate;
  const workflow = normalizeWorkflowMutationCandidate(
    workflowCandidate,
    buildAllowedTaskKeySet(taskCatalog, normalizedTaskDrafts),
    fallback?.workflow
  );
  const workflowTaskKeys = [...new Set(workflow.definition.nodes.map((node) => node.taskKey))];
  const taskDrafts = normalizedTaskDrafts.filter((taskDraft) => workflowTaskKeys.includes(taskDraft.key));
  const existingTaskKeys = new Set(taskCatalog.map((task) => task.key));
  const missingDraftKeys = workflowTaskKeys.filter(
    (taskKey) => !existingTaskKeys.has(taskKey) && !taskDrafts.some((taskDraft) => taskDraft.key === taskKey)
  );

  if (missingDraftKeys.length > 0) {
    throw new Error(`Workflow references new task keys without task drafts: ${missingDraftKeys.join(', ')}.`);
  }

  return {
    workflow,
    summary: readString(
      candidate.summary,
      fallback?.summary ??
        (taskDrafts.length > 0
          ? 'Review the proposed workflow and approve the new task drafts before creating it.'
          : 'Review the workflow draft before creating it.')
    ),
    reusedTaskKeys: workflowTaskKeys.filter((taskKey) => existingTaskKeys.has(taskKey)),
    taskDrafts
  };
}

function buildGenerateWorkflowPrompts(
  description: string,
  taskCatalog: TaskCatalogEntry[],
  attachmentContext = ''
): { fullPrompt: string; systemPrompt: string } {
  const systemPrompt = `You are generating a graph workflow definition for a local-first workflow engine.
Return ONLY valid JSON matching this schema:
{
  "name": "Human readable workflow name",
  "description": "What the workflow does",
  "tags": ["tag-one", "tag-two"],
  "definition": {
    "version": "1",
    "startNodeId": "node-id",
    "nodes": [
      {
        "id": "node-id",
        "name": "Step name",
        "taskKey": "task-key",
        "position": { "x": 48, "y": 48 },
        "config": {}
      }
    ],
    "edges": [
      {
        "id": "edge-id",
        "source": "node-id",
        "target": "node-id"
      }
    ]
  }
}

Rules:
- Use ONLY the task keys provided below.
- Keep the workflow practical for software developers.
- Create a coherent graph with valid node ids, edge ids, and startNodeId.
- Prefer 2 to 8 nodes unless the request clearly needs more.
- Keep config values as plain JSON objects and only add fields that are clearly useful.
- Do not include markdown or explanation.`;

  return {
    systemPrompt,
    fullPrompt: `${systemPrompt}

Available task catalog:
${buildTaskCatalogReference(taskCatalog)}

User request:
${description.trim()}${attachmentContext ? `\n\n${attachmentContext}` : ''}`
  };
}

function buildGenerateWorkflowDraftPrompts(
  description: string,
  taskCatalog: TaskCatalogEntry[],
  attachmentContext = ''
): { fullPrompt: string; systemPrompt: string } {
  const systemPrompt = `You are generating a graph workflow draft for a local-first workflow engine.
Return ONLY valid JSON matching this schema:
{
  "summary": "Explain how the workflow uses existing tasks and why any proposed new tasks are needed.",
  "workflow": {
    "name": "Human readable workflow name",
    "description": "What the workflow does",
    "tags": ["tag-one", "tag-two"],
    "definition": {
      "version": "1",
      "startNodeId": "node-id",
      "nodes": [
        {
          "id": "node-id",
          "name": "Step name",
          "taskKey": "task-key",
          "position": { "x": 48, "y": 48 },
          "config": {}
        }
      ],
      "edges": [
        {
          "id": "edge-id",
          "source": "node-id",
          "target": "node-id"
        }
      ]
    }
  },
  "taskDrafts": [
    {
      "key": "new-task-key",
      "name": "Human readable task name",
      "description": "What the task does",
      "reason": "Why no existing task is enough",
      "capabilities": [],
      "requiresApprovalByDefault": false,
      "resourceDefaults": {
        "cpuShares": 128,
        "memoryMb": 512,
        "timeoutMs": 60000,
        "concurrency": 1
      }
    }
  ]
}

Rules:
- Reuse existing task keys whenever they are a reasonable fit.
- Only create a taskDraft when no existing task fits the requested workflow step.
- Every workflow node taskKey must refer either to an existing task key or to one of the taskDraft keys.
- Explain each taskDraft.reason clearly so the user can approve it.
- Return raw JSON only, with no markdown fences or commentary.`;

  return {
    systemPrompt,
    fullPrompt: `${systemPrompt}

Available task catalog:
${buildTaskCatalogReference(taskCatalog)}

User request:
${description.trim()}${attachmentContext ? `\n\n${attachmentContext}` : ''}`
  };
}

function buildRefineWorkflowPrompts(
  currentWorkflow: WorkflowMutationInput,
  instructions: string,
  taskCatalog: TaskCatalogEntry[],
  attachmentContext = ''
): { fullPrompt: string; systemPrompt: string } {
  const systemPrompt = `You are editing a graph workflow definition for a local-first workflow engine.
Return ONLY valid JSON matching this schema:
{
  "name": "Human readable workflow name",
  "description": "What the workflow does",
  "tags": ["tag-one", "tag-two"],
  "definition": {
    "version": "1",
    "startNodeId": "node-id",
    "nodes": [
      {
        "id": "node-id",
        "name": "Step name",
        "taskKey": "task-key",
        "position": { "x": 48, "y": 48 },
        "config": {}
      }
    ],
    "edges": [
      {
        "id": "edge-id",
        "source": "node-id",
        "target": "node-id"
      }
    ]
  }
}

Rules:
- Use ONLY the task keys provided below.
- Preserve the workflow's intent unless the instructions explicitly change it.
- Preserve existing node ids where practical so the editor can keep context.
- Return JSON only, with no explanation or markdown.`;

  return {
    systemPrompt,
    fullPrompt: `${systemPrompt}

Available task catalog:
${buildTaskCatalogReference(taskCatalog)}

Current workflow JSON:
${JSON.stringify(currentWorkflow, null, 2)}

Requested edits:
${instructions.trim()}${attachmentContext ? `\n\n${attachmentContext}` : ''}`
  };
}

function buildRefineWorkflowDraftPrompts(
  currentProposal: WorkflowDraftProposal,
  instructions: string,
  taskCatalog: TaskCatalogEntry[],
  attachmentContext = ''
): { fullPrompt: string; systemPrompt: string } {
  const systemPrompt = `You are editing a workflow draft proposal for a local-first workflow engine.
Return ONLY valid JSON matching this schema:
{
  "summary": "Explain how the workflow uses existing tasks and why any proposed new tasks are needed.",
  "workflow": {
    "name": "Human readable workflow name",
    "description": "What the workflow does",
    "tags": ["tag-one", "tag-two"],
    "definition": {
      "version": "1",
      "startNodeId": "node-id",
      "nodes": [
        {
          "id": "node-id",
          "name": "Step name",
          "taskKey": "task-key",
          "position": { "x": 48, "y": 48 },
          "config": {}
        }
      ],
      "edges": [
        {
          "id": "edge-id",
          "source": "node-id",
          "target": "node-id"
        }
      ]
    }
  },
  "taskDrafts": [
    {
      "key": "new-task-key",
      "name": "Human readable task name",
      "description": "What the task does",
      "reason": "Why no existing task is enough",
      "capabilities": [],
      "requiresApprovalByDefault": false,
      "resourceDefaults": {
        "cpuShares": 128,
        "memoryMb": 512,
        "timeoutMs": 60000,
        "concurrency": 1
      }
    }
  ]
}

Rules:
- Reuse existing task keys whenever they are a reasonable fit.
- Only keep taskDrafts that are still needed.
- Preserve existing workflow node ids and taskDraft keys where practical so the user can keep refining.
- Every workflow node taskKey must refer either to an existing task key or to one of the taskDraft keys.
- Return raw JSON only, with no markdown fences or commentary.`;

  return {
    systemPrompt,
    fullPrompt: `${systemPrompt}

Available task catalog:
${buildTaskCatalogReference(taskCatalog)}

Current proposal JSON:
${JSON.stringify(currentProposal, null, 2)}

Requested edits:
${instructions.trim()}${attachmentContext ? `\n\n${attachmentContext}` : ''}`
  };
}

function startWorkflowStream(reply: FastifyReply): (event: WorkflowOperationStreamEvent) => void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });

  return (event: WorkflowOperationStreamEvent) => {
    reply.raw.write(`${JSON.stringify(event)}\n`);
  };
}

async function streamOllamaCompletion(
  baseUrl: URL,
  model: string,
  prompt: string,
  images: string[],
  writeEvent: (event: WorkflowOperationStreamEvent) => void
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
    signal: AbortSignal.timeout(workflowModelTimeoutMs)
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

export async function registerWorkflowRoutes(server: FastifyInstance, workflowStore: WorkflowStore, config: AppConfig): Promise<void> {
  server.get('/api/workflows', async () => ({
    workflows: workflowStore.listWorkflowSummaries()
  }));

  server.get('/api/workflows/:id', async (request, reply) => {
    const workflow = workflowStore.getWorkflow((request.params as { id: string }).id);

    if (!workflow) {
      return reply.code(404).send({
        message: 'Workflow not found.'
      });
    }

    return { workflow };
  });

  server.get('/api/workflows/:id/export', async (request, reply) => {
    const workflow = workflowStore.exportWorkflow((request.params as { id: string }).id);

    if (!workflow) {
      return reply.code(404).send({
        message: 'Workflow not found.'
      });
    }

    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${workflow.id}.json"`);

    return stableStringify(workflow);
  });

  server.post('/api/workflows', async (request, reply) => {
    try {
      const input = parseWorkflowMutationInput(request.body);
      const workflow = workflowStore.createWorkflow(input);

      return reply.code(201).send({ workflow });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not create workflow.'
      });
    }
  });

  server.post<{ Body: GenerateWorkflowRequest }>('/api/workflows/preview/generate/stream', async (request, reply) => {
    const { attachments, description } = request.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return reply.code(400).send({ message: 'Workflow description is required.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ message: 'No model selected. Please select a default model in Settings.' });
    }

    const writeEvent = startWorkflowStream(reply);

    try {
      writeEvent({ type: 'status', message: 'Preparing workflow draft request…' });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const taskCatalog = workflowStore.listTaskCatalog();
      const { fullPrompt } = buildGenerateWorkflowDraftPrompts(description, taskCatalog, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const workflowText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating workflow draft…' });

      const proposal = normalizeWorkflowDraftProposalCandidate(parseModelGeneratedJson(workflowText), taskCatalog);

      writeEvent({ type: 'draft', message: `Workflow draft ready: ${proposal.workflow.name}`, proposal });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not generate workflow draft.'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Body: RefineWorkflowDraftRequest }>('/api/workflows/preview/refine/stream', async (request, reply) => {
    const { attachments, instructions, proposal } = request.body;

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      return reply.code(400).send({ message: 'Workflow edit instructions are required.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ message: 'No model selected. Please select a default model in Settings.' });
    }

    const taskCatalog = workflowStore.listTaskCatalog();
    let currentProposal: WorkflowDraftProposal;

    try {
      currentProposal = normalizeWorkflowDraftProposalCandidate(proposal, taskCatalog);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Current workflow draft proposal is invalid.'
      });
    }

    const writeEvent = startWorkflowStream(reply);

    try {
      writeEvent({ type: 'status', message: `Preparing workflow draft refinement for ${currentProposal.workflow.name}…` });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const { fullPrompt } = buildRefineWorkflowDraftPrompts(currentProposal, instructions, taskCatalog, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const workflowText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating refined workflow draft…' });

      const nextProposal = normalizeWorkflowDraftProposalCandidate(
        parseModelGeneratedJson(workflowText),
        taskCatalog,
        currentProposal
      );

      writeEvent({ type: 'draft', message: `Updated workflow draft: ${nextProposal.workflow.name}`, proposal: nextProposal });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not update workflow draft.'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.post<{ Body: ApplyWorkflowDraftRequest }>('/api/workflows/preview/apply', async (request, reply) => {
    try {
      const taskCatalog = workflowStore.listTaskCatalog();
      const proposal = normalizeWorkflowDraftProposalCandidate(request.body.proposal, taskCatalog);
      const validatedWorkflow = normalizeWorkflowMutationCandidate(
        proposal.workflow,
        buildAllowedTaskKeySet(taskCatalog, proposal.taskDrafts)
      );
      const createdTasks = proposal.taskDrafts.map((taskDraft) => workflowStore.upsertCustomTask(toCustomTaskInput(taskDraft)));
      const workflow = workflowStore.createWorkflow(validatedWorkflow);

      return reply.code(201).send({
        createdTasks,
        workflow
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not apply workflow draft.'
      });
    }
  });

  server.post<{ Body: GenerateWorkflowRequest }>('/api/workflows/generate/stream', async (request, reply) => {
    const { attachments, description } = request.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return reply.code(400).send({ message: 'Workflow description is required.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ message: 'No model selected. Please select a default model in Settings.' });
    }

    const writeEvent = startWorkflowStream(reply);

    try {
      writeEvent({ type: 'status', message: 'Preparing workflow generation request…' });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const taskCatalog = workflowStore.listTaskCatalog();
      const { fullPrompt } = buildGenerateWorkflowPrompts(description, taskCatalog, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const workflowText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating generated workflow…' });

      const workflowInput = normalizeWorkflowMutationCandidate(
        parseModelGeneratedJson(workflowText),
        buildAllowedTaskKeySet(taskCatalog)
      );
      const workflow = workflowStore.createWorkflow(workflowInput);

      writeEvent({ type: 'status', message: 'Saving generated workflow to the local catalog…' });
      writeEvent({ type: 'result', message: `Created workflow: ${workflow.name}`, workflow });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not generate workflow.'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.put('/api/workflows/:id', async (request, reply) => {
    try {
      const input = parseWorkflowMutationInput(request.body);
      const workflow = workflowStore.updateWorkflow((request.params as { id: string }).id, input);

      if (!workflow) {
        return reply.code(404).send({
          message: 'Workflow not found.'
        });
      }

      return { workflow };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not update workflow.'
      });
    }
  });

  server.post<{ Body: RefineWorkflowRequest; Params: { id: string } }>('/api/workflows/:id/refine/stream', async (request, reply) => {
    const workflowId = request.params.id;
    const { attachments, instructions, workflow: workflowPayload } = request.body;

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      return reply.code(400).send({ message: 'Workflow edit instructions are required.' });
    }

    const existingWorkflow = workflowStore.getWorkflow(workflowId);

    if (!existingWorkflow) {
      return reply.code(404).send({ message: 'Workflow not found.' });
    }

    const manifest = workflowStore.getModelManifest();
    const selectedModel = manifest.selectedModel;

    if (!selectedModel) {
      return reply.code(400).send({ message: 'No model selected. Please select a default model in Settings.' });
    }

    let currentWorkflowInput: WorkflowMutationInput;

    try {
      currentWorkflowInput = workflowPayload ? parseWorkflowMutationInput(workflowPayload) : toWorkflowMutationInput(existingWorkflow);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Current workflow payload is invalid.'
      });
    }

    const currentWorkflowForModel: WorkflowDraft = {
      name: currentWorkflowInput.name,
      description: currentWorkflowInput.description,
      tags: currentWorkflowInput.tags,
      definition: currentWorkflowInput.definition ?? existingWorkflow.definition
    };

    const writeEvent = startWorkflowStream(reply);

    try {
      writeEvent({ type: 'status', message: `Preparing workflow refinement for ${existingWorkflow.name}…` });
      const attachmentContext = await buildPromptAttachmentContext(attachments, (message) => writeEvent({ type: 'status', message }));
      const taskCatalog = workflowStore.listTaskCatalog();
      const { fullPrompt } = buildRefineWorkflowPrompts(currentWorkflowForModel, instructions, taskCatalog, attachmentContext.promptContext);
      const baseUrl = assertNetworkAllowed(config.privacyMode === 'local-first', config.ollamaBaseUrl);
      const workflowText = await streamOllamaCompletion(baseUrl, selectedModel, fullPrompt, attachmentContext.images, writeEvent);

      writeEvent({ type: 'status', message: 'Validating refined workflow…' });

      const workflowInput = normalizeWorkflowMutationCandidate(
        parseModelGeneratedJson(workflowText),
        buildAllowedTaskKeySet(taskCatalog),
        currentWorkflowForModel
      );
      const workflow = workflowStore.updateWorkflow(workflowId, workflowInput);

      if (!workflow) {
        throw new Error('Workflow not found.');
      }

      writeEvent({ type: 'status', message: 'Saving workflow updates to the local catalog…' });
      writeEvent({ type: 'result', message: `Updated workflow: ${workflow.name}`, workflow });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not update workflow.'
      });
    } finally {
      reply.raw.end();
    }
  });

  server.delete('/api/workflows/:id', async (request, reply) => {
    const deleted = workflowStore.deleteWorkflow((request.params as { id: string }).id);

    if (!deleted) {
      return reply.code(404).send({
        message: 'Workflow not found.'
      });
    }

    return reply.code(204).send();
  });
}
