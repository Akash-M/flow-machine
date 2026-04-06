import { useEffect, useState } from 'react';

import { WorkflowRun, WorkflowRunSummary, WorkflowStepLogEntry, WorkflowStepRun } from '@flow-machine/shared-types';

import { StatusPill } from './StatusPill';

interface WorkflowRunInspectorProps {
  run: WorkflowRun;
  onSelectNode?: (nodeId: string) => void;
}

interface ExtractedTextOutput {
  label: string;
  value: string;
}

interface SearchMatch {
  line: string;
  lineNumber: number;
  path: string;
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

function toneForStep(status: WorkflowStepRun['state']): 'good' | 'warn' | 'bad' {
  if (status === 'success' || status === 'skipped') {
    return 'good';
  }

  if (status === 'running' || status === 'pending' || status === 'waiting-approval') {
    return 'warn';
  }

  return 'bad';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function resolvePreferredStepId(run: WorkflowRun): string | null {
  return (
    (run.currentNodeId ? run.steps.find((step) => step.nodeId === run.currentNodeId)?.nodeId : null) ??
    run.steps.find((step) => step.state === 'running' || step.state === 'waiting-approval' || step.state === 'failed' || step.state === 'canceled')
      ?.nodeId ??
    run.steps[0]?.nodeId ??
    null
  );
}

function extractPreferredTextOutput(value: unknown): ExtractedTextOutput | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return {
      label: 'Text output',
      value
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const candidates: Array<[keyof typeof value, string]> = [
    ['response', 'Generated response'],
    ['rendered', 'Rendered output'],
    ['content', 'File content'],
    ['stdout', 'Command stdout'],
    ['stderr', 'Command stderr'],
    ['body', 'Response body'],
    ['text', 'Captured text']
  ];

  for (const [key, label] of candidates) {
    const candidate = value[key];

    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return {
        label,
        value: candidate
      };
    }
  }

  return null;
}

function extractSearchMatches(value: unknown): SearchMatch[] | null {
  if (!isRecord(value) || !Array.isArray(value.matches)) {
    return null;
  }

  const matches = value.matches.filter(
    (entry): entry is SearchMatch =>
      isRecord(entry) && typeof entry.path === 'string' && typeof entry.lineNumber === 'number' && typeof entry.line === 'string'
  );

  return matches.length > 0 ? matches : null;
}

function CopyValueButton({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setState('idle');
    }, 1_600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('error');
    }
  }

  return (
    <button className="button button--secondary" onClick={() => void handleCopy()} type="button">
      {state === 'copied' ? `${label} copied` : state === 'error' ? 'Copy failed' : label}
    </button>
  );
}

function renderLogMessage(entry: WorkflowStepLogEntry): JSX.Element {
  return (
    <td>
      <div>{entry.message}</div>
      {entry.data !== undefined ? <pre className="json-preview json-preview--compact run-log-data">{formatJson(entry.data)}</pre> : null}
    </td>
  );
}

export function WorkflowRunInspector({ run, onSelectNode }: WorkflowRunInspectorProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(resolvePreferredStepId(run));

  useEffect(() => {
    if (run.steps.length === 0) {
      setSelectedStepId(null);
      return;
    }

    const preferredStepId = resolvePreferredStepId(run);
    const currentStep = selectedStepId ? run.steps.find((step) => step.nodeId === selectedStepId) ?? null : null;
    const currentStepIsTerminal = currentStep
      ? currentStep.state === 'success' || currentStep.state === 'skipped' || currentStep.state === 'failed' || currentStep.state === 'canceled'
      : false;

    if (
      !selectedStepId ||
      !run.steps.some((step) => step.nodeId === selectedStepId) ||
      (preferredStepId && preferredStepId !== selectedStepId && currentStepIsTerminal)
    ) {
      setSelectedStepId(preferredStepId);
    }
  }, [run, selectedStepId]);

  const selectedStep = run.steps.find((step) => step.nodeId === selectedStepId) ?? null;
  const preferredTextOutput = selectedStep ? extractPreferredTextOutput(selectedStep.output) : null;
  const searchMatches = selectedStep ? extractSearchMatches(selectedStep.output) : null;

  return (
    <div className="run-detail run-detail--embedded">
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
                <p>Select a step to inspect its progress logs, inputs, outputs, and network activity.</p>
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
                    <th>Logs</th>
                  </tr>
                </thead>
                <tbody>
                  {run.steps.map((step) => {
                    const isSelected = step.nodeId === selectedStepId;

                    return (
                      <tr
                        className={`data-table__row${isSelected ? ' data-table__row--selected' : ''} data-table__row--interactive`}
                        key={step.nodeId}
                        onClick={() => {
                          setSelectedStepId(step.nodeId);
                          onSelectNode?.(step.nodeId);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedStepId(step.nodeId);
                            onSelectNode?.(step.nodeId);
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
                        <td>{step.logs.length}</td>
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
                <div className="toolbar-row toolbar-row--compact">
                  {onSelectNode ? (
                    <button className="button button--ghost" onClick={() => onSelectNode(selectedStep.nodeId)} type="button">
                      Focus node on canvas
                    </button>
                  ) : null}
                  <StatusPill tone={toneForStep(selectedStep.state)}>{selectedStep.state}</StatusPill>
                </div>
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

              {preferredTextOutput ? (
                <div className="run-detail__result-card">
                  <div className="run-detail__result-card-header">
                    <div>
                      <p className="metric-card__eyebrow">{preferredTextOutput.label}</p>
                      <h4>Copyable result</h4>
                    </div>
                    <CopyValueButton label="Copy result" value={preferredTextOutput.value} />
                  </div>

                  <pre className="json-preview run-detail__text-output">{preferredTextOutput.value}</pre>
                </div>
              ) : null}

              {searchMatches ? (
                <div className="run-detail__result-card">
                  <div className="run-detail__result-card-header">
                    <div>
                      <p className="metric-card__eyebrow">Repository matches</p>
                      <h4>{searchMatches.length} matching line{searchMatches.length === 1 ? '' : 's'}</h4>
                    </div>
                    <CopyValueButton
                      label="Copy matches"
                      value={searchMatches.map((match) => `${match.path}:${match.lineNumber} ${match.line}`).join('\n')}
                    />
                  </div>

                  <div className="table-container table-container--dense">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Path</th>
                          <th>Line</th>
                          <th>Snippet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchMatches.map((match) => (
                          <tr key={`${match.path}:${match.lineNumber}:${match.line}`}>
                            <td className="data-table__mono">{match.path}</td>
                            <td>{match.lineNumber}</td>
                            <td>{match.line}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <div className="run-detail__json-grid">
                <div>
                  <p className="metric-card__eyebrow">Input</p>
                  <pre className="json-preview json-preview--compact">{formatJson(selectedStep.input)}</pre>
                </div>
                <div>
                  <p className="metric-card__eyebrow">{preferredTextOutput ? 'Raw output' : 'Output'}</p>
                  <pre className="json-preview json-preview--compact">{formatJson(selectedStep.output)}</pre>
                </div>
              </div>

              {selectedStep.logs.length > 0 ? (
                <div className="table-container table-container--dense">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Time</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStep.logs.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.level}</td>
                          <td>{formatDateTime(entry.at)}</td>
                          {renderLogMessage(entry)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="helper-copy">This step has not emitted any logs yet.</p>
              )}

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
                        <tr key={`${selectedStep.nodeId}-${entry.kind}-${entry.target}-${entry.method ?? 'none'}`}>
                          <td>{entry.kind}</td>
                          <td className="data-table__mono">{entry.target}</td>
                          <td>{entry.method ?? '--'}</td>
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