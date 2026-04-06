import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import { builtInTaskCatalog } from '@flow-machine/built-in-tasks';
import {
  ApprovalRules,
  CustomTask,
  LocalRepository,
  MergedMcpConfig,
  ModelManifest,
  RunState,
  TaskCatalogEntry,
  WorkflowDocument,
  WorkflowExportBundle,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowRunSummary,
  WorkflowSummary
} from '@flow-machine/shared-types';

import { AppConfig } from './config';
import { createAdHocRepository, createMountedRootRepository, createRepositoryReference, mountedRootRepositoryId } from './repositories';
import { starterWorkflowDocuments, createEmptyWorkflowDocument } from './starter-workflows';
import { stableStringify } from './stable-json';
import { parseImportBundle, sanitizeWorkflowDefinition } from './workflow-validation';

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  tags_json: string;
  definition_json: string;
  last_run_state: WorkflowSummary['lastRunState'];
  created_at: string;
  updated_at: string;
}

interface AppStateRow {
  value_json: string;
}

interface RunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: Exclude<RunState, 'never'>;
  current_node_id: string | null;
  pending_node_ids_json: string;
  steps_json: string;
  context_json: string;
  error_message: string | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'workflow';
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export class WorkflowStore {
  private readonly db: Database.Database;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.db = new Database(path.join(config.dataDir, 'flow-machine.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();
    this.seed();
  }

  listWorkflowSummaries(): WorkflowSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, name, description, tags_json, definition_json, last_run_state, created_at, updated_at
          FROM workflows
          ORDER BY updated_at DESC
        `
      )
      .all() as WorkflowRow[];

    return rows.map((row) => this.toWorkflowSummary(row));
  }

  listWorkflowDocuments(): WorkflowDocument[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, name, description, tags_json, definition_json, last_run_state, created_at, updated_at
          FROM workflows
          ORDER BY updated_at DESC
        `
      )
      .all() as WorkflowRow[];

    return rows.map((row) => this.toWorkflowDocument(row));
  }

  getWorkflow(id: string): WorkflowDocument | null {
    const row = this.db
      .prepare(
        `
          SELECT id, name, description, tags_json, definition_json, last_run_state, created_at, updated_at
          FROM workflows
          WHERE id = ?
        `
      )
      .get(id) as WorkflowRow | undefined;

    return row ? this.toWorkflowDocument(row) : null;
  }

  createWorkflow(input: { name: string; description: string; tags: string[]; definition?: WorkflowDocument['definition'] }): WorkflowDocument {
    const id = `${slugify(input.name)}-${randomUUID().slice(0, 8)}`;
    const workflow = createEmptyWorkflowDocument(id, input.name, input.description, input.tags);

    workflow.definition = input.definition ?? workflow.definition;

    this.persistWorkflow(workflow);

    return workflow;
  }

  updateWorkflow(
    id: string,
    input: { name: string; description: string; tags: string[]; definition?: WorkflowDocument['definition'] }
  ): WorkflowDocument | null {
    const existing = this.getWorkflow(id);

    if (!existing) {
      return null;
    }

    const updated: WorkflowDocument = {
      ...existing,
      name: input.name,
      description: input.description,
      tags: input.tags,
      definition: input.definition ?? existing.definition,
      updatedAt: new Date().toISOString()
    };

    this.persistWorkflow(updated);

    return updated;
  }

  deleteWorkflow(id: string): boolean {
    const result = this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return result.changes > 0;
  }

  listRuns(workflowId?: string): WorkflowRunSummary[] {
    const statement = workflowId
      ? this.db.prepare(
          `
            SELECT id, workflow_id, workflow_name, status, current_node_id, pending_node_ids_json, steps_json, context_json, error_message, created_at, started_at, finished_at, updated_at
            FROM runs
            WHERE workflow_id = ?
            ORDER BY created_at DESC
          `
        )
      : this.db.prepare(
          `
            SELECT id, workflow_id, workflow_name, status, current_node_id, pending_node_ids_json, steps_json, context_json, error_message, created_at, started_at, finished_at, updated_at
            FROM runs
            ORDER BY created_at DESC
          `
        );

    const rows = (workflowId ? statement.all(workflowId) : statement.all()) as RunRow[];
    return rows.map((row) => this.toWorkflowRunSummary(row));
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db
      .prepare(
        `
          SELECT id, workflow_id, workflow_name, status, current_node_id, pending_node_ids_json, steps_json, context_json, error_message, created_at, started_at, finished_at, updated_at
          FROM runs
          WHERE id = ?
        `
      )
      .get(id) as RunRow | undefined;

    return row ? this.toWorkflowRun(row) : null;
  }

  createRun(
    workflow: WorkflowDocument,
    options?: {
      currentNodeId?: string | null;
      context?: WorkflowRunContext;
      pendingNodeIds?: string[];
      steps?: WorkflowRun['steps'];
    }
  ): WorkflowRun {
    const timestamp = new Date().toISOString();
    const run: WorkflowRun = {
      id: `run-${randomUUID().slice(0, 12)}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'queued',
      currentNodeId: options?.currentNodeId ?? workflow.definition.startNodeId,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      updatedAt: timestamp,
      errorMessage: null,
      stepCount: options?.steps?.length ?? 0,
      context: options?.context ?? this.createDefaultRunContext(),
      pendingNodeIds: options?.pendingNodeIds ?? (workflow.definition.startNodeId ? [workflow.definition.startNodeId] : []),
      steps: options?.steps ?? []
    };

    this.persistRun(run);
    this.setWorkflowLastRunState(workflow.id, run.status);

    return run;
  }

  updateRun(run: WorkflowRun): WorkflowRun {
    const nextRun: WorkflowRun = {
      ...run,
      stepCount: run.steps.length,
      updatedAt: new Date().toISOString()
    };

    this.persistRun(nextRun);
    this.setWorkflowLastRunState(nextRun.workflowId, nextRun.status);

    return nextRun;
  }

  getApprovalRules(): ApprovalRules {
    return this.getState<ApprovalRules>('approval_rules', { globalDefaults: [] });
  }

  updateApprovalRules(rules: ApprovalRules): ApprovalRules {
    const nextRules: ApprovalRules = {
      globalDefaults: [...new Set(rules.globalDefaults.map((entry) => entry.trim()).filter(Boolean))]
    };

    this.setState('approval_rules', nextRules);
    return nextRules;
  }

  getModelManifest(): ModelManifest {
    return this.getState<ModelManifest>('model_manifest', {
      provider: 'host-native-ollama',
      baseUrl: this.config.ollamaBaseUrl,
      installed: [],
      selectedModel: null
    });
  }

  updateModelManifest(update: Partial<ModelManifest>): ModelManifest {
    const current = this.getModelManifest();
    const nextManifest: ModelManifest = {
      provider: 'host-native-ollama',
      baseUrl: update.baseUrl ?? current.baseUrl,
      installed: [...new Set((update.installed ?? current.installed).map((entry) => entry.trim()).filter(Boolean))],
      selectedModel: update.selectedModel === undefined ? current.selectedModel : update.selectedModel
    };

    if (nextManifest.selectedModel && !nextManifest.installed.includes(nextManifest.selectedModel)) {
      nextManifest.installed = [...nextManifest.installed, nextManifest.selectedModel];
    }

    this.setState('model_manifest', nextManifest);
    return nextManifest;
  }

  getMcpConfig(): MergedMcpConfig {
    return this.readMcpConfig();
  }

  updateMcpConfig(value: MergedMcpConfig): MergedMcpConfig {
    const nextConfig: MergedMcpConfig = {
      servers: value.servers
    };

    this.writeMcpConfig(nextConfig);
    return nextConfig;
  }

  listRepositories(): LocalRepository[] {
    const mountedRoot = createMountedRootRepository(this.config);
    const storedRepositories = this.getStoredRepositories().filter((repository) => repository.relativePath !== '.');

    return [mountedRoot, ...storedRepositories];
  }

  getRepository(id: string): LocalRepository | null {
    return this.listRepositories().find((repository) => repository.id === id) ?? null;
  }

  upsertRepository(input: { name: string; path: string }): LocalRepository {
    const currentRepositories = this.getStoredRepositories();
    const nextRepository = createRepositoryReference(this.config, {
      hostPath: input.path,
      id: `repo-${randomUUID().slice(0, 8)}`,
      name: input.name,
      source: 'registered'
    });

    const existingRepository = currentRepositories.find((repository) => repository.hostPath === nextRepository.hostPath);
    const repository = existingRepository
      ? {
          ...nextRepository,
          id: existingRepository.id
        }
      : nextRepository;

    if (repository.relativePath === '.') {
      throw new Error('The mounted root is already available by default and does not need to be registered again.');
    }

    const nextRepositories = [
      ...currentRepositories.filter((entry) => entry.id !== repository.id && entry.hostPath !== repository.hostPath),
      repository
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    this.setState('repositories', nextRepositories);
    return repository;
  }

  deleteRepository(id: string): boolean {
    if (id === mountedRootRepositoryId) {
      return false;
    }

    const currentRepositories = this.getStoredRepositories();
    const nextRepositories = currentRepositories.filter((repository) => repository.id !== id);

    if (nextRepositories.length === currentRepositories.length) {
      return false;
    }

    this.setState('repositories', nextRepositories);
    return true;
  }

  resolveAdHocRepository(pathInput: string): LocalRepository {
    return createAdHocRepository(this.config, pathInput);
  }

  listCustomTasks(): CustomTask[] {
    return this.getCustomTasks();
  }

  listTaskCatalog(): TaskCatalogEntry[] {
    const taskCatalog = new Map<string, TaskCatalogEntry>(builtInTaskCatalog.map((task) => [task.key, task]));

    for (const customTask of this.getCustomTasks()) {
      taskCatalog.set(customTask.key, customTask);
    }

    return [...taskCatalog.values()];
  }

  getTaskCatalogEntry(key: string): TaskCatalogEntry | null {
    return this.listTaskCatalog().find((task) => task.key === key) ?? null;
  }

  upsertCustomTask(input: Omit<CustomTask, 'id' | 'generatedAt'>): CustomTask {
    const customTasks = this.getCustomTasks();
    const existingTask = customTasks.find((task) => task.key === input.key);
    const task: CustomTask = {
      ...input,
      id: existingTask?.id ?? `custom-${randomUUID().slice(0, 8)}`,
      generatedAt: existingTask?.generatedAt ?? new Date().toISOString()
    };

    const nextTasks = [...customTasks.filter((t) => t.key !== task.key), task];
    this.setState('custom_tasks', nextTasks);
    return task;
  }

  deleteCustomTask(key: string): boolean {
    const customTasks = this.getCustomTasks();
    const nextTasks = customTasks.filter((t) => t.key !== key);

    if (nextTasks.length === customTasks.length) {
      return false;
    }

    this.setState('custom_tasks', nextTasks);
    return true;
  }

  exportBundle(): WorkflowExportBundle {
    return {
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
      settings: {
        privacyMode: this.config.privacyMode,
        ollamaBaseUrl: this.config.ollamaBaseUrl,
        repoMount: this.config.repoMountSource
      },
      approvals: this.getState<ApprovalRules>('approval_rules', { globalDefaults: [] }),
      models: this.getState<ModelManifest>('model_manifest', {
        provider: 'host-native-ollama',
        baseUrl: this.config.ollamaBaseUrl,
        installed: [],
        selectedModel: null
      }),
      mcp: this.readMcpConfig(),
      taskCatalog: builtInTaskCatalog,
      workflows: this.listWorkflowDocuments()
    };
  }

  exportWorkflow(id: string): WorkflowDocument | null {
    return this.getWorkflow(id);
  }

  importBundle(rawBundle: unknown): { importedCount: number; workflowIds: string[] } {
    const bundle = parseImportBundle(rawBundle);

    for (const workflow of bundle.workflows) {
      this.persistWorkflow({
        ...workflow,
        definition: sanitizeWorkflowDefinition(workflow.definition)
      });
    }

    this.setState('approval_rules', bundle.approvals);
    this.setState('model_manifest', {
      provider: 'host-native-ollama',
      baseUrl: bundle.models.baseUrl,
      installed: bundle.models.installed,
      selectedModel: bundle.models.selectedModel
    });
    this.writeMcpConfig(bundle.mcp);

    return {
      importedCount: bundle.workflows.length,
      workflowIds: bundle.workflows.map((workflow) => workflow.id)
    };
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        last_run_state TEXT NOT NULL DEFAULT 'never',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        current_node_id TEXT,
        pending_node_ids_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
      );
    `);

    const runColumns = this.db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;

    if (!runColumns.some((column) => column.name === 'context_json')) {
      this.db.exec("ALTER TABLE runs ADD COLUMN context_json TEXT NOT NULL DEFAULT '{\"repository\":null}'");
    }

    // Clean up deprecated starter workflows
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run('repo-change-brief');
  }

  private seed(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) AS count FROM workflows').get() as { count: number };

    if (countRow.count === 0) {
      for (const workflow of starterWorkflowDocuments) {
        this.persistWorkflow(workflow);
      }
    }

    this.ensureState('approval_rules', { globalDefaults: [] });
    this.ensureState('model_manifest', {
      provider: 'host-native-ollama',
      baseUrl: this.config.ollamaBaseUrl,
      installed: [],
      selectedModel: null
    });
    this.ensureState('repositories', []);
    this.ensureState('custom_tasks', []);
  }

  private ensureState(key: string, value: unknown): void {
    const existing = this.db.prepare('SELECT value_json FROM app_state WHERE key = ?').get(key) as AppStateRow | undefined;

    if (!existing) {
      this.setState(key, value);
    }
  }

  private getState<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value_json FROM app_state WHERE key = ?').get(key) as AppStateRow | undefined;
    return row ? parseJson<T>(row.value_json, fallback) : fallback;
  }

  private setState(key: string, value: unknown): void {
    this.db
      .prepare(
        `
          INSERT INTO app_state (key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      )
      .run(key, stableStringify(value), new Date().toISOString());
  }

  private persistWorkflow(workflow: WorkflowDocument): void {
    this.db
      .prepare(
        `
          INSERT INTO workflows (
            id,
            name,
            description,
            tags_json,
            definition_json,
            last_run_state,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            tags_json = excluded.tags_json,
            definition_json = excluded.definition_json,
            last_run_state = excluded.last_run_state,
            updated_at = excluded.updated_at
        `
      )
      .run(
        workflow.id,
        workflow.name,
        workflow.description,
        stableStringify(workflow.tags),
        stableStringify(workflow.definition),
        workflow.lastRunState,
        workflow.createdAt,
        workflow.updatedAt
      );
  }

  private persistRun(run: WorkflowRun): void {
    this.db
      .prepare(
        `
          INSERT INTO runs (
            id,
            workflow_id,
            workflow_name,
            status,
            current_node_id,
            pending_node_ids_json,
            steps_json,
            context_json,
            error_message,
            created_at,
            started_at,
            finished_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workflow_name = excluded.workflow_name,
            status = excluded.status,
            current_node_id = excluded.current_node_id,
            pending_node_ids_json = excluded.pending_node_ids_json,
            steps_json = excluded.steps_json,
            context_json = excluded.context_json,
            error_message = excluded.error_message,
            finished_at = excluded.finished_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        run.id,
        run.workflowId,
        run.workflowName,
        run.status,
        run.currentNodeId,
        stableStringify(run.pendingNodeIds),
        stableStringify(run.steps),
        stableStringify(run.context),
        run.errorMessage,
        run.createdAt,
        run.startedAt,
        run.finishedAt,
        run.updatedAt
      );
  }

  private setWorkflowLastRunState(workflowId: string, state: Exclude<RunState, 'never'>): void {
    this.db.prepare('UPDATE workflows SET last_run_state = ?, updated_at = updated_at WHERE id = ?').run(state, workflowId);
  }

  private toWorkflowSummary(row: WorkflowRow): WorkflowSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tags: parseJson<string[]>(row.tags_json, []),
      lastRunState: row.last_run_state,
      updatedAt: row.updated_at
    };
  }

  private toWorkflowDocument(row: WorkflowRow): WorkflowDocument {
    return {
      ...this.toWorkflowSummary(row),
      createdAt: row.created_at,
      definition: sanitizeWorkflowDefinition(parseJson(row.definition_json, {}))
    };
  }

  private toWorkflowRunSummary(row: RunRow): WorkflowRunSummary {
    const steps = parseJson<WorkflowRun['steps']>(row.steps_json, []);

    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      status: row.status,
      currentNodeId: row.current_node_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      updatedAt: row.updated_at,
      errorMessage: row.error_message,
      stepCount: steps.length
    };
  }

  private toWorkflowRun(row: RunRow): WorkflowRun {
    const steps = parseJson<WorkflowRun['steps']>(row.steps_json, []);

    return {
      ...this.toWorkflowRunSummary(row),
      context: parseJson<WorkflowRunContext>(row.context_json, this.createDefaultRunContext()),
      pendingNodeIds: parseJson<string[]>(row.pending_node_ids_json, []),
      steps
    };
  }

  private createDefaultRunContext(): WorkflowRunContext {
    return {
      repository: null
    };
  }

  private getStoredRepositories(): LocalRepository[] {
    const storedRepositories = this.getState<LocalRepository[]>('repositories', []);

    return storedRepositories.reduce<LocalRepository[]>((accumulator, entry) => {
      if (!entry || typeof entry !== 'object') {
        return accumulator;
      }

      try {
        const repository = createRepositoryReference(this.config, {
          hostPath: isString((entry as LocalRepository).hostPath) ? (entry as LocalRepository).hostPath : '',
          id: isString((entry as LocalRepository).id) ? (entry as LocalRepository).id : `repo-${randomUUID().slice(0, 8)}`,
          name: isString((entry as LocalRepository).name) ? (entry as LocalRepository).name : undefined,
          source: 'registered',
          updatedAt: isString((entry as LocalRepository).updatedAt) ? (entry as LocalRepository).updatedAt : undefined
        });

        if (!accumulator.some((existing) => existing.hostPath === repository.hostPath)) {
          accumulator.push(repository);
        }
      } catch {
        // Skip repositories that no longer resolve inside the mounted root.
      }

      return accumulator;
    }, []);
  }

  private getCustomTasks(): CustomTask[] {
    return this.getState<CustomTask[]>('custom_tasks', []);
  }

  private readMcpConfig(): WorkflowExportBundle['mcp'] {
    try {
      const content = fs.readFileSync(this.config.mcpConfigPath, 'utf8');
      const parsed = parseJson<{ servers?: Record<string, unknown> }>(content, { servers: {} });
      return {
        servers: parsed.servers ?? {}
      };
    } catch {
      return { servers: {} };
    }
  }

  private writeMcpConfig(value: WorkflowExportBundle['mcp']): void {
    fs.mkdirSync(path.dirname(this.config.mcpConfigPath), { recursive: true });
    fs.writeFileSync(this.config.mcpConfigPath, stableStringify({ servers: value.servers }), 'utf8');
  }
}
