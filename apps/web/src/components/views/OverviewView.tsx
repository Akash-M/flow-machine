import { AppStatus } from '@flow-machine/shared-types';

import { preflightTone } from '../../lib/dashboard';

const startSteps = [
  {
    title: 'Confirm the local runtime',
    description: 'Check the preflight panel to verify the current workspace root, host filesystem access, data directory, Ollama connectivity, and MCP config state.'
  },
  {
    title: 'Open Workflows Catalog',
    description: 'Create or select a workflow from the catalog, then open it in the editor to assemble nodes, edges, and approval points.'
  },
  {
    title: 'Use the catalog as a guardrail',
    description: 'Review which tasks are local-only, approval-driven, or networked before wiring them into a real flow.'
  }
];

const useCases = [
  {
    title: 'Repository triage',
    description: 'Chain repo search, git inspection, and an agent to produce a concise engineering brief before coding.'
  },
  {
    title: 'Research before change',
    description: 'Collect source context, supporting references, and summarized findings before touching implementation files.'
  },
  {
    title: 'Human-in-the-loop automation',
    description: 'Keep approvals explicit before risky shell commands, writes, or external requests move a workflow forward.'
  }
];

const docsSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'get-started', label: 'Get started' },
  { id: 'workflow-studio', label: 'Workflows Catalog' },
  { id: 'task-catalog', label: 'Task Catalog' },
  { id: 'runtime-checks', label: 'Runtime checks' },
  { id: 'current-focus', label: 'Current focus' }
] as const;

interface OverviewViewProps {
  hasSelectedWorkflow: boolean;
  onOpenCatalog: () => void;
  onOpenStudio: () => void;
  selectedWorkflowName: string;
  selectedWorkflowStatusCopy: string;
  status: AppStatus;
}

export function OverviewView({
  hasSelectedWorkflow,
  onOpenCatalog,
  onOpenStudio,
  selectedWorkflowName,
  selectedWorkflowStatusCopy,
  status
}: OverviewViewProps) {
  return (
    <section className="docs-layout">
      <aside className="docs-sidebar" aria-label="Docs navigation">
        <p className="docs-sidebar__eyebrow">Documentation</p>
        <h2 className="docs-sidebar__title">Flow Machine</h2>
        <nav className="docs-sidebar__nav" aria-label="On this page">
          {docsSections.map((section) => (
            <a className="docs-sidebar__link" href={`#${section.id}`} key={section.id}>
              {section.label}
            </a>
          ))}
        </nav>
        <p className="docs-sidebar__note">
          Local-first workflow automation for developer operations, approvals, and bounded agent work.
        </p>
      </aside>

      <article className="docs-content">
        <header className="docs-header" id="overview">
          <p className="docs-header__eyebrow">Docs</p>
          <h1>Flow Machine documentation</h1>
          <p className="docs-header__lede">
            Flow Machine is for building graph-based automations around code search, git context, bounded agent work,
            and explicit approvals. If you need reusable developer operations that stay close to the repository and
            runtime, this is the surface to build them.
          </p>
        </header>

        <section className="docs-section" id="get-started">
          <h2>Get started</h2>
          <p>
            Start the local stack, confirm the runtime assumptions, and then move into the Workflows Catalog with a clear
            first use case.
          </p>
          <pre className="docs-code-block">
            <code>{status.onboardingCommand}</code>
          </pre>
          <ol className="docs-step-list">
            {startSteps.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="docs-section" id="workflow-studio">
          <h2>Build from the Workflows Catalog</h2>
          <p>
            The Workflows Catalog is the main entry point for authoring. Start from the catalog, then open a specific
            workflow in the editor to add nodes, define edges, and keep risky actions behind explicit approvals.
          </p>
          <ul className="docs-bullet-list">
            <li>Start with an entry node that establishes the first repository or tool action.</li>
            <li>Compose bounded tasks so each node stays easy to inspect and rerun.</li>
            <li>Keep approval nodes close to shell writes, network calls, or actions with user-facing impact.</li>
          </ul>
          <div className="docs-action-row">
            <button className="docs-action-link" onClick={onOpenStudio} type="button">
              Open Workflows Catalog
            </button>
            <button className="docs-action-link" onClick={onOpenCatalog} type="button">
              Review Task Catalog
            </button>
          </div>
        </section>

        <section className="docs-section" id="task-catalog">
          <h2>Use the task catalog as a guardrail</h2>
          <p>
            The catalog is the place to review task boundaries before wiring them into a real flow. Treat it as a
            constraint system, not just a component list.
          </p>
          <ul className="docs-bullet-list">
            {useCases.map((useCase) => (
              <li key={useCase.title}>
                <strong>{useCase.title}.</strong> {useCase.description}
              </li>
            ))}
          </ul>
          <p>
            The current runtime exposes <strong>{status.plannedNodes.length}</strong> planned nodes, so the safest way
            to design a flow is to choose the smallest set of tasks that can complete the job with a clear audit trail.
          </p>
        </section>

        <section className="docs-section" id="runtime-checks">
          <h2>Inspect the runtime</h2>
          <p>
            The product is designed to stay local-first. The runtime model below is the contract the app expects before
            it starts real workflow execution.
          </p>
          <dl className="docs-definition-list">
            <div>
              <dt>Privacy mode</dt>
              <dd>{status.privacy.mode}</dd>
            </div>
            <div>
              <dt>Container runtime</dt>
              <dd>{status.runtime.containerRuntime}</dd>
            </div>
            <div>
              <dt>Current workspace</dt>
              <dd>
                <code>{status.runtime.repoMount.hostPath}</code>
              </dd>
            </div>
            <div>
              <dt>Host filesystem access</dt>
              <dd>
                <code>{status.runtime.hostAccessMount.hostPath}</code>
              </dd>
            </div>
            <div>
              <dt>Data directory</dt>
              <dd>
                <code>{status.runtime.dataDir}</code>
              </dd>
            </div>
            <div>
              <dt>MCP config</dt>
              <dd>
                <code>{status.runtime.mcpConfigPath}</code>
              </dd>
            </div>
            <div>
              <dt>Preflight checks</dt>
              <dd>{status.preflight.length}</dd>
            </div>
          </dl>

          <h3>Preflight checks</h3>
          <ul className="docs-check-list">
            {status.preflight.map((check) => (
              <li key={check.id}>
                <div className="docs-check-list__top">
                  <strong>{check.label}</strong>
                  <span className={`docs-inline-status docs-inline-status--${preflightTone(check.status)}`}>{check.status}</span>
                </div>
                <p>{check.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="docs-section" id="current-focus">
          <h2>Current focus</h2>
          <p>
            {hasSelectedWorkflow
              ? `The studio is currently centered on ${selectedWorkflowName}.`
              : 'No workflow is selected in the studio right now.'}
          </p>
          <p>{selectedWorkflowStatusCopy}</p>
        </section>
      </article>
    </section>
  );
}