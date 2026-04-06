import { EventEmitter } from 'node:events';

import {
  TaskCatalogEntry,
  WorkflowDocument,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowRunSummary,
  WorkflowStepLogEntry,
  WorkflowStepRun
} from '@flow-machine/shared-types';

import { AppConfig } from './config';
import { buildApprovalPrompt, executeTaskNode, requiresApproval } from './run-executors';
import { SecretStore } from './secret-store';
import { WorkflowStore } from './workflow-store';
import { getFirstWorkflowRunValidationError } from './workflow-run-validation';

function buildLogEntryId(step: WorkflowStepRun, index: number): string {
  return `log-${step.nodeId}-${Date.now()}-${index}`;
}

function findNode(workflow: WorkflowDocument, nodeId: string): WorkflowNode | null {
  return workflow.definition.nodes.find((node) => node.id === nodeId) ?? null;
}

function getIncomingSourceIds(workflow: WorkflowDocument, nodeId: string): string[] {
  return workflow.definition.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
}

function getOutgoingEdges(workflow: WorkflowDocument, nodeId: string) {
  return workflow.definition.edges.filter((edge) => edge.source === nodeId);
}

function readConditionResult(step: WorkflowStepRun): boolean | null {
  if (typeof step.output !== 'object' || step.output === null || Array.isArray(step.output)) {
    return null;
  }

  const result = (step.output as Record<string, unknown>).result;
  return typeof result === 'boolean' ? result : null;
}

function createBlankStep(
  node: WorkflowNode,
  input: Record<string, unknown>,
  task: TaskCatalogEntry | null,
  approvalRules: { globalDefaults: string[] }
): WorkflowStepRun {
  const approvalRequired = requiresApproval(node, task, approvalRules);

  return {
    nodeId: node.id,
    nodeName: node.name,
    taskKey: node.taskKey,
    state: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    input,
    output: null,
    errorMessage: null,
    logs: [],
    network: [],
    approval: {
      required: approvalRequired,
      state: approvalRequired ? 'pending' : 'not-required',
      prompt: approvalRequired ? buildApprovalPrompt(node, task) : null
    }
  };
}

function withUpdatedStep(run: WorkflowRun, nextStep: WorkflowStepRun): WorkflowRun {
  const nextSteps = [...run.steps];
  const existingIndex = nextSteps.findIndex((step) => step.nodeId === nextStep.nodeId);

  if (existingIndex >= 0) {
    nextSteps[existingIndex] = nextStep;
  } else {
    nextSteps.push(nextStep);
  }

  return {
    ...run,
    steps: nextSteps,
    stepCount: nextSteps.length
  };
}

function collectNodeInput(workflow: WorkflowDocument, run: WorkflowRun, nodeId: string): Record<string, unknown> {
  return getIncomingSourceIds(workflow, nodeId).reduce<Record<string, unknown>>((accumulator, sourceId) => {
    const sourceStep = run.steps.find((step) => step.nodeId === sourceId);

    if (sourceStep) {
      accumulator[sourceId] = sourceStep.output;
    }

    return accumulator;
  }, {});
}

function allDependenciesSucceeded(workflow: WorkflowDocument, run: WorkflowRun, nodeId: string): boolean {
  const sourceIds = getIncomingSourceIds(workflow, nodeId);

  if (sourceIds.length === 0) {
    return true;
  }

  return sourceIds.every((sourceId) => run.steps.some((step) => step.nodeId === sourceId && step.state === 'success'));
}

function resolveNextNodeIds(workflow: WorkflowDocument, run: WorkflowRun, step: WorkflowStepRun): string[] {
  const outgoingEdges = getOutgoingEdges(workflow, step.nodeId);

  if (outgoingEdges.length === 0) {
    return [];
  }

  const hasConditionalEdges = step.taskKey === 'condition' && outgoingEdges.some((edge) => typeof edge.condition === 'string' && edge.condition.length > 0);
  const filteredEdges = hasConditionalEdges
    ? outgoingEdges.filter((edge) => edge.condition?.trim().toLowerCase() === String(readConditionResult(step)).toLowerCase())
    : outgoingEdges;

  return filteredEdges
    .map((edge) => edge.target)
    .filter((targetId) => {
      if (run.pendingNodeIds.includes(targetId)) {
        return false;
      }

      if (run.steps.some((existingStep) => existingStep.nodeId === targetId)) {
        return false;
      }

      return allDependenciesSucceeded(workflow, run, targetId);
    });
}

