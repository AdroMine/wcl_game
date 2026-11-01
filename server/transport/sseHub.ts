// SSE connection hub. Broadcasts are coalesced: a state change only marks the hub dirty; a flush timer
// (every 300 ms while dirty) builds each connected player's view and writes it only to clients whose
// view CONTENT changed since their last event. Slow readers are dropped instead of buffered.
import { SSE_EVENT_RESYNC } from '../../shared/protocol.ts';
import type { Runtime } from '../runtime.ts';
import type { ViewBuilder } from './views.ts';

/** The subset of http.ServerResponse the hub needs (also implemented by test fakes). */
export interface SseSink {
  write(chunk: string): boolean;
  readonly writableLength: number;
  end(): void;
  destroy(): void;
  on(event: 'drain' | 'close', listener: () => void): unknown;
}

export interface SseHubOptions {
  flushMs?: number;
  pingMs?: number;
  /** Destroy a connection whose queued bytes exceed this. */
  maxWritableBytes?: number;
  /** Destroy a connection that has been unable to accept writes for this long. */
  stallMs?: number;
  maxConnections?: number;
  maxPerPlayer?: number;
  clock?: () => number;
}

type Kind = 'player' | 'screen';

interface Client {
  id: number;
  kind: Kind;
  res: SseSink;
  playerId: string | null;
  tokenHash: string | null;
  lastHash: string | null;
  blockedSince: number | null;
  stale: boolean;
  bytesOut: number;
  closed: boolean;
}

export interface HubStats {
  clients: number;
  players: number;
  screens: number;
  dropped: Record<string, number>;
  bytesOut: number;
  eventsOut: number;
  maxWritableSeen: number;
  flushes: number;
  lastFlushMs: number;
  maxFlushMs: number;
}

export class SseHub {
  private readonly runtime: Runtime;
  private readonly views: ViewBuilder;
  private readonly flushMs: number;
  private readonly pingMs: number;
  private readonly maxWritable: number;
  private readonly stallMs: number;
  private readonly maxConnections: number;
  private readonly maxPerPlayer: number;
  private readonly clock: () => number;
  private clients = new Map<number, Client>();
  private byPlayer = new Map<string, Set<number>>();
  private nextId = 1;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  readonly dropped: Record<string, number> = {};
  private bytesOut = 0;
  private eventsOut = 0;
  private maxWritableSeen = 0;
  private flushes = 0;
  private lastFlushMs = 0;
  private maxFlushMs = 0;

  constructor(runtime: Runtime, views: ViewBuilder, opts: SseHubOptions = {}) {
    this.runtime = runtime;
    this.views = views;
    this.flushMs = opts.flushMs ?? 300;
    this.pingMs = opts.pingMs ?? 15_000;
    this.maxWritable = opts.maxWritableBytes ?? 64 * 1024;
    this.stallMs = opts.stallMs ?? 10_000;
    this.maxConnections = opts.maxConnections ?? 2000;
    this.maxPerPlayer = opts.maxPerPlayer ?? 4;
    this.clock = opts.clock ?? Date.now;
  }

