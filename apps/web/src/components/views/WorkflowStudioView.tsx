import { WorkflowStudioModel } from '../../hooks/useFlowMachineApp';
import { WorkflowLibraryPanel } from '../workflows/WorkflowLibraryPanel';
import { WorkflowWorkbenchPanel } from '../workflows/WorkflowWorkbenchPanel';

interface WorkflowStudioViewProps {
  studio: WorkflowStudioModel;
}

export function WorkflowStudioView({ studio }: WorkflowStudioViewProps) {
  return (
    <section className="workflow-dashboard">
      <WorkflowLibraryPanel studio={studio} />
      <WorkflowWorkbenchPanel studio={studio} />
    </section>
  );
}