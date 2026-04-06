import { FastifyInstance } from 'fastify';

import { ApprovalRules } from '@flow-machine/shared-types';

import { WorkflowRunManager } from '../lib/workflow-runner';
import { WorkflowStore } from '../lib/workflow-store';

function parseApprovalRules(value: unknown): ApprovalRules {
  const rawDefaults =
    value && typeof value === 'object' && 'globalDefaults' in value && Array.isArray(value.globalDefaults)
      ? value.globalDefaults
      : [];

  return {
    globalDefaults: rawDefaults.filter((entry): entry is string => typeof entry === 'string')
  };
}

export async function registerApprovalRoutes(
  server: FastifyInstance,
  workflowStore: WorkflowStore,
  runManager: WorkflowRunManager
): Promise<void> {
  server.get('/api/approvals', async () => ({
    rules: workflowStore.getApprovalRules(),
    pendingRuns: runManager.listRuns().filter((run) => run.status === 'waiting-approval')
  }));

  server.put('/api/approvals/rules', async (request) => ({
    rules: workflowStore.updateApprovalRules(parseApprovalRules(request.body))
  }));
}