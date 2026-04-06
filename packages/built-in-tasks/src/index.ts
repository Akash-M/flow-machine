import { TaskCatalogEntry } from '@flow-machine/shared-types';
import { defineTask, toTaskCatalogEntry } from '@flow-machine/task-sdk';

const taskDefinitions = [
  defineTask({
    key: 'select-repository',
    name: 'Select Repository',
    description: 'Select a repository context for downstream repository-aware tasks.',
    capabilities: [],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'read-file',
    name: 'Read File',
    description: 'Read files from the currently selected repository scope.',
    capabilities: ['filesystem:read'],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'write-file',
    name: 'Write File',
    description: 'Write or patch files inside the allowed repository scope.',
    capabilities: ['filesystem:write'],
    requiresApprovalByDefault: true
  }),
  defineTask({
    key: 'search-repo',
    name: 'Search Repository',
    description: 'Search code and text across the currently selected repository scope.',
    capabilities: ['filesystem:read'],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'shell-command',
    name: 'Shell Command',
    description: 'Run shell commands with explicit approval and policy controls.',
    capabilities: ['shell', 'filesystem:read', 'filesystem:write'],
    requiresApprovalByDefault: true,
    resourceDefaults: {
      timeoutMs: 120_000,
      memoryMb: 1024
    }
  }),
  defineTask({
    key: 'git-summary',
    name: 'Git Summary',
    description: 'Inspect status and diffs to summarize local changes.',
    capabilities: ['git:read', 'filesystem:read'],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'http-request',
    name: 'HTTP Request',
    description: 'Fetch or send data over HTTP with visible network boundaries.',
    capabilities: ['network:http', 'secrets'],
    requiresApprovalByDefault: true
  }),
  defineTask({
    key: 'mcp-call',
    name: 'MCP Call',
    description: 'Execute tools from imported or managed MCP connections.',
    capabilities: ['network:mcp', 'secrets'],
    requiresApprovalByDefault: true
  }),
  defineTask({
    key: 'json-transform',
    name: 'JSON Transform',
    description: 'Transform step data without leaving the local runtime.',
    capabilities: [],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'template',
    name: 'Template',
    description: 'Render text and prompt templates for downstream nodes.',
    capabilities: [],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'condition',
    name: 'Condition',
    description: 'Branch workflow execution based on structured step data.',
    capabilities: [],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'approval',
    name: 'Approval',
    description: 'Pause execution until a developer approves the next action.',
    capabilities: [],
    requiresApprovalByDefault: false
  }),
  defineTask({
    key: 'agent',
    name: 'Agent',
    description: 'Run a bounded dynamic agent against an allowlisted toolset.',
    capabilities: ['llm', 'filesystem:read', 'network:http', 'network:mcp'],
    requiresApprovalByDefault: true,
    resourceDefaults: {
      timeoutMs: 180_000,
      memoryMb: 2048
    }
  }),
  defineTask({
    key: 'browser-automation',
    name: 'Browser Automation',
    description: 'Drive browser sessions for public or authenticated web tasks.',
    capabilities: ['browser', 'network:http', 'secrets'],
    requiresApprovalByDefault: true,
    resourceDefaults: {
      timeoutMs: 180_000,
      memoryMb: 2048
    }
  })
];

export const builtInTaskCatalog: TaskCatalogEntry[] = taskDefinitions.map(toTaskCatalogEntry);

export const builtInTaskNames = builtInTaskCatalog.map((task) => task.name);
