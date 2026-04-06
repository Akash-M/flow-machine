import { containerName, runCommand } from './lib.mjs';

runCommand('podman', ['rm', '-f', containerName], { allowFailure: true });
