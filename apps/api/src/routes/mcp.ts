import { FastifyInstance } from 'fastify';

import { McpConnectionSummary, MergedMcpConfig } from '@flow-machine/shared-types';

import { WorkflowStore } from '../lib/workflow-store';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMergedMcpConfig(value: unknown): MergedMcpConfig {
  if (isRecord(value) && isRecord(value.servers)) {
    return {
      servers: value.servers
    };
  }

  if (isRecord(value)) {
    return {
      servers: value
    };
  }

  throw new Error('Expected an MCP config object.');
}

function summarizeConnections(config: MergedMcpConfig): McpConnectionSummary[] {
  return Object.entries(config.servers)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([id, definition]) => {
      if (isRecord(definition) && typeof definition.command === 'string') {
        return {
          id,
          transport: 'stdio',
          target: definition.command
        } satisfies McpConnectionSummary;
      }

      if (isRecord(definition) && typeof definition.url === 'string') {
        return {
          id,
          transport: definition.type === 'sse' ? 'sse' : 'http',
          target: definition.url
        } satisfies McpConnectionSummary;
      }

      return {
        id,
        transport: 'unknown',
        target: 'Unknown MCP definition'
      } satisfies McpConnectionSummary;
    });
}

export async function registerMcpRoutes(server: FastifyInstance, workflowStore: WorkflowStore): Promise<void> {
  server.get('/api/mcp', async () => {
    const mcp = workflowStore.getMcpConfig();

    return {
      mcp,
      connections: summarizeConnections(mcp)
    };
  });

  server.post('/api/mcp/import', async (request, reply) => {
    try {
      const mcp = workflowStore.updateMcpConfig(toMergedMcpConfig(request.body));

      return {
        mcp,
        connections: summarizeConnections(mcp)
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not import MCP config.'
      });
    }
  });

  server.put('/api/mcp/servers/:id', async (request, reply) => {
    try {
      const serverId = (request.params as { id: string }).id;
      const current = workflowStore.getMcpConfig();
      const definition = isRecord(request.body) && 'definition' in request.body ? request.body.definition : request.body;
      const nextConfig = workflowStore.updateMcpConfig({
        servers: {
          ...current.servers,
          [serverId]: definition
        }
      });

      return {
        mcp: nextConfig,
        connections: summarizeConnections(nextConfig)
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Could not save MCP server.'
      });
    }
  });

  server.delete('/api/mcp/servers/:id', async (request, reply) => {
    const serverId = (request.params as { id: string }).id;
    const current = workflowStore.getMcpConfig();

    if (!(serverId in current.servers)) {
      return reply.code(404).send({
        message: 'MCP server not found.'
      });
    }

    const nextServers = { ...current.servers };
    delete nextServers[serverId];
    const nextConfig = workflowStore.updateMcpConfig({ servers: nextServers });

    return {
      mcp: nextConfig,
      connections: summarizeConnections(nextConfig)
    };
  });
}