// Entry point: wiring only. Run with `node server/index.ts` (dev) or `node dist-server/server/index.js` (prod).
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp({ config });
  const port = await app.listen(config.port);
  console.log(`game server listening on :${port} (${config.nodeEnv}, snapshots: ${config.snapshotStore})`);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: writing final snapshot and closing`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    app.close().then(
      () => process.exit(0),
      e => {
        console.error('shutdown failed', e instanceof Error ? e.message : 'unknown');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', e => console.error('unhandled rejection', e instanceof Error ? e.message : 'unknown'));
  process.on('uncaughtException', e => console.error('uncaught exception', e instanceof Error ? e.message : 'unknown'));
}

main().catch(e => {
  console.error('fatal:', e instanceof Error ? e.message : 'unknown');
  process.exit(1);
});
