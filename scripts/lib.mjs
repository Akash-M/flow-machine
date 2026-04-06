import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

export const containerName = 'flow-machine';
export const imageName = 'flow-machine:dev';
export const appPort = process.env.FLOW_MACHINE_PORT ?? '3000';

export function projectRoot() {
  return process.cwd();
}

export function resolveHostPath(input, fallback) {
  return path.resolve(projectRoot(), input ?? fallback);
}

export function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function commandEnv() {
  const env = { ...process.env };

  if (!env.DOCKER_CONFIG) {
    const dockerConfigPath = resolveHostPath('.flow-machine/docker-config', '.flow-machine/docker-config');
    ensureDirectory(dockerConfigPath);
    env.DOCKER_CONFIG = dockerConfigPath;
  }

  return env;
}

export function buildRunArgs() {
  const repoMount = resolveHostPath(process.env.FLOW_MACHINE_REPO_MOUNT, '.');
  const hostAccessMount = resolveHostPath(process.env.FLOW_MACHINE_HOST_ACCESS_MOUNT, path.parse(projectRoot()).root);
  const dataPath = resolveHostPath(process.env.FLOW_MACHINE_DATA_PATH, './.flow-machine/data');

  ensureDirectory(dataPath);

  const envEntries = {
    FLOW_MACHINE_HOST: '0.0.0.0',
    FLOW_MACHINE_PORT: '3000',
    FLOW_MACHINE_REPO_ROOT: '/workspace/host',
    FLOW_MACHINE_REPO_MOUNT_SOURCE: repoMount,
    FLOW_MACHINE_HOST_ACCESS_ROOT: '/workspace/hostfs',
    FLOW_MACHINE_HOST_ACCESS_MOUNT_SOURCE: hostAccessMount,
    FLOW_MACHINE_DATA_DIR: '/data',
    FLOW_MACHINE_DATA_PATH_SOURCE: process.env.FLOW_MACHINE_DATA_PATH ?? './.flow-machine/data',
    FLOW_MACHINE_MCP_CONFIG_PATH: '/data/mcp.json',
    FLOW_MACHINE_PRIVACY_MODE: process.env.FLOW_MACHINE_PRIVACY_MODE ?? 'local-first',
    FLOW_MACHINE_START_COMMAND: 'corepack yarn local:up',
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? 'http://host.containers.internal:11434'
  };

  const args = [
    'run',
    '-d',
    '--name',
    containerName,
    '--restart',
    'unless-stopped',
    '-p',
    `${appPort}:3000`,
    '-v',
    `${dataPath}:/data`,
    '-v',
    `${repoMount}:/workspace/host`,
    '-v',
    `${hostAccessMount}:/workspace/hostfs`
  ];

  for (const [key, value] of Object.entries(envEntries)) {
    args.push('-e', `${key}=${value}`);
  }

  args.push(imageName);

  return args;
}

export function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: commandEnv()
  });

  if (!allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      server.close();
      reject(error);
    });

    server.once('listening', () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });

    server.listen(Number(port), '0.0.0.0');
  });
}
