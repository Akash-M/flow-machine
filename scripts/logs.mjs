import { containerName, runCommand } from './lib.mjs';

runCommand('podman', ['logs', '-f', containerName]);
