import { useState } from 'react';

import { WorkflowStudioModel } from '../../hooks/useFlowMachineApp';
import { StatusPill } from '../StatusPill';

interface WorkflowLibraryPanelProps {
  studio: WorkflowStudioModel;
}

export function WorkflowLibraryPanel({ studio }: WorkflowLibraryPanelProps) {
  const [workflowPrompt, setWorkflowPrompt] = useState('');
  const showGenerationActivity =
    studio.workflowActivity.action === 'generate' &&
    (studio.workflowActivity.logs.length > 0 || studio.workflowActivity.liveOutput.length > 0);

  async function handleGenerateWorkflow(): Promise<void> {
    try {
      await studio.handleGenerateWorkflow(workflowPrompt);
      setWorkflowPrompt('');
    } catch {
      return;
    }
  }

  function renderWorkflowActivityPanel(title: string) {
    return (
      <section aria-live="polite" className="task-activity-panel">
        <div className="task-activity-panel__header">
          <h3>{title}</h3>
          <span className={`task-activity-panel__status task-activity-panel__status--${studio.workflowActivity.status}`}>
            {studio.workflowActivity.status === 'running'
              ? 'Streaming'
              : studio.workflowActivity.status === 'success'
                ? 'Complete'
                : studio.workflowActivity.status === 'error'
                  ? 'Failed'
                  : 'Idle'}
          </span>
        </div>

        <ul className="task-activity-log">
          {studio.workflowActivity.logs.map((entry) => (
            <li className={`task-activity-log__item task-activity-log__item--${entry.level}`} key={entry.id}>
              {entry.message}
            </li>
          ))}
        </ul>

        {studio.workflowActivity.liveOutput ? (
          <div className="task-activity-stream">
            <p className="subtle-copy">Live model output</p>
            <pre className="json-preview json-preview--compact task-activity-stream__preview">{studio.workflowActivity.liveOutput}</pre>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <aside className="workflow-library">
      <div className="workflow-library__controls">
        <div className="workflow-library__top">
          <div>
            <p className="metric-card__eyebrow">Workflow library</p>
            <h2>Choose a graph</h2>
            <p className="workflow-library__intro">Keep the editor focused on the canvas. Create or import workflows only when you need to.</p>
          </div>
          <StatusPill tone={studio.workflows.length > 0 ? 'good' : 'warn'}>
            {studio.workflows.length} workflow{studio.workflows.length === 1 ? '' : 's'}
          </StatusPill>
        </div>

        <details className="workflow-library__drawer" open={studio.workflows.length === 0}>
          <summary>Create, import, or export</summary>

          <div className="workflow-library__drawer-content">
            <div className="workflow-library__toolbar toolbar-row toolbar-row--compact">
              <button className="button button--secondary" onClick={() => void studio.handleExportAll()} type="button">
                Export Bundle
              </button>
              <label className="button button--secondary file-trigger">
                Import JSON
                <input accept="application/json" onChange={(event) => void studio.handleImportChange(event)} type="file" />
              </label>
            </div>

            <section className="workflow-library__prompt-panel">
              <div className="panel__header panel__header--tight">
                <div>
                  <p className="metric-card__eyebrow">Natural language</p>
                  <h3>Create from a prompt</h3>
                </div>
                <StatusPill tone={studio.isGeneratingWorkflow ? 'warn' : 'good'}>
                  {studio.isGeneratingWorkflow ? 'Generating' : 'Ready'}
                </StatusPill>
              </div>

              <p className="workflow-library__prompt-copy">
                Describe the workflow you want, including steps, approvals, and repositories. The model will draft the graph and save it into the library.
              </p>

              <div className="form-field form-field--full">
                <label htmlFor="workflow-prompt">Workflow prompt</label>
                <textarea
                  className="textarea"
                  id="workflow-prompt"
                  onChange={(event) => setWorkflowPrompt(event.target.value)}
                  placeholder="Create a repository triage workflow that scans a repo, opens browser-based checks for failing pages, and pauses for approval before writing fixes."
                  rows={5}
                  value={workflowPrompt}
                />
              </div>

              <div className="form-actions form-actions--inline">
                <button
                  className="button"
                  disabled={studio.isWorkflowOperationRunning || workflowPrompt.trim().length === 0}
                  onClick={() => void handleGenerateWorkflow()}
                  type="button"
                >
                  {studio.isGeneratingWorkflow ? 'Generating...' : 'Generate Workflow'}
                </button>
              </div>

              {showGenerationActivity ? renderWorkflowActivityPanel('Workflow generation activity') : null}
            </section>

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
      </div>

      <div className="workflow-library__browser">
        <div className="workflow-library__list-header">
          <div>
            <p className="metric-card__eyebrow">Saved workflows</p>
            <h3>{studio.selectedWorkflowSummary ? 'Switch active graph' : 'Choose a graph to edit'}</h3>
          </div>
          <span>{studio.workflows.length}</span>
        </div>

        <div className="workflow-library__list">
          {studio.workflows.length === 0 ? (
            <div className="empty-state">
              <h3>No workflows yet</h3>
              <p>Create the first workflow from the controls above.</p>
            </div>
          ) : (
            studio.workflows.map((workflow) => (
              <button
                className={`workflow-list__button${workflow.id === studio.selectedWorkflowId ? ' workflow-list__button--active' : ''}`}
                key={workflow.id}
                onClick={() => studio.handleSelectWorkflow(workflow.id)}
                type="button"
              >
                <div className="workflow-list__meta">
                  <div className="workflow-list__body">
                    <h3>{workflow.name}</h3>
                    <p>{workflow.description || 'No description yet.'}</p>
                  </div>
                  <span>{workflow.lastRunState}</span>
                </div>
                {workflow.tags.length > 0 ? (
                  <div className="tag-row">
                    {workflow.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}