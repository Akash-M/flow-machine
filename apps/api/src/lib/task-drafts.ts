import { CustomTask, TaskCapability, TaskDraft, TaskCatalogEntry, TaskResourcePolicy } from '@flow-machine/shared-types';

const defaultTaskResourceDefaults: TaskResourcePolicy = {
  concurrency: 1,
  cpuShares: 128,
  memoryMb: 512,
  timeoutMs: 60_000
};

const allowedCapabilities = new Set<TaskCapability>([
  'filesystem:read',
  'filesystem:write',
  'shell',
  'git:read',
  'git:write',
  'network:http',
  'network:mcp',
  'secrets',
  'browser',
  'llm'
]);

type TaskLike = TaskCatalogEntry | TaskDraft;

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'generated-task';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isTaskCapability(value: unknown): value is TaskCapability {
  return typeof value === 'string' && allowedCapabilities.has(value as TaskCapability);
}

function readTaskSource(value: unknown, fallback: TaskDraft['source']): TaskDraft['source'] {
  return value === 'manual' || value === 'generated' ? value : fallback;
}

function readExecutionStrategy(value: unknown, fallback: TaskDraft['executionStrategy']): TaskDraft['executionStrategy'] {
  return value === 'agent' || value === 'template' || value === 'transform' ? value : fallback;
}

function isDraftLikeTask(task: TaskLike | undefined): task is TaskDraft {
  return task !== undefined && 'executionStrategy' in task && 'source' in task;
}

export function inferExecutionStrategy(task: TaskLike): CustomTask['executionStrategy'] {
  return isDraftLikeTask(task) ? task.executionStrategy : 'agent';
}

export function isCustomTask(task: TaskCatalogEntry): task is CustomTask {
  return 'source' in task && 'executionStrategy' in task;
}

export function normalizeResourceDefaults(value: unknown, fallback: TaskResourcePolicy = defaultTaskResourceDefaults): TaskResourcePolicy {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    cpuShares: readNumber(value.cpuShares, fallback.cpuShares),
    concurrency: readNumber(value.concurrency, fallback.concurrency),
    memoryMb: readNumber(value.memoryMb, fallback.memoryMb),
    timeoutMs: readNumber(value.timeoutMs, fallback.timeoutMs)
  };
}

export function normalizeTaskDefinition(candidate: unknown, currentTask: TaskCatalogEntry): TaskCatalogEntry {
  if (!isRecord(candidate)) {
    throw new Error('The model did not return a valid task object.');
  }

  const capabilities = Array.isArray(candidate.capabilities)
    ? candidate.capabilities.filter(isTaskCapability)
    : currentTask.capabilities;

  return {
    key: currentTask.key,
    name: readString(candidate.name, currentTask.name),
    description: readString(candidate.description, currentTask.description),
    capabilities,
    requiresApprovalByDefault: readBoolean(candidate.requiresApprovalByDefault, currentTask.requiresApprovalByDefault),
    resourceDefaults: normalizeResourceDefaults(candidate.resourceDefaults, currentTask.resourceDefaults)
  };
}

export function normalizeTaskDraft(
  candidate: unknown,
  options: {
    currentTask?: TaskLike;
    executionStrategy?: TaskDraft['executionStrategy'];
    reasonFallback?: string;
    source?: TaskDraft['source'];
    systemPrompt?: string;
  } = {}
): TaskDraft {
  if (!isRecord(candidate)) {
    throw new Error('The model did not return a valid task draft object.');
  }

  const currentTask = options.currentTask;
  const fallbackName = currentTask?.name ?? 'Generated Task';
  const nextName = readString(candidate.name, fallbackName);
  const nextKey = currentTask ? currentTask.key : slugify(readString(candidate.key, nextName));
  const capabilities = Array.isArray(candidate.capabilities)
    ? candidate.capabilities.filter(isTaskCapability)
    : currentTask?.capabilities ?? [];
  const source = isDraftLikeTask(currentTask)
    ? currentTask.source
    : readTaskSource(candidate.source, options.source ?? 'generated');
  const executionStrategy = isDraftLikeTask(currentTask)
    ? currentTask.executionStrategy
    : readExecutionStrategy(candidate.executionStrategy, options.executionStrategy ?? 'agent');
  const systemPrompt = isDraftLikeTask(currentTask)
    ? currentTask.systemPrompt
    : typeof candidate.systemPrompt === 'string'
      ? candidate.systemPrompt
      : options.systemPrompt;
  const reasonFallback = isDraftLikeTask(currentTask)
    ? currentTask.reason
    : options.reasonFallback ?? 'This task is needed to complete the requested workflow.';

  return {
    key: nextKey,
    name: nextName,
    description: readString(candidate.description, currentTask?.description ?? ''),
    capabilities,
    requiresApprovalByDefault: readBoolean(candidate.requiresApprovalByDefault, currentTask?.requiresApprovalByDefault ?? false),
    resourceDefaults: normalizeResourceDefaults(candidate.resourceDefaults, currentTask?.resourceDefaults ?? defaultTaskResourceDefaults),
    reason: readString(candidate.reason, reasonFallback),
    source,
    systemPrompt,
    executionStrategy
  };
}

export function toCustomTaskInput(taskDraft: TaskDraft): Omit<CustomTask, 'generatedAt' | 'id'> {
  return {
    key: taskDraft.key,
    name: taskDraft.name,
    description: taskDraft.description,
    capabilities: taskDraft.capabilities,
    requiresApprovalByDefault: taskDraft.requiresApprovalByDefault,
    resourceDefaults: taskDraft.resourceDefaults,
    source: taskDraft.source,
    systemPrompt: taskDraft.systemPrompt,
    executionStrategy: taskDraft.executionStrategy
  };
}