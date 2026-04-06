import { FastifyInstance } from 'fastify';

import { WorkflowRunManager } from '../lib/workflow-runner';

export async function registerRunRoutes(server: FastifyInstance, runManager: WorkflowRunManager): Promise<void> {
  server.get('/api/runs', async (request) => {
    const query = request.query as { workflowId?: string };

    return {
      runs: runManager.listRuns(query.workflowId)
    };
  });

  server.get('/api/runs/:id', async (request, reply) => {
    const run = runManager.getRun((request.params as { id: string }).id);

    if (!run) {
      return reply.code(404).send({
        message: 'Run not found.'
      });
    }

    return { run };
  });

  server.get('/api/runs/:id/events', async (request, reply) => {
    const runId = (request.params as { id: string }).id;
    const run = runManager.getRun(runId);

    if (!run) {
      return reply.code(404).send({
        message: 'Run not found.'
      });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });

    const send = (nextRun: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(nextRun)}\n\n`);
    };

    send(run);

    const unsubscribe = runManager.subscribe(runId, send);
    const heartbeat = setInterval(() => {
      reply.raw.write('event: ping\ndata: {}\n\n');
    }, 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });

  server.post('/api/workflows/:id/runs', async (request, reply) => {
    try {
      const run = await runManager.startRun((request.params as { id: string }).id);
      return reply.code(201).send({ run });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not start workflow run.'
      });
    }
  });

  server.post('/api/runs/:id/approve', async (request, reply) => {
    try {
      const run = await runManager.approveRun((request.params as { id: string }).id);
      return { run };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not approve run.'
      });
    }
  });

  server.post('/api/runs/:id/reject', async (request, reply) => {
    try {
      const run = await runManager.rejectRun((request.params as { id: string }).id);
      return { run };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not reject run.'
      });
    }
  });

  server.post('/api/runs/:id/rerun', async (request, reply) => {
    try {
      const run = await runManager.rerun((request.params as { id: string }).id);
      return reply.code(201).send({ run });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not rerun workflow.'
      });
    }
  });

  server.post('/api/runs/:id/resume', async (request, reply) => {
    try {
      const run = await runManager.resumeRun((request.params as { id: string }).id);
      return reply.code(201).send({ run });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not resume workflow.'
      });
    }
  });
}