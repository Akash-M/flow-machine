import { WorkflowRunSummary } from '@flow-machine/shared-types';

import { RunsViewModel } from '../../hooks/useFlowMachineApp';
import { StatusPill } from '../StatusPill';
import { WorkflowRunInspector } from '../WorkflowRunInspector';

interface RunsViewProps {
  runsModel: RunsViewModel;
}

function toneForRun(status: WorkflowRunSummary['status']): 'good' | 'warn' | 'bad' {
  if (status === 'success') {
    return 'good';
  }

  if (status === 'waiting-approval' || status === 'queued' || status === 'running' || status === 'canceling') {
    return 'warn';
  }

  return 'bad';
}

function canStopRun(status: WorkflowRunSummary['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting-approval' || status === 'canceling';
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
                      <td>{new Date(run.startedAt).toLocaleString()}</td>
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
                {canStopRun(runsModel.selectedRun.status) ? (
                  <button
                    className="button button--danger"
                    disabled={runsModel.isActionPending || runsModel.selectedRun.status === 'canceling'}
                    onClick={runsModel.handleStopSelectedRun}
                    type="button"
                  >
                    {runsModel.selectedRun.status === 'canceling' ? 'Stopping...' : 'Stop run'}
                  </button>
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
            <WorkflowRunInspector run={runsModel.selectedRun} />
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