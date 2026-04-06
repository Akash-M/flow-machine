const baseUrl = process.env.FLOW_MACHINE_API_URL ?? 'http://127.0.0.1:3013';

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    },
    ...init
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${body?.message ?? text}`);
  }

  return body;
}

async function pollRun(runId, expectedStatuses, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { run } = await request(`/api/runs/${runId}`);

    if (expectedStatuses.includes(run.status)) {
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for run ${runId} to reach ${expectedStatuses.join(', ')}.`);
}

async function main() {
  const workflowPayload = {
    name: 'Validation Approval Flow',
    description: 'Lifecycle validation workflow for run orchestration.',
    tags: ['validation'],
    definition: {
      version: '1',
      startNodeId: 'search-readme',
      nodes: [
        {
          id: 'search-readme',
          name: 'Search README',
          taskKey: 'search-repo',
          position: { x: 80, y: 120 },
          config: { query: 'Flow Machine', includePattern: 'README.md' }
        },
        {
          id: 'approval-gate',
          name: 'Approval Gate',
          taskKey: 'approval',
          position: { x: 320, y: 120 },
          config: { prompt: 'Approve lifecycle validation.' }
        }
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'search-readme',
          target: 'approval-gate'
        }
      ]
    }
  };

  const { workflow } = await request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(workflowPayload)
  });

  const { run: queuedRun } = await request(`/api/workflows/${workflow.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const waitingRun = await pollRun(queuedRun.id, ['waiting-approval']);
  const approvals = await request('/api/approvals');
  const browser = await request('/api/browser/status');
  const models = await request('/api/models');

  await request('/api/approvals/rules', {
    method: 'PUT',
    body: JSON.stringify({ globalDefaults: ['shell-command'] })
  });

  await request('/api/mcp/import', {
    method: 'POST',
    body: JSON.stringify({
      servers: {
        validation: {
          command: 'node',
          args: ['apps/api/dist/lib/mcp-validation-server.js'],
          cwd: '${workspaceFolder}'
        }
      }
    })
  });

  await request('/api/secrets/VALIDATION_TOKEN', {
    method: 'PUT',
    body: JSON.stringify({ value: 'abc123' })
  });

  const secrets = await request('/api/secrets');
  const mcp = await request('/api/mcp');

  const mcpWorkflowPayload = {
    name: 'Validation MCP Flow',
    description: 'Runtime validation workflow for MCP execution.',
    tags: ['validation', 'mcp'],
    definition: {
      version: '1',
      startNodeId: 'mcp-search',
      nodes: [
        {
          id: 'mcp-search',
          name: 'Validation MCP Search',
          taskKey: 'mcp-call',
          position: { x: 80, y: 120 },
          config: { server: 'validation', tool: 'search', query: 'lifecycle', scope: 'smoke-test' }
        }
      ],
      edges: []
    }
  };

  const { workflow: mcpWorkflow } = await request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(mcpWorkflowPayload)
  });

  const { run: queuedMcpRun } = await request(`/api/workflows/${mcpWorkflow.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  await pollRun(queuedMcpRun.id, ['waiting-approval']);

  await request(`/api/runs/${queuedMcpRun.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const successfulMcpRun = await pollRun(queuedMcpRun.id, ['success']);

  const browserWorkflowPayload = {
    name: 'Validation Browser Flow',
    description: 'Runtime validation workflow for browser automation execution.',
    tags: ['validation', 'browser'],
    definition: {
      version: '1',
      startNodeId: 'browser-step',
      nodes: [
        {
          id: 'browser-step',
          name: 'Browser Validation',
          taskKey: 'browser-automation',
          position: { x: 80, y: 120 },
          config: {
            actions: [
              { type: 'fill', selector: '#query', value: 'validated' },
              { type: 'click', selector: '#save' },
              { type: 'extract', name: 'headline', selector: '#headline' },
              { type: 'extract', name: 'result', selector: '#result' }
            ],
            url: 'data:text/html,<html><body><main><h1 id="headline">Flow Machine</h1><input id="query" /><button id="save" onclick="document.getElementById(\'result\').textContent = document.getElementById(\'query\').value">Save</button><p id="result"></p></main></body></html>'
          }
        }
      ],
      edges: []
    }
  };

  const { workflow: browserWorkflow } = await request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(browserWorkflowPayload)
  });

  const { run: queuedBrowserRun } = await request(`/api/workflows/${browserWorkflow.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  await pollRun(queuedBrowserRun.id, ['waiting-approval']);

  await request(`/api/runs/${queuedBrowserRun.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const successfulBrowserRun = await pollRun(queuedBrowserRun.id, ['success']);

  await request(`/api/runs/${queuedRun.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const successfulRun = await pollRun(queuedRun.id, ['success']);

  const resumeWorkflowPayload = {
    name: 'Validation Resume Flow',
    description: 'Failure and resume validation for run orchestration.',
    tags: ['validation', 'resume'],
    definition: {
      version: '1',
      startNodeId: 'render-secret',
      nodes: [
        {
          id: 'render-secret',
          name: 'Render Secret',
          taskKey: 'template',
          position: { x: 80, y: 120 },
          config: { template: 'token={{secret:VALIDATION_RESUME_TOKEN}}' }
        },
        {
          id: 'resume-approval',
          name: 'Resume Approval',
          taskKey: 'approval',
          position: { x: 320, y: 120 },
          config: { prompt: 'Approve resumed validation flow.' }
        }
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'render-secret',
          target: 'resume-approval'
        }
      ]
    }
  };

  const { workflow: resumeWorkflow } = await request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(resumeWorkflowPayload)
  });

  const { run: failedRun } = await request(`/api/workflows/${resumeWorkflow.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const failedState = await pollRun(failedRun.id, ['failed']);

  await request('/api/secrets/VALIDATION_RESUME_TOKEN', {
    method: 'PUT',
    body: JSON.stringify({ value: 'resume-ready' })
  });

  const { run: resumedRun } = await request(`/api/runs/${failedRun.id}/resume`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const resumedWaitingRun = await pollRun(resumedRun.id, ['waiting-approval']);

  await request(`/api/runs/${resumedRun.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  const resumedSuccessfulRun = await pollRun(resumedRun.id, ['success']);

  console.log(
    JSON.stringify(
      {
        workflowId: workflow.id,
        runId: queuedRun.id,
        waitingStatus: waitingRun.status,
        finalStatus: successfulRun.status,
        resumeInitialStatus: failedState.status,
        resumeWaitingStatus: resumedWaitingRun.status,
        resumeFinalStatus: resumedSuccessfulRun.status,
        mcpFinalStatus: successfulMcpRun.status,
        mcpResultOk: successfulMcpRun.steps[0]?.output?.result?.structuredContent?.ok ?? null,
        browserFinalStatus: successfulBrowserRun.status,
        browserExtracts: successfulBrowserRun.steps[0]?.output?.extracts ?? null,
        approvalPendingCount: approvals.pendingRuns.length,
        browserAvailable: browser.browser.available,
        modelOnline: models.state.online,
        mcpConnections: mcp.connections.length,
        secretCount: secrets.secrets.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});