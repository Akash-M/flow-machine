import { McpViewModel } from '../../hooks/useFlowMachineApp';
import { StatusPill } from '../StatusPill';

interface McpViewProps {
  mcp: McpViewModel;
}

export function McpView({ mcp }: McpViewProps) {
  return (
    <section className="view-grid view-grid--catalog">
      <section className="panel">
        <div className="panel__header">
          <h2>Managed connections</h2>
          <p>Imported MCP servers are stored locally and can be edited or removed here.</p>
        </div>

        <div className="stack-list">
          {mcp.connections.length === 0 ? (
            <div className="empty-state">
              <h3>No MCP servers yet</h3>
              <p>Import an existing mcp.json file or create a server definition manually.</p>
            </div>
          ) : (
            mcp.connections.map((connection) => (
              <article className="stack-list__item" key={connection.id}>
                <div className="stack-list__title-row">
                  <h3>{connection.id}</h3>
                  <StatusPill tone={connection.transport === 'unknown' ? 'warn' : 'good'}>{connection.transport}</StatusPill>
                </div>
                <p>{connection.target}</p>
                <div className="toolbar-row toolbar-row--compact">
                  <button className="button button--secondary" disabled={mcp.isMutating} onClick={() => mcp.handleDeleteServer(connection.id)} type="button">
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Import or edit MCP JSON</h2>
          <p>Paste a VS Code-style mcp.json payload or save a single server definition by id.</p>
        </div>

        <div className="form-field">
          <label htmlFor="mcp-import-json">Import JSON</label>
          <textarea className="textarea textarea--code" id="mcp-import-json" onChange={(event) => mcp.setImportText(event.target.value)} rows={10} value={mcp.importText} />
        </div>

        <div className="toolbar-row">
          <button className="button" disabled={mcp.isMutating} onClick={mcp.handleImportConfig} type="button">
            Import Config
          </button>
        </div>

        <div className="form-field">
          <label htmlFor="mcp-server-id">Server id</label>
          <input className="input" id="mcp-server-id" onChange={(event) => mcp.setServerIdInput(event.target.value)} placeholder="filesystem" value={mcp.serverIdInput} />
        </div>
        <div className="form-field">
          <label htmlFor="mcp-server-json">Server definition JSON</label>
          <textarea className="textarea textarea--code" id="mcp-server-json" onChange={(event) => mcp.setServerDefinitionText(event.target.value)} rows={10} value={mcp.serverDefinitionText} />
        </div>
        <div className="toolbar-row">
          <button className="button button--secondary" disabled={mcp.isMutating} onClick={mcp.handleSaveServer} type="button">
            Save Server
          </button>
        </div>

        {mcp.errorMessage ? <p className="error-copy">{mcp.errorMessage}</p> : null}
      </section>
    </section>
  );
}