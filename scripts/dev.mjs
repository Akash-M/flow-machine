import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { assertPortAvailable, commandEnv, ensureDirectory, projectRoot, resolveHostPath } from './lib.mjs';

const apiPort = process.env.FLOW_MACHINE_PORT ?? '3000';
const webPort = process.env.FLOW_MACHINE_WEB_PORT ?? '5173';
const workspaceRoot = projectRoot();
const repoMount = resolveHostPath(process.env.FLOW_MACHINE_REPO_MOUNT, '.');

function normalizeOllamaBaseUrl(input) {
  const value = input ?? 'http://127.0.0.1:11434';
  return value.replace('host.containers.internal', '127.0.0.1');
}

function resolveMcpConfigPath(dataPath) {
  if (process.env.FLOW_MACHINE_MCP_CONFIG_PATH) {
    return path.resolve(workspaceRoot, process.env.FLOW_MACHINE_MCP_CONFIG_PATH);
  }

  return path.join(dataPath, 'mcp.json');
}

function createMcpConfigFile(mcpConfigPath) {
  ensureDirectory(path.dirname(mcpConfigPath));

  if (!fs.existsSync(mcpConfigPath)) {
    fs.writeFileSync(mcpConfigPath, '{\n  "servers": {}\n}\n', 'utf8');
  }
}

function toYarnInvocation() {
  const yarnEntrypoint = resolveHostPath('.yarn/releases/yarn-4.13.0.cjs', '.yarn/releases/yarn-4.13.0.cjs');
  return {
    command: process.execPath,
    baseArgs: [yarnEntrypoint]
  };
}

function runYarn(args, env) {
  const yarn = toYarnInvocation();
  const result = spawnSync(yarn.command, [...yarn.baseArgs, ...args], {
    stdio: 'inherit',
    env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function spawnYarn(label, args, env) {
  const yarn = toYarnInvocation();
  const child = spawn(yarn.command, [...yarn.baseArgs, ...args], {
    stdio: 'inherit',
    env
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `${label} stopped with signal ${signal}.` : `${label} exited with code ${code ?? 0}.`;
    console.error(reason);
    shutdown(typeof code === 'number' ? code : 1);
  });

  return child;
}

async function ensurePortIsAvailable(port, ownerLabel) {
  try {
    await assertPortAvailable(port);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Free it before starting ${ownerLabel}.`);
      process.exit(1);
    }

    throw error;
  }
}

const dataPath = resolveHostPath(process.env.FLOW_MACHINE_DATA_PATH, './.flow-machine/data');
const mcpConfigPath = resolveMcpConfigPath(dataPath);
const env = {
  ...commandEnv(),
  FLOW_MACHINE_HOST: '0.0.0.0',
  FLOW_MACHINE_PORT: apiPort,
  FLOW_MACHINE_WEB_PORT: webPort,
  FLOW_MACHINE_WEB_DEV_URL: `http://127.0.0.1:${webPort}`,
  FLOW_MACHINE_REPO_ROOT: repoMount,
  FLOW_MACHINE_REPO_MOUNT_SOURCE: repoMount,
  FLOW_MACHINE_DATA_DIR: dataPath,
  FLOW_MACHINE_DATA_PATH_SOURCE: process.env.FLOW_MACHINE_DATA_PATH ?? './.flow-machine/data',
  FLOW_MACHINE_MCP_CONFIG_PATH: mcpConfigPath,
  FLOW_MACHINE_PRIVACY_MODE: process.env.FLOW_MACHINE_PRIVACY_MODE ?? 'local-first',
  FLOW_MACHINE_START_COMMAND: 'corepack yarn local:dev',
  OLLAMA_BASE_URL: normalizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL)
};

let shuttingDown = false;
const children = [];

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }

    process.exit(code);
  }, 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await ensurePortIsAvailable(apiPort, 'the API dev server');
await ensurePortIsAvailable(webPort, 'the web dev server');

ensureDirectory(dataPath);
createMcpConfigFile(mcpConfigPath);

console.log('Starting Flow Machine live-reload mode');
console.log(`  API: http://127.0.0.1:${apiPort}`);
console.log(`  Web: http://127.0.0.1:${webPort}`);
console.log(`  Repo root: ${repoMount}`);
console.log(`  Data dir: ${dataPath}`);
console.log(`  Ollama: ${env.OLLAMA_BASE_URL}`);

for (const workspaceName of ['@flow-machine/shared-types', '@flow-machine/task-sdk', '@flow-machine/engine', '@flow-machine/built-in-tasks']) {
  runYarn(['workspace', workspaceName, 'build'], env);
}

for (const [label, args] of [
  ['shared-types watcher', ['workspace', '@flow-machine/shared-types', 'dev']],
  ['task-sdk watcher', ['workspace', '@flow-machine/task-sdk', 'dev']],
  ['engine watcher', ['workspace', '@flow-machine/engine', 'dev']],
  ['built-in-tasks watcher', ['workspace', '@flow-machine/built-in-tasks', 'dev']],
  ['api dev server', ['workspace', '@flow-machine/api', 'dev']],
  ['web dev server', ['workspace', '@flow-machine/web', 'dev']]
]) {
  children.push(spawnYarn(label, args, env));
}