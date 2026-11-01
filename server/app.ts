// Application assembly: builds the runtime, scheduler, persistence, SSE hub and HTTP server.
// index.ts only loads the config and calls createApp(); tests call it with port 0 and fake options.
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createAdminAuth } from './auth.ts';
import type { ServerConfig } from './config.ts';
import { createInitialState } from './engine/index.ts';
import type { GameState } from './engine/index.ts';
import { Persistence, bootState } from './persistence/index.ts';
import type { PersistenceOptions } from './persistence/index.ts';
import { Runtime } from './runtime.ts';
import { Scheduler } from './scheduler.ts';
import { createHttpServer } from './transport/http.ts';
import { DEFAULT_RATE_LIMITS } from './transport/rateLimit.ts';
import type { RateLimitConfig } from './transport/rateLimit.ts';
import { SseHub } from './transport/sseHub.ts';
import type { SseHubOptions } from './transport/sseHub.ts';
import { ViewBuilder } from './transport/views.ts';

export interface AppOptions {
  config: ServerConfig;
  /** Start from this state instead of restoring/creating one (tests). */
  initialState?: GameState;
  /** Do not read or write snapshots (tests that do not care about persistence). */
  noPersistence?: boolean;
  persistence?: PersistenceOptions;
  hub?: SseHubOptions;
  limits?: Partial<RateLimitConfig>;
  schedulerIntervalMs?: number;
  clock?: () => number;
  quiet?: boolean;
}

export interface App {
  server: Server;
  runtime: Runtime;
  hub: SseHub;
  views: ViewBuilder;
  persistence: Persistence | null;
  scheduler: Scheduler;
  restoredFrom: string | null;
  /** Listen on the given port (0 = ephemeral). Resolves with the bound port. */
  listen(port?: number, host?: string): Promise<number>;
  /** Final snapshot, close every connection, stop timers. */
  close(): Promise<void>;
}

export async function createApp(opts: AppOptions): Promise<App> {
  const { config } = opts;
  const log = (m: string) => {
    if (!opts.quiet) console.log(m);
  };
  for (const w of config.warnings) if (!opts.quiet) console.warn(`warning: ${w}`);

  const persistence = opts.noPersistence ? null : new Persistence(config, opts.persistence);
  let initial: GameState;
  let restoredFrom: string | null = null;
  if (opts.initialState) {
    initial = opts.initialState;
  } else if (persistence) {
    const boot = await bootState(persistence);
    initial = boot.state;
    restoredFrom = boot.restoredFrom;
  } else {
    initial = createInitialState({ seed: randomBytes(4).readUInt32BE(0) });
  }
  const runtime = new Runtime(initial, { clock: opts.clock });
  if (restoredFrom) log(`restored game from ${restoredFrom}: phase ${initial.phase}, version ${initial.version}, PAUSED until an admin resumes`);
  else if (!opts.initialState) log('started a fresh game');

  const views = new ViewBuilder({ sid: runtime.sid, publicUrl: config.publicUrl });
  const hub = new SseHub(runtime, views, opts.hub);
  const scheduler = new Scheduler(runtime, { intervalMs: opts.schedulerIntervalMs });
  const server = createHttpServer({
    config,
    runtime,
    hub,
    views,
    persistence,
    admin: createAdminAuth(config.adminToken),
    limits: { ...DEFAULT_RATE_LIMITS, ...opts.limits },
  });

  let closed = false;
  const app: App = {
    server,
    runtime,
    hub,
    views,
    persistence,
    scheduler,
    restoredFrom,
    async listen(port = config.port, host?: string) {
      runtime.startMonitoring();
      hub.start();
      scheduler.start();
      persistence?.start(runtime);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    },
    async close() {
      if (closed) return;
      closed = true;
      scheduler.stop();
      hub.stop();
      server.close();
      server.closeAllConnections();
      runtime.stopMonitoring();
      if (persistence) await persistence.stop();
    },
  };
  return app;
}
