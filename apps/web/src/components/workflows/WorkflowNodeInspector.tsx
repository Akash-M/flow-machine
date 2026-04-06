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
  const taskOptions = studio.tasks.map((task) => ({
    value: task.key,
    label: task.name,
    description: task.key,
    keywords: [task.description, ...task.capabilities]
  }));
  const repositoryOptions =
    studio.repositories.length === 0
      ? [{ value: 'mounted-root', label: 'Mounted root', description: 'Repository list is still loading' }]
      : studio.repositories.map((repository) => ({
          value: repository.id,
          label: repository.name,
          description: repository.relativePath,
          keywords: [repository.hostPath]
        }));

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
          <Combobox
            id="selected-node-repository"
            noResultsText="No repositories match this search."
            onChange={studio.handleRepositorySelectionChange}
            options={repositoryOptions}
            placeholder="Search repositories"
            value={selectedRepositoryId}
          />
          <p className="helper-copy">Downstream repository-aware tasks will use this selected repository as their working root.</p>
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