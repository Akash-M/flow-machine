import { ApprovalsViewModel } from '../../hooks/useFlowMachineApp';
import { StatusPill } from '../StatusPill';

interface ApprovalsViewProps {
  approvals: ApprovalsViewModel;
}

export function ApprovalsView({ approvals }: ApprovalsViewProps) {
  const autoApprovalTasks = approvals.tasks.filter((task) => task.requiresApprovalByDefault && task.key !== 'approval');
  const manualApprovalTasks = Math.max(autoApprovalTasks.length - approvals.rules.globalDefaults.length, 0);

  return (
    <section className="view-grid">
      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Approval summary</h2>
          <p>Review queue pressure and default approval rules in a compact operational view.</p>
        </div>

        <div className="table-container table-container--dense">
          <table className="data-table data-table--summary">
            <tbody>
              <tr>
                <th scope="row">Pending runs</th>
                <td>{approvals.pendingRuns.length}</td>
              </tr>
              <tr>
                <th scope="row">Auto-approved tasks</th>
                <td>{approvals.rules.globalDefaults.length}</td>
              </tr>
              <tr>
                <th scope="row">Manual tasks</th>
                <td>{manualApprovalTasks}</td>
              </tr>
              <tr>
                <th scope="row">Approval-capable tasks</th>
                <td>{autoApprovalTasks.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Pending decisions</h2>
          <p>These runs are paused until you approve or reject the current node.</p>
        </div>

        {approvals.pendingRuns.length === 0 ? (
          <div className="empty-state">
            <h3>No pending approvals</h3>
            <p>New approval pauses will appear here as workflow runs reach guarded steps.</p>
          </div>
        ) : (
          <div className="table-container table-container--dense">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Paused at</th>
                  <th>Started</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {approvals.pendingRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="data-table__name-cell">
                      <strong>{run.workflowName}</strong>
                      <span className="data-table__subtle">{run.id}</span>
                    </td>
                    <td>
                      <StatusPill tone="warn">waiting-approval</StatusPill>
                    </td>
                    <td>{run.currentNodeId ?? 'Approval boundary'}</td>
                    <td>{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="data-table__actions">
                      <button className="button" onClick={() => approvals.handleOpenRun(run.id)} type="button">
                        Open Run
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Default auto-approvals</h2>
          <p>Use this to silence repeated prompts for trusted task types. Explicit approval nodes always stay manual.</p>
        </div>

        {autoApprovalTasks.length > 0 ? (
          <div className="table-container table-container--dense">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Description</th>
                  <th>Mode</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {autoApprovalTasks.map((task) => {
                  const enabled = approvals.rules.globalDefaults.includes(task.key);

                  return (
                    <tr key={task.key}>
                      <td className="data-table__name-cell">
                        <strong>{task.name}</strong>
                        <span className="data-table__subtle">{task.key}</span>
                      </td>
                      <td>{task.description}</td>
                      <td>
                        <StatusPill tone={enabled ? 'good' : 'warn'}>{enabled ? 'auto-approved' : 'manual'}</StatusPill>
                      </td>
                      <td className="data-table__actions">
                        <button className={`button${enabled ? ' button--secondary' : ''}`} disabled={approvals.isSavingRules} onClick={() => approvals.handleToggleAutoApproval(task.key)} type="button">
                          {enabled ? 'Require approval' : 'Auto-approve'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No approval-capable tasks</h3>
            <p>Tasks that support default approval tuning will appear here once they are available in the catalog.</p>
          </div>
        )}
      </section>
    </section>
  );
}