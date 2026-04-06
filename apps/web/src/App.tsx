import { Navigate, Route, Routes } from 'react-router-dom';

import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { FlashBanner } from './components/FlashBanner';
import { ApprovalsView } from './components/views/ApprovalsView';
import { CatalogView } from './components/views/CatalogView';
import { McpView } from './components/views/McpView';
import { OverviewView } from './components/views/OverviewView';
import { RunsView } from './components/views/RunsView';
import { SecretsView } from './components/views/SecretsView';
import { SettingsView } from './components/views/SettingsView';
import { WorkflowCatalogView } from './components/views/WorkflowCatalogView';
import { WorkflowDetailView } from './components/views/WorkflowDetailView';
import { useFlowMachineApp } from './hooks/useFlowMachineApp';
import { dashboardPathForView } from './lib/dashboard';

export function App() {
  const model = useFlowMachineApp();

  if (model.statusQuery.isLoading) {
    return (
      <main className="shell shell--centered">
        <div className="loading-state">
          <p className="loading-state__eyebrow">Flow Machine</p>
          <h1>Checking local runtime</h1>
          <p>Waiting for the API, runtime preflight checks, and host-native Ollama status.</p>
        </div>
      </main>
    );
  }

  if (model.statusQuery.isError || !model.system.status) {
    return (
      <main className="shell shell--centered">
        <div className="loading-state loading-state--error">
          <p className="loading-state__eyebrow">Flow Machine</p>
          <h1>API unavailable</h1>
          <p>{model.statusQuery.error instanceof Error ? model.statusQuery.error.message : 'Unknown error.'}</p>
          <p>Start the stack with the documented command and refresh this page.</p>
        </div>
      </main>
    );
  }

  const status = model.system.status;

  return (
    <main className="app-shell">
      <div className="shell__backdrop shell__backdrop--top" />
      <div className="shell__backdrop shell__backdrop--bottom" />

      <AppSidebar
        navigationItems={model.system.navigationItems}
      />

      <div className="app-frame">
        {model.view.activeView !== 'overview' && model.view.activeView !== 'workflows' ? (
          <AppHeader
            activeView={model.view.activeView}
            currentView={model.system.currentView}
            hasEditorWorkflow={Boolean(model.workflowStudio.editorWorkflow)}
            isEditorDirty={model.workflowStudio.isEditorDirty}
          />
        ) : null}

        <FlashBanner notifications={model.notifications.notifications} onDismiss={model.notifications.dismissNotification} />

        <section className={`app-view${model.view.activeView === 'workflow-editor' ? ' app-view--workflow-studio' : ''}`}>
          <Routes>
            <Route
              element={
                <OverviewView
                  hasSelectedWorkflow={model.system.selectedWorkflowActive}
                  onOpenCatalog={() => model.view.setActiveView('catalog')}
                  onOpenStudio={() => model.view.setActiveView('workflows')}
                  selectedWorkflowName={model.system.selectedWorkflowName}
                  selectedWorkflowStatusCopy={model.system.selectedWorkflowStatusCopy}
                  status={status}
                />
              }
              path={dashboardPathForView('overview')}
            />
            <Route element={<WorkflowCatalogView studio={model.workflowStudio} />} path={dashboardPathForView('workflows')} />
            <Route element={<WorkflowDetailView studio={model.workflowStudio} />} path={dashboardPathForView('workflow-editor')} />
            <Route element={<WorkflowDetailView studio={model.workflowStudio} />} path="/workflows/:id" />
            <Route element={<RunsView runsModel={model.runs} />} path={dashboardPathForView('runs')} />
            <Route element={<ApprovalsView approvals={model.approvals} />} path={dashboardPathForView('approvals')} />
            <Route element={<CatalogView catalog={model.catalog} />} path={dashboardPathForView('catalog')} />
            <Route element={<McpView mcp={model.mcp} />} path={dashboardPathForView('mcp')} />
            <Route element={<SecretsView secrets={model.secrets} />} path={dashboardPathForView('secrets')} />
            <Route element={<SettingsView settings={model.settings} status={status} />} path={dashboardPathForView('settings')} />
            <Route element={<Navigate replace to={dashboardPathForView('overview')} />} path="*" />
          </Routes>
        </section>
      </div>
    </main>
  );
}