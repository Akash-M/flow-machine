import { KeyboardEvent, useEffect, useMemo, useState } from 'react';

import { WorkflowRunSummary } from '@flow-machine/shared-types';

import { WorkflowStudioModel } from '../../hooks/useFlowMachineApp';
import { PromptAttachmentDraft, toPromptAttachmentPayloads } from '../../lib/prompt-attachments';
import { Combobox } from '../Combobox';
import { OperationActivityPanel } from '../OperationActivityPanel';
import { PromptComposer } from '../PromptComposer';
import { StatusPill } from '../StatusPill';
import { TaskDraftReviewCard } from '../TaskDraftReviewCard';

interface WorkflowCatalogViewProps {
  studio: WorkflowStudioModel;
}

type WorkflowSortKey = 'name' | 'updated';

function toneForRun(status: WorkflowRunSummary['status'] | 'never'): 'good' | 'warn' | 'bad' {
  if (status === 'success') {
    return 'good';
  }

  if (status === 'queued' || status === 'running' || status === 'waiting-approval' || status === 'never') {
    return 'warn';
  }

  return 'bad';
}

export function WorkflowCatalogView({ studio }: WorkflowCatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<WorkflowSortKey>('updated');
  const [workflowPrompt, setWorkflowPrompt] = useState('');
  const [workflowAttachments, setWorkflowAttachments] = useState<PromptAttachmentDraft[]>([]);
  const [isWorkflowPromptBlocked, setIsWorkflowPromptBlocked] = useState(false);
  const [approveTaskDrafts, setApproveTaskDrafts] = useState(false);
  const [workflowDraftAttachments, setWorkflowDraftAttachments] = useState<PromptAttachmentDraft[]>([]);
  const [workflowDraftInstructions, setWorkflowDraftInstructions] = useState('');
  const [isWorkflowDraftPromptBlocked, setIsWorkflowDraftPromptBlocked] = useState(false);
  const sortOptions = useMemo(
    () => [
      { value: 'updated', label: 'Recently updated', description: 'Newest changes first' },
      { value: 'name', label: 'Name', description: 'Alphabetical order' }
    ],
    []
  );
  const showGenerationActivity =
    studio.workflowActivity.action === 'generate' &&
    (studio.workflowActivity.logs.length > 0 || studio.workflowActivity.liveOutput.length > 0);
  const showDraftRefineActivity =
    studio.workflowActivity.action === 'refine' &&
    (studio.workflowActivity.logs.length > 0 || studio.workflowActivity.liveOutput.length > 0);

  useEffect(() => {
    setApproveTaskDrafts(studio.workflowDraftProposal?.taskDrafts.length === 0);
    setWorkflowDraftAttachments([]);
    setWorkflowDraftInstructions('');
    setIsWorkflowDraftPromptBlocked(false);
  }, [studio.workflowDraftProposal]);

  const filteredAndSortedWorkflows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filtered = studio.workflows.filter((workflow) => {
      if (!normalizedQuery) {
        return true;
      }

      return (
        workflow.name.toLowerCase().includes(normalizedQuery) ||
        workflow.description.toLowerCase().includes(normalizedQuery) ||
        workflow.id.toLowerCase().includes(normalizedQuery) ||
        workflow.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      );
    });

    return filtered.sort((left, right) => {
      if (sortKey === 'name') {
        return left.name.localeCompare(right.name);
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [searchQuery, sortKey, studio.workflows]);

  async function handleGenerateWorkflow(): Promise<void> {
    try {
      await studio.handleGenerateWorkflow(workflowPrompt, toPromptAttachmentPayloads(workflowAttachments));
      setWorkflowAttachments([]);
    } catch {
      return;
    }
  }

  async function handleRefineWorkflowDraft(): Promise<void> {
    try {
      await studio.handleRefineWorkflowDraftProposal(
        workflowDraftInstructions,
        toPromptAttachmentPayloads(workflowDraftAttachments)
      );
      setWorkflowDraftAttachments([]);
      setWorkflowDraftInstructions('');
    } catch {
      return;
    }
  }

  async function handleApplyWorkflowDraft(): Promise<void> {
    try {
      await studio.handleApplyWorkflowDraft();
      setWorkflowPrompt('');
      setWorkflowAttachments([]);
    } catch {
      return;
    }
  }

  function handleOpenWorkflow(workflowId: string): void {
    studio.handleSelectWorkflow(workflowId);
  }

  function handleWorkflowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, workflowId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenWorkflow(workflowId);
    }
  }

  return (
    <section className="view-grid view-grid--catalog">
      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Create a new workflow</h2>
          <p>Describe the workflow you want, review the generated draft and any proposed new tasks, then create it when you are satisfied.</p>
        </div>

        <div className="form-grid">
          <div className="form-field form-field--full">
            <PromptComposer
              attachments={workflowAttachments}
              helperCopy="Attach docs, screenshots, PDFs, or source files so the generated workflow reflects the real context you want the model to use."
              id="workflow-catalog-prompt"
              label="Workflow prompt"
              onAttachmentsChange={setWorkflowAttachments}
              onBlockingStateChange={setIsWorkflowPromptBlocked}
              onChange={setWorkflowPrompt}
              placeholder="Create a repository triage workflow that inspects the git diff, runs browser checks for impacted pages, pauses before filesystem writes, and summarizes the proposed fix."
              selectedModelName={studio.selectedModelName}
              selectedModelSupportsImages={studio.selectedModelSupportsImages}
              value={workflowPrompt}
            />
          </div>
        </div>

        <div className="toolbar-row">
          <button
            className="button"
            disabled={studio.isWorkflowOperationRunning || isWorkflowPromptBlocked || workflowPrompt.trim().length === 0}
            onClick={() => void handleGenerateWorkflow()}
            type="button"
          >
            {studio.isGeneratingWorkflow
              ? 'Generating workflow...'
              : studio.isWorkflowOperationRunning
                ? 'Workflow operation in progress...'
                : 'Generate Workflow'}
          </button>
          <button className="button button--secondary" onClick={() => void studio.handleExportAll()} type="button">
            Export Bundle
          </button>
          <label className="button button--secondary file-trigger">
            Import JSON
            <input accept="application/json" onChange={(event) => void studio.handleImportChange(event)} type="file" />
          </label>
        </div>

        {showGenerationActivity ? (
          <OperationActivityPanel
            liveOutput={studio.workflowActivity.liveOutput}
            logs={studio.workflowActivity.logs}
            status={studio.workflowActivity.status}
            title="Workflow generation activity"
          />
        ) : null}

        {studio.workflowDraftProposal ? (
          <section className="draft-review-panel">
            <div className="draft-review-panel__header">
              <div>
                <p className="metric-card__eyebrow">Workflow Draft</p>
                <h3>{studio.workflowDraftProposal.workflow.name}</h3>
                <p>{studio.workflowDraftProposal.summary}</p>
              </div>
              <StatusPill tone={studio.workflowDraftProposal.taskDrafts.length > 0 ? 'warn' : 'good'}>
                {studio.workflowDraftProposal.taskDrafts.length > 0
                  ? `${studio.workflowDraftProposal.taskDrafts.length} new task${studio.workflowDraftProposal.taskDrafts.length === 1 ? '' : 's'} to approve`
                  : 'Uses existing tasks only'}
              </StatusPill>
            </div>

            <div className="draft-review-panel__chips">
              <span className="workflow-inline-chip">
                {studio.workflowDraftProposal.workflow.definition.nodes.length} node{studio.workflowDraftProposal.workflow.definition.nodes.length === 1 ? '' : 's'}
              </span>
              <span className="workflow-inline-chip">
                {studio.workflowDraftProposal.workflow.definition.edges.length} edge{studio.workflowDraftProposal.workflow.definition.edges.length === 1 ? '' : 's'}
              </span>
              {studio.workflowDraftProposal.reusedTaskKeys.map((taskKey) => (
                <span className="workflow-inline-chip workflow-inline-chip--muted" key={taskKey}>
                  Reuses {taskKey}
                </span>
              ))}
            </div>

            <section className="draft-review-panel__section">
              <h4>Workflow draft JSON</h4>
              <pre className="json-preview json-preview--compact">{JSON.stringify(studio.workflowDraftProposal.workflow, null, 2)}</pre>
            </section>

            <section className="draft-review-panel__section">
              <h4>Refine workflow draft</h4>
              <PromptComposer
                attachments={workflowDraftAttachments}
                helperCopy="Keep iterating on the draft before anything is created. Add more context files if the model needs them."
                label="Workflow draft changes"
                maxHeight={240}
                minRows={4}
                onAttachmentsChange={setWorkflowDraftAttachments}
                onBlockingStateChange={setIsWorkflowDraftPromptBlocked}
                onChange={setWorkflowDraftInstructions}
                placeholder="Reuse an existing task for the final summary, simplify the graph, or adjust how repository selection works."
                selectedModelName={studio.selectedModelName}
                selectedModelSupportsImages={studio.selectedModelSupportsImages}
                value={workflowDraftInstructions}
              />

              <div className="toolbar-row">
                <button
                  className="button button--secondary"
                  disabled={studio.isWorkflowOperationRunning || isWorkflowDraftPromptBlocked || workflowDraftInstructions.trim().length === 0}
                  onClick={() => void handleRefineWorkflowDraft()}
                  type="button"
                >
                  {studio.isRefiningWorkflow ? 'Refining workflow draft...' : 'Refine workflow draft'}
                </button>
                <button className="button button--ghost" onClick={studio.handleDiscardWorkflowDraft} type="button">
                  Discard draft
                </button>
              </div>

              {showDraftRefineActivity ? (
                <OperationActivityPanel
                  liveOutput={studio.workflowActivity.liveOutput}
                  logs={studio.workflowActivity.logs}
                  status={studio.workflowActivity.status}
                  title="Workflow draft refinement activity"
                />
              ) : null}
            </section>

            {studio.workflowDraftProposal.taskDrafts.length > 0 ? (
              <section className="draft-review-panel__section draft-review-panel__section--stacked">
                <div className="draft-review-panel__approval-copy">
                  <h4>Approve new tasks before creating the workflow</h4>
                  <p>
                    This workflow draft depends on new custom tasks. Review each one, refine them if needed, and then approve their creation alongside the workflow.
                  </p>
                </div>

                <label className="draft-review-panel__approval-toggle">
                  <input checked={approveTaskDrafts} onChange={(event) => setApproveTaskDrafts(event.target.checked)} type="checkbox" />
                  <span>
                    I approve creating {studio.workflowDraftProposal.taskDrafts.length} new task{studio.workflowDraftProposal.taskDrafts.length === 1 ? '' : 's'} in the catalog as part of this workflow.
                  </span>
                </label>

                <div className="draft-review-panel__task-list">
                  {studio.workflowDraftProposal.taskDrafts.map((taskDraft) => (
                    <TaskDraftReviewCard
                      activity={studio.taskActivity}
                      draft={taskDraft}
                      key={taskDraft.key}
                      onRefine={(instructions, attachments) => studio.handleRefineWorkflowTaskDraft(taskDraft.key, instructions, attachments)}
                      refineActionLabel="Refine proposed task"
                      selectedModelName={studio.selectedModelName}
                      selectedModelSupportsImages={studio.selectedModelSupportsImages}
                      title={`Review proposed task: ${taskDraft.name}`}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <div className="toolbar-row">
              <button
                className="button"
                disabled={
                  studio.isApplyingWorkflowDraft ||
                  studio.isTaskOperationRunning ||
                  studio.isWorkflowOperationRunning ||
                  (studio.workflowDraftProposal.taskDrafts.length > 0 && !approveTaskDrafts)
                }
                onClick={() => void handleApplyWorkflowDraft()}
                type="button"
              >
                {studio.isApplyingWorkflowDraft
                  ? 'Creating workflow...'
                  : studio.workflowDraftProposal.taskDrafts.length > 0
                    ? 'Approve tasks and create workflow'
                    : 'Create workflow'}
              </button>
            </div>
          </section>
        ) : null}

        <details className="workflow-library__drawer workflow-catalog__manual-drawer">
          <summary>Create manually</summary>

          <div className="workflow-library__drawer-content">
            <form className="workflow-library__composer form-grid form-grid--single" onSubmit={studio.handleCreateSubmit}>
              <div className="form-field">
                <label htmlFor="workflow-name">Workflow name</label>
                <input
                  className="input"
                  id="workflow-name"
                  onChange={(event) => studio.handleCreateFormChange('name', event.target.value)}
                  placeholder="New workflow"
                  required
                  value={studio.createForm.name}
                />
              </div>
              <div className="form-field">
                <label htmlFor="workflow-description">Description</label>
                <textarea
                  className="textarea"
                  id="workflow-description"
                  onChange={(event) => studio.handleCreateFormChange('description', event.target.value)}
                  placeholder="What should this workflow do?"
                  rows={2}
                  value={studio.createForm.description}
                />
              </div>
              <div className="form-field">
                <label htmlFor="workflow-tags">Tags</label>
                <input
                  className="input"
                  id="workflow-tags"
                  onChange={(event) => studio.handleCreateFormChange('tags', event.target.value)}
                  placeholder="git, local-first, approval"
                  value={studio.createForm.tags}
                />
              </div>
              <div className="form-actions">
                <button className="button" disabled={studio.createPending} type="submit">
                  {studio.createPending ? 'Creating...' : 'Create Workflow'}
                </button>
              </div>
            </form>
          </div>
        </details>
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Existing workflows</h2>
          <p>Open any saved workflow in the editor from the table below.</p>
        </div>

        <div className="toolbar-row">
          <input
            className="input"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search workflows by name, description, id, or tag..."
            type="text"
            value={searchQuery}
          />
          <div className="workflow-catalog__sort">
            <Combobox
              noResultsText="No sort options found."
              onChange={(nextValue) => setSortKey(nextValue as WorkflowSortKey)}
              options={sortOptions}
              placeholder="Sort workflows"
              value={sortKey}
            />
          </div>
        </div>

        <div className="table-container">
          <table className="tasks-table workflows-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Tags</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedWorkflows.map((workflow) => (
                <tr
                  className="tasks-table__row"
                  key={workflow.id}
                  onClick={() => handleOpenWorkflow(workflow.id)}
                  onKeyDown={(event) => handleWorkflowKeyDown(event, workflow.id)}
                  role="button"
                  tabIndex={0}
                >
                  <td className="task-name workflow-name-cell">
                    <strong>{workflow.name}</strong>
                    <span className="task-key">{workflow.id}</span>
                  </td>
                  <td>
                    <StatusPill tone={toneForRun(workflow.lastRunState)}>{workflow.lastRunState}</StatusPill>
                  </td>
                  <td>{new Date(workflow.updatedAt).toLocaleString()}</td>
                  <td>
                    <div className="tag-row">
                      {workflow.tags.length === 0 ? <span className="tag">untagged</span> : null}
                      {workflow.tags.map((tag) => (
                        <span className="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="task-actions">
                    <button
                      aria-label={`Open ${workflow.name}`}
                      className="icon-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenWorkflow(workflow.id);
                      }}
                      title="Open workflow"
                      type="button"
                    >
                      →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredAndSortedWorkflows.length === 0 ? (
          <div className="empty-state">
            <h3>{studio.workflows.length === 0 ? 'No workflows yet' : 'No workflows found'}</h3>
            <p>
              {studio.workflows.length === 0
                ? 'Create the first workflow from the section above.'
                : 'Try adjusting your search query or sort order.'}
            </p>
          </div>
        ) : null}
      </section>
    </section>
  );
}
