import { TaskCapability, TaskCatalogEntry, TaskResourcePolicy } from '@flow-machine/shared-types';

export interface TaskDefinition extends TaskCatalogEntry {
  version: string;
}

export interface TaskDefinitionInput {
  key: string;
  name: string;
  description: string;
  capabilities: TaskCapability[];
  requiresApprovalByDefault: boolean;
  resourceDefaults?: TaskResourcePolicy;
}

export function defineTask(input: TaskDefinitionInput): TaskDefinition {
  return {
    version: '0.1.0',
    resourceDefaults: {
      cpuShares: 512,
      memoryMb: 512,
      timeoutMs: 60_000,
      concurrency: 1,
      ...input.resourceDefaults
    },
    ...input
  };
}

export function toTaskCatalogEntry(task: TaskDefinition): TaskCatalogEntry {
  return {
    key: task.key,
    name: task.name,
    description: task.description,
    capabilities: task.capabilities,
    requiresApprovalByDefault: task.requiresApprovalByDefault,
    resourceDefaults: task.resourceDefaults
  };
}
