import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { WorkflowRunSummary } from '@flow-machine/shared-types';

import { WorkflowStudioModel } from '../../hooks/useFlowMachineApp';
import { PromptAttachmentDraft, toPromptAttachmentPayloads } from '../../lib/prompt-attachments';
import { Combobox } from '../Combobox';
import { OperationActivityPanel } from '../OperationActivityPanel';
import { PromptComposer } from '../PromptComposer';
import { StatusPill } from '../StatusPill';
import { WorkflowRunInspector } from '../WorkflowRunInspector';
import { WorkflowCanvas } from '../WorkflowCanvas';
import { WorkflowNodeInspector } from './WorkflowNodeInspector';

interface WorkflowWorkbenchPanelProps {
  studio: WorkflowStudioModel;
}

function toneForRun(status: WorkflowRunSummary['status']): 'good' | 'warn' | 'bad' {
  if (status === 'success') {
    return 'good';
  }

  if (status === 'queued' || status === 'running' || status === 'waiting-approval' || status === 'canceling') {
    return 'warn';
  }

  return 'bad';
}

function canStopRun(status: WorkflowRunSummary['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting-approval' || status === 'canceling';
}

export function WorkflowWorkbenchPanel({ studio }: WorkflowWorkbenchPanelProps) {
  const [workflowInstructions, setWorkflowInstructions] = useState('');
  const [workflowAttachments, setWorkflowAttachments] = useState<PromptAttachmentDraft[]>([]);
  const [isWorkflowPromptBlocked, setIsWorkflowPromptBlocked] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const editorWorkflow = studio.editorWorkflow;
  const startNodeName = editorWorkflow?.definition.startNodeId
    ? editorWorkflow.definition.nodes.find((node) => node.id === editorWorkflow.definition.startNodeId)?.name ??
      editorWorkflow.definition.startNodeId
    : 'Unset';
  const updatedAtCopy = editorWorkflow ? new Date(editorWorkflow.updatedAt).toLocaleString() : null;
  const waitingApprovalStep =
    studio.activeRun?.steps.find((step) => step.state === 'waiting-approval' || step.approval.state === 'pending') ?? null;
  const runningStep = studio.activeRun?.steps.find((step) => step.state === 'running') ?? null;
  const failedStep = studio.activeRun?.steps.find((step) => step.state === 'failed') ?? null;
  const failedNodeValidationIssue = failedStep
    ? studio.workflowValidationIssues.find((issue) => issue.nodeId === failedStep.nodeId) ?? null
    : null;
  const primaryWorkflowValidationIssue = studio.workflowValidationIssues[0] ?? null;
  const approvalTargetLabel = waitingApprovalStep?.nodeName ?? 'pending step';
  const stoppableRun = studio.activeRun && canStopRun(studio.activeRun.status) ? studio.activeRun : null;
  const latestRunNodeName =
    studio.latestRun?.currentNodeId && editorWorkflow
      ? editorWorkflow.definition.nodes.find((node) => node.id === studio.latestRun?.currentNodeId)?.name ?? studio.latestRun.currentNodeId
      : null;
  const runPrimaryLabel = studio.startRunPending
    ? 'Starting...'
    : studio.isEditorDirty && studio.updatePending
      ? 'Saving...'
      : studio.isEditorDirty
        ? 'Save & Run'
        : 'Run workflow';
  const runCountCopy = `${studio.workflowRunCount} run${studio.workflowRunCount === 1 ? '' : 's'}`;
  const showRefineActivity =
    studio.workflowActivity.action === 'refine' &&
    studio.workflowActivity.targetWorkflowId === editorWorkflow?.id &&
    (studio.workflowActivity.logs.length > 0 || studio.workflowActivity.liveOutput.length > 0);
  const taskOptions = studio.tasks.map((task) => ({
    value: task.key,
    label: task.name,
    description: task.key,
    keywords: [task.description, ...task.capabilities]
  }));
  const workflowNodes = editorWorkflow?.definition.nodes ?? [];
  const sourceNodeOptions = [
    { value: '', label: 'Source node', description: 'Search nodes to use as the edge source' },
    ...workflowNodes.map((node) => ({
      value: node.id,
      label: node.name,
      description: node.id,
      keywords: [node.taskKey]
    }))
  ];
  const targetNodeOptions = [
    { value: '', label: 'Target node', description: 'Search nodes to use as the edge target' },
    ...workflowNodes.map((node) => ({
      value: node.id,
      label: node.name,
      description: node.id,
      keywords: [node.taskKey]
    }))
  ];
  const startNodeOptions = [
    { value: '', label: 'No start node', description: 'Workflow runs stay blocked until you choose one' },
    ...workflowNodes.map((node) => ({
      value: node.id,
      label: node.name,
      description: node.id,
      keywords: [node.taskKey]
    }))
  ];
  const deleteModal =
    editorWorkflow && isDeleteModalOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-overlay" onClick={() => (!studio.deletePending ? setIsDeleteModalOpen(false) : undefined)} role="presentation">
            <div
              aria-labelledby="workflow-delete-title"
              aria-modal="true"
              className="modal-content modal-content--narrow"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="modal-header">
                <div>
                  <h2 id="workflow-delete-title">Delete workflow</h2>
                  <p className="modal-key">{editorWorkflow.name}</p>
                </div>
                <button
                  aria-label="Close workflow delete confirmation"
                  className="modal-close"
                  disabled={studio.deletePending}
                  onClick={() => setIsDeleteModalOpen(false)}
                  type="button"
                >
                  ✕
                </button>
              </div>

              <div className="modal-body modal-body--stacked">
                <p>This removes the saved workflow from the local catalog. Existing run history remains, but the workflow definition itself cannot be restored automatically.</p>
                <div className="toolbar-row toolbar-row--compact">
                  <button className="button button--danger" disabled={studio.deletePending} onClick={studio.handleDeleteSelected} type="button">
                    {studio.deletePending ? 'Deleting...' : 'Delete workflow'}
                  </button>
                  <button className="button button--secondary" disabled={studio.deletePending} onClick={() => setIsDeleteModalOpen(false)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  useEffect(() => {
    setWorkflowInstructions('');
    setWorkflowAttachments([]);
    setIsWorkflowPromptBlocked(false);
    setIsDeleteModalOpen(false);
  }, [editorWorkflow?.id]);

  async function handleRefineWorkflow(): Promise<void> {
    try {
      await studio.handleRefineWorkflow(workflowInstructions, toPromptAttachmentPayloads(workflowAttachments));
      setWorkflowInstructions('');
      setWorkflowAttachments([]);
    } catch {
      return;
    }
  }

  let executionTone: 'good' | 'warn' | 'bad' = editorWorkflow?.definition.startNodeId ? 'good' : 'warn';
  let executionTitle = editorWorkflow?.definition.startNodeId ? 'Ready to run' : 'Start node required';
  let executionCopy = editorWorkflow?.definition.startNodeId
    ? 'Run the current workflow here and watch the latest execution state without leaving the editor.'
    : 'Choose a start node before running this workflow.';

  if (studio.startRunPending) {
    executionTone = 'warn';
    executionTitle = 'Starting workflow';
    executionCopy = studio.isEditorDirty
      ? 'Saving the current graph and queuing a new run.'
      : 'Queuing a new run and waiting for the first step to start.';
  } else if (studio.pendingApprovalRun) {
    executionTone = 'warn';
    executionTitle = 'Approval required';
    executionCopy = waitingApprovalStep
      ? `${waitingApprovalStep.nodeName} is paused and waiting for approval.${waitingApprovalStep.approval.prompt ? ` ${waitingApprovalStep.approval.prompt}` : ''}`
      : 'This workflow is paused and waiting for approval. Approve or reject it here to continue.';
  } else if (studio.latestRun?.status === 'running') {
    executionTone = 'warn';
    executionTitle = 'Workflow running';
    executionCopy = runningStep
      ? `Currently executing ${runningStep.nodeName}. Follow progress directly on the canvas and recent activity below.`
      : latestRunNodeName
        ? `Currently executing ${latestRunNodeName}. Follow progress directly on the canvas and recent activity below.`
        : 'Execution is in progress. Follow progress directly on the canvas and recent activity below.';
  } else if (studio.latestRun?.status === 'canceling') {
    executionTone = 'warn';
    executionTitle = 'Stopping workflow';
    executionCopy = 'Stop requested. Waiting for the current step to unwind before Flow Machine marks the run as stopped.';
  } else if (studio.latestRun?.status === 'queued') {
    executionTone = 'warn';
    executionTitle = 'Run queued';
    executionCopy = 'The workflow has been queued and is waiting for the first step to start.';
  } else if (studio.latestRun?.status === 'success') {
    executionTone = 'good';
    executionTitle = 'Last run succeeded';
    executionCopy = `Completed ${studio.latestRun.stepCount} recorded step${studio.latestRun.stepCount === 1 ? '' : 's'} at ${new Date(
      studio.latestRun.updatedAt
    ).toLocaleTimeString()}.`;
  } else if (studio.latestRun?.status === 'failed') {
    executionTone = 'bad';
    executionTitle = 'Last run failed';
    executionCopy = failedStep?.errorMessage ?? studio.latestRun.errorMessage ?? 'Inspect the failure and resume or rerun from here.';
  } else if (studio.latestRun?.status === 'canceled') {
    executionTone = 'bad';
    executionTitle = 'Last run stopped';
    executionCopy = studio.latestRun.errorMessage ?? 'This run was stopped before the remaining nodes could finish.';
  }

  const workflowContent = studio.detailState.isLoading && !editorWorkflow ? (
    <div className="empty-state">
      <h3>Loading workflow</h3>
      <p>Fetching the stored workflow definition and metadata.</p>
    </div>
  ) : studio.detailState.isError && !editorWorkflow ? (
    <div className="empty-state">
      <h3>Workflow unavailable</h3>
      <p>{studio.detailState.errorMessage ?? 'Unknown error.'}</p>
    </div>
  ) : editorWorkflow ? (
    <>
      <div className="workflow-workbench__overview">
        <div className="workflow-workbench__fact-strip">
          <span className="workflow-inline-chip">{editorWorkflow.definition.nodes.length} node{editorWorkflow.definition.nodes.length === 1 ? '' : 's'}</span>
          <span className="workflow-inline-chip">{editorWorkflow.definition.edges.length} edge{editorWorkflow.definition.edges.length === 1 ? '' : 's'}</span>
          <span className="workflow-inline-chip">Entry: {startNodeName}</span>
          <span className="workflow-inline-chip">Updated {updatedAtCopy}</span>
          <span className={`workflow-inline-chip${studio.latestRun ? '' : ' workflow-inline-chip--muted'}`}>{runCountCopy}</span>
          {studio.latestRun ? (
            <button className="workflow-inline-chip workflow-inline-chip--button" onClick={() => studio.handleFocusRun(studio.latestRun!.id)} type="button">
              Latest run: {studio.latestRun.status}
            </button>
          ) : null}
        </div>

        <details className="workflow-workbench__details-panel">
          <summary>Edit workflow details</summary>

          <div className="workflow-workbench__details-body">
            <div className="workflow-meta-grid">
              <div className="form-field">
                <label htmlFor="editor-workflow-name">Workflow name</label>
                <input
                  className="input"
                  id="editor-workflow-name"
                  onChange={(event) => studio.handleWorkflowFieldChange('name', event.target.value)}
                  value={editorWorkflow.name}
                />
              </div>
              <div className="form-field">
                <label htmlFor="editor-workflow-tags">Tags</label>
                <input
                  className="input"
                  id="editor-workflow-tags"
                  onChange={(event) => studio.handleWorkflowTagsChange(event.target.value)}
                  value={studio.workflowTagsInput}
                />
              </div>
              <div className="form-field form-field--full">
                <label htmlFor="editor-workflow-description">Description</label>
                <textarea
                  className="textarea"
                  id="editor-workflow-description"
                  onChange={(event) => studio.handleWorkflowFieldChange('description', event.target.value)}
                  rows={2}
                  value={editorWorkflow.description}
                />
              </div>
            </div>

            <div className="workflow-workbench__detail-actions toolbar-row toolbar-row--compact">
              <StatusPill tone={editorWorkflow.definition.startNodeId ? 'good' : 'warn'}>
                {editorWorkflow.definition.startNodeId ? 'Entry node ready' : 'Entry node missing'}
              </StatusPill>
              <button className="button button--secondary" onClick={() => void studio.handleExportWorkflow()} type="button">
                Export workflow
              </button>
              <button className="button button--danger" onClick={() => setIsDeleteModalOpen(true)} type="button">
                Delete workflow
              </button>
            </div>
          </div>
        </details>

        <section className="workflow-workbench__prompt-panel">
          <div className="panel__header panel__header--tight">
            <div>
              <p className="metric-card__eyebrow">Natural language</p>
              <h3>Refine this workflow</h3>
            </div>
            <StatusPill tone={studio.isRefiningWorkflow ? 'warn' : 'good'}>
              {studio.isRefiningWorkflow ? 'Applying' : 'Ready'}
            </StatusPill>
          </div>

          <p className="workflow-workbench__prompt-copy">
            Describe the changes you want in plain language. The model will update the current graph, preserve usable editor state, and save the revised workflow.
          </p>

          <PromptComposer
            attachments={workflowAttachments}
            helperCopy="Attach specs, screenshots, PDFs, or code snippets so the workflow refinement uses the same supporting context you are working from."
            id="workflow-refine-prompt"
            label="Workflow changes"
            onAttachmentsChange={setWorkflowAttachments}
            onBlockingStateChange={setIsWorkflowPromptBlocked}
            onChange={setWorkflowInstructions}
            placeholder="Add an approval step before any filesystem write tasks, then send failing browser checks to a retry branch before the final fix step."
            selectedModelName={studio.selectedModelName}
            selectedModelSupportsImages={studio.selectedModelSupportsImages}
            value={workflowInstructions}
          />

          <div className="form-actions form-actions--inline">
            <button
              className="button"
              disabled={studio.isWorkflowOperationRunning || isWorkflowPromptBlocked || workflowInstructions.trim().length === 0}
              onClick={() => void handleRefineWorkflow()}
              type="button"
            >
              {studio.isRefiningWorkflow ? 'Applying changes...' : 'Apply with model'}
            </button>
          </div>

          {showRefineActivity ? (
            <OperationActivityPanel
              liveOutput={studio.workflowActivity.liveOutput}
              logs={studio.workflowActivity.logs}
              status={studio.workflowActivity.status}
              title="Workflow refinement activity"
            />
          ) : null}
        </section>
      </div>

      <div className="workflow-workbench__composer">
        <div className="workflow-workbench__controls">
          <p className="workflow-workbench__note">
            Use canvas mode for layout and selection. Run status is mirrored on the graph so you can see when a node is active,
            waiting for approval, or has failed.
          </p>
          <div className="segmented-control" role="tablist" aria-label="Workflow editor view">
            <button
              aria-selected={studio.studioView === 'canvas'}
              className={`segmented-control__button${studio.studioView === 'canvas' ? ' segmented-control__button--active' : ''}`}
              onClick={() => studio.handleStudioViewChange('canvas')}
              role="tab"
              type="button"
            >
              Canvas
            </button>
            <button
              aria-selected={studio.studioView === 'definition'}
              className={`segmented-control__button${studio.studioView === 'definition' ? ' segmented-control__button--active' : ''}`}
              onClick={() => studio.handleStudioViewChange('definition')}
              role="tab"
              type="button"
            >
              Definition
            </button>
          </div>
        </div>

        <div className="workflow-editor">
          <div className="workflow-editor__stage">
            <div className="workflow-editor__runbar">
              <div className="workflow-editor__runbar-main">
                <div className="workflow-editor__runbar-copy">
                  <div className="workflow-editor__runbar-heading">
                    <p className="metric-card__eyebrow">Run this workflow</p>
                    <StatusPill tone={executionTone}>
                      {studio.latestRun ? studio.latestRun.status : editorWorkflow.definition.startNodeId ? 'ready' : 'blocked'}
                    </StatusPill>
                  </div>
                  <h3>{executionTitle}</h3>
                  <p>{executionCopy}</p>
                </div>

                <div className="workflow-editor__runbar-actions">
                  <button
                    className="button"
                    disabled={!studio.canStartWorkflow || studio.startRunPending || studio.updatePending}
                    onClick={studio.handleStartSelectedWorkflowRun}
                    type="button"
                  >
                    {runPrimaryLabel}
                  </button>

                  {studio.latestRun ? (
                    <button className="button button--ghost" onClick={() => studio.handleOpenRun(studio.latestRun!.id)} type="button">
                      View run details
                    </button>
                  ) : null}

                  {stoppableRun ? (
                    <button
                      className="button button--danger"
                      disabled={studio.isRunActionPending || stoppableRun.status === 'canceling'}
                      onClick={() => studio.handleStopRun(stoppableRun.id)}
                      type="button"
                    >
                      {stoppableRun.status === 'canceling' ? 'Stopping...' : 'Stop run'}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="workflow-editor__runbar-meta">
                <span className="workflow-inline-chip">{runCountCopy} recorded</span>
                {studio.latestRun?.currentNodeId ? <span className="workflow-inline-chip">Current node: {latestRunNodeName}</span> : null}
                {studio.latestRun ? (
                  <span className="workflow-inline-chip">Updated {new Date(studio.latestRun.updatedAt).toLocaleTimeString()}</span>
                ) : null}
                {studio.isEditorDirty ? (
                  <span className="workflow-inline-chip workflow-inline-chip--warn">Current edits will be saved before this run starts</span>
                ) : null}
              </div>

              {studio.pendingApprovalRun ? (
                <div className="workflow-editor__context-panel workflow-editor__context-panel--approval">
                  <div>
                    <p className="metric-card__eyebrow">Needs decision</p>
                    <h4>{approvalTargetLabel} is waiting for approval</h4>
                    <p>
                      {waitingApprovalStep?.approval.prompt ??
                        'Approve the pending step to let this run continue, or reject it to stop the current run.'}
                    </p>
                  </div>

                  <div className="workflow-editor__context-actions">
                    <button
                      className="button"
                      disabled={studio.isRunActionPending}
                      onClick={() => studio.handleApproveRun(studio.pendingApprovalRun!.id)}
                      type="button"
                    >
                      Approve {approvalTargetLabel}
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={studio.isRunActionPending}
                      onClick={() => studio.handleRejectRun(studio.pendingApprovalRun!.id)}
                      type="button"
                    >
                      Reject current run
                    </button>
                  </div>
                </div>
              ) : null}

              {primaryWorkflowValidationIssue ? (
                <div className="workflow-editor__context-panel workflow-editor__context-panel--validation">
                  <div>
                    <p className="metric-card__eyebrow">Run blocked</p>
                    <h4>{primaryWorkflowValidationIssue.nodeName} needs configuration</h4>
                    <p>
                      {primaryWorkflowValidationIssue.message} {primaryWorkflowValidationIssue.recommendation}
                      {studio.workflowValidationIssues.length > 1
                        ? ` ${studio.workflowValidationIssues.length - 1} more issue${studio.workflowValidationIssues.length === 2 ? '' : 's'} still need attention.`
                        : ''}
                    </p>
                  </div>

                  <div className="workflow-editor__context-actions">
                    <button className="button" onClick={() => studio.handleSelectNode(primaryWorkflowValidationIssue.nodeId)} type="button">
                      Open blocking node
                    </button>
                  </div>
                </div>
              ) : null}

              {studio.latestRun?.status === 'failed' ? (
                <div className="workflow-editor__context-panel workflow-editor__context-panel--failure">
                  <div>
                    <p className="metric-card__eyebrow">Latest failure</p>
                    <h4>{failedStep?.nodeName ?? 'A workflow step'} failed</h4>
                    <p>
                      {failedNodeValidationIssue
                        ? `${failedNodeValidationIssue.message} ${failedNodeValidationIssue.recommendation}`
                        : failedStep?.errorMessage ?? studio.latestRun.errorMessage ?? 'Resume the current run or start a clean rerun.'}
                    </p>
                  </div>

                  <div className="workflow-editor__context-actions">
                    {failedStep ? (
                      <button className="button button--ghost" onClick={() => studio.handleSelectNode(failedStep.nodeId)} type="button">
                        Open failed node
                      </button>
                    ) : null}
                    <button
                      className="button"
                      disabled={studio.isRunActionPending}
                      onClick={() => studio.handleResumeRun(studio.latestRun!.id)}
                      type="button"
                    >
                      Resume failed run
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={studio.isRunActionPending}
                      onClick={() => studio.handleRerunRun(studio.latestRun!.id)}
                      type="button"
                    >
                      Start fresh rerun
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {studio.activeRun ? (
              <section className="workflow-editor__live-panel workflow-editor__live-panel--inspector">
                <div className="workflow-editor__live-panel-header">
                  <div>
                    <p className="metric-card__eyebrow">{stoppableRun ? 'Live execution' : 'Latest run detail'}</p>
                    <h4>{stoppableRun ? 'Inspect the run without leaving the editor' : 'Review the latest result in place'}</h4>
                    <p>
                      {stoppableRun
                        ? 'Follow every step, inspect current logs, and stop the run here if it is clearly stalled or no longer useful.'
                        : 'Inspect full logs and usable outputs from the latest selected run directly beside the canvas.'}
                    </p>
                  </div>
                  <StatusPill tone={toneForRun(studio.activeRun.status)}>{studio.activeRun.status}</StatusPill>
                </div>

                <WorkflowRunInspector onSelectNode={studio.handleSelectNode} run={studio.activeRun} />
              </section>
            ) : null}

            <div className="workflow-editor__toolbar">
              <div className="workflow-editor__toolbar-group">
                <Combobox
                  noResultsText="No tasks match this search."
                  onChange={studio.handleNewNodeTaskKeyChange}
                  options={taskOptions}
                  placeholder="Search task types"
                  value={studio.newNodeTaskKey}
                />
                <button className="button" disabled={!studio.canAddNode} onClick={studio.handleAddNode} type="button">
                  Add Node
                </button>
              </div>

              <div className="workflow-editor__toolbar-group">
                <Combobox
                  noResultsText="No source nodes found."
                  onChange={(nextValue) => studio.handleEdgeDraftChange({ sourceId: nextValue })}
                  options={sourceNodeOptions}
                  placeholder="Search source nodes"
                  value={studio.edgeDraft.sourceId}
                />
                <Combobox
                  noResultsText="No target nodes found."
                  onChange={(nextValue) => studio.handleEdgeDraftChange({ targetId: nextValue })}
                  options={targetNodeOptions}
                  placeholder="Search target nodes"
                  value={studio.edgeDraft.targetId}
                />
                <button className="button button--secondary" disabled={!studio.canAddEdge} onClick={studio.handleAddEdge} type="button">
                  Add Connection
                </button>
              </div>

              <div className="workflow-editor__toolbar-group">
                <Combobox
                  noResultsText="No nodes found."
                  onChange={studio.handleStartNodeChange}
                  options={startNodeOptions}
                  placeholder="Search start node"
                  value={editorWorkflow.definition.startNodeId ?? ''}
                />
              </div>
            </div>

            <div className="workflow-editor__viewport">
              {studio.studioView === 'canvas' ? (
                <WorkflowCanvas
                  definition={editorWorkflow.definition}
                  onMoveNode={studio.handleMoveNode}
                  onSelectNode={studio.handleSelectNode}
                  run={studio.activeRun}
                  selectedNodeId={studio.selectedNodeId}
                />
              ) : (
                <pre className="json-preview json-preview--full">{JSON.stringify(editorWorkflow.definition, null, 2)}</pre>
              )}
            </div>
          </div>

          <aside className="workflow-editor__sidebar">
            <WorkflowNodeInspector studio={studio} />
          </aside>
        </div>
      </div>
    </>
  ) : (
    <div className="empty-state">
      <h3>No workflow selected</h3>
      <p>Select a workflow from the library or create a new one to start editing its graph definition.</p>
    </div>
  );

  return (
    <>
      <section className="workflow-workbench">
        <div className="workflow-workbench__header">
          <div className="workflow-workbench__title">
            <p className="metric-card__eyebrow">Workflow editor</p>
            <h2>{editorWorkflow?.name || studio.selectedWorkflowSummary?.name || 'Choose a workflow'}</h2>
            <p className="subtle-copy">
              {editorWorkflow?.description ||
                studio.selectedWorkflowSummary?.description ||
                'Select a workflow from the catalog to begin editing.'}
            </p>
          </div>

          {editorWorkflow ? (
            <div className="workflow-workbench__actions">
              <StatusPill tone={studio.isEditorDirty ? 'warn' : 'good'}>
                {studio.isEditorDirty ? 'Unsaved changes' : 'All changes saved'}
              </StatusPill>
              <div className="toolbar-row toolbar-row--compact">
                <button className="button" disabled={!studio.canSaveWorkflow} onClick={studio.handleSaveWorkflow} type="button">
                  {studio.updatePending ? 'Saving...' : 'Save'}
                </button>
                <button className="button button--secondary" disabled={!studio.isEditorDirty} onClick={studio.handleResetWorkflow} type="button">
                  Reset
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {workflowContent}
      </section>
      {deleteModal}
    </>
  );
}