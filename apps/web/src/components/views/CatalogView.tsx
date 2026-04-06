import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { PromptAttachmentDraft, toPromptAttachmentPayloads } from '../../lib/prompt-attachments';
import { OperationActivityPanel } from '../OperationActivityPanel';
import { PromptComposer } from '../PromptComposer';
import { StatusPill } from '../StatusPill';
import { TaskDraftReviewCard } from '../TaskDraftReviewCard';
import { CatalogViewModel } from '../../hooks/useFlowMachineApp';

interface CatalogViewProps {
  catalog: CatalogViewModel;
}

export function CatalogView({ catalog }: CatalogViewProps) {
  const {
    customTaskDescription,
    generatedTaskDraft,
    handleDiscardGeneratedTaskDraft,
    handleGenerateCustomTask,
    handleRefineGeneratedTaskDraft,
    handleRefineTask,
    handleSaveGeneratedTaskDraft,
    isGeneratingTask,
    isSavingTaskDraft,
    isTaskOperationRunning,
    isRefiningTask,
    selectedModelName,
    selectedModelSupportsImages,
    setCustomTaskDescription,
    taskActivity,
    tasks
  } = catalog;
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'timeout' | 'memory'>('name');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [taskEditPrompt, setTaskEditPrompt] = useState('');
  const [taskCreateAttachments, setTaskCreateAttachments] = useState<PromptAttachmentDraft[]>([]);
  const [isTaskCreatePromptBlocked, setIsTaskCreatePromptBlocked] = useState(false);
  const [taskEditAttachments, setTaskEditAttachments] = useState<PromptAttachmentDraft[]>([]);
  const [isTaskEditPromptBlocked, setIsTaskEditPromptBlocked] = useState(false);

  const filteredAndSortedTasks = useMemo(() => {
    let filtered = tasks.filter((task) =>
      task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.key.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'timeout':
          return (a.resourceDefaults.timeoutMs ?? 60_000) - (b.resourceDefaults.timeoutMs ?? 60_000);
        case 'memory':
          return (a.resourceDefaults.memoryMb ?? 512) - (b.resourceDefaults.memoryMb ?? 512);
        default:
          return 0;
      }
    });
  }, [tasks, searchQuery, sortKey]);

  const selectedTaskData = tasks.find((t) => t.key === selectedTask);
  const selectedTaskJson = useMemo(
    () => (selectedTaskData ? JSON.stringify(selectedTaskData, null, 2) : ''),
    [selectedTaskData]
  );
  const showGenerationActivity = taskActivity.action === 'generate' && (taskActivity.logs.length > 0 || taskActivity.liveOutput.length > 0);
  const showSelectedTaskActivity = Boolean(selectedTaskData) && taskActivity.action === 'refine' && taskActivity.targetTaskKey === selectedTaskData?.key;

  useEffect(() => {
    if (selectedTask) {
      document.body.classList.add('modal-active');
    } else {
      document.body.classList.remove('modal-active');
    }
    return () => document.body.classList.remove('modal-active');
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedTask(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedTask]);

  useEffect(() => {
    setTaskEditPrompt('');
    setTaskEditAttachments([]);
    setIsTaskEditPromptBlocked(false);
  }, [selectedTask]);

  async function handleGenerateTaskWithAttachments(): Promise<void> {
    try {
      await handleGenerateCustomTask(toPromptAttachmentPayloads(taskCreateAttachments));
      setTaskCreateAttachments([]);
    } catch {
      return;
    }
  }

  async function handleApplyTaskEdits(): Promise<void> {
    if (!selectedTaskData) {
      return;
    }

    try {
      await handleRefineTask(selectedTaskData.key, taskEditPrompt, toPromptAttachmentPayloads(taskEditAttachments));
      setTaskEditPrompt('');
      setTaskEditAttachments([]);
    } catch {
      // Feedback is handled by the view model mutation.
    }
  }

  const modal =
    selectedTaskData && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-overlay" onClick={() => setSelectedTask(null)} role="presentation">
            <div
              aria-labelledby="task-details-title"
              aria-modal="true"
              className="modal-content"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="modal-header">
                <div>
                  <h2 id="task-details-title">{selectedTaskData.name}</h2>
                  <p className="modal-key">{selectedTaskData.key}</p>
                </div>
                <button aria-label="Close task details" className="modal-close" onClick={() => setSelectedTask(null)} type="button">
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div className="modal-layout">
                  <div className="modal-column">
                    <section className="modal-section">
                      <h3>Description</h3>
                      <p>{selectedTaskData.description}</p>
                    </section>

                    <section className="modal-section">
                      <h3>Status</h3>
                      <div>
                        {selectedTaskData.requiresApprovalByDefault ? (
                          <StatusPill tone="warn">Requires Approval</StatusPill>
                        ) : (
                          <StatusPill tone="good">Local Execution</StatusPill>
                        )}
                      </div>
                    </section>

                    <section className="modal-section">
                      <h3>Resource Configuration</h3>
                      <dl className="definition-list">
                        <dt>Timeout</dt>
                        <dd>{Math.round((selectedTaskData.resourceDefaults.timeoutMs ?? 60_000) / 1000)}s</dd>
                        <dt>Memory</dt>
                        <dd>{selectedTaskData.resourceDefaults.memoryMb ?? 512} MB</dd>
                      </dl>
                    </section>

                    <section className="modal-section">
                      <h3>Capabilities</h3>
                      <div className="tag-row">
                        {selectedTaskData.capabilities.length === 0 ? (
                          <span className="tag">pure-local</span>
                        ) : (
                          selectedTaskData.capabilities.map((capability) => (
                            <span className="tag" key={capability}>
                              {capability}
                            </span>
                          ))
                        )}
                      </div>
                    </section>
                  </div>

                  <div className="modal-column">
                    <section className="modal-section">
                      <h3>Task JSON</h3>
                      <p className="subtle-copy">Current persisted task definition.</p>
                      <pre className="json-preview json-preview--compact modal-json-preview">{selectedTaskJson}</pre>
                    </section>

                    <section className="modal-section">
                      <h3>Edit With Natural Language</h3>
                      <p>Describe the change you want. The task key stays stable, and the catalog will save an override for this task.</p>
                      {selectedTaskData.key === 'select-repository' ? (
                        <p className="helper-copy">
                          Refining this built-in task updates its saved definition, but the workflow editor still controls how repository selection is entered on each select-repository node.
                        </p>
                      ) : null}
                      <PromptComposer
                        attachments={taskEditAttachments}
                        helperCopy="Attach docs, screenshots, PDFs, or other files that should shape this task refinement."
                        label="Task changes"
                        maxHeight={240}
                        minRows={5}
                        onAttachmentsChange={setTaskEditAttachments}
                        onBlockingStateChange={setIsTaskEditPromptBlocked}
                        onChange={setTaskEditPrompt}
                        placeholder="e.g., Reduce the default timeout to 90 seconds, mark it local by default, and clarify that it only reads repository files."
                        selectedModelName={selectedModelName}
                        selectedModelSupportsImages={selectedModelSupportsImages}
                        value={taskEditPrompt}
                      />
                      <div className="toolbar-row toolbar-row--compact">
                        <button
                          className="button"
                          disabled={isTaskEditPromptBlocked || isTaskOperationRunning || !taskEditPrompt.trim()}
                          onClick={() => void handleApplyTaskEdits()}
                          type="button"
                        >
                          {isRefiningTask ? 'Applying changes...' : isTaskOperationRunning ? 'Task operation in progress...' : 'Apply changes'}
                        </button>
                      </div>

                      {showSelectedTaskActivity ? (
                        <OperationActivityPanel
                          liveOutput={taskActivity.liveOutput}
                          logs={taskActivity.logs}
                          status={taskActivity.status}
                          title="Refinement activity"
                        />
                      ) : null}
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="view-grid view-grid--catalog">
      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Generate custom tasks</h2>
          <p>Create new workflow tasks by describing what you need in natural language. Review and refine the generated draft before saving it into the catalog.</p>
        </div>

        <div className="form-grid">
          <div className="form-field">
            <PromptComposer
              attachments={taskCreateAttachments}
              helperCopy="Attach docs, PDFs, screenshots, or source files so the generated task is grounded in real context."
              id="custom-task-description"
              label="Task description"
              minRows={3}
              onAttachmentsChange={setTaskCreateAttachments}
              onBlockingStateChange={setIsTaskCreatePromptBlocked}
              onChange={setCustomTaskDescription}
              placeholder="e.g., Create a task that validates JSON files in a directory and reports any schema violations"
              selectedModelName={selectedModelName}
              selectedModelSupportsImages={selectedModelSupportsImages}
              value={customTaskDescription}
            />
          </div>
        </div>

        <div className="toolbar-row">
          <button
            className="button"
            disabled={isTaskCreatePromptBlocked || isTaskOperationRunning || !customTaskDescription.trim()}
            onClick={() => void handleGenerateTaskWithAttachments()}
            type="button"
          >
            {isGeneratingTask ? 'Generating task...' : isTaskOperationRunning ? 'Task operation in progress...' : 'Generate Task'}
          </button>
        </div>

        {showGenerationActivity ? (
          <OperationActivityPanel
            liveOutput={taskActivity.liveOutput}
            logs={taskActivity.logs}
            status={taskActivity.status}
            title="Generation activity"
          />
        ) : null}

        {generatedTaskDraft ? (
          <TaskDraftReviewCard
            activity={taskActivity}
            draft={generatedTaskDraft}
            onDismiss={handleDiscardGeneratedTaskDraft}
            onPrimaryAction={handleSaveGeneratedTaskDraft}
            onRefine={handleRefineGeneratedTaskDraft}
            primaryActionDisabled={isTaskOperationRunning}
            primaryActionLabel="Save task"
            primaryActionPending={isSavingTaskDraft}
            selectedModelName={selectedModelName}
            selectedModelSupportsImages={selectedModelSupportsImages}
            title="Review generated task before saving"
          />
        ) : null}
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Existing Tasks</h2>
          <p>Built-in and custom tasks available in your catalog.</p>
        </div>

        <div className="toolbar-row">
          <input
            className="input"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tasks by name, description, or key..."
            type="text"
            value={searchQuery}
          />
        </div>

        <div className="table-container">
          <table className="tasks-table">
            <thead>
              <tr>
                <th onClick={() => setSortKey('name')} style={{ cursor: 'pointer' }}>
                  Name {sortKey === 'name' ? '▼' : ''}
                </th>
                <th>Status</th>
                <th onClick={() => setSortKey('timeout')} style={{ cursor: 'pointer' }}>
                  Timeout {sortKey === 'timeout' ? '▼' : ''}
                </th>
                <th onClick={() => setSortKey('memory')} style={{ cursor: 'pointer' }}>
                  Memory {sortKey === 'memory' ? '▼' : ''}
                </th>
                <th>Capabilities</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedTasks.map((task) => (
                <tr
                  className="tasks-table__row"
                  key={task.key}
                  onClick={() => setSelectedTask(task.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedTask(task.key);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <td className="task-name">
                    <strong>{task.name}</strong>
                    <span className="task-key">{task.key}</span>
                  </td>
                  <td>
                    {task.requiresApprovalByDefault ? (
                      <StatusPill tone="warn">Approval</StatusPill>
                    ) : (
                      <StatusPill tone="good">Local</StatusPill>
                    )}
                  </td>
                  <td>{Math.round((task.resourceDefaults.timeoutMs ?? 60_000) / 1000)}s</td>
                  <td>{task.resourceDefaults.memoryMb ?? 512} MB</td>
                  <td>
                    <div className="tag-row">
                      {task.capabilities.length === 0 ? <span className="tag">pure-local</span> : null}
                      {task.capabilities.map((capability) => (
                        <span className="tag" key={capability}>
                          {capability}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="task-actions">
                    <button
                      aria-label={`View details for ${task.name}`}
                      className="icon-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTask(task.key);
                      }}
                      title="View task details"
                      type="button"
                    >
                      ℹ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredAndSortedTasks.length === 0 && searchQuery ? (
          <div className="empty-state">
            <h3>No tasks found</h3>
            <p>Try adjusting your search query.</p>
          </div>
        ) : null}
      </section>
      {modal}
    </section>
  );
}