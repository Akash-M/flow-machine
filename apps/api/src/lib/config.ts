import { PrivacyMode } from '@flow-machine/shared-types';

export interface AppConfig {
  host: string;
  port: number;
  webDevUrl: string | null;
  repoRoot: string;
  repoMountSource: string;
  hostAccessRoot: string;
  hostAccessMountSource: string;
  dataDir: string;
  dataPathSource: string;
  mcpConfigPath: string;
  privacyMode: PrivacyMode;
  ollamaBaseUrl: string;
  startupCommand: string;
  appVersion: string;
  startedAt: string;
}

function parsePort(input: string | undefined, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parsePrivacyMode(input: string | undefined): PrivacyMode {
  return input === 'strict-local' ? 'strict-local' : 'local-first';
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.FLOW_MACHINE_HOST ?? '0.0.0.0',
    port: parsePort(process.env.FLOW_MACHINE_PORT, 3000),
    webDevUrl: process.env.FLOW_MACHINE_WEB_DEV_URL ?? null,
    repoRoot: process.env.FLOW_MACHINE_REPO_ROOT ?? '/workspace/host',
    repoMountSource: process.env.FLOW_MACHINE_REPO_MOUNT_SOURCE ?? '.',
    hostAccessRoot: process.env.FLOW_MACHINE_HOST_ACCESS_ROOT ?? process.env.FLOW_MACHINE_REPO_ROOT ?? '/workspace/host',
    hostAccessMountSource: process.env.FLOW_MACHINE_HOST_ACCESS_MOUNT_SOURCE ?? process.env.FLOW_MACHINE_REPO_MOUNT_SOURCE ?? '.',
    dataDir: process.env.FLOW_MACHINE_DATA_DIR ?? '/data',
    dataPathSource: process.env.FLOW_MACHINE_DATA_PATH_SOURCE ?? './.flow-machine/data',
    mcpConfigPath: process.env.FLOW_MACHINE_MCP_CONFIG_PATH ?? '/data/mcp.json',
    privacyMode: parsePrivacyMode(process.env.FLOW_MACHINE_PRIVACY_MODE),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://host.containers.internal:11434',
    startupCommand: process.env.FLOW_MACHINE_START_COMMAND ?? 'corepack yarn local:up',
    appVersion: process.env.FLOW_MACHINE_APP_VERSION ?? '0.1.0',
    startedAt: new Date().toISOString()
  };
}
