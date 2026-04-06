import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function main(): Promise<void> {
  const server = new Server(
    {
      name: 'flow-machine-validation-mcp',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: 'Validation-only MCP server used by the Flow Machine lifecycle script.'
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        description: 'Returns a simple validation payload for a query string.',
        inputSchema: {
          additionalProperties: true,
          properties: {
            query: {
              type: 'string'
            },
            scope: {
              type: 'string'
            }
          },
          required: ['query'],
          type: 'object'
        },
        name: 'search'
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'search') {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool ${request.params.name}.`);
    }

    const args = isRecord(request.params.arguments) ? request.params.arguments : {};
    const query = asString(args.query);

    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, 'query is required.');
    }

    const scope = asString(args.scope) ?? 'all';

    return {
      content: [
        {
          text: `Validation result for ${query} (${scope})`,
          type: 'text'
        }
      ],
      structuredContent: {
        ok: true,
        query,
        scope,
        source: 'flow-machine-validation-mcp'
      }
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});