import { useEffect, useState } from 'react';

import { PromptAttachmentPayload, TaskDraft } from '@flow-machine/shared-types';

import { TaskOperationActivity } from '../hooks/useFlowMachineApp';
import { PromptAttachmentDraft, toPromptAttachmentPayloads } from '../lib/prompt-attachments';
import { PromptComposer } from './PromptComposer';
import { StatusPill } from './StatusPill';

interface TaskDraftReviewCardProps {
  activity?: TaskOperationActivity;
  draft: TaskDraft;
  onDismiss?: () => void;
  onPrimaryAction?: () => Promise<void> | void;
  onRefine: (instructions: string, attachments?: PromptAttachmentPayload[]) => Promise<void>;
  primaryActionDisabled?: boolean;
  primaryActionLabel?: string;
  primaryActionPending?: boolean;
  refineActionLabel?: string;
  selectedModelName?: string | null;
  selectedModelSupportsImages?: boolean | null;
  title?: string;
}

export function TaskDraftReviewCard({
  activity,
  draft,
  onDismiss,
  onPrimaryAction,
  onRefine,
  primaryActionDisabled = false,
  primaryActionLabel = 'Save task',
  primaryActionPending = false,
  refineActionLabel = 'Refine task draft',
  selectedModelName = null,
  selectedModelSupportsImages = null,
  title
}: TaskDraftReviewCardProps) {
  const [attachments, setAttachments] = useState<PromptAttachmentDraft[]>([]);
  const [instructions, setInstructions] = useState('');
  const [isPromptBlocked, setIsPromptBlocked] = useState(false);
  const showActivity = Boolean(activity) && activity?.targetTaskKey === draft.key && (activity.logs.length > 0 || activity.liveOutput.length > 0);

  useEffect(() => {
    setAttachments([]);
    setInstructions('');
    setIsPromptBlocked(false);
  }, [draft.key]);

  async function handleRefine(): Promise<void> {
    try {
      await onRefine(instructions, toPromptAttachmentPayloads(attachments));
      setAttachments([]);
      setInstructions('');
    } catch {
      return;
    }
  }

  async function handlePrimaryAction(): Promise<void> {
    if (!onPrimaryAction) {
      return;
    }

    try {
      await onPrimaryAction();
    } catch {
      return;
    }
  }

  function renderActivityPanel(): JSX.Element | null {
    if (!activity || !showActivity) {
      return null;
    }

    return (
      <section aria-live="polite" className="task-activity-panel">
        <div className="task-activity-panel__header">
          <h3>Task draft activity</h3>
          <span className={`task-activity-panel__status task-activity-panel__status--${activity.status}`}>
            {activity.status === 'running'
              ? 'Streaming'
              : activity.status === 'success'
                ? 'Complete'
                : activity.status === 'error'
                  ? 'Failed'
                  : 'Idle'}
          </span>
        </div>

        <ul className="task-activity-log">
          {activity.logs.map((entry) => (
            <li className={`task-activity-log__item task-activity-log__item--${entry.level}`} key={entry.id}>
              {entry.message}
            </li>
          ))}
        </ul>

        {activity.liveOutput ? (
          <div className="task-activity-stream">
            <p className="subtle-copy">Live model output</p>
            <pre className="json-preview json-preview--compact task-activity-stream__preview">{activity.liveOutput}</pre>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="draft-review-card">
      <div className="draft-review-card__header">
        <div>
          <p className="metric-card__eyebrow">Task Draft</p>
          <h3>{title ?? draft.name}</h3>
          <p>{draft.description}</p>
        </div>

        <div className="draft-review-card__header-meta">
          <StatusPill tone={draft.requiresApprovalByDefault ? 'warn' : 'good'}>
            {draft.requiresApprovalByDefault ? 'Requires approval' : 'Local by default'}
          </StatusPill>
        </div>
      </div>

      <div className="draft-review-card__body">
        <section className="draft-review-card__section">
          <h4>Why this task is proposed</h4>
          <p>{draft.reason}</p>
        </section>

        <section className="draft-review-card__section">
          <h4>Task details</h4>
          <dl className="definition-list draft-review-card__definition-list">
            <dt>Key</dt>
            <dd>{draft.key}</dd>
            <dt>Timeout</dt>
            <dd>{Math.round((draft.resourceDefaults.timeoutMs ?? 60_000) / 1000)}s</dd>
            <dt>Memory</dt>
            <dd>{draft.resourceDefaults.memoryMb ?? 512} MB</dd>
          </dl>
        </section>

        <section className="draft-review-card__section">
          <h4>Capabilities</h4>
          <div className="tag-row">
            {draft.capabilities.length === 0 ? <span className="tag">pure-local</span> : null}
            {draft.capabilities.map((capability) => (
              <span className="tag" key={capability}>
                {capability}
              </span>
            ))}
          </div>
        </section>

        <section className="draft-review-card__section">
          <h4>Draft JSON</h4>
          <pre className="json-preview json-preview--compact">{JSON.stringify(draft, null, 2)}</pre>
        </section>

        <section className="draft-review-card__section">
          <h4>Refine this task draft</h4>
          <PromptComposer
            attachments={attachments}
            helperCopy="Add notes, code, screenshots, or PDFs if the model needs more context before you save this task."
            label="Task draft changes"
            maxHeight={220}
            minRows={4}
            onAttachmentsChange={setAttachments}
            onBlockingStateChange={setIsPromptBlocked}
            onChange={setInstructions}
            placeholder="Clarify the repository scan behavior, tighten the timeout, or explain exactly what this task should output."
            selectedModelName={selectedModelName}
            selectedModelSupportsImages={selectedModelSupportsImages}
            value={instructions}
          />

          <div className="toolbar-row">
            <button
              className="button button--secondary"
              disabled={activity?.status === 'running' || isPromptBlocked || instructions.trim().length === 0}
              onClick={() => void handleRefine()}
              type="button"
            >
              {activity?.status === 'running' && activity.targetTaskKey === draft.key ? 'Refining task draft...' : refineActionLabel}
            </button>

            {onPrimaryAction ? (
              <button
                className="button"
                disabled={primaryActionDisabled || primaryActionPending}
                onClick={() => void handlePrimaryAction()}
                type="button"
              >
                {primaryActionPending ? `${primaryActionLabel}...` : primaryActionLabel}
              </button>
            ) : null}

            {onDismiss ? (
              <button className="button button--ghost" onClick={onDismiss} type="button">
                Dismiss draft
              </button>
            ) : null}
          </div>

          {renderActivityPanel()}
        </section>
      </div>
    </section>
  );
}