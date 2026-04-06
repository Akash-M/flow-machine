import { loadConfig } from './lib/config';
import { buildServer } from './server';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await buildServer(config);

  await server.listen({
    host: config.host,
    port: config.port
  });

  server.log.info(
    {
      port: config.port,
      privacyMode: config.privacyMode,
      ollamaBaseUrl: config.ollamaBaseUrl,
      repoRoot: config.repoRoot,
      hostAccessRoot: config.hostAccessRoot
    },
    'Flow Machine API is ready.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
