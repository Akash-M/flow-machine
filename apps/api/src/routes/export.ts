import { FastifyInstance } from 'fastify';

import { stableStringify } from '../lib/stable-json';
import { WorkflowStore } from '../lib/workflow-store';

export async function registerExportRoutes(server: FastifyInstance, workflowStore: WorkflowStore): Promise<void> {
  server.get('/api/export', async (_request, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="flow-machine-export.json"');

    return stableStringify(workflowStore.exportBundle());
  });

  server.post('/api/import', async (request, reply) => {
    try {
      const result = workflowStore.importBundle(request.body);
      return {
        importedCount: result.importedCount,
        workflowIds: result.workflowIds
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not import bundle.'
      });
    }
  });
}
