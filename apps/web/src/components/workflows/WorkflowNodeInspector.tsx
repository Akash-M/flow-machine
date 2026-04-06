import { WorkflowStudioModel } from '../../hooks/useFlowMachineApp';
import { Combobox } from '../Combobox';
import { StatusPill } from '../StatusPill';

interface WorkflowNodeInspectorProps {
  studio: WorkflowStudioModel;
}

export function WorkflowNodeInspector({ studio }: WorkflowNodeInspectorProps) {
  if (!studio.editorWorkflow || !studio.selectedNode) {
    return (
      <div className="empty-state">
        <h3>Select a node</h3>
        <p>Pick a node from the canvas to edit its label, task binding, position, and config.</p>
      </div>
    );
  }

  const { editorWorkflow, selectedNode } = studio;
  const selectedRepositoryId = typeof selectedNode.config.repositoryId === 'string' ? selectedNode.config.repositoryId : 'mounted-root';
  const selectedRepositoryPath =
    typeof selectedNode.config.repositoryPath === 'string'
      ? selectedNode.config.repositoryPath
      : typeof selectedNode.config.path === 'string'
        ? selectedNode.config.path
        : '';
  const searchQuery = typeof selectedNode.config.query === 'string' ? selectedNode.config.query : '';
  const searchIncludePattern = typeof selectedNode.config.includePattern === 'string' ? selectedNode.config.includePattern : '';
  const repositorySelectionMode = selectedRepositoryPath.trim().length > 0 ? 'path' : 'registered';
  const taskOptions = studio.tasks.map((task) => ({
    value: task.key,
    label: task.name,
    description: task.key,
    keywords: [task.description, ...task.capabilities]
  }));
  const repositoryOptions =
    studio.repositories.length === 0
      ? [{ value: 'mounted-root', label: 'Current workspace', description: 'Repository list is still loading' }]
      : studio.repositories.map((repository) => ({
          value: repository.id,
          label: repository.name,
          description: repository.source === 'mounted-root' ? 'Current workspace' : repository.hostPath,
          keywords: [repository.hostPath]
        }));
  const selectedRegisteredRepository = studio.repositories.find((repository) => repository.id === selectedRepositoryId) ?? null;

  function handleRepositorySelectionModeChange(mode: 'path' | 'registered'): void {
    if (mode === 'registered') {
      studio.handleRepositoryPathChange('');
      return;
    }

    studio.handleRepositoryPathChange(selectedRegisteredRepository?.hostPath ?? '');
  }

  function resolveNodeName(nodeId: string): string {
    return editorWorkflow.definition.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
  }

  return (
    <>
      <div className="workflow-editor__sidebar-header">
        <div>
          <p className="metric-card__eyebrow">Node inspector</p>
          <h4>{selectedNode.name}</h4>
        </div>
        {editorWorkflow.definition.startNodeId === selectedNode.id ? <StatusPill tone="good">Start node</StatusPill> : null}
      </div>

      <div className="form-field">
        <label htmlFor="selected-node-name">Node label</label>
        <input
          className="input"
          id="selected-node-name"
          onChange={(event) => studio.handleNodeFieldChange('name', event.target.value)}
          value={selectedNode.name}
        />
      </div>

      <div className="form-field">
        <label htmlFor="selected-node-task">Task type</label>
        <Combobox
          id="selected-node-task"
          noResultsText="No task types match this search."
          onChange={(nextValue) => studio.handleNodeFieldChange('taskKey', nextValue)}
          options={taskOptions}
          placeholder="Search task types"
          value={selectedNode.taskKey}
        />
      </div>

      {selectedNode.taskKey === 'select-repository' ? (
        <div className="form-field">
          <label htmlFor="selected-node-repository">Repository</label>
          <div className="segmented-control" role="tablist" aria-label="Repository selection mode">
            <button
              aria-selected={repositorySelectionMode === 'registered'}
              className={`segmented-control__button${repositorySelectionMode === 'registered' ? ' segmented-control__button--active' : ''}`}
              onClick={() => handleRepositorySelectionModeChange('registered')}
              role="tab"
              type="button"
            >
              Saved repository
            </button>
            <button
              aria-selected={repositorySelectionMode === 'path'}
              className={`segmented-control__button${repositorySelectionMode === 'path' ? ' segmented-control__button--active' : ''}`}
              onClick={() => handleRepositorySelectionModeChange('path')}
              role="tab"
              type="button"
            >
              Direct path
            </button>
          </div>

          {repositorySelectionMode === 'registered' ? (
            <>
              <Combobox
                id="selected-node-repository"
                noResultsText="No repositories match this search."
                onChange={studio.handleRepositorySelectionChange}
                options={repositoryOptions}
                placeholder="Search repositories"
                value={selectedRepositoryId}
              />
              <p className="helper-copy">Use a saved repository from Settings. Downstream repository-aware tasks will use that repository as their working root.</p>
            </>
          ) : (
            <>
              <input
                className="input"
                id="selected-node-repository"
                onChange={(event) => studio.handleRepositoryPathChange(event.target.value)}
                placeholder="/Users/you/projects/another-repo"
                value={selectedRepositoryPath}
              />
              <p className="helper-copy">Enter a direct host path when you want this workflow node to target a repository that is not saved in the registry.</p>
            </>
          )}
        </div>
      ) : null}

      {selectedNode.taskKey === 'search-repo' ? (
        <>
          <div className="form-field">
            <label htmlFor="selected-node-search-query">Search query</label>
            <input
              className="input"
              id="selected-node-search-query"
              onChange={(event) => studio.handleNodeConfigFieldChange('query', event.target.value)}
              placeholder="TODO|FIXME|function useFlowMachineApp"
              value={searchQuery}
            />
            <p className="helper-copy">Required. This is the text or regex pattern the Search Repository node will look for.</p>
          </div>

          <div className="form-field">
            <label htmlFor="selected-node-search-include-pattern">Include pattern</label>
            <input
              className="input"
              id="selected-node-search-include-pattern"
              onChange={(event) => studio.handleNodeConfigFieldChange('includePattern', event.target.value)}
              placeholder="src/**/*.ts"
              value={searchIncludePattern}
            />
            <p className="helper-copy">Optional. Limit the search to matching files or folders.</p>
          </div>
        </>
      ) : null}

      {studio.selectedNodeValidationIssues.length > 0 ? (
        <div className="workflow-node-inspector__validation">
          <p className="error-copy">Fix these issues before the workflow can run:</p>
          <ul className="workflow-node-inspector__validation-list">
            {studio.selectedNodeValidationIssues.map((issue) => (
              <li key={`${issue.nodeId}:${issue.field ?? issue.message}`}>{`${issue.message} ${issue.recommendation}`}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="workflow-editor__position-grid">
        <div className="form-field">
          <label htmlFor="selected-node-x">Position X</label>
          <input
            className="input"
            id="selected-node-x"
            onChange={(event) => studio.handleNodePositionChange('x', event.target.value)}
            type="number"
            value={selectedNode.position.x}
          />
        </div>
        <div className="form-field">
          <label htmlFor="selected-node-y">Position Y</label>
          <input
            className="input"
            id="selected-node-y"
            onChange={(event) => studio.handleNodePositionChange('y', event.target.value)}
            type="number"
            value={selectedNode.position.y}
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="selected-node-config">Config JSON</label>
        <textarea
          className="textarea textarea--code"
          id="selected-node-config"
          onChange={(event) => studio.handleNodeConfigTextChange(event.target.value)}
          rows={10}
          value={studio.nodeConfigText}
        />
        {studio.configError ? (
          <p className="error-copy">{studio.configError}</p>
        ) : (
          <p className="helper-copy">Stored as a JSON object on the node.</p>
        )}
      </div>

      <div className="toolbar-row toolbar-row--compact">
        <button className="button button--secondary" onClick={studio.handleApplyNodeConfig} type="button">
          Apply Config
        </button>
        <button className="button button--secondary" onClick={() => studio.handleStartNodeChange(selectedNode.id)} type="button">
          Set as Start
        </button>
        <button className="button button--danger" onClick={studio.handleDeleteSelectedNode} type="button">
          Remove Node
        </button>
      </div>

      <div className="workflow-connection-list">
        <div className="workflow-editor__sidebar-header">
          <div>
            <p className="metric-card__eyebrow">Connections</p>
            <h4>
              {studio.selectedNodeEdges.length === 0
                ? 'No connections'
                : `${studio.selectedNodeEdges.length} linked edge${studio.selectedNodeEdges.length === 1 ? '' : 's'}`}
            </h4>
          </div>
        </div>

        {studio.selectedNodeEdges.length === 0 ? (
          <p className="helper-copy">Add a connection from the graph toolbar.</p>
        ) : (
          studio.selectedNodeEdges.map((edge) => (
            <article className="connection-row" key={edge.id}>
              <div>
                <strong>{edge.source === selectedNode.id ? 'Outgoing' : 'Incoming'}</strong>
                <p>
                  {resolveNodeName(edge.source)}
                  {' -> '}
                  {resolveNodeName(edge.target)}
                </p>
              </div>
              <button className="button button--ghost" onClick={() => studio.handleRemoveEdge(edge.id)} type="button">
                Remove
              </button>
            </article>
          ))
        )}
      </div>
    </>
  );
}