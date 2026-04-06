import { FastifyInstance } from 'fastify';

import { mountedRootRepositoryId } from '../lib/repositories';
import { WorkflowStore } from '../lib/workflow-store';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRepositoryInput(value: unknown): { name: string; path: string } {
  if (!isRecord(value)) {
    throw new Error('Expected a repository payload object.');
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const path = typeof value.path === 'string' ? value.path.trim() : '';

  if (!name) {
    throw new Error('Repository name is required.');
  }

  if (!path) {
    throw new Error('Repository path is required.');
  }

  return {
    name,
    path
  };
}

export async function registerRepositoryRoutes(server: FastifyInstance, workflowStore: WorkflowStore): Promise<void> {
  server.get('/api/repositories', async () => ({
    repositories: workflowStore.listRepositories()
  }));

  server.post('/api/repositories', async (request, reply) => {
    try {
      const repository = workflowStore.upsertRepository(parseRepositoryInput(request.body));

      return reply.code(201).send({
        repository,
        repositories: workflowStore.listRepositories()
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not save repository.'
      });
    }
  });

  server.delete('/api/repositories/:id', async (request, reply) => {
    const repositoryId = (request.params as { id: string }).id;

    if (repositoryId === mountedRootRepositoryId) {
      return reply.code(400).send({
        message: 'The mounted root repository is always available and cannot be removed.'
      });
    }

    const deleted = workflowStore.deleteRepository(repositoryId);

    if (!deleted) {
      return reply.code(404).send({
        message: 'Repository not found.'
      });
    }

    return reply.code(204).send();
  });
}