function mergeRunContext(current: WorkflowRunContext, update?: Partial<WorkflowRunContext>): WorkflowRunContext {
  if (!update) {
    return current;
  }

  return {
    ...current,
    ...update
  };
}

class RunCancellationError extends Error {
  constructor(message = 'Run stopped by user.') {
    super(message);
    this.name = 'RunCancellationError';
  }
}

function cancellationMessage(signal: AbortSignal): string {
  if (signal.reason instanceof Error && signal.reason.message) {
    return signal.reason.message;
  }

  if (typeof signal.reason === 'string' && signal.reason.trim().length > 0) {
    return signal.reason;
  }

  return 'Run stopped by user.';
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'RunCancellationError');
}

function cancelStep(step: WorkflowStepRun, finishedAt: string, message: string): WorkflowStepRun {
  return {
    ...step,
    state: 'canceled',
    finishedAt,
    durationMs: step.startedAt ? Date.parse(finishedAt) - Date.parse(step.startedAt) : null,
    errorMessage: message,
    approval:
      step.approval.state === 'pending'
        ? {
            ...step.approval,
            state: 'rejected'
          }
        : step.approval,
    logs: [
      ...step.logs,
      {
        id: buildLogEntryId(step, step.logs.length),
        at: finishedAt,
        level: 'warn',
        message
      }
    ]
  };
}

export class WorkflowRunManager {
  private readonly events = new EventEmitter();

