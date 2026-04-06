import { appPort, assertPortAvailable, buildRunArgs, containerName, imageName, runCommand } from './lib.mjs';

try {
	await assertPortAvailable(appPort);
} catch (error) {
	if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
		console.error(
			`Port ${appPort} is already in use. Set FLOW_MACHINE_PORT in .env to an unused port, then run corepack yarn local:up again.`
		);
		process.exit(1);
	}

	throw error;
}

runCommand('podman', ['build', '-f', 'container/Containerfile', '-t', imageName, '.']);
runCommand('podman', ['rm', '-f', containerName], { allowFailure: true });
runCommand('podman', buildRunArgs());
