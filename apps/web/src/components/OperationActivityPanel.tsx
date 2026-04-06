import { useEffect, useMemo, useState } from 'react';

import type { TaskActivityLogEntry } from '../hooks/useFlowMachineApp';

type ActivityStatus = 'error' | 'idle' | 'running' | 'success';

interface OperationActivityPanelProps {
  liveOutput?: string;
  liveOutputLabel?: string;
  logs: TaskActivityLogEntry[];
  status: ActivityStatus;
  title: string;
}

interface ActivityGuidance {
  message: string;
  tone: 'bad' | 'good' | 'warn';
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function buildGuidance(
  status: ActivityStatus,
  lastMessage: string,
  hasLiveOutput: boolean,
  elapsedMs: number,
  silenceMs: number
): ActivityGuidance | null {
  const normalizedMessage = lastMessage.toLowerCase();
  const waitingOnOllama =
    normalizedMessage.includes('contacting ollama') ||
    normalizedMessage.includes('waiting for output') ||
    normalizedMessage.includes('preparing');

  if (status === 'error') {
    return {
      message: 'This attempt failed. It is safe to retry. If the same problem repeats, check that Ollama is online and the selected model is available.',
      tone: 'bad'
    };
  }

  if (status === 'success') {
    return {
      message: 'The operation completed successfully.',
      tone: 'good'
    };
  }

  if (status !== 'running') {
    return null;
  }

  if (hasLiveOutput) {
    return {
      message: 'The model has started producing output. Wait while the response continues to build. If nothing changes for more than about a minute, retry later.',
      tone: 'good'
    };
  }

  if (waitingOnOllama && silenceMs < 15_000) {
    return {
      message: 'The request is in flight. Wait a little longer while Ollama accepts the request or loads the model.',
      tone: 'warn'
    };
  }

  if (waitingOnOllama && silenceMs < 45_000) {
    return {
      message: 'Still waiting on Ollama. This often means the model is cold-starting or the machine is busy. If this is the first request, waiting is usually the right choice.',
      tone: 'warn'
    };
  }

  if (silenceMs >= 45_000 || elapsedMs >= 60_000) {
    return {
      message: 'No new progress has appeared for a while. This request may be stuck. Retry if nothing changes soon, then check Settings to confirm Ollama is online and the selected model is installed.',
      tone: 'bad'
    };
  }

  return {
    message: 'The operation is still running. Wait for another status update before retrying.',
    tone: 'warn'
  };
}

export function OperationActivityPanel({
  liveOutput = '',
  liveOutputLabel = 'Live model output',
  logs,
  status,
  title
}: OperationActivityPanelProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== 'running') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status]);

  const firstLogAt = logs[0]?.createdAt ?? now;
  const lastLogAt = logs[logs.length - 1]?.createdAt ?? firstLogAt;
  const elapsedMs = Math.max(0, now - firstLogAt);
  const silenceMs = Math.max(0, now - lastLogAt);
  const lastMessage = logs[logs.length - 1]?.message ?? '';
  const guidance = useMemo(
    () => buildGuidance(status, lastMessage, liveOutput.trim().length > 0, elapsedMs, silenceMs),
    [elapsedMs, lastMessage, liveOutput, silenceMs, status]
  );

  return (
    <section aria-live="polite" className="task-activity-panel">
      <div className="task-activity-panel__header">
        <h3>{title}</h3>
        <span className={`task-activity-panel__status task-activity-panel__status--${status}`}>
          {status === 'running' ? 'Streaming' : status === 'success' ? 'Complete' : status === 'error' ? 'Failed' : 'Idle'}
        </span>
      </div>

      <div className="task-activity-panel__meta">
        <span>{`Elapsed ${formatDuration(elapsedMs)}`}</span>
        {status === 'running' ? <span>{`No update for ${formatDuration(silenceMs)}`}</span> : null}
      </div>

      {guidance ? <p className={`task-activity-panel__guidance task-activity-panel__guidance--${guidance.tone}`}>{guidance.message}</p> : null}

      <ul className="task-activity-log">
        {logs.map((entry) => (
          <li className={`task-activity-log__item task-activity-log__item--${entry.level}`} key={entry.id}>
            {entry.message}
          </li>
        ))}
      </ul>

      {liveOutput ? (
        <div className="task-activity-stream">
          <p className="subtle-copy">{liveOutputLabel}</p>
          <pre className="json-preview json-preview--compact task-activity-stream__preview">{liveOutput}</pre>
        </div>
      ) : null}
    </section>
  );
}