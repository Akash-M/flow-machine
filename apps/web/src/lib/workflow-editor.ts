import { TaskCatalogEntry, WorkflowDefinition, WorkflowDocument, WorkflowNode } from '@flow-machine/shared-types';

function cloneNode(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    position: {
      ...node.position
    },
    config: {
      ...node.config
    }
  };
}

export function cloneWorkflowDocument(workflow: WorkflowDocument): WorkflowDocument {
  return {
    ...workflow,
    tags: [...workflow.tags],
    definition: {
      ...workflow.definition,
      nodes: workflow.definition.nodes.map(cloneNode),
      edges: workflow.definition.edges.map((edge) => ({ ...edge }))
    }
  };
}

export function createNodeFromTask(task: TaskCatalogEntry, index: number): WorkflowNode {
  const column = index % 3;
  const row = Math.floor(index / 3);

  return {
    id: `${task.key}-${crypto.randomUUID().slice(0, 8)}`,
    name: task.name,
    taskKey: task.key,
    position: {
      x: 48 + column * 232,
      y: 48 + row * 148
    },
    config: {}
  };
}

export function addNodeToDefinition(definition: WorkflowDefinition, task: TaskCatalogEntry): { definition: WorkflowDefinition; nodeId: string } {
  const node = createNodeFromTask(task, definition.nodes.length);

  return {
    nodeId: node.id,
    definition: {
      ...definition,
      startNodeId: definition.startNodeId ?? node.id,
      nodes: [...definition.nodes, node]
    }
  };
}

export function updateNodeInDefinition(
  definition: WorkflowDefinition,
  nodeId: string,
  update: Partial<Pick<WorkflowNode, 'name' | 'taskKey' | 'config' | 'position'>>
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }

      return {
        ...node,
        ...update,
        position: update.position ?? node.position,
        config: update.config ?? node.config
      };
    })
  };
}

export function removeNodeFromDefinition(definition: WorkflowDefinition, nodeId: string): WorkflowDefinition {
  const nodes = definition.nodes.filter((node) => node.id !== nodeId);
  const edges = definition.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);

  return {
    ...definition,
    nodes,
    edges,
    startNodeId: definition.startNodeId === nodeId ? nodes[0]?.id ?? null : definition.startNodeId
  };
}

export function addEdgeToDefinition(definition: WorkflowDefinition, sourceId: string, targetId: string): WorkflowDefinition {
  if (!sourceId || !targetId || sourceId === targetId) {
    return definition;
  }

  const hasDuplicate = definition.edges.some((edge) => edge.source === sourceId && edge.target === targetId);

  if (hasDuplicate) {
    return definition;
  }

  return {
    ...definition,
    edges: [
      ...definition.edges,
      {
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        source: sourceId,
        target: targetId
      }
    ]
  };
}

export function removeEdgeFromDefinition(definition: WorkflowDefinition, edgeId: string): WorkflowDefinition {
  return {
    ...definition,
    edges: definition.edges.filter((edge) => edge.id !== edgeId)
  };
}

export function setStartNode(definition: WorkflowDefinition, nodeId: string | null): WorkflowDefinition {
  if (!nodeId) {
    return {
      ...definition,
      startNodeId: null
    };
  }

  const nodeExists = definition.nodes.some((node) => node.id === nodeId);

  return {
    ...definition,
    startNodeId: nodeExists ? nodeId : definition.startNodeId
  };
}