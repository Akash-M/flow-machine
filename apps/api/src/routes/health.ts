import { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/health', async () => {
    return {
      status: 'ok',
      checkedAt: new Date().toISOString()
    };
  });
}
