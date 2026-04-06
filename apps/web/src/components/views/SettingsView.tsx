import { AppStatus } from '@flow-machine/shared-types';

import { SettingsViewModel } from '../../hooks/useFlowMachineApp';
import { preflightTone, privacyTone } from '../../lib/dashboard';
import { OperationActivityPanel } from '../OperationActivityPanel';
import { StatusPill } from '../StatusPill';

interface SettingsViewProps {
  settings: SettingsViewModel;
  status: AppStatus;
}

function formatModelSize(size: number | null): string {
  return size !== null ? `${Math.round(size / 1024 / 1024)} MB` : 'Size unavailable';
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'No modified timestamp reported.';
}

export function SettingsView({ settings, status }: SettingsViewProps) {
  const installedModels = settings.state?.models ?? [];
  const activeModelName = settings.state?.manifest.selectedModel ?? null;

  return (
    <section className="view-grid view-grid--catalog">
      <section className="panel">
        <div className="panel__header">
          <h2>Runtime settings</h2>
          <p>Review the current local runtime posture, browser automation readiness, and persisted mount paths.</p>
        </div>

        <div className="table-container table-container--dense">
          <table className="settings-table settings-table--summary">
            <tbody>
              <tr>
                <th scope="row">Privacy mode</th>
                <td>
                  <StatusPill tone={privacyTone(status.privacy.mode)}>{status.privacy.mode}</StatusPill>
                </td>
              </tr>
              <tr>
                <th scope="row">Container runtime</th>
                <td>{status.runtime.containerRuntime}</td>
              </tr>
              <tr>
                <th scope="row">Current workspace</th>
                <td className="settings-table__mono">{status.runtime.repoMount.hostPath}</td>
              </tr>
              <tr>
                <th scope="row">Host filesystem access</th>
                <td className="settings-table__mono">{status.runtime.hostAccessMount.hostPath}</td>
              </tr>
              <tr>
                <th scope="row">Data directory</th>
                <td className="settings-table__mono">{status.runtime.dataDir}</td>
              </tr>
              <tr>
                <th scope="row">MCP config path</th>
                <td className="settings-table__mono">{status.runtime.mcpConfigPath}</td>
              </tr>
              <tr>
                <th scope="row">Browser automation</th>
                <td>{settings.browserStatus?.message ?? settings.browserStatusError ?? 'Checking browser runtime.'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Bundle management</h2>
          <p>Export workflows and reconstructable settings, or import a previously exported JSON bundle.</p>
        </div>

        <div className="toolbar-row">
          <button className="button" onClick={() => void settings.handleExportAll()} type="button">
            Export Bundle
          </button>
          <label className="button button--secondary file-trigger">
            Import Bundle
            <input accept="application/json" onChange={(event) => void settings.handleImportChange(event)} type="file" />
          </label>
        </div>
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Ollama models</h2>
          <p>Check the installed Ollama version, review models available on the machine, and choose the active model for agent nodes.</p>
        </div>

        <div className="table-container table-container--dense">
          <table className="settings-table settings-table--summary">
            <tbody>
              <tr>
                <th scope="row">Status</th>
                <td>
                  <StatusPill tone={settings.state?.online ? 'good' : 'warn'}>{settings.state?.online ? 'Online' : 'Offline'}</StatusPill>
                </td>
                <td>{settings.state?.message ?? 'Checking host-native Ollama connectivity.'}</td>
              </tr>
              <tr>
                <th scope="row">Version</th>
                <td>{settings.state?.version ?? 'Unknown'}</td>
                <td>Version reported by the host Ollama runtime.</td>
              </tr>
              <tr>
                <th scope="row">Installed models</th>
                <td>{installedModels.length}</td>
                <td>Models currently installed on the machine.</td>
              </tr>
              <tr>
                <th scope="row">Active model</th>
                <td>{activeModelName ?? 'Unset'}</td>
                <td>Model currently selected for agent nodes by default.</td>
              </tr>
              <tr>
                <th scope="row">Endpoint</th>
                <td className="settings-table__mono">{settings.state?.manifest.baseUrl ?? '--'}</td>
                <td>Current Ollama base URL configured for the local app.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section className="settings-section">
          <div className="panel__header">
            <h2>Pull a model</h2>
            <p>Use Ollama model names exactly as they should be fetched on the host runtime.</p>
          </div>

          <div className="toolbar-row">
            <input
              className="input"
              disabled={settings.isPullingModel}
              onChange={(event) => settings.setPullModelName(event.target.value)}
              placeholder="qwen2.5-coder:7b"
              value={settings.pullModelName}
            />
            <button className="button" disabled={settings.isPullingModel || !settings.pullModelName.trim()} onClick={settings.handlePullModel} type="button">
              {settings.isPullingModel ? `Pulling ${settings.modelPullActivity.modelName ?? 'model'}...` : 'Pull Model'}
            </button>
          </div>

          {settings.modelPullActivity.status !== 'idle' || settings.modelPullActivity.logs.length > 0 ? (
            <OperationActivityPanel
              liveOutput={settings.modelPullActivity.liveOutput}
              liveOutputLabel="Latest pull progress"
              logs={settings.modelPullActivity.logs}
              status={settings.modelPullActivity.status}
              title="Model pull activity"
            />
          ) : null}

          {settings.errorMessage ? <p className="error-copy">{settings.errorMessage}</p> : null}
        </section>

        <section className="settings-section">
          <div className="panel__header">
            <h2>Installed models</h2>
            <p>These models are installed on the machine. Mark one as the active default for agent nodes, or leave it unset and rely on per-node configuration.</p>
          </div>

          {installedModels.length > 0 ? (
            <div className="table-container table-container--dense">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Size</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {installedModels.map((model) => {
                    const selected = activeModelName === model.name;

                    return (
                      <tr key={model.name}>
                        <td className="settings-table__name-cell">
                          <strong>{model.name}</strong>
                        </td>
                        <td>
                          <StatusPill tone={selected ? 'good' : 'warn'}>{selected ? 'active' : 'installed'}</StatusPill>
                        </td>
                        <td>{formatTimestamp(model.modifiedAt)}</td>
                        <td>{formatModelSize(model.size)}</td>
                        <td className="settings-table__actions">
                          <button className={`button${selected ? ' button--secondary' : ''}`} disabled={settings.isMutating} onClick={() => settings.handleSelectModel(selected ? null : model.name)} type="button">
                            {selected ? 'Clear Active' : 'Make Active'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {!settings.isLoading && installedModels.length === 0 ? (
            <div className="empty-state">
              <h3>No models listed</h3>
              <p>Pull a model above or confirm that the host Ollama runtime is reachable.</p>
            </div>
          ) : null}
        </section>
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Repository registry</h2>
          <p>Register repositories from anywhere on the host filesystem so workflows can select them later with the Select Repository task.</p>
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="repository-name">Repository name</label>
            <input
              className="input"
              id="repository-name"
              onChange={(event) => settings.setRepositoryNameInput(event.target.value)}
              placeholder="frontend-app"
              value={settings.repositoryNameInput}
            />
          </div>
          <div className="form-field">
            <label htmlFor="repository-path">Repository path</label>
            <input
              className="input"
              id="repository-path"
              onChange={(event) => settings.setRepositoryPathInput(event.target.value)}
              placeholder="/Users/you/projects/my-repo"
              value={settings.repositoryPathInput}
            />
            <p className="helper-copy">Absolute paths outside the current workspace are supported as long as they are reachable through host filesystem access.</p>
          </div>
        </div>

        <div className="toolbar-row">
          <button className="button" disabled={settings.isSavingRepositories} onClick={settings.handleSaveRepository} type="button">
            {settings.isSavingRepositories ? 'Saving...' : 'Save Repository'}
          </button>
        </div>

        {settings.repositories.length > 0 ? (
          <div className="table-container table-container--dense">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Path</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {settings.repositories.map((repository) => (
                  <tr key={repository.id}>
                    <td className="settings-table__name-cell">
                      <strong>{repository.name}</strong>
                    </td>
                    <td>{repository.source}</td>
                    <td>{repository.isGitRepository ? 'git' : 'directory'}</td>
                    <td className="settings-table__mono">{repository.hostPath}</td>
                    <td className="settings-table__actions">
                      {repository.source === 'registered' ? (
                        <button className="button button--ghost" disabled={settings.isSavingRepositories} onClick={() => settings.handleDeleteRepository(repository.id)} type="button">
                          Remove
                        </button>
                      ) : (
                        <span className="helper-copy">Managed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel feature-panel--wide">
        <div className="panel__header">
          <h2>Preflight checks</h2>
          <p>These checks run continuously and are the fastest way to spot runtime misconfiguration.</p>
        </div>

        <div className="table-container table-container--dense">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {status.preflight.map((check) => (
                <tr key={check.id}>
                  <td className="settings-table__name-cell">
                    <strong>{check.label}</strong>
                  </td>
                  <td>
                    <StatusPill tone={preflightTone(check.status)}>{check.status}</StatusPill>
                  </td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}