import { FastifyInstance } from 'fastify';

import { AppConfig } from '../lib/config';
import { buildAppStatus } from '../lib/system-status';

export async function registerSystemRoutes(server: FastifyInstance, config: AppConfig): Promise<void> {
  server.get('/api/system/status', async () => buildAppStatus(config));
}
