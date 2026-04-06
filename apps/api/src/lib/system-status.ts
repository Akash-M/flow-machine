import fs from 'node:fs/promises';
import { URL } from 'node:url';

import { builtInTaskNames } from '@flow-machine/built-in-tasks';
import { createEngineSummary } from '@flow-machine/engine';
import { AppStatus, PreflightCheck, ServiceHealth, ServiceHealthState } from '@flow-machine/shared-types';

import { AppConfig } from './config';
import { getBrowserRuntimeStatus } from './browser-runtime';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function asPreflightState(status: ServiceHealthState): PreflightCheck['status'] {
  if (status === 'online') {
    return 'ready';
  }

  if (status === 'degraded') {
    return 'warning';
  }

  return 'missing';
}

async function checkOllama(baseUrl: string): Promise<ServiceHealth> {
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(new URL('/api/tags', baseUrl), {
      signal: AbortSignal.timeout(2_500)
    });

    if (!response.ok) {
      return {
        name: 'ollama',
        status: 'degraded',
        checkedAt,
        message: `Reached Ollama but received HTTP ${response.status}.`,
        url: baseUrl
      };
    }

    return {
      name: 'ollama',
      status: 'online',
      checkedAt,
      message: 'Host-native Ollama is reachable from the application container.',
      url: baseUrl
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown connectivity error.';

    return {
      name: 'ollama',
      status: 'offline',
      checkedAt,
      message: `Could not reach Ollama at ${baseUrl}: ${message}`,
      url: baseUrl
    };
  }
}

function buildPrivacySummary(config: AppConfig): string {
  if (config.privacyMode === 'strict-local') {
    return 'Strict local-only mode blocks all outbound network access beyond localhost.';
  }

  return 'Local-first mode keeps execution local by default and surfaces approved network access explicitly.';
}

export async function buildAppStatus(config: AppConfig): Promise<AppStatus> {
  const [repoRootExists, hostAccessRootExists, dataDirExists, mcpConfigExists, ollama, browserRuntime] = await Promise.all([
    pathExists(config.repoRoot),
    pathExists(config.hostAccessRoot),
    pathExists(config.dataDir),
    pathExists(config.mcpConfigPath),
    checkOllama(config.ollamaBaseUrl),
    getBrowserRuntimeStatus()
  ]);

  const strictModeConflict = config.privacyMode === 'strict-local' && !isLoopbackUrl(config.ollamaBaseUrl);

  const preflight: PreflightCheck[] = [
    {
      id: 'repo-mount',
      label: 'Current workspace root',
      status: repoRootExists ? 'ready' : 'missing',
      detail: repoRootExists
        ? `The default workspace root is available at ${config.repoRoot}.`
        : `The expected workspace root ${config.repoRoot} is not available inside the runtime.`,
      required: true
    },
    {
      id: 'host-access-mount',
      label: 'Host filesystem access',
      status: hostAccessRootExists ? 'ready' : 'missing',
      detail: hostAccessRootExists
        ? `Registered repositories can resolve through ${config.hostAccessRoot}.`
        : `The configured host filesystem access root ${config.hostAccessRoot} is not available inside the runtime.`,
      required: true
    },
    {
      id: 'data-directory',
      label: 'Persistent data directory',
      status: dataDirExists ? 'ready' : 'warning',
      detail: dataDirExists
        ? `App data is persisted at ${config.dataDir}.`
        : `The data directory ${config.dataDir} does not exist yet and will be created on startup.`,
      required: true
    },
    {
      id: 'ollama',
      label: 'Host-native Ollama',
      status: asPreflightState(ollama.status),
      detail: ollama.message,
      required: true
    },
    {
      id: 'privacy-runtime',
      label: 'Privacy mode compatibility',
      status: strictModeConflict ? 'warning' : 'ready',
      detail: strictModeConflict
        ? 'Strict local-only mode and host-native Ollama may conflict because the container reaches Ollama through host.containers.internal rather than localhost.'
        : 'The current runtime configuration is compatible with the selected privacy mode.',
      required: false
    },
    {
      id: 'mcp-config',
      label: 'MCP configuration file',
      status: mcpConfigExists ? 'ready' : 'warning',
      detail: mcpConfigExists
        ? `MCP configuration is available at ${config.mcpConfigPath}.`
        : 'No MCP configuration file is present yet. The app will initialize an empty file on first start.',
      required: false
    },
    {
      id: 'browser-runtime',
      label: 'Browser automation runtime',
      status: browserRuntime.available ? 'ready' : 'warning',
      detail: browserRuntime.message,
      required: false
    }
  ];

  return {
    appName: 'Flow Machine',
    version: config.appVersion,
    startedAt: config.startedAt,
    onboardingCommand: config.startupCommand,
    privacy: {
      mode: config.privacyMode,
      networkAllowed: config.privacyMode !== 'strict-local',
      summary: buildPrivacySummary(config)
    },
    ollama,
    runtime: {
      containerRuntime: 'podman',
      nodeVersion: process.version,
      repoMount: {
        hostPath: config.repoMountSource,
        containerPath: config.repoRoot,
        readOnly: false,
        mode: 'mounted'
      },
      hostAccessMount: {
        hostPath: config.hostAccessMountSource,
        containerPath: config.hostAccessRoot,
        readOnly: false,
        mode: 'mounted'
      },
      dataDir: config.dataPathSource,
      mcpConfigPath: config.mcpConfigPath,
      hostNativeOllama: true
    },
    engine: createEngineSummary(),
    capabilities: {
      approvals: true,
      exportFormat: 'json',
      hostNativeOllama: true,
      mcpImport: 'vscode-mcp.json'
    },
    preflight,
    plannedNodes: builtInTaskNames
  };
}
