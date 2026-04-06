import { LocalRepository, WorkflowDefinition, WorkflowNode } from '@flow-machine/shared-types';

export interface WorkflowValidationIssue {
  field?: string;
  message: string;
  nodeId: string;
  nodeName: string;
  recommendation: string;
  taskKey: string;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function createIssue(
  node: WorkflowNode,
  message: string,
  recommendation: string,
  field?: string
): WorkflowValidationIssue {
  return {
    field,
    message,
    nodeId: node.id,
    nodeName: node.name,
    recommendation,
    taskKey: node.taskKey
  };
}

export function describeWorkflowValidationIssue(issue: WorkflowValidationIssue): string {
  return `${issue.nodeName}: ${issue.message} ${issue.recommendation}`;
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  repositories: LocalRepository[]
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];

  for (const node of definition.nodes) {
    const repositoryId = asString(node.config.repositoryId);
    const repositoryPath = asString(node.config.repositoryPath) ?? asString(node.config.path);

    switch (node.taskKey) {
      case 'select-repository': {
        if (!repositoryPath && repositoryId && !repositories.some((repository) => repository.id === repositoryId)) {
          issues.push(
            createIssue(
              node,
              `references a saved repository that no longer exists (${repositoryId}).`,
              'Choose another saved repository or enter a direct host path in the node inspector.',
              'repositoryId'
            )
          );
        }
        break;
      }
      case 'read-file':
      case 'write-file': {
        if (!asString(node.config.path)) {
          issues.push(
            createIssue(node, 'is missing config.path.', 'Add a target file path in the node config.', 'path')
          );
        }
        break;
      }
      case 'search-repo': {
        if (!asString(node.config.query)) {
          issues.push(
            createIssue(
              node,
              'is missing config.query.',
              'Add a search query in the node inspector before starting the workflow.',
              'query'
            )
          );
        }
        break;
      }
      case 'shell-command': {
        if (!asString(node.config.command) && !asString(node.config.commandString)) {
          issues.push(
            createIssue(
              node,
              'is missing config.command or config.commandString.',
              'Add a shell command in the node config before starting the workflow.'
            )
          );
        }
        break;
      }
      case 'http-request': {
        if (!asString(node.config.url)) {
          issues.push(
            createIssue(node, 'is missing config.url.', 'Add a request URL in the node config before starting the workflow.', 'url')
          );
        }
        break;
      }
      case 'template': {
        if (!asString(node.config.template)) {
          issues.push(
            createIssue(
              node,
              'is missing config.template.',
              'Add a template string in the node config before starting the workflow.',
              'template'
            )
          );
        }
        break;
      }
      default:
        break;
    }
  }

  return issues;
}