import { SecretsViewModel } from '../../hooks/useFlowMachineApp';
import { StatusPill } from '../StatusPill';

interface SecretsViewProps {
  secrets: SecretsViewModel;
}

export function SecretsView({ secrets }: SecretsViewProps) {
  return (
    <section className="view-grid view-grid--catalog">
      <section className="panel">
        <div className="panel__header">
          <h2>Stored secrets</h2>
          <p>
            Secrets are excluded from workflow exports and resolved at runtime via placeholders such as <code>{'{{secret:API_KEY}}'}</code>.
          </p>
        </div>

        <div className="stack-list">
          {secrets.secrets.length === 0 ? (
            <div className="empty-state">
              <h3>No secrets stored</h3>
              <p>Create a secret manually or import a block of .env content.</p>
            </div>
          ) : (
            secrets.secrets.map((entry) => (
              <article className="stack-list__item" key={entry.key}>
                <div className="stack-list__title-row">
                  <h3>{entry.key}</h3>
                  <StatusPill tone="good">{entry.backend}</StatusPill>
                </div>
                <p>Updated {new Date(entry.updatedAt).toLocaleString()}</p>
                <div className="toolbar-row toolbar-row--compact">
                  <button className="button button--secondary" disabled={secrets.isMutating} onClick={() => secrets.handleDeleteSecret(entry.key)} type="button">
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
          <h2>Add or import</h2>
          <p>Manual secrets are useful for single values. Bulk import is useful when you already have a .env file.</p>
        </div>

        <div className="form-field">
          <label htmlFor="secret-key">Secret key</label>
          <input className="input" id="secret-key" onChange={(event) => secrets.setSecretKeyInput(event.target.value)} placeholder="OPENAI_API_KEY" value={secrets.secretKeyInput} />
        </div>
        <div className="form-field">
          <label htmlFor="secret-value">Secret value</label>
          <textarea className="textarea" id="secret-value" onChange={(event) => secrets.setSecretValueInput(event.target.value)} rows={4} value={secrets.secretValueInput} />
        </div>
        <div className="toolbar-row">
          <button className="button" disabled={secrets.isMutating} onClick={secrets.handleSaveSecret} type="button">
            Save Secret
          </button>
        </div>

        <div className="form-field">
          <label htmlFor="secret-import-env">Import .env content</label>
          <textarea className="textarea textarea--code" id="secret-import-env" onChange={(event) => secrets.setImportEnvText(event.target.value)} rows={10} value={secrets.importEnvText} />
        </div>
        <div className="toolbar-row">
          <button className="button button--secondary" disabled={secrets.isMutating} onClick={secrets.handleImportEnv} type="button">
            Import Env Secrets
          </button>
        </div>

        {secrets.errorMessage ? <p className="error-copy">{secrets.errorMessage}</p> : null}
      </section>
    </section>
  );
}