  private readonly activeRuns = new Set<string>();

  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly store: WorkflowStore,
    private readonly config: AppConfig,
    private readonly secretStore: SecretStore
  ) {
    this.events.setMaxListeners(0);
  }

  listRuns(workflowId?: string): WorkflowRunSummary[] {
    return this.store.listRuns(workflowId);
  }

  getRun(runId: string): WorkflowRun | null {
    return this.store.getRun(runId);
  }

  subscribe(runId: string, listener: (run: WorkflowRun) => void): () => void {
    const eventName = this.eventName(runId);
    this.events.on(eventName, listener);

    return () => {
      this.events.off(eventName, listener);
    };
  }

  async startRun(workflowId: string): Promise<WorkflowRun> {
    const workflow = this.store.getWorkflow(workflowId);

    if (!workflow) {
      throw new Error('Workflow not found.');
    }

    const validationError = getFirstWorkflowRunValidationError(workflow, this.store);

    if (validationError) {
      throw new Error(validationError);
    }

    const run = this.store.createRun(workflow);
    this.emitRun(run);
    void this.executeRun(run.id);

    return run;
  }

  async rerun(runId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId);

    if (!run) {
      throw new Error('Run not found.');
    }

    return this.startRun(run.workflowId);
  }

  async resumeRun(runId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId);

    if (!run || run.status !== 'failed') {
      throw new Error('Only failed runs can be resumed.');
    }

    const workflow = this.store.getWorkflow(run.workflowId);

    if (!workflow) {
      throw new Error('Workflow not found.');
    }

    const validationError = getFirstWorkflowRunValidationError(workflow, this.store);

    if (validationError) {
      throw new Error(validationError);
    }

    const preservedSteps = run.steps.filter((step) => step.state === 'success' || step.state === 'skipped');
    const resumeNodeIds = [run.currentNodeId, ...run.pendingNodeIds].filter(
      (nodeId): nodeId is string => Boolean(nodeId) && !preservedSteps.some((step) => step.nodeId === nodeId)
    );

    if (resumeNodeIds.length === 0) {
      throw new Error('No pending node remains to resume from.');
    }

    const resumedRun = this.store.createRun(workflow, {
      currentNodeId: resumeNodeIds[0],
      context: run.context,
      pendingNodeIds: resumeNodeIds,
      steps: preservedSteps
    });

    this.emitRun(resumedRun);
    void this.executeRun(resumedRun.id);

    return resumedRun;
  }

  async approveRun(runId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId);

    if (!run || run.status !== 'waiting-approval' || !run.currentNodeId) {
      throw new Error('Run is not waiting for approval.');
    }

    const step = run.steps.find((entry) => entry.nodeId === run.currentNodeId);

    if (!step) {
      throw new Error('Approval step not found.');
    }

    const approvedStep: WorkflowStepRun = {
      ...step,
      state: 'pending',
      errorMessage: null,
      approval: {
        ...step.approval,
        state: 'approved'
      },
      logs: [
        ...step.logs,
        {
          id: buildLogEntryId(step, step.logs.length),
          at: new Date().toISOString(),
          level: 'info',
          message: 'Approval granted.'
        }
      ]
    };

    const nextRun = this.persistRun(
      withUpdatedStep(
        {
          ...run,
          status: 'running',
          errorMessage: null,
          finishedAt: null,
          currentNodeId: approvedStep.nodeId,
          pendingNodeIds: run.pendingNodeIds.includes(approvedStep.nodeId)
            ? run.pendingNodeIds
            : [approvedStep.nodeId, ...run.pendingNodeIds]
        },
        approvedStep
      )
    );

    void this.executeRun(runId);

    return nextRun;
  }

  async rejectRun(runId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId);

    if (!run || run.status !== 'waiting-approval' || !run.currentNodeId) {
      throw new Error('Run is not waiting for approval.');
    }

    const step = run.steps.find((entry) => entry.nodeId === run.currentNodeId);

    if (!step) {
      throw new Error('Approval step not found.');
    }

    const finishedAt = new Date().toISOString();
    const rejectedStep: WorkflowStepRun = {
      ...step,
      state: 'failed',
      finishedAt,
      durationMs: step.startedAt ? Date.parse(finishedAt) - Date.parse(step.startedAt) : null,
      errorMessage: 'Approval rejected.',
      approval: {
        ...step.approval,
        state: 'rejected'
      },
      logs: [
        ...step.logs,
        {
          id: buildLogEntryId(step, step.logs.length),
          at: finishedAt,
          level: 'warn',
          message: 'Approval rejected.'
        }
      ]
    };

    return this.persistRun(
      withUpdatedStep(
        {
          ...run,
          status: 'failed',
          errorMessage: 'Approval rejected.',
          finishedAt,
          pendingNodeIds: [],
          currentNodeId: rejectedStep.nodeId
        },
        rejectedStep
      )
    );
  }

  async stopRun(runId: string): Promise<WorkflowRun> {
    const run = this.store.getRun(runId);

    if (!run) {
      throw new Error('Run not found.');
    }

    if (run.status === 'success' || run.status === 'failed' || run.status === 'canceled') {
      throw new Error('Only queued, running, canceling, or waiting approval runs can be stopped.');
    }

    const message = 'Run stopped by user.';
    const currentStep = run.currentNodeId ? run.steps.find((entry) => entry.nodeId === run.currentNodeId) ?? null : null;
    const controller = this.abortControllers.get(runId);

    if (!controller || run.status === 'queued' || run.status === 'waiting-approval') {
      return this.persistCanceledRun(run, message, currentStep);
    }

    if (run.status === 'canceling') {
      return run;
    }

    const requestedAt = new Date().toISOString();
    const nextRun = this.persistRun(
      currentStep
        ? withUpdatedStep(
            {
              ...run,
              status: 'canceling',
              errorMessage: message,
              finishedAt: null
            },
            {
              ...currentStep,
              logs: [
                ...currentStep.logs,
                {
                  id: buildLogEntryId(currentStep, currentStep.logs.length),
                  at: requestedAt,
                  level: 'warn',
                  message: 'Stop requested. Waiting for the current step to halt.'
                }
              ]
            }
          )
        : {
            ...run,
            status: 'canceling',
            errorMessage: message,
            finishedAt: null
          }
    );

    controller.abort(new RunCancellationError(message));
    return nextRun;
  }

  private async executeRun(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) {
      return;
    }

    this.activeRuns.add(runId);
    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    try {
      let run = this.store.getRun(runId);

      if (!run || run.status === 'waiting-approval' || run.status === 'failed' || run.status === 'success' || run.status === 'canceled') {
        return;
      }

      if (run.status === 'canceling') {
        this.persistCanceledRun(run, cancellationMessage(abortController.signal));
        return;
      }

      const workflow = this.store.getWorkflow(run.workflowId);

      if (!workflow) {
        this.failRun(run, 'Workflow not found while executing run.');
        return;
      }

      if (!workflow.definition.startNodeId) {
        this.failRun(run, 'Workflow has no start node.');
        return;
      }

      if (run.status === 'queued') {
        run = this.persistRun({
          ...run,
          status: 'running',
          currentNodeId: run.pendingNodeIds[0] ?? workflow.definition.startNodeId
        });
      }

      while (run.pendingNodeIds.length > 0) {
        const persistedRun = this.store.getRun(runId);

        if (!persistedRun) {
          return;
        }

        run = persistedRun;

        if (abortController.signal.aborted || run.status === 'canceling') {
          this.persistCanceledRun(run, cancellationMessage(abortController.signal));
          return;
        }

        const nodeId = run.pendingNodeIds[0];
        const node = findNode(workflow, nodeId);

        if (!node) {
          this.failRun(run, `Workflow node ${nodeId} no longer exists.`);
          return;
        }

        const task = this.store.getTaskCatalogEntry(node.taskKey);
        const approvalRules = this.store.getApprovalRules();
        const input = collectNodeInput(workflow, run, node.id);
        let step = run.steps.find((entry) => entry.nodeId === node.id) ?? createBlankStep(node, input, task, approvalRules);

        step = {
          ...step,
          nodeName: node.name,
          input
        };

        if (requiresApproval(node, task, approvalRules) && step.approval.state !== 'approved') {
          const waitingStep: WorkflowStepRun = {
            ...step,
            state: 'waiting-approval',
            approval: {
              required: true,
              state: 'pending',
              prompt: buildApprovalPrompt(node, task)
            },
            logs: [
              ...step.logs,
              {
                id: buildLogEntryId(step, step.logs.length),
                at: new Date().toISOString(),
                level: 'info',
                message: 'Execution is paused for approval.'
              }
            ]
          };

          run = this.persistRun(
            withUpdatedStep(
              {
                ...run,
                status: 'waiting-approval',
                currentNodeId: node.id,
                pendingNodeIds: run.pendingNodeIds.slice(1),
                finishedAt: null,
                errorMessage: null
              },
              waitingStep
            )
          );

          return;
        }

        const stepLogs = [...step.logs];
        const stepNetwork = [...step.network];
        const startedAt = step.startedAt ?? new Date().toISOString();
        let runningStepSnapshot: WorkflowStepRun | null = null;
        const log = (level: WorkflowStepLogEntry['level'], message: string, data?: unknown) => {
          stepLogs.push({
            id: buildLogEntryId(step, stepLogs.length),
            at: new Date().toISOString(),
            level,
            message,
            data
          });

          if (runningStepSnapshot && run) {
            const currentRun = run;
            run = this.persistRun(
              withUpdatedStep(
                {
                  ...currentRun,
                  status: currentRun.status === 'canceling' ? 'canceling' : 'running',
                  currentNodeId: node.id,
                  finishedAt: null,
                  errorMessage: currentRun.status === 'canceling' ? currentRun.errorMessage : null
                },
                {
                  ...runningStepSnapshot,
                  logs: [...stepLogs],
                  network: [...stepNetwork]
                }
              )
            );
          }
        };

        const runningStep: WorkflowStepRun = {
          ...step,
          state: 'running',
          startedAt,
          logs: stepLogs,
          approval: step.approval.required
            ? {
                ...step.approval,
                state: 'approved'
              }
            : step.approval
        };
        runningStepSnapshot = runningStep;

        run = this.persistRun(
          withUpdatedStep(
            {
              ...run,
              status: 'running',
              currentNodeId: node.id,
              finishedAt: null,
              errorMessage: null
            },
            runningStep
          )
        );

        try {
          const result = await executeTaskNode({
            config: this.config,
            input,
            node,
            repository: run.context.repository,
            secretStore: this.secretStore,
            signal: abortController.signal,
            task,
            workflow,
            workflowStore: this.store,
            log
          });
          const finishedAt = new Date().toISOString();
          const successfulStep: WorkflowStepRun = {
            ...runningStep,
            state: 'success',
            finishedAt,
            durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
            output: result.output,
            errorMessage: null,
            logs: stepLogs,
            network: [...stepNetwork, ...(result.network ?? [])]
          };
          const runWithSuccessfulStep = withUpdatedStep(run, successfulStep);

          if (abortController.signal.aborted || this.store.getRun(runId)?.status === 'canceling') {
            this.persistRun({
              ...runWithSuccessfulStep,
              context: mergeRunContext(run.context, result.context),
              status: 'canceled',
              currentNodeId: null,
              pendingNodeIds: [],
              finishedAt,
              errorMessage: cancellationMessage(abortController.signal)
            });
            return;
          }

          const nextNodeIds = resolveNextNodeIds(workflow, runWithSuccessfulStep, successfulStep);

          run = this.persistRun({
            ...runWithSuccessfulStep,
            context: mergeRunContext(run.context, result.context),
            currentNodeId: null,
            pendingNodeIds: [...run.pendingNodeIds.slice(1), ...nextNodeIds]
          });
        } catch (error) {
          const finishedAt = new Date().toISOString();
          const latestRun = this.store.getRun(runId) ?? run;

          if (abortController.signal.aborted || latestRun.status === 'canceling' || isCancellationError(error)) {
            const message = cancellationMessage(abortController.signal);
            const canceledStep = cancelStep(
              {
                ...runningStep,
                logs: [...stepLogs],
                network: stepNetwork
              },
              finishedAt,
              message
            );

            this.persistRun(
              withUpdatedStep(
                {
                  ...latestRun,
                  status: 'canceled',
                  currentNodeId: node.id,
                  pendingNodeIds: [],
                  finishedAt,
                  errorMessage: message
                },
                canceledStep
              )
            );

            return;
          }

          const message = error instanceof Error ? error.message : 'Unknown workflow execution failure.';
          const failedStep: WorkflowStepRun = {
            ...runningStep,
            state: 'failed',
            finishedAt,
            durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
            errorMessage: message,
            logs: [
              ...stepLogs,
              {
                id: buildLogEntryId(runningStep, stepLogs.length),
                at: finishedAt,
                level: 'error',
                message
              }
            ],
            network: stepNetwork
          };

          this.persistRun(
            withUpdatedStep(
              {
                ...run,
                status: 'failed',
                currentNodeId: node.id,
                pendingNodeIds: [],
                finishedAt,
                errorMessage: message
              },
              failedStep
            )
          );

          return;
        }
      }

      const latestRun = this.store.getRun(runId) ?? run;

      if (abortController.signal.aborted || latestRun.status === 'canceling') {
        this.persistCanceledRun(latestRun, cancellationMessage(abortController.signal));
        return;
      }

      this.persistRun({
        ...run,
        status: 'success',
        currentNodeId: null,
        finishedAt: new Date().toISOString(),
        errorMessage: null
      });
    } finally {
      this.abortControllers.delete(runId);
      this.activeRuns.delete(runId);
    }
  }

  private persistCanceledRun(run: WorkflowRun, message: string, stepOverride?: WorkflowStepRun | null): WorkflowRun {
    const finishedAt = new Date().toISOString();
    const step = stepOverride ?? (run.currentNodeId ? run.steps.find((entry) => entry.nodeId === run.currentNodeId) ?? null : null);

    if (step && step.state !== 'success' && step.state !== 'failed' && step.state !== 'skipped' && step.state !== 'canceled') {
      return this.persistRun(
        withUpdatedStep(
          {
            ...run,
            status: 'canceled',
            currentNodeId: step.nodeId,
            pendingNodeIds: [],
            finishedAt,
            errorMessage: message
          },
          cancelStep(step, finishedAt, message)
        )
      );
    }

    return this.persistRun({
      ...run,
      status: 'canceled',
      pendingNodeIds: [],
      finishedAt,
      errorMessage: message
    });
  }

  private failRun(run: WorkflowRun, message: string): WorkflowRun {
    return this.persistRun({
      ...run,
      status: 'failed',
      currentNodeId: run.currentNodeId ?? run.pendingNodeIds[0] ?? null,
      pendingNodeIds: [],
      finishedAt: new Date().toISOString(),
      errorMessage: message
    });
  }

  private eventName(runId: string): string {
    return `run:${runId}`;
  }

  private emitRun(run: WorkflowRun): void {
    this.events.emit(this.eventName(run.id), run);
  }

  private persistRun(run: WorkflowRun): WorkflowRun {
    const nextRun = this.store.updateRun(run);
    this.emitRun(nextRun);
    return nextRun;
  }
}