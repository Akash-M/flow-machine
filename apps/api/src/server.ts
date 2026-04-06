import fs from 'node:fs';
import path from 'node:path';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import { AppConfig } from './lib/config';
import { SecretStore } from './lib/secret-store';
import { WorkflowRunManager } from './lib/workflow-runner';
import { WorkflowStore } from './lib/workflow-store';
import { registerApprovalRoutes } from './routes/approvals';
import { registerBrowserRoutes } from './routes/browser';
import { registerCustomTaskRoutes } from './routes/custom-tasks';
import { registerExportRoutes } from './routes/export';
import { registerHealthRoutes } from './routes/health';
import { registerMcpRoutes } from './routes/mcp';
import { registerModelRoutes } from './routes/models';
import { registerRepositoryRoutes } from './routes/repositories';
import { registerRunRoutes } from './routes/runs';
import { registerSecretRoutes } from './routes/secrets';
import { registerSystemRoutes } from './routes/system';
import { registerTaskRoutes } from './routes/tasks';
import { registerWorkflowRoutes } from './routes/workflows';

export async function buildServer(config: AppConfig) {
  const server = Fastify({
    logger: true
  });
  const workflowStore = new WorkflowStore(config);
  const secretStore = new SecretStore(config);
  const runManager = new WorkflowRunManager(workflowStore, config, secretStore);

  await server.register(cors, {
    origin: true
  });

  await registerHealthRoutes(server);
  await registerSystemRoutes(server, config);
  await registerTaskRoutes(server, workflowStore);
  await registerCustomTaskRoutes(server, workflowStore, config);
  await registerWorkflowRoutes(server, workflowStore, config);
  await registerRunRoutes(server, runManager);
  await registerRepositoryRoutes(server, workflowStore);
  await registerApprovalRoutes(server, workflowStore, runManager);
  await registerModelRoutes(server, workflowStore, config);
  await registerMcpRoutes(server, workflowStore);
  await registerSecretRoutes(server, secretStore);
  await registerBrowserRoutes(server);
  await registerExportRoutes(server, workflowStore);

  server.addHook('onClose', async () => {
    workflowStore.close();
  });

  const webRoot = path.resolve(__dirname, '../../web/dist');
  const webDevUrl = config.webDevUrl ? config.webDevUrl.replace(/\/$/, '') : null;
  const hasWebAssets = !webDevUrl && fs.existsSync(webRoot);

  if (hasWebAssets) {
    await server.register(fastifyStatic, {
      root: webRoot,
      prefix: '/'
    });
  }

  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        message: 'Not found'
      });
    }

    if (webDevUrl) {
      return reply.redirect(`${webDevUrl}${request.url === '/' ? '' : request.url}`);
    }

    if (hasWebAssets) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({
      message: 'Web assets are not built yet. Run the web build before starting the API directly.'
    });
  });

  return server;
}
