import { FastifyInstance } from 'fastify';

import { SecretStore } from '../lib/secret-store';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSecretValue(value: unknown): string {
  if (!isRecord(value) || typeof value.value !== 'string') {
    throw new Error('Secret value is required.');
  }

  return value.value;
}

function parseEnvContent(value: unknown): string {
  if (!isRecord(value) || typeof value.content !== 'string') {
    throw new Error('Secret import content is required.');
  }

  return value.content;
}

export async function registerSecretRoutes(server: FastifyInstance, secretStore: SecretStore): Promise<void> {
  server.get('/api/secrets', async () => ({
    backend: 'encrypted-file',
    secrets: secretStore.listSecrets()
  }));

  server.put('/api/secrets/:key', async (request, reply) => {
    try {
      return {
        secret: secretStore.upsertSecret((request.params as { key: string }).key, parseSecretValue(request.body))
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not save secret.'
      });
    }
  });

  server.delete('/api/secrets/:key', async (request, reply) => {
    const deleted = secretStore.deleteSecret((request.params as { key: string }).key);

    if (!deleted) {
      return reply.code(404).send({
        message: 'Secret not found.'
      });
    }

    return reply.code(204).send();
  });

  server.post('/api/secrets/import-env', async (request, reply) => {
    try {
      const imported = secretStore.importEnvFile(parseEnvContent(request.body));

      return {
        imported
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not import secrets.'
      });
    }
  });
}