import {
  WorkflowDefinition,
  WorkflowDocument,
  WorkflowExportBundle,
  WorkflowNode,
  WorkflowSummary,
  createBlankWorkflowDefinition
} from '@flow-machine/shared-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeNode(value: unknown): WorkflowNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, name, taskKey, position, config } = value;

  if (!isString(id) || !isString(name) || !isString(taskKey) || !isRecord(position)) {
    return null;
  }

  const x = position.x;
  const y = position.y;

  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  return {
    id,
    name,
    taskKey,
    position: {
      x,
      y
    },
    config: isRecord(config) ? config : {}
  };
}

function sanitizeEdge(value: unknown): WorkflowDefinition['edges'][number] | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.source) || !isString(value.target)) {
    return null;
  }

  return {
    id: value.id,
    source: value.source,
    target: value.target,
    label: isString(value.label) ? value.label : undefined,
    condition: isString(value.condition) ? value.condition : undefined
  };
}

export function sanitizeWorkflowDefinition(value: unknown): WorkflowDefinition {
  if (!isRecord(value)) {
    return createBlankWorkflowDefinition();
  }

  const nodes = Array.isArray(value.nodes)
    ? value.nodes.reduce<WorkflowNode[]>((accumulator, entry) => {
        const node = sanitizeNode(entry);

        if (!node || accumulator.some((existing) => existing.id === node.id)) {
          return accumulator;
        }

        accumulator.push(node);
        return accumulator;
      }, [])
    : [];

  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges = Array.isArray(value.edges)
    ? value.edges.reduce<WorkflowDefinition['edges']>((accumulator, entry) => {
        const edge = sanitizeEdge(entry);

        if (!edge || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || accumulator.some((existing) => existing.id === edge.id)) {
          return accumulator;
        }

        accumulator.push(edge);
        return accumulator;
      }, [])
    : [];

  const startNodeId = isString(value.startNodeId) && nodeIds.has(value.startNodeId) ? value.startNodeId : null;

  return {
    version: '1',
    startNodeId,
    nodes,
    edges
  };
}

export function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isString)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export interface WorkflowMutationInput {
  name: string;
  description: string;
  tags: string[];
  definition?: WorkflowDefinition;
}

export function parseWorkflowMutationInput(value: unknown): WorkflowMutationInput {
  if (!isRecord(value)) {
    throw new Error('Expected a workflow payload object.');
  }

  const name = isString(value.name) ? value.name.trim() : '';
  const description = isString(value.description) ? value.description.trim() : '';

  if (!name) {
    throw new Error('Workflow name is required.');
  }

  return {
    name,
    description,
    tags: sanitizeTags(value.tags),
    definition: value.definition ? sanitizeWorkflowDefinition(value.definition) : undefined
  };
}

function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.description) &&
    Array.isArray(value.tags) &&
    isString(value.lastRunState) &&
    isString(value.updatedAt)
  );
}

function isWorkflowDocument(value: unknown): value is WorkflowDocument {
  return isWorkflowSummary(value) && isRecord(value) && isString(value.createdAt) && 'definition' in value;
}

function sanitizeWorkflowDocument(workflow: WorkflowDocument): WorkflowDocument {
  return {
    ...workflow,
    tags: sanitizeTags(workflow.tags),
    definition: sanitizeWorkflowDefinition(workflow.definition)
  };
}

function createImportBundle(workflows: WorkflowDocument[]): WorkflowExportBundle {
  return {
    version: '0.1.0',
    exportedAt: new Date().toISOString(),
    settings: {
      privacyMode: 'local-first',
      ollamaBaseUrl: 'http://host.containers.internal:11434',
      repoMount: '.'
    },
    approvals: {
      globalDefaults: []
    },
    models: {
      provider: 'host-native-ollama',
      baseUrl: 'http://host.containers.internal:11434',
      installed: [],
      selectedModel: null
    },
    mcp: {
      servers: {}
    },
    taskCatalog: [],
    workflows
  };
}

export function parseImportBundle(value: unknown): WorkflowExportBundle {
  if (isWorkflowDocument(value)) {
    return createImportBundle([sanitizeWorkflowDocument(value)]);
  }

  if (!isRecord(value) || !Array.isArray(value.workflows)) {
    throw new Error('Expected an export bundle with a workflows array.');
  }

  const workflows = value.workflows.filter(isWorkflowDocument).map(sanitizeWorkflowDocument);

  if (workflows.length !== value.workflows.length) {
    throw new Error('One or more workflows in the import bundle are invalid.');
  }

  return {
    version: '0.1.0',
    exportedAt: isString(value.exportedAt) ? value.exportedAt : new Date().toISOString(),
    settings: {
      privacyMode: value.settings && isRecord(value.settings) && value.settings.privacyMode === 'strict-local'
        ? 'strict-local'
        : 'local-first',
      ollamaBaseUrl:
        value.settings && isRecord(value.settings) && isString(value.settings.ollamaBaseUrl)
          ? value.settings.ollamaBaseUrl
          : 'http://host.containers.internal:11434',
      repoMount:
        value.settings && isRecord(value.settings) && isString(value.settings.repoMount)
          ? value.settings.repoMount
          : '.'
    },
    approvals:
      value.approvals && isRecord(value.approvals) && Array.isArray(value.approvals.globalDefaults)
        ? { globalDefaults: sanitizeTags(value.approvals.globalDefaults) }
        : { globalDefaults: [] },
    models:
      value.models && isRecord(value.models) && Array.isArray(value.models.installed)
        ? {
            provider: 'host-native-ollama',
            baseUrl: isString(value.models.baseUrl) ? value.models.baseUrl : 'http://host.containers.internal:11434',
            installed: sanitizeTags(value.models.installed),
            selectedModel: isString(value.models.selectedModel) ? value.models.selectedModel : null
          }
        : {
            provider: 'host-native-ollama',
            baseUrl: 'http://host.containers.internal:11434',
            installed: [],
            selectedModel: null
          },
    mcp:
      value.mcp && isRecord(value.mcp) && isRecord(value.mcp.servers)
        ? { servers: value.mcp.servers }
        : { servers: {} },
    taskCatalog: [],
    workflows
  };
}
