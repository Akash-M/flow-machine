import { FastifyInstance } from 'fastify';

import { getBrowserRuntimeStatus } from '../lib/browser-runtime';

export async function registerBrowserRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/browser/status', async () => ({
    browser: await getBrowserRuntimeStatus()
  }));
}