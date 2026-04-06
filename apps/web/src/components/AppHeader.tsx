import { DashboardView, DashboardViewCopy } from '../lib/dashboard';
import { StatusPill } from './StatusPill';

interface AppHeaderProps {
  activeView: DashboardView;
  currentView: DashboardViewCopy;
  hasEditorWorkflow: boolean;
  isEditorDirty: boolean;
}

export function AppHeader({ activeView, currentView, hasEditorWorkflow, isEditorDirty }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__copy">
        <p className="metric-card__eyebrow">{currentView.eyebrow}</p>
        <h2>{currentView.title}</h2>
        <p>{currentView.description}</p>
      </div>

      {activeView === 'workflow-editor' && hasEditorWorkflow ? (
        <div className="app-header__actions">
          <StatusPill tone={isEditorDirty ? 'warn' : 'good'}>
            {isEditorDirty ? 'Workflow has unsaved changes' : 'Workflow is synced'}
          </StatusPill>
        </div>
      ) : null}
    </header>
  );
}