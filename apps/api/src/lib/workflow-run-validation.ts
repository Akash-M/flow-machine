import { WorkflowDocument } from '@flow-machine/shared-types';

import { WorkflowStore } from './workflow-store';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function getFirstWorkflowRunValidationError(workflow: WorkflowDocument, workflowStore: WorkflowStore): string | null {
  if (!workflow.definition.startNodeId) {
    return 'Workflow has no start node.';
  }

  for (const node of workflow.definition.nodes) {
    const repositoryId = asString(node.config.repositoryId);
    const repositoryPath = asString(node.config.repositoryPath) ?? asString(node.config.path);

    switch (node.taskKey) {
      case 'select-repository':
        if (!repositoryPath && repositoryId && !workflowStore.getRepository(repositoryId)) {
          return `Select Repository node "${node.name}" references a saved repository that no longer exists. Choose another saved repository or enter a direct path.`;
        }
        break;
      case 'read-file':
        if (!asString(node.config.path)) {
          return `Read File node "${node.name}" is missing config.path. Add a target file path before running the workflow.`;
        }
        break;
      case 'write-file':
        if (!asString(node.config.path)) {
          return `Write File node "${node.name}" is missing config.path. Add a target file path before running the workflow.`;
        }
        break;
      case 'search-repo':
        if (!asString(node.config.query)) {
          return `Search Repository node "${node.name}" is missing config.query. Add a search query before running the workflow.`;
        }
        break;
      case 'shell-command':
        if (!asString(node.config.command) && !asString(node.config.commandString)) {
          return `Shell Command node "${node.name}" is missing config.command or config.commandString. Add a command before running the workflow.`;
        }
        break;
      case 'http-request':
        if (!asString(node.config.url)) {
          return `HTTP Request node "${node.name}" is missing config.url. Add a request URL before running the workflow.`;
        }
        break;
      case 'template':
        if (!asString(node.config.template)) {
          return `Template node "${node.name}" is missing config.template. Add a template string before running the workflow.`;
        }
        break;
      default:
        break;
    }
  }

  return null;
}