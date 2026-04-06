import { useEffect, useState } from 'react';

import { WorkflowRun, WorkflowRunSummary, WorkflowStepRun } from '@flow-machine/shared-types';

import { RunsViewModel } from '../../hooks/useFlowMachineApp';
import { StatusPill } from '../StatusPill';

interface RunsViewProps {
  runsModel: RunsViewModel;
}

function toneForRun(status: WorkflowRunSummary['status']): 'good' | 'warn' | 'bad' {
  if (status === 'success') {
    return 'good';
  }

  if (status === 'waiting-approval' || status === 'queued' || status === 'running') {
    return 'warn';
  }

  return 'bad';
}

function toneForStep(status: WorkflowStepRun['state']): 'good' | 'warn' | 'bad' {
  if (status === 'success' || status === 'skipped') {
    return 'good';
  }

  if (status === 'running' || status === 'pending' || status === 'waiting-approval') {
    return 'warn';
  }

  return 'bad';
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'No data.';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

function formatDuration(value: number | null): string {
  return value !== null ? `${value} ms` : 'pending';
}

function RunDetail({ run }: { run: WorkflowRun }) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(run.steps[0]?.nodeId ?? null);

  useEffect(() => {
    if (run.steps.length === 0) {
      setSelectedStepId(null);
      return;
    }

    if (!selectedStepId || !run.steps.some((step) => step.nodeId === selectedStepId)) {
      setSelectedStepId(run.steps[0].nodeId);
    }
  }, [run.steps, selectedStepId]);

  const selectedStep = run.steps.find((step) => step.nodeId === selectedStepId) ?? null;

  return (
    <div className="run-detail">
      <div className="table-container table-container--dense">
        <table className="data-table data-table--summary">
          <tbody>
            <tr>
              <th scope="row">Status</th>
              <td>
                <StatusPill tone={toneForRun(run.status)}>{run.status}</StatusPill>
              </td>
            </tr>
            <tr>
              <th scope="row">Workflow</th>
              <td>{run.workflowName}</td>
            </tr>
            <tr>
              <th scope="row">Started</th>
              <td>{formatDateTime(run.startedAt)}</td>
            </tr>
            <tr>
              <th scope="row">Finished</th>
              <td>{formatDateTime(run.finishedAt)}</td>
            </tr>
            <tr>
              <th scope="row">Steps</th>
              <td>{run.steps.length}</td>
            </tr>
            <tr>
              <th scope="row">Current node</th>
              <td>{run.currentNodeId ?? 'Completed'}</td>
            </tr>
            {run.context.repository ? (
              <>
                <tr>
                  <th scope="row">Repository</th>
                  <td>{run.context.repository.name}</td>
                </tr>
                <tr>
                  <th scope="row">Repository path</th>
                  <td className="data-table__mono">{run.context.repository.hostPath}</td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>
      </div>

      {run.errorMessage ? <p className="error-copy">{run.errorMessage}</p> : null}

      {run.steps.length === 0 ? (
        <div className="empty-state">
          <h3>No steps yet</h3>
          <p>The run has been queued, but no node output has been recorded yet.</p>
        </div>
      ) : (
        <>
          <section className="run-detail__section">
            <div className="panel__header panel__header--tight">
              <div>
                <h3>Step timeline</h3>
                <p>Select a step to inspect its input, output, logs, and network activity.</p>
              </div>
            </div>

            <div className="table-container table-container--dense">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>State</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Approval</th>
                    <th>Network</th>
                  </tr>
                </thead>
                <tbody>
                  {run.steps.map((step) => {
                    const isSelected = step.nodeId === selectedStepId;

                    return (
                      <tr
                        className={`data-table__row${isSelected ? ' data-table__row--selected' : ''} data-table__row--interactive`}
                        key={step.nodeId}
                        onClick={() => setSelectedStepId(step.nodeId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedStepId(step.nodeId);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td className="data-table__name-cell">
                          <strong>{step.nodeName}</strong>
                          <span className="data-table__subtle">{step.taskKey}</span>
                        </td>
                        <td>
                          <StatusPill tone={toneForStep(step.state)}>{step.state}</StatusPill>
                        </td>
                        <td>{formatDateTime(step.startedAt)}</td>
                        <td>{formatDuration(step.durationMs)}</td>
                        <td>{step.approval.state}</td>
                        <td>{step.network.length > 0 ? `${step.network.length} call${step.network.length === 1 ? '' : 's'}` : 'None'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedStep ? (
            <section className="run-detail__section">
              <div className="panel__header panel__header--tight">
                <div>
                  <h3>Selected step detail</h3>
                  <p>{selectedStep.nodeName}</p>
                </div>
                <StatusPill tone={toneForStep(selectedStep.state)}>{selectedStep.state}</StatusPill>
              </div>

              <div className="table-container table-container--dense">
                <table className="data-table data-table--summary">
                  <tbody>
                    <tr>
                      <th scope="row">Task key</th>
                      <td className="data-table__mono">{selectedStep.taskKey}</td>
                    </tr>
                    <tr>
                      <th scope="row">Started</th>
                      <td>{formatDateTime(selectedStep.startedAt)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Finished</th>
                      <td>{formatDateTime(selectedStep.finishedAt)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Duration</th>
                      <td>{formatDuration(selectedStep.durationMs)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Approval</th>
                      <td>{selectedStep.approval.state}</td>
                    </tr>
                    <tr>
                      <th scope="row">Network activity</th>
                      <td>{selectedStep.network.length > 0 ? `${selectedStep.network.length} call${selectedStep.network.length === 1 ? '' : 's'}` : 'None recorded'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {selectedStep.errorMessage ? <p className="error-copy">{selectedStep.errorMessage}</p> : null}

              <div className="run-detail__json-grid">
                <div>
                  <p className="metric-card__eyebrow">Input</p>
                  <pre className="json-preview json-preview--compact">{formatJson(selectedStep.input)}</pre>
                </div>
                <div>
                  <p className="metric-card__eyebrow">Output</p>
                  <pre className="json-preview json-preview--compact">{formatJson(selectedStep.output)}</pre>
                </div>
              </div>

              {selectedStep.network.length > 0 ? (
                <div className="table-container table-container--dense">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th>Target</th>
                        <th>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStep.network.map((entry) => (
                        <tr key={`${selectedStep.nodeId}-${entry.kind}-${entry.target}`}>
                          <td>{entry.kind}</td>
                          <td className="data-table__mono">{entry.target}</td>
                          <td>{entry.method ?? '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {selectedStep.logs.length > 0 ? (
                <div className="table-container table-container--dense">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStep.logs.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.level}</td>
                          <td>{entry.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function RunsView({ runsModel }: RunsViewProps) {
  return (
    <section className="view-grid">
      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Run summary</h2>
          <p>Track workflow execution volume, active work, and approval pressure without wasting vertical space.</p>
        </div>

        <div className="table-container table-container--dense">
          <table className="data-table data-table--summary">
            <tbody>
              <tr>
                <th scope="row">Total runs</th>
                <td>{runsModel.runs.length}</td>
              </tr>
              <tr>
                <th scope="row">Active runs</th>
                <td>{runsModel.activeRunCount}</td>
              </tr>
              <tr>
                <th scope="row">Waiting approval</th>
                <td>{runsModel.waitingApprovalCount}</td>
              </tr>
              <tr>
                <th scope="row">Completed</th>
                <td>{runsModel.completedRunCount}</td>
              </tr>
              <tr>
                <th scope="row">Selected workflow</th>
                <td>{runsModel.selectedWorkflowName}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="split-dashboard">
        <aside className="panel split-dashboard__sidebar">
          <div className="panel__header panel__header--tight">
            <div>
              <h2>Recent runs</h2>
              <p>Start a run from the selected workflow or inspect an existing execution.</p>
            </div>
            <button className="button" disabled={!runsModel.canStartSelectedWorkflow || runsModel.isStartingRun} onClick={runsModel.handleStartSelectedWorkflowRun} type="button">
              {runsModel.isStartingRun ? 'Starting...' : `Run ${runsModel.selectedWorkflowName}`}
            </button>
          </div>

          {runsModel.runs.length === 0 ? (
            <div className="empty-state">
              <h3>No runs yet</h3>
              <p>Start a workflow to record step output, logs, and approval history.</p>
            </div>
          ) : (
            <div className="table-container table-container--dense">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {runsModel.runs.map((run) => (
                    <tr
                      className={`data-table__row${run.id === runsModel.selectedRunId ? ' data-table__row--selected' : ''} data-table__row--interactive`}
                      key={run.id}
                      onClick={() => runsModel.handleOpenRun(run.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          runsModel.handleOpenRun(run.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td className="data-table__name-cell">
                        <strong>{run.workflowName}</strong>
                        <span className="data-table__subtle">{run.id}</span>
                      </td>
                      <td>
                        <StatusPill tone={toneForRun(run.status)}>{run.status}</StatusPill>
                      </td>
                      <td>{formatDateTime(run.startedAt)}</td>
                      <td>{run.stepCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>

        <section className="panel split-dashboard__detail">
          <div className="panel__header panel__header--tight">
            <div>
              <h2>Run detail</h2>
              <p>Inspect step-by-step execution state, outputs, network activity, and approval pauses.</p>
            </div>

            {runsModel.selectedRun ? (
              <div className="toolbar-row toolbar-row--compact">
                {runsModel.selectedRun.status === 'waiting-approval' ? (
                  <>
                    <button className="button" disabled={runsModel.isActionPending} onClick={runsModel.handleApproveSelectedRun} type="button">
                      Approve
                    </button>
                    <button className="button button--secondary" disabled={runsModel.isActionPending} onClick={runsModel.handleRejectSelectedRun} type="button">
                      Reject
                    </button>
                  </>
                ) : null}
                {runsModel.selectedRun.status === 'failed' ? (
                  <button className="button" disabled={runsModel.isActionPending} onClick={runsModel.handleResumeSelectedRun} type="button">
                    Resume
                  </button>
                ) : null}
                <button className="button button--secondary" disabled={runsModel.isActionPending} onClick={runsModel.handleRerunSelectedRun} type="button">
                  Rerun
                </button>
              </div>
            ) : null}
          </div>

          {runsModel.detailState.isLoading && !runsModel.selectedRun ? (
            <div className="empty-state">
              <h3>Loading run</h3>
              <p>Fetching step output and lifecycle detail.</p>
            </div>
          ) : runsModel.detailState.isError && !runsModel.selectedRun ? (
            <div className="empty-state">
              <h3>Run unavailable</h3>
              <p>{runsModel.detailState.errorMessage ?? 'Unknown error.'}</p>
            </div>
          ) : runsModel.selectedRun ? (
            <RunDetail run={runsModel.selectedRun} />
          ) : (
            <div className="empty-state">
              <h3>No run selected</h3>
              <p>Choose a run from the left to inspect its step timeline.</p>
            </div>
          )}
        </section>
      </section>
    </section>
  );
}