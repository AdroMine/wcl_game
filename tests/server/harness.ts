// Test harness: start the whole app in-process on an ephemeral port.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.ts';
import type { App, AppOptions } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import type { ServerConfig } from '../../server/config.ts';
import { SseConnection } from '../../tools/swarm/sse.ts';
import type { SseEvent } from '../../tools/swarm/sse.ts';
import type { CommandResult, View } from '../../shared/protocol.ts';

export const ADMIN_TOKEN = 'test-admin-token-0123456789';

export interface TestServer {
  app: App;
  url: string;
  port: number;
  dir: string;
  config: ServerConfig;
  close(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function startServer(opts: Partial<AppOptions> & { env?: Record<string, string>; keepDir?: string } = {}): Promise<TestServer> {
  const dir = opts.keepDir ?? (await mkdtemp(join(tmpdir(), 'wcl-test-')));
  const config = loadConfig({ ADMIN_TOKEN, SNAPSHOT_DIR: dir, PORT: '0', ...(opts.env ?? {}) });
  const { env: _env, keepDir: _k, ...rest } = opts;
  void _env;
  void _k;
  const app = await createApp({ config, quiet: true, ...rest });
  const port = await app.listen(0, '127.0.0.1');
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    port,
    dir,
    config,
    close: () => app.close(),
    async cleanup() {
      await app.close();
      if (!opts.keepDir) await rm(dir, { recursive: true, force: true });
    },
  };
}

let seq = 0;
export const cid = (p = 'c') => `${p}-${process.pid}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

export class Player {
  readonly url: string;
  readonly id: string;
  readonly token: string;
  constructor(url: string, n: number | string) {
    this.url = url;
    this.id = `player-${String(n).padStart(4, '0')}`;
    this.token = `tok-${this.id}-${'x'.repeat(24)}`;
  }
  async cmd(type: string, payload: unknown = {}, commandId = cid()): Promise<{ status: number; body: CommandResult }> {
    const res = await fetch(`${this.url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId, playerId: this.id, token: this.token, type, payload }),
    });
    return { status: res.status, body: (await res.json()) as CommandResult };
  }
  async join(name = this.id): Promise<void> {
    const r = await this.cmd('JOIN', { name });
    if (!r.body.ok) throw new Error(`join failed ${JSON.stringify(r)}`);
  }
  async view(): Promise<View> {
    const res = await fetch(`${this.url}/api/view?playerId=${this.id}&token=${this.token}`);
    return (await res.json()) as View;
  }
  streamUrl(): string {
    return `${this.url}/api/stream?playerId=${this.id}&token=${this.token}`;
  }
}

export async function admin(url: string, type: string, payload: unknown = {}, commandId?: string): Promise<CommandResult> {
  const res = await fetch(`${url}/api/admin/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload, ...(commandId ? { commandId } : {}) }),
  });
  return (await res.json()) as CommandResult;
}

export async function adminGet(url: string, path: string): Promise<Response> {
  return fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
}

/** An SSE listener that records events and lets tests wait for a condition. */
export class Listener {
  readonly events: SseEvent[] = [];
  readonly times: number[] = [];
  conn: SseConnection;
  retry: number | null = null;
  status = 0;
  constructor(url: string) {
    this.conn = new SseConnection(url, {
      onOpen: s => (this.status = s),
      onEvent: e => {
        this.events.push(e);
        this.times.push(Date.now());
      },
      onRetry: ms => (this.retry = ms),
    });
  }
  views(): View[] {
    return this.events.filter(e => e.event === 'message').map(e => JSON.parse(e.data) as View);
  }
  async waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting (${this.events.length} events)`);
      await new Promise(r => setTimeout(r, 10));
    }
  }
  close(): void {
    this.conn.close();
  }
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