  start(): void {
    if (this.flushTimer) return;
    this.unsubscribe = this.runtime.subscribe(() => this.markDirty());
    this.flushTimer = setInterval(() => {
      this.checkStalls();
      if (this.dirty) this.flush();
    }, this.flushMs);
    this.pingTimer = setInterval(() => this.ping(), this.pingMs);
    this.flushTimer.unref();
    this.pingTimer.unref();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.flushTimer = this.pingTimer = null;
    for (const c of [...this.clients.values()]) {
      try {
        c.res.end();
      } catch {
        /* ignore */
      }
      this.remove(c);
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  connectedPlayerIds(): string[] {
    return [...this.byPlayer.keys()];
  }

  stats(): HubStats {
    let players = 0;
    let screens = 0;
    for (const c of this.clients.values()) (c.kind === 'player' ? players++ : screens++);
    return {
      clients: this.clients.size,
      players,
      screens,
      dropped: { ...this.dropped },
      bytesOut: this.bytesOut,
      eventsOut: this.eventsOut,
      maxWritableSeen: this.maxWritableSeen,
      flushes: this.flushes,
      lastFlushMs: this.lastFlushMs,
      maxFlushMs: this.maxFlushMs,
    };
  }

  // ---- connect ---------------------------------------------------------------

  /**
   * Register a connection whose response head has already been written. Sends `retry:` and the first
   * view immediately. Returns false (and ends the response) when the server is over capacity.
   */
  connect(res: SseSink, kind: Kind, playerId: string | null, tokenHash: string | null, retryMs: number): boolean {
    if (this.clients.size >= this.maxConnections) {
      this.bump('capacity');
      res.end();
      return false;
    }
    const client: Client = { id: this.nextId++, kind, res, playerId: kind === 'player' ? playerId : null, tokenHash, lastHash: null, blockedSince: null, stale: false, bytesOut: 0, closed: false };
    this.clients.set(client.id, client);
    if (client.playerId) {
      let set = this.byPlayer.get(client.playerId);
      if (!set) this.byPlayer.set(client.playerId, (set = new Set()));
      set.add(client.id);
      // A player may have several tabs, but not unboundedly many: drop the oldest.
      if (set.size > this.maxPerPlayer) {
        const oldest = this.clients.get(Math.min(...set));
        if (oldest) this.drop(oldest, 'too-many-tabs');
      }
    }
    res.on('close', () => this.remove(client));
    res.on('drain', () => {
      client.blockedSince = null;
      if (client.stale && !client.closed) {
        client.stale = false;
        client.lastHash = null;
        this.sendView(client, this.clock());
      }
    });
    this.write(client, `retry: ${retryMs}\n\n`);
    this.sendView(client, this.clock());
    return true;
  }

  // ---- flush -----------------------------------------------------------------

  private viewFor(c: Client, now: number, cache: Map<string, ReturnType<ViewBuilder['forPlayer']>>) {
    const state = this.runtime.state;
    if (c.kind === 'screen') {
      let s = cache.get('\0screen') as unknown as { json: string; hash: string } | undefined;
      if (!s) {
        s = this.views.screen(state, now);
        cache.set('\0screen', s as never);
      }
      return { json: s.json, hash: s.hash, v: state.version };
    }
    const key = `${c.playerId ?? ''}\0${c.tokenHash ?? ''}`;
    let b = cache.get(key);
    if (!b) {
      b = this.views.forPlayer(state, c.playerId, c.tokenHash, now);
      cache.set(key, b);
    }
    return { json: b.json, hash: b.hash, v: state.version };
  }

  private sendView(c: Client, now: number, cache = new Map<string, ReturnType<ViewBuilder['forPlayer']>>()): void {
    const v = this.viewFor(c, now, cache);
    if (v.hash === c.lastHash) return;
    if (this.write(c, `id: ${v.v}\ndata: ${v.json}\n\n`)) c.lastHash = v.hash;
    else c.lastHash = null;
  }

  flush(): void {
    const t0 = this.clock();
    this.dirty = false;
    this.flushes++;
    const cache = new Map<string, ReturnType<ViewBuilder['forPlayer']>>();
    for (const c of [...this.clients.values()]) {
      if (c.closed) continue;
      if (c.blockedSince != null) {
        c.stale = true; // the newest view is sent when the socket drains
        continue;
      }
      try {
        this.sendView(c, t0, cache);
      } catch (e) {
        console.error('view build failed', e instanceof Error ? e.message : 'unknown');
      }
    }
    this.lastFlushMs = this.clock() - t0;
    if (this.lastFlushMs > this.maxFlushMs) this.maxFlushMs = this.lastFlushMs;
  }

  /** Tell every client to reload its view (admin "force resync"), then push fresh views. */
  resync(): number {
    this.views.invalidate();
    const payload = `event: ${SSE_EVENT_RESYNC}\ndata: {"sid":"${this.views.sid}","v":${this.runtime.state.version}}\n\n`;
    let n = 0;
    for (const c of [...this.clients.values()]) {
      c.lastHash = null;
      if (c.blockedSince != null) {
        c.stale = true;
        continue;
      }
      if (this.write(c, payload)) n++;
    }
    this.dirty = true;
    return n;
  }

  // ---- low level -------------------------------------------------------------

  private write(c: Client, text: string): boolean {
    if (c.closed) return false;
    let ok: boolean;
    try {
      ok = c.res.write(text);
    } catch {
      this.drop(c, 'write-error');
      return false;
    }
    c.bytesOut += text.length;
    this.bytesOut += Buffer.byteLength(text);
    if (text.startsWith('id:') || text.startsWith('event:')) this.eventsOut++;
    const queued = c.res.writableLength;
    if (queued > this.maxWritableSeen) this.maxWritableSeen = queued;
    if (queued > this.maxWritable) {
      this.drop(c, 'buffer-limit');
      return false;
    }
    if (!ok) {
      if (c.blockedSince == null) c.blockedSince = this.clock();
      c.stale = true;
      return false;
    }
    return true;
  }

  private ping(): void {
    for (const c of [...this.clients.values()]) {
      if (c.blockedSince != null) continue;
      this.write(c, ': ping\n\n');
    }
  }

  private checkStalls(): void {
    const now = this.clock();
    for (const c of [...this.clients.values()]) {
      if (c.blockedSince != null && now - c.blockedSince > this.stallMs) this.drop(c, 'stalled');
    }
  }

  private bump(reason: string): void {
    this.dropped[reason] = (this.dropped[reason] ?? 0) + 1;
  }

  private drop(c: Client, reason: string): void {
    if (c.closed) return;
    this.bump(reason);
    this.remove(c);
    try {
      c.res.destroy();
    } catch {
      /* ignore */
    }
  }

  private remove(c: Client): void {
    if (c.closed) return;
    c.closed = true;
    this.clients.delete(c.id);
    if (c.playerId) {
      const set = this.byPlayer.get(c.playerId);
      if (set) {
        set.delete(c.id);
        if (set.size === 0) this.byPlayer.delete(c.playerId);
      }
    }
  }
}
