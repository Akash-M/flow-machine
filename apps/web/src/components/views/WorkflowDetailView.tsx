import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { Combobox } from '../Combobox';
import { WorkflowStudioModel } from '../../hooks/useFlowMachineApp';
import { WorkflowWorkbenchPanel } from '../workflows/WorkflowWorkbenchPanel';

interface WorkflowDetailViewProps {
  studio: WorkflowStudioModel;
}

export function WorkflowDetailView({ studio }: WorkflowDetailViewProps) {
  const params = useParams<{ id?: string }>();
  const hasWorkflows = studio.workflows.length > 0;
  const selectedWorkflowValue = params.id ?? '';
  const hasSelectedWorkflow = Boolean(params.id);
  const workflowOptions = useMemo(
    () =>
      studio.workflows.map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
        description: workflow.id,
        keywords: [workflow.description, ...workflow.tags]
      })),
    [studio.workflows]
  );

  return (
    <section className="view-grid workflow-detail-view">
      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Workflow editor</h2>
          <p>Choose a saved workflow to inspect, refine, run, or delete it.</p>
        </div>

        <div className="workflow-detail-view__toolbar toolbar-row">
          <div className="form-field workflow-detail-view__field">
            <label htmlFor="workflow-editor-select">Select workflow</label>
            <Combobox
              id="workflow-editor-select"
              noResultsText="No workflows match this search."
              onChange={(nextValue) => {
                if (nextValue) {
                  studio.handleSelectWorkflow(nextValue);
                }
              }}
              options={workflowOptions}
              placeholder="Search workflows by name or id"
              value={selectedWorkflowValue}
            />
          </div>
        </div>

        {!hasSelectedWorkflow ? (
          <div className="empty-state workflow-detail-view__empty-state">
            <h3>{hasWorkflows ? 'Select a workflow' : 'No workflows yet'}</h3>
            <p>
              {hasWorkflows
                ? 'Choose a workflow from the dropdown, or open one directly from the Workflows Catalog.'
                : 'Create a workflow from the Workflows Catalog before opening the editor.'}
            </p>
          </div>
        ) : null}
      </section>

      {hasSelectedWorkflow ? <WorkflowWorkbenchPanel studio={studio} /> : null}
    </section>
  );
}
