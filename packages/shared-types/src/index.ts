export type PrivacyMode = 'strict-local' | 'local-first';

export type ServiceHealthState = 'online' | 'offline' | 'degraded';

export type PreflightState = 'ready' | 'warning' | 'missing';

export type RunState = 'never' | 'queued' | 'running' | 'waiting-approval' | 'success' | 'failed';

export type WorkflowStepState = 'pending' | 'running' | 'waiting-approval' | 'success' | 'failed' | 'skipped';

export type WorkflowLogLevel = 'info' | 'warn' | 'error';

export type WorkflowNetworkKind = 'http' | 'ollama' | 'mcp' | 'browser';

export type TaskCapability =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'shell'
  | 'git:read'
  | 'git:write'
  | 'network:http'
  | 'network:mcp'
  | 'secrets'
  | 'browser'
  | 'llm';

export interface TaskResourcePolicy {
  cpuShares?: number;
  memoryMb?: number;
  timeoutMs?: number;
  concurrency?: number;
}

export interface PromptAttachmentPayload {
  contentBase64: string;
  name: string;
  size: number;
  type: string;
}

export interface TaskCatalogEntry {
  key: string;
  name: string;
  description: string;
  capabilities: TaskCapability[];
  requiresApprovalByDefault: boolean;
  resourceDefaults: TaskResourcePolicy;
}

export interface CustomTask extends TaskCatalogEntry {
  id: string;
  source: 'generated' | 'manual';
  generatedAt: string;
  systemPrompt?: string;
  executionStrategy: 'agent' | 'template' | 'transform';
}

export interface TaskDraft extends TaskCatalogEntry {
  reason: string;
  source: 'generated' | 'manual';
  systemPrompt?: string;
  executionStrategy: 'agent' | 'template' | 'transform';
}

export interface ServiceHealth {
  name: string;
  status: ServiceHealthState;
  checkedAt: string;
  message: string;
  url?: string;
}

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightState;
  detail: string;
  required: boolean;
}

export interface RepoMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
  mode: 'mounted';
}

export type RepositorySource = 'mounted-root' | 'registered' | 'ad-hoc';

export interface LocalRepository {
  id: string;
  name: string;
  hostPath: string;
  relativePath: string;
  isGitRepository: boolean;
  source: RepositorySource;
  updatedAt: string;
}

export interface WorkflowRunContext {
  repository: LocalRepository | null;
}

export interface EngineSummary {
  executionModel: 'graph';
  resumeMode: 'supported';
  agentMode: 'bounded-dynamic';
  subflows: 'planned';
}

export interface AppStatus {
  appName: string;
  version: string;
  startedAt: string;
  onboardingCommand: string;
  privacy: {
    mode: PrivacyMode;
    networkAllowed: boolean;
    summary: string;
  };
  ollama: ServiceHealth;
  runtime: {
    containerRuntime: 'podman';
    nodeVersion: string;
    repoMount: RepoMount;
    dataDir: string;
    mcpConfigPath: string;
    hostNativeOllama: boolean;
  };
  engine: EngineSummary;
  capabilities: {
    approvals: boolean;
    exportFormat: 'json';
    hostNativeOllama: boolean;
    mcpImport: 'vscode-mcp.json';
  };
  preflight: PreflightCheck[];
  plannedNodes: string[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  lastRunState: RunState;
  updatedAt: string;
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  name: string;
  taskKey: string;
  position: WorkflowNodePosition;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}

export interface WorkflowDefinition {
  version: '1';
  startNodeId: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowDocument extends WorkflowSummary {
  createdAt: string;
  definition: WorkflowDefinition;
}

export interface WorkflowDraft {
  name: string;
  description: string;
  tags: string[];
  definition: WorkflowDefinition;
}

export interface WorkflowDraftProposal {
  workflow: WorkflowDraft;
  summary: string;
  reusedTaskKeys: string[];
  taskDrafts: TaskDraft[];
}

export interface WorkflowStepLogEntry {
  id: string;
  at: string;
  level: WorkflowLogLevel;
  message: string;
  data?: unknown;
}

export interface WorkflowStepApproval {
  required: boolean;
  state: 'not-required' | 'pending' | 'approved' | 'rejected';
  prompt: string | null;
}

export interface WorkflowRunNetworkActivity {
  kind: WorkflowNetworkKind;
  target: string;
  method?: string;
}

export interface WorkflowStepRun {
  nodeId: string;
  nodeName: string;
  taskKey: string;
  state: WorkflowStepState;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
  logs: WorkflowStepLogEntry[];
  network: WorkflowRunNetworkActivity[];
  approval: WorkflowStepApproval;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: Exclude<RunState, 'never'>;
  currentNodeId: string | null;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  errorMessage: string | null;
  stepCount: number;
}

export interface WorkflowRun extends WorkflowRunSummary {
  pendingNodeIds: string[];
  steps: WorkflowStepRun[];
  context: WorkflowRunContext;
}

export interface ApprovalRules {
  globalDefaults: string[];
}

export interface ModelManifest {
  provider: 'host-native-ollama';
  baseUrl: string;
  installed: string[];
  selectedModel: string | null;
}

export interface MergedMcpConfig {
  servers: Record<string, unknown>;
}

export type SecretBackend = 'encrypted-file';

export interface SecretSummary {
  key: string;
  updatedAt: string;
  backend: SecretBackend;
}

export interface OllamaModelDescriptor {
  name: string;
  size: number | null;
  modifiedAt: string | null;
  digest: string | null;
}

export interface ModelGatewayState {
  manifest: ModelManifest;
  online: boolean;
  message: string;
  models: OllamaModelDescriptor[];
  selectedModelCapabilities: string[] | null;
  version: string | null;
}

export interface McpConnectionSummary {
  id: string;
  transport: 'stdio' | 'http' | 'sse' | 'unknown';
  target: string;
}

export interface BrowserRuntimeStatus {
  available: boolean;
  provider: 'playwright' | 'unconfigured';
  message: string;
}

export interface WorkflowExportBundle {
  version: '0.1.0';
  exportedAt: string;
  settings: {
    privacyMode: PrivacyMode;
    ollamaBaseUrl: string;
    repoMount: string;
  };
  approvals: ApprovalRules;
  models: ModelManifest;
  mcp: MergedMcpConfig;
  taskCatalog: TaskCatalogEntry[];
  workflows: WorkflowDocument[];
}

export function createBlankWorkflowDefinition(): WorkflowDefinition {
  return {
    version: '1',
    startNodeId: null,
    nodes: [],
    edges: []
  };
}
