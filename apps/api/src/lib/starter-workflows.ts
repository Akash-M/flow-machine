import { WorkflowDocument, WorkflowNode, createBlankWorkflowDefinition } from '@flow-machine/shared-types';

function makeNode(node: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'name' | 'taskKey'>): WorkflowNode {
  return {
    position: { x: 0, y: 0 },
    config: {},
    ...node
  };
}

const now = new Date().toISOString();

export const starterWorkflowDocuments: WorkflowDocument[] = [
  {
    id: 'mcp-research-agent',
    name: 'MCP Research Agent',
    description: 'Use a bounded agent with MCP and HTTP access to gather context before a coding task.',
    tags: ['agent', 'mcp', 'http'],
    lastRunState: 'never',
    createdAt: now,
    updatedAt: now,
    definition: {
      version: '1',
      startNodeId: 'mcp-call',
      nodes: [
        makeNode({
          id: 'mcp-call',
          name: 'Query MCP Source',
          taskKey: 'mcp-call',
          position: { x: 80, y: 140 },
          config: { server: 'example-server', tool: 'search', query: 'relevant implementation context' }
        }),
        makeNode({
          id: 'http-request',
          name: 'Fetch Supporting Context',
          taskKey: 'http-request',
          position: { x: 360, y: 140 },
          config: { method: 'GET', url: 'https://example.invalid/reference' }
        }),
        makeNode({
          id: 'agent',
          name: 'Synthesize Findings',
          taskKey: 'agent',
          position: { x: 660, y: 140 },
          config: { objective: 'Combine MCP and HTTP results into a structured research brief.' }
        })
      ],
      edges: [
        { id: 'edge-1', source: 'mcp-call', target: 'http-request' },
        { id: 'edge-2', source: 'http-request', target: 'agent' }
      ]
    }
  }
];

export function createEmptyWorkflowDocument(id: string, name: string, description: string, tags: string[]): WorkflowDocument {
  const timestamp = new Date().toISOString();

  return {
    id,
    name,
    description,
    tags,
    lastRunState: 'never',
    createdAt: timestamp,
    updatedAt: timestamp,
    definition: createBlankWorkflowDefinition()
  };
}
