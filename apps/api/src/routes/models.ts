import { FastifyInstance, FastifyReply } from 'fastify';

import { ModelGatewayState } from '@flow-machine/shared-types';

import { AppConfig } from '../lib/config';
import {
  OllamaPullStreamChunk,
  getOllamaModelCapabilities,
  getOllamaVersion,
  listOllamaModels,
  pullOllamaModel,
  streamOllamaModelPull
} from '../lib/ollama';
import { WorkflowStore } from '../lib/workflow-store';

type ModelPullStreamEvent =
  | { type: 'status'; status: string; completed?: number; digest?: string; total?: number }
  | { type: 'result'; message: string; state: ModelGatewayState }
  | { type: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSelectedModel(value: unknown): string | null {
  if (!isRecord(value) || !('selectedModel' in value)) {
    return null;
  }

  return typeof value.selectedModel === 'string' && value.selectedModel.trim().length > 0 ? value.selectedModel.trim() : null;
}

function parseModelName(value: unknown): string {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim().length === 0) {
    throw new Error('Model name is required.');
  }

  return value.name.trim();
}

function startModelPullStream(reply: FastifyReply): (event: ModelPullStreamEvent) => void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });

  return (event: ModelPullStreamEvent) => {
    reply.raw.write(`${JSON.stringify(event)}\n`);
  };
}

function toModelPullStatusEvent(chunk: OllamaPullStreamChunk): ModelPullStreamEvent | null {
  if (!chunk.status || chunk.status.trim().length === 0) {
    return null;
  }

  return {
    type: 'status',
    status: chunk.status,
    completed: chunk.completed,
    digest: chunk.digest,
    total: chunk.total
  };
}

async function buildModelGatewayState(workflowStore: WorkflowStore, config: AppConfig): Promise<ModelGatewayState> {
  let manifest = workflowStore.getModelManifest();

  try {
    const models = await listOllamaModels(config.ollamaBaseUrl);
    let version: string | null = null;
    let selectedModelCapabilities: string[] | null = null;

    try {
      version = await getOllamaVersion(config.ollamaBaseUrl);
    } catch {
      version = null;
    }

    const modelNames = models.map((model) => model.name);
    const selectedModel = manifest.selectedModel && modelNames.includes(manifest.selectedModel) ? manifest.selectedModel : null;

    manifest = workflowStore.updateModelManifest({
      baseUrl: config.ollamaBaseUrl,
      installed: modelNames,
      selectedModel
    });

    if (selectedModel) {
      try {
        selectedModelCapabilities = await getOllamaModelCapabilities(config.ollamaBaseUrl, selectedModel);
      } catch {
        selectedModelCapabilities = null;
      }
    }

    return {
      manifest,
      online: true,
      message: 'Host-native Ollama is reachable.',
      models,
      selectedModelCapabilities,
      version
    };
  } catch (error) {
    return {
      manifest,
      online: false,
      message: error instanceof Error ? error.message : 'Could not reach Ollama.',
      models: manifest.installed.map((name) => ({
        name,
        size: null,
        modifiedAt: null,
        digest: null
      })),
      selectedModelCapabilities: null,
      version: null
    };
  }
}

export async function registerModelRoutes(server: FastifyInstance, workflowStore: WorkflowStore, config: AppConfig): Promise<void> {
  server.get('/api/models', async () => ({
    state: await buildModelGatewayState(workflowStore, config)
  }));

  server.put('/api/models/default', async (request, reply) => {
    try {
      const selectedModel = parseSelectedModel(request.body);
      const manifest = workflowStore.updateModelManifest({ selectedModel });

      return {
        manifest
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not update selected model.'
      });
    }
  });

  server.post('/api/models/pull', async (request, reply) => {
    try {
      const modelName = parseModelName(request.body);
      await pullOllamaModel(config.ollamaBaseUrl, modelName);

      const state = await buildModelGatewayState(workflowStore, config);

      if (!state.manifest.selectedModel) {
        state.manifest = workflowStore.updateModelManifest({ selectedModel: modelName });
      }

      return {
        state
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not pull model.'
      });
    }
  });

  server.post('/api/models/pull/stream', async (request, reply) => {
    let modelName = '';

    try {
      modelName = parseModelName(request.body);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Model name is required.'
      });
    }

    const writeEvent = startModelPullStream(reply);

    try {
      writeEvent({ type: 'status', status: `Starting model pull for ${modelName}…` });

      await streamOllamaModelPull(config.ollamaBaseUrl, modelName, (chunk) => {
        const event = toModelPullStatusEvent(chunk);

        if (event) {
          writeEvent(event);
        }
      });

      const state = await buildModelGatewayState(workflowStore, config);

      if (!state.manifest.selectedModel) {
        state.manifest = workflowStore.updateModelManifest({ selectedModel: modelName });
      }

      writeEvent({
        type: 'result',
        message: `Pulled model ${modelName}.`,
        state
      });
    } catch (error) {
      writeEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not pull model.'
      });
    } finally {
      reply.raw.end();
    }
  });
}