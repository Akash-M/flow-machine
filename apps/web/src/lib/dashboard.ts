import { AppStatus } from '@flow-machine/shared-types';

export type DashboardView = 'overview' | 'workflows' | 'workflow-editor' | 'runs' | 'approvals' | 'catalog' | 'models' | 'mcp' | 'secrets' | 'settings';
export type StudioView = 'canvas' | 'definition';

export const dashboardPathByView: Record<DashboardView, string> = {
  overview: '/',
  workflows: '/workflows',
  'workflow-editor': '/workflow-editor',
  runs: '/runs',
  approvals: '/approvals',
  catalog: '/task-catalog',
  models: '/models',
  mcp: '/mcp',
  secrets: '/secrets',
  settings: '/settings'
};

export interface DashboardViewCopy {
  eyebrow: string;
  title: string;
  description: string;
}

export const dashboardViewCopy: Record<DashboardView, DashboardViewCopy> = {
  overview: {
    eyebrow: 'Docs',
    title: 'What Flow Machine Is For',
    description: 'Understand the product, confirm the runtime, and move into the workflow builder with clear intent.'
  },
  workflows: {
    eyebrow: 'Browse workflows',
    title: 'Workflows Catalog',
    description: 'Create workflows, review the saved catalog, and open a specific flow when you are ready to edit it.'
  },
  'workflow-editor': {
    eyebrow: 'Edit workflows',
    title: 'Workflow Editor',
    description: 'Choose a saved workflow, refine its graph, and run or delete it without returning to the catalog.'
  },
  runs: {
    eyebrow: 'Inspect execution',
    title: 'Run History',
    description: 'Track workflow execution, step output, approval pauses, and reruns in one place.'
  },
  approvals: {
    eyebrow: 'Control execution',
    title: 'Approvals',
    description: 'Review pending run gates and tune the task types that should auto-approve by default.'
  },
  catalog: {
    eyebrow: 'Reference nodes',
    title: 'Task Catalog',
    description: 'Review which nodes stay local, which ones cross a boundary, and where approvals matter by default.'
  },
  models: {
    eyebrow: 'Manage Ollama',
    title: 'Models',
    description: 'Choose the default model, review installed host-native models, and pull additional ones.'
  },
  mcp: {
    eyebrow: 'Connect tools',
    title: 'MCP Connections',
    description: 'Import and manage MCP server definitions that future workflow nodes can target.'
  },
  secrets: {
    eyebrow: 'Store access',
    title: 'Secrets',
    description: 'Keep reusable credentials outside exports and make them available through runtime placeholders.'
  },
  settings: {
    eyebrow: 'Inspect runtime',
    title: 'Settings',
    description: 'Review privacy mode, browser automation readiness, and import or export the local bundle.'
  }
};

export function dashboardPathForView(view: DashboardView): string {
  return dashboardPathByView[view];
}

export function workflowDetailPathForId(workflowId: string): string {
  return `/workflows/${encodeURIComponent(workflowId)}`;
}

export function workflowIdFromPathname(pathname: string): string | null {
  const normalizedPathname = pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
  const match = normalizedPathname.match(/^\/workflows\/([^/]+)$/);

  return match ? decodeURIComponent(match[1]) : null;
}

export function dashboardViewFromPathname(pathname: string): DashboardView | null {
  const normalizedPathname = pathname === '/' ? pathname : pathname.replace(/\/+$/, '');

  if (/^\/workflows\/[^/]+$/.test(normalizedPathname)) {
    return 'workflow-editor';
  }

  return (
    (Object.entries(dashboardPathByView).find(([, path]) => path === normalizedPathname)?.[0] as DashboardView | undefined) ?? null
  );
}

export function preflightTone(status: AppStatus['preflight'][number]['status']): 'good' | 'warn' | 'bad' {
  if (status === 'ready') {
    return 'good';
  }

  if (status === 'warning') {
    return 'warn';
  }

  return 'bad';
}

export function privacyTone(mode: AppStatus['privacy']['mode']): 'good' | 'warn' {
  return mode === 'strict-local' ? 'good' : 'warn';
}