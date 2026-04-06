import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ApprovalRules,
  AppStatus,
  BrowserRuntimeStatus,
  CustomTask,
  LocalRepository,
  McpConnectionSummary,
  MergedMcpConfig,
  ModelGatewayState,
  PromptAttachmentPayload,
  SecretBackend,
  SecretSummary,
  TaskCatalogEntry,
  TaskDraft,
  WorkflowDocument,
  WorkflowDraftProposal,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunSummary,
  WorkflowSummary
} from '@flow-machine/shared-types';

import {
  DashboardView,
  DashboardViewCopy,
  StudioView,
  dashboardPathForView,
  dashboardViewCopy,
  dashboardViewFromPathname,
  workflowDetailPathForId,
  workflowIdFromPathname
} from '../lib/dashboard';
import { downloadText, fetchJson, isRecord, requestJson, requestNdjsonStream, requestText } from '../lib/http';
import {
  addEdgeToDefinition,
  addNodeToDefinition,
  cloneWorkflowDocument,
  removeEdgeFromDefinition,
  removeNodeFromDefinition,
  setStartNode,
  updateNodeInDefinition
} from '../lib/workflow-editor';

const initialCreateForm: WorkflowCreateForm = {
  name: '',
  description: '',
  tags: ''
};

const emptyEdgeDraft: WorkflowEdgeDraft = {
  sourceId: '',
  targetId: ''
};

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function serializeTags(tags: string[]): string {
  return tags.join(', ');
}

export interface DashboardNavigationItem {
  id: DashboardView;
  label: string;
  description: string;
  href: string;
}

export interface WorkflowCreateForm {
  name: string;
  description: string;
  tags: string;
}

export interface WorkflowEdgeDraft {
  sourceId: string;
  targetId: string;
}

export interface WorkflowDetailState {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
}

export interface AppViewModel {
  activeView: DashboardView;
  studioView: StudioView;
  setActiveView: (view: DashboardView) => void;
  setStudioView: (view: StudioView) => void;
}

export interface SystemViewModel {
  currentView: DashboardViewCopy;
  navigationItems: DashboardNavigationItem[];
  selectedWorkflowActive: boolean;
  selectedWorkflowName: string;
  selectedWorkflowStatusCopy: string;
  status: AppStatus | null;
}

