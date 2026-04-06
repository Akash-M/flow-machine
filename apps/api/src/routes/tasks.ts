import { FastifyInstance } from 'fastify';

import { builtInTaskCatalog } from '@flow-machine/built-in-tasks';

import { WorkflowStore } from '../lib/workflow-store';

export async function registerTaskRoutes(server: FastifyInstance, workflowStore?: WorkflowStore): Promise<void> {
  server.get('/api/tasks', async () => {
    const allTasks = workflowStore ? workflowStore.listTaskCatalog() : builtInTaskCatalog;

    return {
      tasks: allTasks
    };
  });
}