export interface CatalogViewModel {
  approvalTaskCount: number;
  customTaskDescription: string;
  generatedTaskDraft: TaskDraft | null;
  handleDiscardGeneratedTaskDraft: () => void;
  handleGenerateCustomTask: (attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleRefineGeneratedTaskDraft: (instructions: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleRefineTask: (taskKey: string, instructions: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleSaveGeneratedTaskDraft: () => Promise<void>;
  isGeneratingTask: boolean;
  isSavingTaskDraft: boolean;
  isTaskOperationRunning: boolean;
  isRefiningTask: boolean;
  localOnlyTaskCount: number;
  networkTaskCount: number;
  selectedModelName: string | null;
  selectedModelSupportsImages: boolean | null;
  setCustomTaskDescription: (value: string) => void;
  taskActivity: TaskOperationActivity;
  tasks: TaskCatalogEntry[];
}

export interface TaskActivityLogEntry {
  id: string;
  level: 'error' | 'info' | 'success';
  message: string;
}

export interface TaskOperationActivity {
  action: 'generate' | 'refine' | null;
  liveOutput: string;
  logs: TaskActivityLogEntry[];
  status: 'error' | 'idle' | 'running' | 'success';
  targetTaskKey: string | null;
}

export interface ModelPullActivity {
  liveOutput: string;
  logs: TaskActivityLogEntry[];
  modelName: string | null;
  status: 'error' | 'idle' | 'running' | 'success';
}

export interface WorkflowOperationActivity {
  action: 'generate' | 'refine' | null;
  liveOutput: string;
  logs: TaskActivityLogEntry[];
  status: 'error' | 'idle' | 'running' | 'success';
  targetWorkflowId: string | null;
}

interface TaskOperationStreamEvent {
  customTask?: CustomTask;
  message?: string;
  taskDraft?: TaskDraft;
  text?: string;
  type: 'draft' | 'error' | 'result' | 'status' | 'token';
}

interface WorkflowOperationStreamEvent {
  message?: string;
  proposal?: WorkflowDraftProposal;
  text?: string;
  type: 'draft' | 'error' | 'result' | 'status' | 'token';
  workflow?: WorkflowDocument;
}

interface ApplyWorkflowDraftResponse {
  createdTasks: CustomTask[];
  workflow: WorkflowDocument;
}

interface ModelPullStreamEvent {
  completed?: number;
  digest?: string;
  message?: string;
  state?: ModelGatewayState;
  status?: string;
  total?: number;
  type: 'error' | 'result' | 'status';
}

let taskActivityLogSequence = 0;
let appNotificationSequence = 0;

const initialTaskOperationActivity: TaskOperationActivity = {
  action: null,
  liveOutput: '',
  logs: [],
  status: 'idle',
  targetTaskKey: null
};

const initialModelPullActivity: ModelPullActivity = {
  liveOutput: '',
  logs: [],
  modelName: null,
  status: 'idle'
};

const initialWorkflowOperationActivity: WorkflowOperationActivity = {
  action: null,
  liveOutput: '',
  logs: [],
  status: 'idle',
  targetWorkflowId: null
};

function createTaskActivityLogEntry(level: TaskActivityLogEntry['level'], message: string): TaskActivityLogEntry {
  taskActivityLogSequence += 1;

  return {
    id: `task-activity-${taskActivityLogSequence}`,
    level,
    message
  };
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;

  return `${scaled >= 10 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
}

function formatModelPullLogMessage(status: string, digest?: string): string {
  return digest ? `${status} ${digest.slice(0, 12)}...` : status;
}

function formatModelPullProgress(status: string, completed?: number, total?: number, digest?: string): string {
  const parts = [formatModelPullLogMessage(status, digest)];

  if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
    const percent = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    parts.push(`${percent}%`);
    parts.push(`${formatBytes(completed)} / ${formatBytes(total)}`);
  } else if (typeof completed === 'number' && completed > 0) {
    parts.push(formatBytes(completed));
  }

  return parts.join(' | ');
}

export interface AppNotification {
  id: string;
  level: 'error' | 'info' | 'success' | 'warn';
  message: string;
}

interface QueuedNotification extends AppNotification {
  dedupeKey?: string;
}

function createAppNotification(level: AppNotification['level'], message: string, dedupeKey?: string): QueuedNotification {
  appNotificationSequence += 1;

  return {
    dedupeKey,
    id: `app-notification-${appNotificationSequence}`,
    level,
    message
  };
}

export interface RunsViewModel {
  activeRunCount: number;
  completedRunCount: number;
  detailState: WorkflowDetailState;
  isActionPending: boolean;
  isStartingRun: boolean;
  runs: WorkflowRunSummary[];
  selectedRun: WorkflowRun | null;
  selectedRunId: string | null;
  selectedWorkflowName: string;
  waitingApprovalCount: number;
  canStartSelectedWorkflow: boolean;
  handleApproveSelectedRun: () => void;
  handleOpenRun: (runId: string) => void;
  handleRejectSelectedRun: () => void;
  handleResumeSelectedRun: () => void;
  handleRerunSelectedRun: () => void;
  handleStartSelectedWorkflowRun: () => void;
}

export interface ApprovalsViewModel {
  isSavingRules: boolean;
  pendingRuns: WorkflowRunSummary[];
  rules: ApprovalRules;
  tasks: TaskCatalogEntry[];
  handleOpenRun: (runId: string) => void;
  handleToggleAutoApproval: (taskKey: string) => void;
}

export interface McpViewModel {
  connections: McpConnectionSummary[];
  errorMessage: string | null;
  importText: string;
  isLoading: boolean;
  isMutating: boolean;
  mcp: MergedMcpConfig;
  serverDefinitionText: string;
  serverIdInput: string;
  setImportText: (value: string) => void;
  setServerDefinitionText: (value: string) => void;
  setServerIdInput: (value: string) => void;
  handleDeleteServer: (id: string) => void;
  handleImportConfig: () => void;
  handleSaveServer: () => void;
}

export interface SecretsViewModel {
  backend: SecretBackend;
  errorMessage: string | null;
  importEnvText: string;
  isLoading: boolean;
  isMutating: boolean;
  secretKeyInput: string;
  secretValueInput: string;
  secrets: SecretSummary[];
  setImportEnvText: (value: string) => void;
  setSecretKeyInput: (value: string) => void;
  setSecretValueInput: (value: string) => void;
  handleDeleteSecret: (key: string) => void;
  handleImportEnv: () => void;
  handleSaveSecret: () => void;
}

export interface SettingsViewModel {
  browserStatus: BrowserRuntimeStatus | null;
  browserStatusError: string | null;
  errorMessage: string | null;
  handleDeleteRepository: (id: string) => void;
  handleExportAll: () => Promise<void>;
  handleImportChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handlePullModel: () => void;
  handleSaveRepository: () => void;
  handleSelectModel: (name: string | null) => void;
  isLoading: boolean;
  isPullingModel: boolean;
  isMutating: boolean;
  isSavingRepositories: boolean;
  modelPullActivity: ModelPullActivity;
  pullModelName: string;
  repositories: LocalRepository[];
  repositoryNameInput: string;
  repositoryPathInput: string;
  setRepositoryNameInput: (value: string) => void;
  setRepositoryPathInput: (value: string) => void;
  setPullModelName: (value: string) => void;
  state: ModelGatewayState | null;
}

export interface WorkflowStudioModel {
  activeRun: WorkflowRun | null;
  canAddEdge: boolean;
  canAddNode: boolean;
  canSaveWorkflow: boolean;
  canStartWorkflow: boolean;
  configError: string | null;
  createForm: WorkflowCreateForm;
  createPending: boolean;
  deletePending: boolean;
  detailState: WorkflowDetailState;
  edgeDraft: WorkflowEdgeDraft;
  editorWorkflow: WorkflowDocument | null;
  handleApplyWorkflowDraft: () => Promise<void>;
  isEditorDirty: boolean;
  handleDiscardWorkflowDraft: () => void;
  isGeneratingWorkflow: boolean;
  isApplyingWorkflowDraft: boolean;
  isRunActionPending: boolean;
  isRefiningWorkflow: boolean;
  isTaskOperationRunning: boolean;
  isWorkflowOperationRunning: boolean;
  latestRun: WorkflowRunSummary | null;
  newNodeTaskKey: string;
  nodeConfigText: string;
  pendingApprovalRun: WorkflowRunSummary | null;
  repositories: LocalRepository[];
  recentRuns: WorkflowRunSummary[];
  selectedNode: WorkflowNode | null;
  selectedNodeEdges: WorkflowEdge[];
  selectedModelName: string | null;
  selectedModelSupportsImages: boolean | null;
  selectedNodeId: string | null;
  selectedWorkflowId: string | null;
  selectedWorkflowSummary: WorkflowSummary | null;
  startRunPending: boolean;
  studioView: StudioView;
  taskActivity: TaskOperationActivity;
  tasks: TaskCatalogEntry[];
  updatePending: boolean;
  workflowActivity: WorkflowOperationActivity;
  workflowDraftProposal: WorkflowDraftProposal | null;
  workflowRunCount: number;
  workflowTagsInput: string;
  workflows: WorkflowSummary[];
  handleAddEdge: () => void;
  handleAddNode: () => void;
  handleApplyNodeConfig: () => void;
  handleApproveRun: (runId: string) => void;
  handleCreateFormChange: (field: keyof WorkflowCreateForm, value: string) => void;
  handleCreateSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleDeleteSelected: () => void;
  handleDeleteSelectedNode: () => void;
  handleEdgeDraftChange: (update: Partial<WorkflowEdgeDraft>) => void;
  handleExportAll: () => Promise<void>;
  handleExportWorkflow: () => Promise<void>;
  handleFocusRun: (runId: string) => void;
  handleGenerateWorkflow: (description: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleImportChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  handleNewNodeTaskKeyChange: (value: string) => void;
  handleNodeConfigTextChange: (value: string) => void;
  handleNodeFieldChange: (field: 'name' | 'taskKey', value: string) => void;
  handleNodePositionChange: (axis: 'x' | 'y', value: string) => void;
  handleOpenRun: (runId: string) => void;
  handleRepositorySelectionChange: (repositoryId: string) => void;
  handleRejectRun: (runId: string) => void;
  handleRemoveEdge: (edgeId: string) => void;
  handleRerunRun: (runId: string) => void;
  handleRefineWorkflow: (instructions: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleRefineWorkflowDraftProposal: (instructions: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleRefineWorkflowTaskDraft: (taskKey: string, instructions: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  handleResetWorkflow: () => void;
  handleResumeRun: (runId: string) => void;
  handleSaveWorkflow: () => void;
  handleSelectNode: (nodeId: string) => void;
  handleSelectWorkflow: (workflowId: string) => void;
  handleStartSelectedWorkflowRun: () => void;
  handleStartNodeChange: (nodeId: string) => void;
  handleStudioViewChange: (view: StudioView) => void;
  handleWorkflowFieldChange: (field: 'name' | 'description', value: string) => void;
  handleWorkflowTagsChange: (value: string) => void;
}

export interface NotificationsModel {
  dismissNotification: (id: string) => void;
  notifications: AppNotification[];
}

export interface FlowMachineAppModel {
  catalog: CatalogViewModel;
  approvals: ApprovalsViewModel;
  mcp: McpViewModel;
  notifications: NotificationsModel;
  runs: RunsViewModel;
  secrets: SecretsViewModel;
  settings: SettingsViewModel;
  statusQuery: UseQueryResult<AppStatus, Error>;
  system: SystemViewModel;
  view: AppViewModel;
  workflowStudio: WorkflowStudioModel;
}

function toRunSummary(run: WorkflowRun): WorkflowRunSummary {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    currentNodeId: run.currentNodeId,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
    errorMessage: run.errorMessage,
    stepCount: run.steps.length
  };
}

function toWorkflowSummary(workflow: WorkflowDocument): WorkflowSummary {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    tags: workflow.tags,
    lastRunState: workflow.lastRunState,
    updatedAt: workflow.updatedAt
  };
}

function upsertWorkflowSummary(workflows: WorkflowSummary[] | undefined, workflow: WorkflowDocument): WorkflowSummary[] {
  const nextSummary = toWorkflowSummary(workflow);

  return [nextSummary, ...(workflows ?? []).filter((entry) => entry.id !== workflow.id)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function useFlowMachineApp(): FlowMachineAppModel {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = dashboardViewFromPathname(location.pathname) ?? 'overview';
  const routedWorkflowId = workflowIdFromPathname(location.pathname);
  const [studioView, setStudioView] = useState<StudioView>('canvas');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<WorkflowCreateForm>(initialCreateForm);
  const [workflowTagsInput, setWorkflowTagsInput] = useState('');
  const [newNodeTaskKey, setNewNodeTaskKey] = useState('');
  const [edgeDraft, setEdgeDraft] = useState<WorkflowEdgeDraft>(emptyEdgeDraft);
  const [nodeConfigText, setNodeConfigText] = useState('{}');
  const [configError, setConfigError] = useState<string | null>(null);
  const [editorWorkflow, setEditorWorkflow] = useState<WorkflowDocument | null>(null);
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [notifications, setNotifications] = useState<QueuedNotification[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [pullModelName, setPullModelName] = useState('');
  const [mcpImportText, setMcpImportText] = useState('');
  const [mcpServerIdInput, setMcpServerIdInput] = useState('');
  const [mcpServerDefinitionText, setMcpServerDefinitionText] = useState('{\n  \"command\": \"npx\",\n  \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem\", \".\"]\n}');
  const [secretKeyInput, setSecretKeyInput] = useState('');
  const [secretValueInput, setSecretValueInput] = useState('');
  const [secretImportEnvText, setSecretImportEnvText] = useState('');
  const [repositoryNameInput, setRepositoryNameInput] = useState('');
  const [repositoryPathInput, setRepositoryPathInput] = useState('');
  const [customTaskDescription, setCustomTaskDescription] = useState('');
  const [generatedTaskDraft, setGeneratedTaskDraft] = useState<TaskDraft | null>(null);
  const [taskActivity, setTaskActivity] = useState<TaskOperationActivity>(initialTaskOperationActivity);
  const [workflowActivity, setWorkflowActivity] = useState<WorkflowOperationActivity>(initialWorkflowOperationActivity);
  const [workflowDraftProposal, setWorkflowDraftProposal] = useState<WorkflowDraftProposal | null>(null);
  const [modelPullActivity, setModelPullActivity] = useState<ModelPullActivity>(initialModelPullActivity);
  const hasSeededRunStatusSnapshotRef = useRef(false);
  const runStatusSnapshotRef = useRef<Map<string, WorkflowRunSummary['status']>>(new Map());

  function pushNotification(message: string, level: AppNotification['level'] = 'info', dedupeKey?: string): void {
    setNotifications((current) => {
      if (
        dedupeKey &&
        current.some((entry) => entry.dedupeKey === dedupeKey && entry.level === level && entry.message === message)
      ) {
        return current;
      }

      return [...current, createAppNotification(level, message, dedupeKey)].slice(-4);
    });
  }

  function dismissNotification(id: string): void {
    setNotifications((current) => current.filter((entry) => entry.id !== id));
  }

  function setFeedback(message: string | null): void {
    if (!message) {
      setNotifications([]);
      return;
    }

    pushNotification(message);
  }

  function setActiveView(view: DashboardView): void {
    const nextPath = dashboardPathForView(view);

    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  }

  function openWorkflowCatalog(): void {
    const nextPath = dashboardPathForView('workflows');

    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  }

  function openWorkflowDetail(workflowId: string): void {
    const nextPath = workflowDetailPathForId(workflowId);

    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  }

  const statusQuery = useQuery<AppStatus, Error>({
    queryKey: ['system-status'],
    queryFn: () => fetchJson<AppStatus>('/api/system/status'),
    refetchInterval: 10_000
  });

  const workflowsQuery = useQuery<WorkflowSummary[], Error>({
    queryKey: ['workflows'],
    queryFn: async () => {
      const response = await fetchJson<{ workflows: WorkflowSummary[] }>('/api/workflows');
      return response.workflows;
    },
    refetchOnWindowFocus: false
  });

  const workflowDetailQuery = useQuery<WorkflowDocument, Error>({
    enabled: Boolean(selectedWorkflowId),
    queryKey: ['workflow', selectedWorkflowId],
    queryFn: async () => {
      const response = await fetchJson<{ workflow: WorkflowDocument }>(`/api/workflows/${selectedWorkflowId}`);
      return response.workflow;
    },
    refetchOnWindowFocus: false
  });

  const tasksQuery = useQuery<TaskCatalogEntry[], Error>({
    queryKey: ['tasks'],
    queryFn: async () => {
      const response = await fetchJson<{ tasks: TaskCatalogEntry[] }>('/api/tasks');
      return response.tasks;
    },
    refetchOnWindowFocus: false
  });

  const runsQuery = useQuery<WorkflowRunSummary[], Error>({
    queryKey: ['runs'],
    queryFn: async () => {
      const response = await fetchJson<{ runs: WorkflowRunSummary[] }>('/api/runs');
      return response.runs;
    },
    refetchInterval: 4_000,
    refetchOnWindowFocus: false
  });

  const runDetailQuery = useQuery<WorkflowRun, Error>({
    enabled: Boolean(selectedRunId),
    queryKey: ['run', selectedRunId],
    queryFn: async () => {
      const response = await fetchJson<{ run: WorkflowRun }>(`/api/runs/${selectedRunId}`);
      return response.run;
    },
    refetchInterval: 4_000,
    refetchOnWindowFocus: false
  });

  const approvalsQuery = useQuery<{ rules: ApprovalRules; pendingRuns: WorkflowRunSummary[] }, Error>({
    queryKey: ['approvals'],
    queryFn: () => fetchJson<{ rules: ApprovalRules; pendingRuns: WorkflowRunSummary[] }>('/api/approvals'),
    refetchInterval: 4_000,
    refetchOnWindowFocus: false
  });

  const modelStateQuery = useQuery<ModelGatewayState, Error>({
    queryKey: ['models'],
    queryFn: async () => {
      const response = await fetchJson<{ state: ModelGatewayState }>('/api/models');
      return response.state;
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: false
  });

  const mcpQuery = useQuery<{ connections: McpConnectionSummary[]; mcp: MergedMcpConfig }, Error>({
    queryKey: ['mcp'],
    queryFn: () => fetchJson<{ connections: McpConnectionSummary[]; mcp: MergedMcpConfig }>('/api/mcp'),
    refetchOnWindowFocus: false
  });

  const secretsQuery = useQuery<{ backend: SecretBackend; secrets: SecretSummary[] }, Error>({
    queryKey: ['secrets'],
    queryFn: () => fetchJson<{ backend: SecretBackend; secrets: SecretSummary[] }>('/api/secrets'),
    refetchOnWindowFocus: false
  });

  const browserStatusQuery = useQuery<BrowserRuntimeStatus, Error>({
    queryKey: ['browser-status'],
    queryFn: async () => {
      const response = await fetchJson<{ browser: BrowserRuntimeStatus }>('/api/browser/status');
      return response.browser;
    },
    refetchOnWindowFocus: false
  });

  const repositoriesQuery = useQuery<LocalRepository[], Error>({
    queryKey: ['repositories'],
    queryFn: async () => {
      const response = await fetchJson<{ repositories: LocalRepository[] }>('/api/repositories');
      return response.repositories;
    },
    refetchOnWindowFocus: false
  });

  const createWorkflowMutation = useMutation({
    mutationFn: (payload: { name: string; description: string; tags: string[] }) =>
      requestJson<{ workflow: WorkflowDocument }>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    onSuccess: async ({ workflow }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['workflow'] })
      ]);
      setSelectedWorkflowId(workflow.id);
      setCreateForm(initialCreateForm);
      openWorkflowDetail(workflow.id);
      setStudioView('canvas');
      setFeedback(`Created workflow ${workflow.name}.`);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not create workflow.');
    }
  });

  const updateWorkflowMutation = useMutation({
    mutationFn: (workflow: WorkflowDocument) =>
      requestJson<{ workflow: WorkflowDocument }>(`/api/workflows/${workflow.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: workflow.name.trim(),
          description: workflow.description.trim(),
          tags: workflow.tags,
          definition: workflow.definition
        })
      }),
    onSuccess: async ({ workflow }) => {
      setEditorWorkflow(cloneWorkflowDocument(workflow));
      setWorkflowTagsInput(serializeTags(workflow.tags));
      setSelectedNodeId((current) =>
        current && workflow.definition.nodes.some((node) => node.id === current)
          ? current
          : workflow.definition.startNodeId ?? workflow.definition.nodes[0]?.id ?? null
      );
      setIsEditorDirty(false);
      setConfigError(null);
      openWorkflowDetail(workflow.id);
      setFeedback(`Saved workflow ${workflow.name}.`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not save workflow.');
    }
  });

  const deleteWorkflowMutation = useMutation({
    mutationFn: (workflowId: string) =>
      requestJson<void>(`/api/workflows/${workflowId}`, {
        method: 'DELETE'
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['workflow'] })
      ]);
      setFeedback('Deleted workflow.');
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not delete workflow.');
    }
  });

  const importBundleMutation = useMutation({
    mutationFn: (payload: unknown) =>
      requestJson<{ importedCount: number; workflowIds: string[] }>('/api/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    onSuccess: async ({ importedCount, workflowIds }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['workflow'] })
      ]);

      if (workflowIds[0]) {
        setSelectedWorkflowId(workflowIds[0]);
        openWorkflowDetail(workflowIds[0]);
      } else {
        openWorkflowCatalog();
      }

      setStudioView('canvas');
      setFeedback(`Imported ${importedCount} workflow${importedCount === 1 ? '' : 's'}.`);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not import JSON.');
    }
  });

  const startRunMutation = useMutation({
    mutationFn: (workflowId: string) =>
      requestJson<{ run: WorkflowRun }>(`/api/workflows/${workflowId}/runs`, {
        method: 'POST',
        body: JSON.stringify({})
      }),
    onSuccess: async ({ run }) => {
      setSelectedRunId(run.id);
      setFeedback(`Started run for ${run.workflowName}.`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['run', run.id] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not start workflow run.');
    }
  });

  const approveRunMutation = useMutation({
    mutationFn: (runId: string) =>
      requestJson<{ run: WorkflowRun }>(`/api/runs/${runId}/approve`, {
        method: 'POST',
        body: JSON.stringify({})
      }),
    onSuccess: async ({ run }) => {
      setSelectedRunId(run.id);
      setFeedback(`Approved ${run.workflowName}.`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['run', run.id] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not approve run.');
    }
  });

  const rejectRunMutation = useMutation({
    mutationFn: (runId: string) =>
      requestJson<{ run: WorkflowRun }>(`/api/runs/${runId}/reject`, {
        method: 'POST',
        body: JSON.stringify({})
      }),
    onSuccess: async ({ run }) => {
      setSelectedRunId(run.id);
      setFeedback(`Rejected ${run.workflowName}.`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['run', run.id] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not reject run.');
    }
  });

  const rerunRunMutation = useMutation({
    mutationFn: (runId: string) =>
      requestJson<{ run: WorkflowRun }>(`/api/runs/${runId}/rerun`, {
        method: 'POST',
        body: JSON.stringify({})
      }),
    onSuccess: async ({ run }) => {
      setSelectedRunId(run.id);
      setFeedback(`Queued rerun for ${run.workflowName}.`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['run', run.id] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not rerun workflow.');
    }
  });

  const resumeRunMutation = useMutation({
    mutationFn: (runId: string) =>
      requestJson<{ run: WorkflowRun }>(`/api/runs/${runId}/resume`, {
        method: 'POST',
        body: JSON.stringify({})
      }),
    onSuccess: async ({ run }) => {
      setSelectedRunId(run.id);
      setFeedback(`Resumed ${run.workflowName}.`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['run', run.id] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not resume workflow.');
    }
  });

  const updateApprovalRulesMutation = useMutation({
    mutationFn: (rules: ApprovalRules) =>
      requestJson<{ rules: ApprovalRules }>('/api/approvals/rules', {
        method: 'PUT',
        body: JSON.stringify(rules)
      }),
    onSuccess: async () => {
      setFeedback('Updated approval defaults.');

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['runs'] })
      ]);
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not update approval defaults.');
    }
  });

  const updateSelectedModelMutation = useMutation({
    mutationFn: (selectedModel: string | null) =>
      requestJson('/api/models/default', {
        method: 'PUT',
        body: JSON.stringify({ selectedModel })
      }),
    onSuccess: async () => {
      setFeedback('Updated default model.');
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not update default model.');
    }
  });

  const importMcpConfigMutation = useMutation({
    mutationFn: (payload: unknown) =>
      requestJson('/api/mcp/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    onSuccess: async () => {
      setMcpImportText('');
      setFeedback('Imported MCP configuration.');
      await queryClient.invalidateQueries({ queryKey: ['mcp'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not import MCP config.');
    }
  });

  const saveMcpServerMutation = useMutation({
    mutationFn: ({ id, definition }: { id: string; definition: unknown }) =>
      requestJson(`/api/mcp/servers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ definition })
      }),
    onSuccess: async () => {
      setFeedback('Saved MCP server.');
      await queryClient.invalidateQueries({ queryKey: ['mcp'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not save MCP server.');
    }
  });

  const deleteMcpServerMutation = useMutation({
    mutationFn: (id: string) =>
      requestJson(`/api/mcp/servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({})
      }),
    onSuccess: async () => {
      setFeedback('Deleted MCP server.');
      await queryClient.invalidateQueries({ queryKey: ['mcp'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not delete MCP server.');
    }
  });

  const saveSecretMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      requestJson(`/api/secrets/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value })
      }),
    onSuccess: async () => {
      setSecretValueInput('');
      setFeedback('Saved secret.');
      await queryClient.invalidateQueries({ queryKey: ['secrets'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not save secret.');
    }
  });

  const deleteSecretMutation = useMutation({
    mutationFn: (key: string) =>
      requestJson(`/api/secrets/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        body: JSON.stringify({})
      }),
    onSuccess: async () => {
      setFeedback('Deleted secret.');
      await queryClient.invalidateQueries({ queryKey: ['secrets'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not delete secret.');
    }
  });

  const importSecretsMutation = useMutation({
    mutationFn: (content: string) =>
      requestJson<{ imported: SecretSummary[] }>('/api/secrets/import-env', {
        method: 'POST',
        body: JSON.stringify({ content })
      }),
    onSuccess: async ({ imported }) => {
      setSecretImportEnvText('');
      setFeedback(`Imported ${imported.length} secret${imported.length === 1 ? '' : 's'}.`);
      await queryClient.invalidateQueries({ queryKey: ['secrets'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not import secrets.');
    }
  });

  const saveRepositoryMutation = useMutation({
    mutationFn: (payload: { name: string; path: string }) =>
      requestJson<{ repository: LocalRepository }>('/api/repositories', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    onSuccess: async ({ repository }) => {
      setRepositoryNameInput('');
      setRepositoryPathInput('');
      setFeedback(`Saved repository ${repository.name}.`);
      await queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not save repository.');
    }
  });

  const deleteRepositoryMutation = useMutation({
    mutationFn: (repositoryId: string) =>
      requestJson<void>(`/api/repositories/${encodeURIComponent(repositoryId)}`, {
        method: 'DELETE',
        body: JSON.stringify({})
      }),
    onSuccess: async () => {
      setFeedback('Deleted repository.');
      await queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not delete repository.');
    }
  });

  const saveGeneratedTaskDraftMutation = useMutation({
    mutationFn: (taskDraft: TaskDraft) =>
      requestJson<{ customTask: CustomTask }>('/api/tasks/custom', {
        method: 'POST',
        body: JSON.stringify({ task: taskDraft })
      }),
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not save task draft.');
    }
  });

  const applyWorkflowDraftMutation = useMutation({
    mutationFn: (proposal: WorkflowDraftProposal) =>
      requestJson<ApplyWorkflowDraftResponse>('/api/workflows/preview/apply', {
        method: 'POST',
        body: JSON.stringify({ proposal })
      }),
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Could not create workflow from draft.');
    }
  });

  const workflows = workflowsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const approvalRules = approvalsQuery.data?.rules ?? { globalDefaults: [] };
  const pendingApprovalRuns = approvalsQuery.data?.pendingRuns ?? runs.filter((run) => run.status === 'waiting-approval');
  const modelState = modelStateQuery.data ?? null;
  const selectedModelName = modelState?.manifest.selectedModel ?? null;
  const selectedModelSupportsImages = selectedModelName ? modelState?.selectedModelCapabilities?.includes('vision') ?? null : null;
  const mcpState = mcpQuery.data ?? { connections: [], mcp: { servers: {} } };
  const repositories = repositoriesQuery.data ?? [];
  const secretsState = secretsQuery.data ?? { backend: 'encrypted-file' as SecretBackend, secrets: [] };

  const selectedNode = useMemo(
    () => editorWorkflow?.definition.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [editorWorkflow, selectedNodeId]
  );

  const selectedNodeEdges = useMemo(() => {
    if (!editorWorkflow || !selectedNode) {
      return [];
    }

    return editorWorkflow.definition.edges.filter(
      (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id
    );
  }, [editorWorkflow, selectedNode]);

  const selectedTask = tasks.find((task) => task.key === newNodeTaskKey) ?? tasks[0] ?? null;
  const selectedWorkflowSummary = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const workflowRuns = useMemo(
    () =>
      selectedWorkflowId
        ? [...runs]
            .filter((run) => run.workflowId === selectedWorkflowId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        : [],
    [runs, selectedWorkflowId]
  );
  const recentRuns = workflowRuns.slice(0, 4);
  const latestWorkflowRun = workflowRuns[0] ?? null;
  const pendingWorkflowApprovalRun = workflowRuns.find((run) => run.status === 'waiting-approval') ?? null;
  const inFlightWorkflowRun =
    workflowRuns.find((run) => run.status === 'running' || run.status === 'queued' || run.status === 'waiting-approval') ?? null;

  useEffect(() => {
    if (routedWorkflowId) {
      if (selectedWorkflowId !== routedWorkflowId) {
        setSelectedWorkflowId(routedWorkflowId);
      }
      return;
    }

    if (workflows.length === 0) {
      setSelectedWorkflowId(null);
      setEditorWorkflow(null);
      setSelectedNodeId(null);
      setIsEditorDirty(false);
      return;
    }

    if (selectedWorkflowId && !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(null);
      setEditorWorkflow(null);
      setSelectedNodeId(null);
      setIsEditorDirty(false);
    }
  }, [routedWorkflowId, selectedWorkflowId, workflows]);

  useEffect(() => {
    if (tasks.length === 0) {
      setNewNodeTaskKey('');
      return;
    }

    setNewNodeTaskKey((current) =>
      current && tasks.some((task) => task.key === current) ? current : tasks[0].key
    );
  }, [tasks]);

  useEffect(() => {
    if (!workflowDetailQuery.data || isEditorDirty) {
      return;
    }

    const nextWorkflow = cloneWorkflowDocument(workflowDetailQuery.data);

    setEditorWorkflow(nextWorkflow);
    setWorkflowTagsInput(serializeTags(nextWorkflow.tags));
    setSelectedNodeId(nextWorkflow.definition.startNodeId ?? nextWorkflow.definition.nodes[0]?.id ?? null);
    setConfigError(null);
  }, [isEditorDirty, workflowDetailQuery.data]);

  useEffect(() => {
    if (!editorWorkflow) {
      setEdgeDraft(emptyEdgeDraft);
      return;
    }

    const nodeIds = new Set(editorWorkflow.definition.nodes.map((node) => node.id));

    setSelectedNodeId((current) =>
      current && nodeIds.has(current)
        ? current
        : editorWorkflow.definition.startNodeId ?? editorWorkflow.definition.nodes[0]?.id ?? null
    );

    setEdgeDraft((current) => {
      const fallbackSource = editorWorkflow.definition.startNodeId ?? editorWorkflow.definition.nodes[0]?.id ?? '';
      const sourceId = current.sourceId && nodeIds.has(current.sourceId) ? current.sourceId : fallbackSource;
      const targetId =
        current.targetId && nodeIds.has(current.targetId) && current.targetId !== sourceId
          ? current.targetId
          : editorWorkflow.definition.nodes.find((node) => node.id !== sourceId)?.id ?? '';

      return {
        sourceId,
        targetId
      };
    });
  }, [editorWorkflow]);

  useEffect(() => {
    if (!selectedNode) {
      setNodeConfigText('{}');
      setConfigError(null);
      return;
    }

    setNodeConfigText(JSON.stringify(selectedNode.config, null, 2));
    setConfigError(null);
  }, [selectedNode]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (activeView !== 'workflows' || workflowRuns.length === 0) {
      return;
    }

    if (!selectedRunId || !workflowRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId((pendingWorkflowApprovalRun ?? inFlightWorkflowRun ?? latestWorkflowRun)?.id ?? null);
    }
  }, [activeView, inFlightWorkflowRun, latestWorkflowRun, pendingWorkflowApprovalRun, selectedRunId, workflowRuns]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }

    const eventSource = new EventSource(`/api/runs/${selectedRunId}/events`);

    eventSource.onmessage = (event) => {
      try {
        const run = JSON.parse(event.data) as WorkflowRun;

        queryClient.setQueryData(['run', run.id], run);
        queryClient.setQueriesData<WorkflowRunSummary[]>({ queryKey: ['runs'] }, (current) => {
          if (!current) {
            return current;
          }

          const nextSummary = toRunSummary(run);
          const existingIndex = current.findIndex((entry) => entry.id === nextSummary.id);

          if (existingIndex === -1) {
            return [nextSummary, ...current].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          }

          const nextRuns = [...current];
          nextRuns[existingIndex] = nextSummary;
          return nextRuns;
        });
      } catch {
        // Ignore malformed event payloads and let polling recover.
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient, selectedRunId]);

  useEffect(() => {
    if (!runsQuery.data) {
      return;
    }

    const nextSnapshot = new Map(runs.map((run) => [run.id, run.status]));

    if (!hasSeededRunStatusSnapshotRef.current) {
      hasSeededRunStatusSnapshotRef.current = true;
      runStatusSnapshotRef.current = nextSnapshot;
      return;
    }

    for (const run of runs) {
      const previousStatus = runStatusSnapshotRef.current.get(run.id);

      if (previousStatus === run.status) {
        continue;
      }

      if (run.status === 'waiting-approval') {
        pushNotification(`Approval required for ${run.workflowName}.`, 'warn', `run-status:${run.id}:waiting-approval`);
        continue;
      }

      if (run.status === 'success') {
        pushNotification(`${run.workflowName} completed successfully.`, 'success', `run-status:${run.id}:success`);
        continue;
      }

      if (run.status === 'failed' && run.errorMessage !== 'Approval rejected.') {
        pushNotification(
          run.errorMessage ? `${run.workflowName} failed. ${run.errorMessage}` : `${run.workflowName} failed.`,
          'error',
          `run-status:${run.id}:failed`
        );
      }
    }

    runStatusSnapshotRef.current = nextSnapshot;
  }, [runs, runsQuery.data]);

  const status = statusQuery.data ?? null;
  const currentView = dashboardViewCopy[activeView];
  const approvalTaskCount = tasks.filter((task) => task.requiresApprovalByDefault).length;
  const networkTaskCount = tasks.filter((task) => task.capabilities.some((capability) => capability.startsWith('network:'))).length;
  const localOnlyTaskCount = tasks.filter((task) => task.capabilities.length === 0).length;
  const activeRunCount = runs.filter((run) => run.status === 'queued' || run.status === 'running').length;
  const completedRunCount = runs.filter((run) => run.status === 'success' || run.status === 'failed').length;
  const selectedRun = runDetailQuery.data ?? null;
  const activeWorkflowRun = selectedRun?.workflowId === selectedWorkflowId ? selectedRun : null;
  const selectedWorkflowName = editorWorkflow?.name || selectedWorkflowSummary?.name || 'No workflow selected';
  const selectedWorkflowActive = Boolean(editorWorkflow || selectedWorkflowSummary);
  const selectedWorkflowStatusCopy = editorWorkflow
    ? isEditorDirty
      ? 'Unsaved local changes in the editor.'
      : `Persisted ${new Date(editorWorkflow.updatedAt).toLocaleString()}.`
    : selectedWorkflowSummary
      ? 'Selected in the editor. Loading the full workflow definition.'
      : 'Choose a workflow from the catalog before editing it.';
  const isPullingModel = modelPullActivity.status === 'running';
  const isTaskOperationRunning = taskActivity.status === 'running';
  const isGeneratingTask = isTaskOperationRunning && taskActivity.action === 'generate';
  const isRefiningTask = isTaskOperationRunning && taskActivity.action === 'refine';
  const isWorkflowOperationRunning = workflowActivity.status === 'running';
  const isGeneratingWorkflow = isWorkflowOperationRunning && workflowActivity.action === 'generate';
  const isRefiningWorkflow = isWorkflowOperationRunning && workflowActivity.action === 'refine';

  const navigationItems: DashboardNavigationItem[] = [
    {
      id: 'workflows',
      label: 'Workflows Catalog',
      description: 'Create workflows and review the saved catalog',
      href: dashboardPathForView('workflows')
    },
    {
      id: 'workflow-editor',
      label: 'Workflow Editor',
      description: 'Open a selected workflow and edit its graph',
      href: dashboardPathForView('workflow-editor')
    },
    {
      id: 'catalog',
      label: 'Tasks Catalog',
      description: 'Review nodes and runtime boundaries',
      href: dashboardPathForView('catalog')
    },
    {
      id: 'runs',
      label: 'Run History',
      description: 'Inspect live and completed workflow runs',
      href: dashboardPathForView('runs')
    },
    {
      id: 'approvals',
      label: 'Approvals',
      description: 'Review pending gates and auto-approval rules',
      href: dashboardPathForView('approvals')
    },
    {
      id: 'mcp',
      label: 'MCP',
      description: 'Import and manage MCP server connections',
      href: dashboardPathForView('mcp')
    },
    {
      id: 'secrets',
      label: 'Secrets',
      description: 'Store values for network and tool access',
      href: dashboardPathForView('secrets')
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Review runtime, privacy, and import/export status',
      href: dashboardPathForView('settings')
    },
    {
      id: 'overview',
      label: 'Docs',
      description: 'What the app does and how to use it',
      href: dashboardPathForView('overview')
    }
  ];

  const canSaveWorkflow = Boolean(editorWorkflow?.name.trim()) && isEditorDirty && !updateWorkflowMutation.isPending;
  const canAddEdge = Boolean(edgeDraft.sourceId) && Boolean(edgeDraft.targetId) && edgeDraft.sourceId !== edgeDraft.targetId;
  const canAddNode = Boolean(selectedTask);

  function applyWorkflowToEditor(workflow: WorkflowDocument): void {
    setSelectedWorkflowId(workflow.id);
    setEditorWorkflow(cloneWorkflowDocument(workflow));
    setWorkflowTagsInput(serializeTags(workflow.tags));
    setSelectedNodeId((current) => {
      if (workflow.id === selectedWorkflowId && current && workflow.definition.nodes.some((node) => node.id === current)) {
        return current;
      }

      return workflow.definition.startNodeId ?? workflow.definition.nodes[0]?.id ?? null;
    });
    setConfigError(null);
    setIsEditorDirty(false);
    openWorkflowDetail(workflow.id);
    setStudioView('canvas');
  }

  async function syncWorkflowCaches(workflow: WorkflowDocument): Promise<void> {
    queryClient.setQueryData<WorkflowDocument>(['workflow', workflow.id], workflow);
    queryClient.setQueryData<WorkflowSummary[]>(['workflows'], (current) => upsertWorkflowSummary(current, workflow));

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workflows'] }),
      queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] })
    ]);
  }

  function resetEditorToServerState(): void {
    if (!workflowDetailQuery.data) {
      return;
    }

    const nextWorkflow = cloneWorkflowDocument(workflowDetailQuery.data);

    setEditorWorkflow(nextWorkflow);
    setWorkflowTagsInput(serializeTags(nextWorkflow.tags));
    setSelectedNodeId(nextWorkflow.definition.startNodeId ?? nextWorkflow.definition.nodes[0]?.id ?? null);
    setConfigError(null);
    setIsEditorDirty(false);
  }

  function confirmDiscardIfNeeded(): boolean {
    if (!isEditorDirty) {
      return true;
    }

    return window.confirm('Discard unsaved workflow changes?');
  }

  async function handleExportAll(): Promise<void> {
    try {
      const content = await requestText('/api/export');
      downloadText(`flow-machine-export-${new Date().toISOString().slice(0, 10)}.json`, content);
      setFeedback('Exported full bundle.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not export bundle.');
    }
  }

  async function handleExportWorkflow(): Promise<void> {
    if (!selectedWorkflowId) {
      return;
    }

    try {
      const content = await requestText(`/api/workflows/${selectedWorkflowId}/export`);
      downloadText(`${selectedWorkflowId}.json`, content);
      setFeedback(`Exported workflow ${selectedWorkflowId}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not export workflow.');
    }
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      await importBundleMutation.mutateAsync(JSON.parse(content) as unknown);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not import JSON.');
    } finally {
      event.target.value = '';
    }
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createWorkflowMutation.mutate({
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      tags: parseTags(createForm.tags)
    });
  }

  async function handleGenerateWorkflow(description: string, attachments: PromptAttachmentPayload[] = []): Promise<void> {
    const nextDescription = description.trim();

    if (!nextDescription) {
      setFeedback('Describe the workflow you want to generate.');
      return;
    }

    if (isWorkflowOperationRunning) {
      setFeedback('Wait for the current workflow operation to finish.');
      return;
    }

    if (!confirmDiscardIfNeeded()) {
      return;
    }

    pushNotification('Workflow draft generation started. You can keep working while the model runs.', 'info');

    try {
      const proposal = await runWorkflowDraftStream({
        action: 'generate',
        body: { attachments, description: nextDescription },
        startMessage: 'Opening streamed workflow draft generation…',
        targetWorkflowId: null,
        url: '/api/workflows/preview/generate/stream'
      });

      setWorkflowDraftProposal(proposal);
      pushNotification(
        `Workflow draft ready: ${proposal.workflow.name}`,
        'success',
        `workflow-draft:generate:${proposal.workflow.name}:success`
      );
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not generate workflow draft.', 'error');
      throw error;
    }
  }

  async function handleRefineWorkflowDraftProposal(
    instructions: string,
    attachments: PromptAttachmentPayload[] = []
  ): Promise<void> {
    const nextInstructions = instructions.trim();

    if (!nextInstructions) {
      setFeedback('Describe the workflow draft changes you want to apply.');
      return;
    }

    if (!workflowDraftProposal) {
      setFeedback('Generate a workflow draft before refining it.');
      return;
    }

    if (isWorkflowOperationRunning) {
      setFeedback('Wait for the current workflow operation to finish.');
      return;
    }

    pushNotification(`Updating workflow draft ${workflowDraftProposal.workflow.name}.`, 'info');

    try {
      const nextProposal = await runWorkflowDraftStream({
        action: 'refine',
        body: {
          attachments,
          instructions: nextInstructions,
          proposal: workflowDraftProposal
        },
        startMessage: `Opening streamed workflow draft refinement for ${workflowDraftProposal.workflow.name}…`,
        targetWorkflowId: null,
        url: '/api/workflows/preview/refine/stream'
      });

      setWorkflowDraftProposal(nextProposal);
      pushNotification(
        `Updated workflow draft: ${nextProposal.workflow.name}`,
        'success',
        `workflow-draft:refine:${nextProposal.workflow.name}:success`
      );
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not update workflow draft.', 'error');
      throw error;
    }
  }

  async function handleRefineWorkflowTaskDraft(
    taskKey: string,
    instructions: string,
    attachments: PromptAttachmentPayload[] = []
  ): Promise<void> {
    const nextInstructions = instructions.trim();

    if (!nextInstructions) {
      setFeedback('Describe the task draft changes you want to apply.');
      return;
    }

    if (!workflowDraftProposal) {
      setFeedback('Generate a workflow draft before refining its task drafts.');
      return;
    }

    if (isTaskOperationRunning) {
      setFeedback('Wait for the current task operation to finish.');
      return;
    }

    const currentTaskDraft = workflowDraftProposal.taskDrafts.find((taskDraft) => taskDraft.key === taskKey);

    if (!currentTaskDraft) {
      setFeedback('Task draft not found.');
      return;
    }

    pushNotification(`Updating task draft ${currentTaskDraft.name}.`, 'info');

    try {
      const nextTaskDraft = await runTaskDraftStream({
        action: 'refine',
        body: {
          attachments,
          instructions: nextInstructions,
          task: currentTaskDraft
        },
        startMessage: `Opening streamed task draft refinement for ${currentTaskDraft.key}…`,
        targetTaskKey: currentTaskDraft.key,
        url: '/api/tasks/preview/refine/stream'
      });

      setWorkflowDraftProposal((current) =>
        current
          ? {
              ...current,
              taskDrafts: current.taskDrafts.map((taskDraft) =>
                taskDraft.key === nextTaskDraft.key ? nextTaskDraft : taskDraft
              )
            }
          : current
      );
      pushNotification(`Updated task draft: ${nextTaskDraft.name}`, 'success', `task-draft:${nextTaskDraft.key}:success`);
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not update task draft.', 'error');
      throw error;
    }
  }

  async function handleApplyWorkflowDraft(): Promise<void> {
    if (!workflowDraftProposal) {
      setFeedback('Generate a workflow draft before creating it.');
      return;
    }

    const { createdTasks, workflow } = await applyWorkflowDraftMutation.mutateAsync(workflowDraftProposal);

    setWorkflowDraftProposal(null);
    setCreateForm(initialCreateForm);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      syncWorkflowCaches(workflow)
    ]);
    applyWorkflowToEditor(workflow);
    pushNotification(
      createdTasks.length > 0
        ? `Created workflow ${workflow.name} and ${createdTasks.length} new task${createdTasks.length === 1 ? '' : 's'}.`
        : `Created workflow ${workflow.name}.`,
      'success',
      `workflow-draft:apply:${workflow.id}`
    );
  }

  function handleDiscardWorkflowDraft(): void {
    setWorkflowDraftProposal(null);
  }

  function handleCreateFormChange(field: keyof WorkflowCreateForm, value: string): void {
    setCreateForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function handleDeleteSelected(): void {
    if (!selectedWorkflowId) {
      return;
    }

    deleteWorkflowMutation.mutate(selectedWorkflowId, {
      onSuccess: () => {
        setSelectedWorkflowId(null);
        setEditorWorkflow(null);
        setSelectedNodeId(null);
        setConfigError(null);
        setIsEditorDirty(false);
        openWorkflowCatalog();
      }
    });
  }

  function handleSelectWorkflow(workflowId: string): void {
    if (workflowId === selectedWorkflowId && location.pathname === workflowDetailPathForId(workflowId)) {
      return;
    }

    if (!confirmDiscardIfNeeded()) {
      return;
    }

    setSelectedWorkflowId(workflowId);
    setEditorWorkflow(null);
    setSelectedNodeId(null);
    setConfigError(null);
    setIsEditorDirty(false);
    openWorkflowDetail(workflowId);
    setStudioView('canvas');
  }

  function handleWorkflowFieldChange(field: 'name' | 'description', value: string): void {
    setEditorWorkflow((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [field]: value,
        updatedAt: new Date().toISOString()
      };
    });

    setIsEditorDirty(true);
  }

  function handleWorkflowTagsChange(value: string): void {
    setWorkflowTagsInput(value);

    setEditorWorkflow((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        tags: parseTags(value),
        updatedAt: new Date().toISOString()
      };
    });

    setIsEditorDirty(true);
  }

  function handleNewNodeTaskKeyChange(value: string): void {
    setNewNodeTaskKey(value);
  }

  function handleEdgeDraftChange(update: Partial<WorkflowEdgeDraft>): void {
    setEdgeDraft((current) => ({
      ...current,
      ...update
    }));
  }

  function handleStudioViewChange(view: StudioView): void {
    setStudioView(view);
  }

  function handleAddNode(): void {
    if (!editorWorkflow || !selectedTask) {
      return;
    }

    const result = addNodeToDefinition(editorWorkflow.definition, selectedTask);

    setEditorWorkflow({
      ...editorWorkflow,
      definition: result.definition,
      updatedAt: new Date().toISOString()
    });
    setSelectedNodeId(result.nodeId);
    setIsEditorDirty(true);
    setStudioView('canvas');
    setFeedback(`Added ${selectedTask.name}.`);
  }

  function handleAddEdge(): void {
    if (!editorWorkflow || !canAddEdge) {
      return;
    }

    const definition = addEdgeToDefinition(editorWorkflow.definition, edgeDraft.sourceId, edgeDraft.targetId);

    if (definition === editorWorkflow.definition) {
      setFeedback('Choose two different nodes and avoid duplicate connections.');
      return;
    }

    setEditorWorkflow({
      ...editorWorkflow,
      definition,
      updatedAt: new Date().toISOString()
    });
    setIsEditorDirty(true);
    setStudioView('canvas');
    setFeedback('Added connection.');
  }

  function handleRemoveEdge(edgeId: string): void {
    if (!editorWorkflow) {
      return;
    }

    setEditorWorkflow({
      ...editorWorkflow,
      definition: removeEdgeFromDefinition(editorWorkflow.definition, edgeId),
      updatedAt: new Date().toISOString()
    });
    setIsEditorDirty(true);
  }

  function handleMoveNode(nodeId: string, position: { x: number; y: number }): void {
    setEditorWorkflow((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        definition: updateNodeInDefinition(current.definition, nodeId, { position }),
        updatedAt: new Date().toISOString()
      };
    });

    setIsEditorDirty(true);
  }

  function handleSelectNode(nodeId: string): void {
    setSelectedNodeId(nodeId);
  }

  function handleNodeFieldChange(field: 'name' | 'taskKey', value: string): void {
    if (!selectedNodeId) {
      return;
    }

    setEditorWorkflow((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        definition: updateNodeInDefinition(current.definition, selectedNodeId, { [field]: value }),
        updatedAt: new Date().toISOString()
      };
    });

    setIsEditorDirty(true);
  }

  function handleNodePositionChange(axis: 'x' | 'y', value: string): void {
    if (!selectedNodeId) {
      return;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return;
    }

    setEditorWorkflow((current) => {
      if (!current) {
        return current;
      }

      const existingNode = current.definition.nodes.find((node) => node.id === selectedNodeId);

      if (!existingNode) {
        return current;
      }

      return {
        ...current,
        definition: updateNodeInDefinition(current.definition, selectedNodeId, {
          position: {
            ...existingNode.position,
            [axis]: Math.max(24, Math.round(numericValue))
          }
        }),
        updatedAt: new Date().toISOString()
      };
    });

    setIsEditorDirty(true);
  }

  function handleStartNodeChange(nodeId: string): void {
    if (!editorWorkflow) {
      return;
    }

    setEditorWorkflow({
      ...editorWorkflow,
      definition: setStartNode(editorWorkflow.definition, nodeId || null),
      updatedAt: new Date().toISOString()
    });
    setIsEditorDirty(true);
  }

  function handleNodeConfigTextChange(value: string): void {
    setNodeConfigText(value);
  }

  function handleApplyNodeConfig(): void {
    if (!editorWorkflow || !selectedNode) {
      return;
    }

    try {
      const parsed = JSON.parse(nodeConfigText) as unknown;

      if (!isRecord(parsed)) {
        throw new Error('Node config must be a JSON object.');
      }

      setEditorWorkflow({
        ...editorWorkflow,
        definition: updateNodeInDefinition(editorWorkflow.definition, selectedNode.id, { config: parsed }),
        updatedAt: new Date().toISOString()
      });
      setConfigError(null);
      setIsEditorDirty(true);
      setFeedback(`Updated config for ${selectedNode.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not parse node config.';
      setConfigError(message);
      setFeedback(message);
    }
  }

  function handleDeleteSelectedNode(): void {
    if (!editorWorkflow || !selectedNode) {
      return;
    }

    const definition = removeNodeFromDefinition(editorWorkflow.definition, selectedNode.id);

    setEditorWorkflow({
      ...editorWorkflow,
      definition,
      updatedAt: new Date().toISOString()
    });
    setSelectedNodeId(definition.startNodeId ?? definition.nodes[0]?.id ?? null);
    setIsEditorDirty(true);
    setFeedback(`Removed node ${selectedNode.name}.`);
  }

  function prepareWorkflowForSave(): WorkflowDocument | null {
    if (!editorWorkflow) {
      return null;
    }

    const baseWorkflow: WorkflowDocument = {
      ...editorWorkflow,
      name: editorWorkflow.name.trim(),
      description: editorWorkflow.description.trim()
    };

    if (!selectedNode) {
      return baseWorkflow;
    }

    try {
      const parsed = JSON.parse(nodeConfigText) as unknown;

      if (!isRecord(parsed)) {
        throw new Error('Node config must be a JSON object.');
      }

      setConfigError(null);

      return {
        ...baseWorkflow,
        definition: updateNodeInDefinition(baseWorkflow.definition, selectedNode.id, { config: parsed })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not parse node config.';
      setConfigError(message);
      setFeedback(message);
      return null;
    }
  }

  function handleSaveWorkflow(): void {
    const workflow = prepareWorkflowForSave();

    if (!workflow) {
      return;
    }

    setEditorWorkflow(workflow);
    updateWorkflowMutation.mutate(workflow);
  }

  async function handleRefineWorkflow(instructions: string, attachments: PromptAttachmentPayload[] = []): Promise<void> {
    const nextInstructions = instructions.trim();

    if (!editorWorkflow || !selectedWorkflowId) {
      setFeedback('Select a workflow before applying model-driven edits.');
      return;
    }

    if (!nextInstructions) {
      setFeedback('Describe the workflow changes you want to apply.');
      return;
    }

    if (isWorkflowOperationRunning) {
      setFeedback('Wait for the current workflow operation to finish.');
      return;
    }

    const workflow = prepareWorkflowForSave();

    if (!workflow) {
      return;
    }

    setEditorWorkflow(workflow);
    pushNotification(`Updating ${workflow.name} in the background. You can keep working while the model runs.`, 'info');

    try {
      const updatedWorkflow = await runWorkflowOperationStream({
        action: 'refine',
        body: {
          attachments,
          instructions: nextInstructions,
          workflow: {
            name: workflow.name.trim(),
            description: workflow.description.trim(),
            tags: workflow.tags,
            definition: workflow.definition
          }
        },
        startMessage: `Opening streamed workflow refinement for ${workflow.name}…`,
        targetWorkflowId: workflow.id,
        url: `/api/workflows/${workflow.id}/refine/stream`
      });

      pushNotification(`Updated workflow: ${updatedWorkflow.name}`, 'success', `workflow-operation:refine:${updatedWorkflow.id}:success`);
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not update workflow.', 'error');
      throw error;
    }
  }

  function handleResetWorkflow(): void {
    resetEditorToServerState();
    setFeedback('Discarded local edits.');
  }

  function handleFocusRun(runId: string): void {
    setSelectedRunId(runId);
  }

  function handleOpenRun(runId: string): void {
    handleFocusRun(runId);
    setActiveView('runs');
  }

  function handleStartSelectedWorkflowRun(): void {
    if (!selectedWorkflowId) {
      return;
    }

    if (isEditorDirty) {
      const workflow = prepareWorkflowForSave();

      if (!workflow) {
        return;
      }

      setEditorWorkflow(workflow);
      updateWorkflowMutation.mutate(workflow, {
        onSuccess: ({ workflow: savedWorkflow }) => {
          startRunMutation.mutate(savedWorkflow.id);
        }
      });
      return;
    }

    startRunMutation.mutate(selectedWorkflowId);
  }

  function handleApproveRun(runId: string): void {
    handleFocusRun(runId);
    approveRunMutation.mutate(runId);
  }

  function handleRejectRun(runId: string): void {
    handleFocusRun(runId);
    rejectRunMutation.mutate(runId);
  }

  function handleRerunRun(runId: string): void {
    handleFocusRun(runId);
    rerunRunMutation.mutate(runId);
  }

  function handleResumeRun(runId: string): void {
    handleFocusRun(runId);
    resumeRunMutation.mutate(runId);
  }

  function handleApproveSelectedRun(): void {
    if (!selectedRunId) {
      return;
    }

    handleApproveRun(selectedRunId);
  }

  function handleRejectSelectedRun(): void {
    if (!selectedRunId) {
      return;
    }

    handleRejectRun(selectedRunId);
  }

  function handleRerunSelectedRun(): void {
    if (!selectedRunId) {
      return;
    }

    handleRerunRun(selectedRunId);
  }

  function handleResumeSelectedRun(): void {
    if (!selectedRunId) {
      return;
    }

    handleResumeRun(selectedRunId);
  }

  function handleToggleAutoApproval(taskKey: string): void {
    const nextDefaults = approvalRules.globalDefaults.includes(taskKey)
      ? approvalRules.globalDefaults.filter((entry) => entry !== taskKey)
      : [...approvalRules.globalDefaults, taskKey];

    updateApprovalRulesMutation.mutate({
      globalDefaults: nextDefaults
    });
  }

  function handlePullModel(): void {
    const modelName = pullModelName.trim();

    if (!modelName) {
      setFeedback('Enter a model name to pull from Ollama.');
      return;
    }

    if (isPullingModel) {
      setFeedback('Wait for the current model pull to finish.');
      return;
    }

    pushNotification(`Pulling model ${modelName}. You can keep working while Ollama downloads it.`, 'info');

    void (async () => {
      try {
        await runModelPullStream(modelName);
        setPullModelName('');
        pushNotification(`Pulled model ${modelName}.`, 'success', `model-pull:${modelName}:success`);
      } catch (error) {
        pushNotification(error instanceof Error ? error.message : 'Could not pull model.', 'error', `model-pull:${modelName}:error`);
      }
    })();
  }

  function handleSelectModel(name: string | null): void {
    updateSelectedModelMutation.mutate(name);
  }

  function handleImportConfig(): void {
    try {
      importMcpConfigMutation.mutate(JSON.parse(mcpImportText) as unknown);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not parse MCP config JSON.');
    }
  }

  function handleSaveMcpServer(): void {
    const serverId = mcpServerIdInput.trim();

    if (!serverId) {
      setFeedback('Enter an MCP server id.');
      return;
    }

    try {
      saveMcpServerMutation.mutate({
        id: serverId,
        definition: JSON.parse(mcpServerDefinitionText) as unknown
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not parse MCP server JSON.');
    }
  }

  function handleDeleteMcpServer(id: string): void {
    deleteMcpServerMutation.mutate(id);
  }

  function handleSaveSecret(): void {
    const key = secretKeyInput.trim();

    if (!key) {
      setFeedback('Enter a secret key.');
      return;
    }

    saveSecretMutation.mutate({
      key,
      value: secretValueInput
    });
  }

  function handleDeleteSecret(key: string): void {
    deleteSecretMutation.mutate(key);
  }

  function handleImportEnv(): void {
    if (!secretImportEnvText.trim()) {
      setFeedback('Paste .env content to import secrets.');
      return;
    }

    importSecretsMutation.mutate(secretImportEnvText);
  }

  function handleSaveRepository(): void {
    const name = repositoryNameInput.trim();
    const path = repositoryPathInput.trim();

    if (!name) {
      setFeedback('Enter a repository name.');
      return;
    }

    if (!path) {
      setFeedback('Enter a repository path.');
      return;
    }

    saveRepositoryMutation.mutate({ name, path });
  }

  function handleDeleteRepository(id: string): void {
    deleteRepositoryMutation.mutate(id);
  }

  async function runTaskDraftStream({
    action,
    body,
    startMessage,
    targetTaskKey,
    url
  }: {
    action: 'generate' | 'refine';
    body: Record<string, unknown>;
    startMessage: string;
    targetTaskKey: string | null;
    url: string;
  }): Promise<TaskDraft> {
    setTaskActivity({
      action,
      liveOutput: '',
      logs: [createTaskActivityLogEntry('info', startMessage)],
      status: 'running',
      targetTaskKey
    });

    let resultingTaskDraft: TaskDraft | null = null;
    let streamedErrorMessage: string | null = null;

    try {
      await requestNdjsonStream<TaskOperationStreamEvent>(
        url,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        (event) => {
          if (event.type === 'status' && event.message) {
            setTaskActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('info', event.message!)]
                  }
                : current
            );
            return;
          }

          if (event.type === 'token' && event.text) {
            setTaskActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    liveOutput: `${current.liveOutput}${event.text}`
                  }
                : current
            );
            return;
          }

          if (event.type === 'draft' && event.taskDraft) {
            resultingTaskDraft = event.taskDraft;

            if (event.message) {
              setTaskActivity((current) =>
                current.action === action
                  ? {
                      ...current,
                      logs: [...current.logs, createTaskActivityLogEntry('success', event.message!)]
                    }
                  : current
              );
            }

            return;
          }

          if (event.type === 'error') {
            streamedErrorMessage = event.message ?? 'Task draft operation failed.';

            setTaskActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('error', streamedErrorMessage ?? 'Task draft operation failed.')],
                    status: 'error'
                  }
                : current
            );
          }
        }
      );

      if (streamedErrorMessage) {
        throw new Error(streamedErrorMessage);
      }

      if (!resultingTaskDraft) {
        throw new Error('Task draft operation finished without a draft result.');
      }

      setTaskActivity((current) =>
        current.action === action
          ? {
              ...current,
              status: 'success'
            }
          : current
      );

      return resultingTaskDraft;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task draft operation failed.';

      setTaskActivity((current) => {
        if (current.action !== action) {
          return current;
        }

        const lastMessage = current.logs[current.logs.length - 1]?.message;

        return {
          ...current,
          logs: lastMessage === message ? current.logs : [...current.logs, createTaskActivityLogEntry('error', message)],
          status: 'error'
        };
      });

      throw error;
    }
  }

  async function runTaskOperationStream({
    action,
    body,
    startMessage,
    targetTaskKey,
    url
  }: {
    action: 'generate' | 'refine';
    body: Record<string, unknown>;
    startMessage: string;
    targetTaskKey: string | null;
    url: string;
  }): Promise<CustomTask> {
    setTaskActivity({
      action,
      liveOutput: '',
      logs: [createTaskActivityLogEntry('info', startMessage)],
      status: 'running',
      targetTaskKey
    });

    let resultingTask: CustomTask | null = null;
    let streamedErrorMessage: string | null = null;

    try {
      await requestNdjsonStream<TaskOperationStreamEvent>(
        url,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        (event) => {
          if (event.type === 'status' && event.message) {
            const statusMessage = event.message;

            setTaskActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('info', statusMessage)]
                  }
                : current
            );
            return;
          }

          if (event.type === 'token' && event.text) {
            setTaskActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    liveOutput: `${current.liveOutput}${event.text}`
                  }
                : current
            );
            return;
          }

          if (event.type === 'result' && event.customTask) {
            resultingTask = event.customTask;

            if (event.message) {
              const resultMessage = event.message;

              setTaskActivity((current) =>
                current.action === action
                  ? {
                      ...current,
                      logs: [...current.logs, createTaskActivityLogEntry('success', resultMessage)]
                    }
                  : current
              );
            }

            return;
          }

          if (event.type === 'error') {
            streamedErrorMessage = event.message ?? 'Task operation failed.';

            setTaskActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('error', streamedErrorMessage ?? 'Task operation failed.')],
                    status: 'error'
                  }
                : current
            );
          }
        }
      );

      if (streamedErrorMessage) {
        throw new Error(streamedErrorMessage);
      }

      if (!resultingTask) {
        throw new Error('Task operation finished without a saved task result.');
      }

      setTaskActivity((current) =>
        current.action === action
          ? {
              ...current,
              status: 'success'
            }
          : current
      );

      await queryClient.invalidateQueries({ queryKey: ['tasks'] });

      return resultingTask;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task operation failed.';

      setTaskActivity((current) => {
        if (current.action !== action) {
          return current;
        }

        const lastMessage = current.logs[current.logs.length - 1]?.message;

        return {
          ...current,
          logs: lastMessage === message ? current.logs : [...current.logs, createTaskActivityLogEntry('error', message)],
          status: 'error'
        };
      });

      throw error;
    }
  }

  async function runWorkflowDraftStream({
    action,
    body,
    startMessage,
    targetWorkflowId,
    url
  }: {
    action: 'generate' | 'refine';
    body: Record<string, unknown>;
    startMessage: string;
    targetWorkflowId: string | null;
    url: string;
  }): Promise<WorkflowDraftProposal> {
    setWorkflowActivity({
      action,
      liveOutput: '',
      logs: [createTaskActivityLogEntry('info', startMessage)],
      status: 'running',
      targetWorkflowId
    });

    let resultingProposal: WorkflowDraftProposal | null = null;
    let streamedErrorMessage: string | null = null;

    try {
      await requestNdjsonStream<WorkflowOperationStreamEvent>(
        url,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        (event) => {
          if (event.type === 'status' && event.message) {
            setWorkflowActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('info', event.message!)]
                  }
                : current
            );
            return;
          }

          if (event.type === 'token' && event.text) {
            setWorkflowActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    liveOutput: `${current.liveOutput}${event.text}`
                  }
                : current
            );
            return;
          }

          if (event.type === 'draft' && event.proposal) {
            resultingProposal = event.proposal;

            if (event.message) {
              setWorkflowActivity((current) =>
                current.action === action
                  ? {
                      ...current,
                      logs: [...current.logs, createTaskActivityLogEntry('success', event.message!)]
                    }
                  : current
              );
            }

            return;
          }

          if (event.type === 'error') {
            streamedErrorMessage = event.message ?? 'Workflow draft operation failed.';

            setWorkflowActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('error', streamedErrorMessage ?? 'Workflow draft operation failed.')],
                    status: 'error'
                  }
                : current
            );
          }
        }
      );

      if (streamedErrorMessage) {
        throw new Error(streamedErrorMessage);
      }

      if (!resultingProposal) {
        throw new Error('Workflow draft operation finished without a draft result.');
      }

      setWorkflowActivity((current) =>
        current.action === action
          ? {
              ...current,
              status: 'success'
            }
          : current
      );

      return resultingProposal;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow draft operation failed.';

      setWorkflowActivity((current) => {
        if (current.action !== action) {
          return current;
        }

        const lastMessage = current.logs[current.logs.length - 1]?.message;

        return {
          ...current,
          logs: lastMessage === message ? current.logs : [...current.logs, createTaskActivityLogEntry('error', message)],
          status: 'error'
        };
      });

      throw error;
    }
  }

  async function runWorkflowOperationStream({
    action,
    body,
    startMessage,
    targetWorkflowId,
    url
  }: {
    action: 'generate' | 'refine';
    body: Record<string, unknown>;
    startMessage: string;
    targetWorkflowId: string | null;
    url: string;
  }): Promise<WorkflowDocument> {
    setWorkflowActivity({
      action,
      liveOutput: '',
      logs: [createTaskActivityLogEntry('info', startMessage)],
      status: 'running',
      targetWorkflowId
    });

    let resultingWorkflow: WorkflowDocument | null = null;
    let streamedErrorMessage: string | null = null;

    try {
      await requestNdjsonStream<WorkflowOperationStreamEvent>(
        url,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        (event) => {
          if (event.type === 'status' && event.message) {
            const statusMessage = event.message;

            setWorkflowActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('info', statusMessage)]
                  }
                : current
            );
            return;
          }

          if (event.type === 'token' && event.text) {
            setWorkflowActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    liveOutput: `${current.liveOutput}${event.text}`
                  }
                : current
            );
            return;
          }

          if (event.type === 'result' && event.workflow) {
            resultingWorkflow = event.workflow;

            if (event.message) {
              const resultMessage = event.message;

              setWorkflowActivity((current) =>
                current.action === action
                  ? {
                      ...current,
                      logs: [...current.logs, createTaskActivityLogEntry('success', resultMessage)]
                    }
                  : current
              );
            }

            return;
          }

          if (event.type === 'error') {
            streamedErrorMessage = event.message ?? 'Workflow operation failed.';

            setWorkflowActivity((current) =>
              current.action === action
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('error', streamedErrorMessage ?? 'Workflow operation failed.')],
                    status: 'error'
                  }
                : current
            );
          }
        }
      );

      if (streamedErrorMessage) {
        throw new Error(streamedErrorMessage);
      }

      if (!resultingWorkflow) {
        throw new Error('Workflow operation finished without a saved workflow result.');
      }

      setWorkflowActivity((current) =>
        current.action === action
          ? {
              ...current,
              status: 'success'
            }
          : current
      );

      await syncWorkflowCaches(resultingWorkflow);
      applyWorkflowToEditor(resultingWorkflow);

      return resultingWorkflow;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow operation failed.';

      setWorkflowActivity((current) => {
        if (current.action !== action) {
          return current;
        }

        const lastMessage = current.logs[current.logs.length - 1]?.message;

        return {
          ...current,
          logs: lastMessage === message ? current.logs : [...current.logs, createTaskActivityLogEntry('error', message)],
          status: 'error'
        };
      });

      throw error;
    }
  }

  async function runModelPullStream(modelName: string): Promise<ModelGatewayState> {
    setModelPullActivity({
      liveOutput: 'Waiting for Ollama pull output…',
      logs: [createTaskActivityLogEntry('info', `Opening model pull stream for ${modelName}...`)],
      modelName,
      status: 'running'
    });

    let resultingState: ModelGatewayState | null = null;
    let streamedErrorMessage: string | null = null;

    try {
      await requestNdjsonStream<ModelPullStreamEvent>(
        '/api/models/pull/stream',
        {
          method: 'POST',
          body: JSON.stringify({ name: modelName })
        },
        (event) => {
          if (event.type === 'status' && event.status) {
            const logMessage = formatModelPullLogMessage(event.status, event.digest);
            const progressMessage = formatModelPullProgress(event.status, event.completed, event.total, event.digest);

            setModelPullActivity((current) => {
              if (current.modelName !== modelName) {
                return current;
              }

              const lastMessage = current.logs[current.logs.length - 1]?.message;

              return {
                ...current,
                liveOutput: progressMessage,
                logs: lastMessage === logMessage ? current.logs : [...current.logs, createTaskActivityLogEntry('info', logMessage)]
              };
            });

            return;
          }

          if (event.type === 'result' && event.state) {
            resultingState = event.state;

            setModelPullActivity((current) =>
              current.modelName === modelName
                ? {
                    ...current,
                    logs: event.message
                      ? [...current.logs, createTaskActivityLogEntry('success', event.message)]
                      : current.logs,
                    status: 'success'
                  }
                : current
            );

            return;
          }

          if (event.type === 'error') {
            streamedErrorMessage = event.message ?? 'Could not pull model.';

            setModelPullActivity((current) =>
              current.modelName === modelName
                ? {
                    ...current,
                    logs: [...current.logs, createTaskActivityLogEntry('error', streamedErrorMessage ?? 'Could not pull model.')],
                    status: 'error'
                  }
                : current
            );
          }
        }
      );

      if (streamedErrorMessage) {
        throw new Error(streamedErrorMessage);
      }

      if (!resultingState) {
        throw new Error('Model pull finished without a refreshed model state.');
      }

      queryClient.setQueryData(['models'], resultingState);
      await queryClient.invalidateQueries({ queryKey: ['models'] });

      return resultingState;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not pull model.';

      setModelPullActivity((current) => {
        if (current.modelName !== modelName) {
          return current;
        }

        const lastMessage = current.logs[current.logs.length - 1]?.message;

        return {
          ...current,
          logs: lastMessage === message ? current.logs : [...current.logs, createTaskActivityLogEntry('error', message)],
          status: 'error'
        };
      });

      throw error;
    }
  }

  async function handleGenerateCustomTask(attachments: PromptAttachmentPayload[] = []): Promise<void> {
    const description = customTaskDescription.trim();

    if (!description) {
      setFeedback('Enter a task description to generate a custom task.');
      return;
    }

    if (isTaskOperationRunning) {
      setFeedback('Wait for the current task operation to finish.');
      return;
    }

    pushNotification('Task draft generation started. You can keep working while the model runs.', 'info');

    try {
      const taskDraft = await runTaskDraftStream({
        action: 'generate',
        body: { attachments, description },
        startMessage: 'Opening streamed task draft generation…',
        targetTaskKey: null,
        url: '/api/tasks/preview/generate/stream'
      });

      setGeneratedTaskDraft(taskDraft);
      pushNotification(`Task draft ready: ${taskDraft.name}`, 'success', `task-draft:generate:${taskDraft.key}:success`);
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not generate task draft.', 'error');
      throw error;
    }
  }

  async function handleRefineGeneratedTaskDraft(
    instructions: string,
    attachments: PromptAttachmentPayload[] = []
  ): Promise<void> {
    const nextInstructions = instructions.trim();

    if (!nextInstructions) {
      setFeedback('Describe the task draft changes you want to apply.');
      return;
    }

    if (!generatedTaskDraft) {
      setFeedback('Generate a task draft before refining it.');
      return;
    }

    if (isTaskOperationRunning) {
      setFeedback('Wait for the current task operation to finish.');
      return;
    }

    pushNotification(`Updating task draft ${generatedTaskDraft.name}.`, 'info');

    try {
      const nextTaskDraft = await runTaskDraftStream({
        action: 'refine',
        body: {
          attachments,
          instructions: nextInstructions,
          task: generatedTaskDraft
        },
        startMessage: `Opening streamed task draft refinement for ${generatedTaskDraft.key}…`,
        targetTaskKey: generatedTaskDraft.key,
        url: '/api/tasks/preview/refine/stream'
      });

      setGeneratedTaskDraft(nextTaskDraft);
      pushNotification(`Updated task draft: ${nextTaskDraft.name}`, 'success', `task-draft:refine:${nextTaskDraft.key}:success`);
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not update task draft.', 'error');
      throw error;
    }
  }

  async function handleSaveGeneratedTaskDraft(): Promise<void> {
    if (!generatedTaskDraft) {
      setFeedback('Generate a task draft before saving it.');
      return;
    }

    const { customTask } = await saveGeneratedTaskDraftMutation.mutateAsync(generatedTaskDraft);
    setGeneratedTaskDraft(null);
    setCustomTaskDescription('');
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    pushNotification(`Saved task: ${customTask.name}`, 'success', `task-draft:save:${customTask.key}:success`);
  }

  function handleDiscardGeneratedTaskDraft(): void {
    setGeneratedTaskDraft(null);
  }

  async function handleRefineTask(
    taskKey: string,
    instructions: string,
    attachments: PromptAttachmentPayload[] = []
  ): Promise<void> {
    const nextInstructions = instructions.trim();

    if (!nextInstructions) {
      setFeedback('Describe the task changes you want to apply.');
      return;
    }

    if (isTaskOperationRunning) {
      setFeedback('Wait for the current task operation to finish.');
      return;
    }

    pushNotification(`Updating ${taskKey} in the background. You can keep working while the model runs.`, 'info');

    try {
      const customTask = await runTaskOperationStream({
        action: 'refine',
        body: { attachments, instructions: nextInstructions },
        startMessage: `Opening streamed task refinement for ${taskKey}…`,
        targetTaskKey: taskKey,
        url: `/api/tasks/${encodeURIComponent(taskKey)}/refine/stream`
      });

      pushNotification(`Updated task: ${customTask.name}`, 'success', `task-operation:refine:${customTask.key}:success`);
    } catch (error) {
      pushNotification(error instanceof Error ? error.message : 'Could not update task.', 'error');
      throw error;
    }
  }

  function handleRepositorySelectionChange(repositoryId: string): void {
    if (!selectedNodeId) {
      return;
    }

    setEditorWorkflow((current) => {
      if (!current) {
        return current;
      }

      const selectedNodeEntry = current.definition.nodes.find((node) => node.id === selectedNodeId);

      if (!selectedNodeEntry) {
        return current;
      }

      return {
        ...current,
        definition: updateNodeInDefinition(current.definition, selectedNodeId, {
          config: {
            ...selectedNodeEntry.config,
            repositoryId
          }
        }),
        updatedAt: new Date().toISOString()
      };
    });

    setNodeConfigText((current) => {
      try {
        const parsed = JSON.parse(current) as unknown;

        if (isRecord(parsed)) {
          return JSON.stringify(
            {
              ...parsed,
              repositoryId
            },
            null,
            2
          );
        }
      } catch {
        // Fall back to rewriting from the selected node effect.
      }

      return current;
    });

    setConfigError(null);
    setIsEditorDirty(true);
  }

  return {
    statusQuery,
    view: {
      activeView,
      studioView,
      setActiveView,
      setStudioView
    },
    system: {
      currentView,
      navigationItems,
      selectedWorkflowActive,
      selectedWorkflowName,
      selectedWorkflowStatusCopy,
      status
    },
    catalog: {
      approvalTaskCount,
      customTaskDescription,
      generatedTaskDraft,
      handleDiscardGeneratedTaskDraft,
      handleGenerateCustomTask,
      handleRefineGeneratedTaskDraft,
      handleRefineTask,
      handleSaveGeneratedTaskDraft,
      isGeneratingTask,
      isSavingTaskDraft: saveGeneratedTaskDraftMutation.isPending,
      isTaskOperationRunning,
      isRefiningTask,
      localOnlyTaskCount,
      networkTaskCount,
      selectedModelName,
      selectedModelSupportsImages,
      setCustomTaskDescription,
      taskActivity,
      tasks
    },
    runs: {
      activeRunCount,
      completedRunCount,
      detailState: {
        isLoading: runDetailQuery.isLoading,
        isError: runDetailQuery.isError,
        errorMessage:
          runDetailQuery.error instanceof Error ? runDetailQuery.error.message : runDetailQuery.isError ? 'Unknown error.' : null
      },
      isActionPending:
        approveRunMutation.isPending || rejectRunMutation.isPending || rerunRunMutation.isPending || resumeRunMutation.isPending,
      isStartingRun: startRunMutation.isPending,
      runs,
      selectedRun,
      selectedRunId,
      selectedWorkflowName,
      waitingApprovalCount: pendingApprovalRuns.length,
      canStartSelectedWorkflow: Boolean(selectedWorkflowId),
      handleApproveSelectedRun,
      handleOpenRun,
      handleRejectSelectedRun,
      handleResumeSelectedRun,
      handleRerunSelectedRun,
      handleStartSelectedWorkflowRun
    },
    approvals: {
      isSavingRules: updateApprovalRulesMutation.isPending,
      pendingRuns: pendingApprovalRuns,
      rules: approvalRules,
      tasks,
      handleOpenRun,
      handleToggleAutoApproval
    },
    mcp: {
      connections: mcpState.connections,
      errorMessage: mcpQuery.error instanceof Error ? mcpQuery.error.message : null,
      importText: mcpImportText,
      isLoading: mcpQuery.isLoading,
      isMutating: importMcpConfigMutation.isPending || saveMcpServerMutation.isPending || deleteMcpServerMutation.isPending,
      mcp: mcpState.mcp,
      serverDefinitionText: mcpServerDefinitionText,
      serverIdInput: mcpServerIdInput,
      setImportText: setMcpImportText,
      setServerDefinitionText: setMcpServerDefinitionText,
      setServerIdInput: setMcpServerIdInput,
      handleDeleteServer: handleDeleteMcpServer,
      handleImportConfig,
      handleSaveServer: handleSaveMcpServer
    },
    secrets: {
      backend: secretsState.backend,
      errorMessage: secretsQuery.error instanceof Error ? secretsQuery.error.message : null,
      importEnvText: secretImportEnvText,
      isLoading: secretsQuery.isLoading,
      isMutating: saveSecretMutation.isPending || deleteSecretMutation.isPending || importSecretsMutation.isPending,
      secretKeyInput,
      secretValueInput,
      secrets: secretsState.secrets,
      setImportEnvText: setSecretImportEnvText,
      setSecretKeyInput,
      setSecretValueInput,
      handleDeleteSecret,
      handleImportEnv,
      handleSaveSecret
    },
    settings: {
      browserStatus: browserStatusQuery.data ?? null,
      browserStatusError: browserStatusQuery.error instanceof Error ? browserStatusQuery.error.message : null,
      errorMessage: modelStateQuery.error instanceof Error ? modelStateQuery.error.message : null,
      handleDeleteRepository,
      handleExportAll,
      handleImportChange,
      handlePullModel,
      handleSaveRepository,
      handleSelectModel,
      isLoading: modelStateQuery.isLoading,
      isPullingModel,
      isMutating: updateSelectedModelMutation.isPending || saveRepositoryMutation.isPending || deleteRepositoryMutation.isPending,
      isSavingRepositories: saveRepositoryMutation.isPending || deleteRepositoryMutation.isPending,
      modelPullActivity,
      pullModelName,
      repositories,
      repositoryNameInput,
      repositoryPathInput,
      setRepositoryNameInput,
      setRepositoryPathInput,
      setPullModelName,
      state: modelState
    },
    notifications: {
      dismissNotification,
      notifications
    },
    workflowStudio: {
      activeRun: activeWorkflowRun,
      canAddEdge,
      canAddNode,
      canSaveWorkflow,
      canStartWorkflow: Boolean(selectedWorkflowId) && Boolean(!editorWorkflow || editorWorkflow.definition.startNodeId),
      configError,
      createForm,
      createPending: createWorkflowMutation.isPending,
      deletePending: deleteWorkflowMutation.isPending,
      detailState: {
        isLoading: workflowDetailQuery.isLoading,
        isError: workflowDetailQuery.isError,
        errorMessage:
          workflowDetailQuery.error instanceof Error
            ? workflowDetailQuery.error.message
            : workflowDetailQuery.isError
              ? 'Unknown error.'
              : null
      },
      edgeDraft,
      editorWorkflow,
      handleApplyWorkflowDraft,
      handleDiscardWorkflowDraft,
      isEditorDirty,
      isApplyingWorkflowDraft: applyWorkflowDraftMutation.isPending,
      isGeneratingWorkflow,
      isRunActionPending:
        approveRunMutation.isPending || rejectRunMutation.isPending || rerunRunMutation.isPending || resumeRunMutation.isPending,
      isRefiningWorkflow,
      isTaskOperationRunning,
      isWorkflowOperationRunning,
      latestRun: latestWorkflowRun,
      newNodeTaskKey,
      nodeConfigText,
      pendingApprovalRun: pendingWorkflowApprovalRun,
      repositories,
      recentRuns,
      selectedNode,
      selectedNodeEdges,
      selectedModelName,
      selectedModelSupportsImages,
      selectedNodeId,
      selectedWorkflowId,
      selectedWorkflowSummary,
      startRunPending: startRunMutation.isPending,
      studioView,
      taskActivity,
      tasks,
      updatePending: updateWorkflowMutation.isPending,
      workflowActivity,
      workflowDraftProposal,
      workflowRunCount: workflowRuns.length,
      workflowTagsInput,
      workflows,
      handleAddEdge,
      handleAddNode,
      handleApplyNodeConfig,
      handleApproveRun,
      handleCreateFormChange,
      handleCreateSubmit,
      handleDeleteSelected,
      handleDeleteSelectedNode,
      handleEdgeDraftChange,
      handleExportAll,
      handleExportWorkflow,
      handleFocusRun,
      handleGenerateWorkflow,
      handleImportChange,
      handleMoveNode,
      handleNewNodeTaskKeyChange,
      handleNodeConfigTextChange,
      handleNodeFieldChange,
      handleNodePositionChange,
      handleOpenRun,
      handleRepositorySelectionChange,
      handleRejectRun,
      handleRemoveEdge,
      handleRerunRun,
      handleRefineWorkflow,
      handleRefineWorkflowDraftProposal,
      handleRefineWorkflowTaskDraft,
      handleResetWorkflow,
      handleResumeRun,
      handleSaveWorkflow,
      handleSelectNode,
      handleSelectWorkflow,
      handleStartSelectedWorkflowRun,
      handleStartNodeChange,
      handleStudioViewChange,
      handleWorkflowFieldChange,
      handleWorkflowTagsChange
    }
  };
}