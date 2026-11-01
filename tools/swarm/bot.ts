// One simulated phone: a real SSE connection with jittered reconnect and a polling fallback,
// commands with real commandIds, retries after timeouts with the SAME commandId, and deliberate
// duplicates. Game decisions live in brain.ts.
import { SseConnection } from './sse.ts';
import { mulberry, sleep } from './stats.ts';
import type { CommandResult, View } from '../../shared/protocol.ts';

export interface Counters {
  sent: number;
  ok: number;
  /** Engine/transport error codes returned by the server. */
  errors: Record<string, number>;
  http: Record<string, number>;
  dupSent: number;
  /** A duplicate of an accepted command that was NOT answered ok:true. */
  dupMismatch: number;
  timeouts: number;
  retries: number;
  networkErrors: number;
  rtts: number[];
  bytesSse: number;
  bytesPoll: number;
  bytesCmd: number;
  events: number;
  resyncs: number;
  reconnects: number;
  sseConnects: number;
  polls: number;
  polls304: number;
  maxEventBytes: number;
  staleViewsIgnored: number;
  restartsSeen: number;
}

export function newCounters(): Counters {
  return {
    sent: 0, ok: 0, errors: {}, http: {}, dupSent: 0, dupMismatch: 0, timeouts: 0, retries: 0, networkErrors: 0, rtts: [],
    bytesSse: 0, bytesPoll: 0, bytesCmd: 0, events: 0, resyncs: 0, reconnects: 0, sseConnects: 0, polls: 0, polls304: 0,
    maxEventBytes: 0, staleViewsIgnored: 0, restartsSeen: 0,
  };
}

export interface BotConfig {
  target: string;
  index: number;
  id: string;
  token: string;
  name: string;
  dupRate: number;
  /** Probability that a command request is aborted client-side right after sending (a lost response). */
  abortRate: number;
  seed: number;
  counters: Counters;
  onView?: (bot: Bot, view: View) => void;
}

interface Waiter {
  pred: (v: View) => boolean;
  resolve: (t: number | null) => void;
  timer: NodeJS.Timeout;
}

export class Bot {
  readonly cfg: BotConfig;
  readonly index: number;
  readonly id: string;
  readonly rng: () => number;
  view: View | null = null;
  viewRaw = '';
  lastSeenAt = 0;
  sid: string | null = null;
  stopped = false;
  conn: SseConnection | null = null;
  streamPaused = false;
  retryHint = 3000;
  /** Server clock minus local clock, estimated from view.serverNow. */
  clockOffset = 0;
  private waiters: Waiter[] = [];
  private etag: string | null = null;
  private cmdSeq = 0;
  private gotEventThisConn = false;
  private resyncFlag = false;
  private connectedAt = 0;
  versionsSeen: number[] = [];
  /** Local time of the last resync event. */
  resyncAt = 0;
  /** Free-form per-bot memory for the brain. */
  readonly memo: Record<string, unknown> = {};

  constructor(cfg: BotConfig) {
    this.cfg = cfg;
    this.index = cfg.index;
    this.id = cfg.id;
    this.rng = mulberry(cfg.seed);
  }

  private get c(): Counters {
    return this.cfg.counters;
  }

  // ---- connection ------------------------------------------------------------

  start(): void {
    void this.connectLoop();
  }

  stop(): void {
    this.stopped = true;
    this.conn?.close();
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.waiters = [];
  }

  /** Stop reading the stream without closing it (a phone in a pocket on bad Wi-Fi). */
  stopReading(): void {
    this.streamPaused = true;
    this.conn?.pause();
  }

  private async connectLoop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      this.gotEventThisConn = false;
      const url = `${this.cfg.target}/api/stream?playerId=${this.id}&token=${this.cfg.token}`;
      this.c.sseConnects++;
      this.connectedAt = Date.now();
      let lastBytes = 0;
      const conn = new SseConnection(url, {
        onEvent: e => {
          this.gotEventThisConn = true;
          this.c.events++;
          const bytes = Buffer.byteLength(e.data);
          if (e.event === 'resync') {
            this.c.resyncs++;
            // The server asked everyone to reload: reconnect after a random delay so 200 phones do not stampede.
            this.resyncFlag = true;
            this.resyncAt = Date.now();
            setTimeout(() => this.conn?.close(), Math.floor(this.rng() * 2000));
            return;
          }
          if (bytes > this.c.maxEventBytes) this.c.maxEventBytes = bytes;
          try {
            this.accept(JSON.parse(e.data) as View, e.data);
          } catch {
            /* ignore malformed event */
          }
        },
        onRetry: ms => (this.retryHint = ms),
        onBytes: n => {
          this.c.bytesSse += n;
          lastBytes += n;
        },
      });
      this.conn = conn;
      if (this.streamPaused) conn.pause();
      const res = await conn.done;
      void lastBytes;
      if (this.stopped) break;
      this.c.reconnects++;
      if (this.resyncFlag) {
        this.resyncFlag = false;
        attempt = 0;
        await sleep(50 + Math.floor(this.rng() * 400));
        continue;
      }
      attempt = this.gotEventThisConn && Date.now() - this.connectedAt > 4000 ? 0 : attempt + 1;
      // Full-jitter exponential backoff, starting from the server's retry hint.
      const base = Math.min(30_000, this.retryHint * 2 ** Math.min(attempt - 1, 3));
      const delay = base * (0.5 + this.rng() * 0.5);
      if (res.error && attempt >= 3) await this.pollOnce(); // fall back to polling while the stream is failing
      await sleep(delay);
    }
  }

  async pollOnce(): Promise<void> {
    try {
      this.c.polls++;
      const res = await fetch(`${this.cfg.target}/api/view?playerId=${this.id}&token=${this.cfg.token}`, {
        headers: this.etag ? { 'If-None-Match': this.etag } : {},
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 304) {
        this.c.polls304++;
        return;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return;
      }
      const text = await res.text();
      this.c.bytesPoll += Buffer.byteLength(text);
      this.etag = res.headers.get('etag');
      this.accept(JSON.parse(text) as View, text);
    } catch {
      this.c.networkErrors++;
    }
  }

  private accept(v: View, raw: string): void {
    const now = Date.now();
    if (this.sid !== null && v.sid !== this.sid) this.c.restartsSeen++;
    // A new server instance may restart at a lower version (restored snapshot): accept anything from it.
    if (this.sid === v.sid && this.view && v.v < this.view.v) {
      this.c.staleViewsIgnored++;
      return;
    }
    this.sid = v.sid;
    this.view = v;
    this.viewRaw = raw;
    this.lastSeenAt = now;
    this.clockOffset = v.serverNow - now;
    this.versionsSeen.push(v.v);
    if (this.versionsSeen.length > 50) this.versionsSeen.shift();
    this.cfg.onView?.(this, v);
    if (this.waiters.length > 0) {
      const keep: Waiter[] = [];
      for (const w of this.waiters) {
        if (w.pred(v)) {
          clearTimeout(w.timer);
          w.resolve(now);
        } else keep.push(w);
      }
      this.waiters = keep;
    }
  }

  /** Resolve with the local time at which `pred` first held (null on timeout). */
  waitFor(pred: (v: View) => boolean, timeoutMs: number): Promise<number | null> {
    if (this.view && pred(this.view)) return Promise.resolve(this.lastSeenAt);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w.timer !== timer);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }

  // ---- commands --------------------------------------------------------------

  nextCommandId(): string {
    return `${this.id}-${++this.cmdSeq}-${Math.floor(this.rng() * 1e9).toString(36)}`;
  }

  /** Send a command. Network failures and timeouts are retried with the SAME commandId. */
  async cmd(type: string, payload: unknown = {}, opts: { commandId?: string; dups?: number; noAbort?: boolean } = {}): Promise<{ status: number; body: CommandResult } | null> {
    const commandId = opts.commandId ?? this.nextCommandId();
    const body = JSON.stringify({ commandId, playerId: this.id, token: this.cfg.token, type, payload });
    this.c.sent++;
    let result: { status: number; body: CommandResult } | null = null;
    for (let attempt = 0; attempt < 6 && !this.stopped; attempt++) {
      if (attempt > 0) {
        this.c.retries++;
        await sleep(Math.min(4000, 250 * 2 ** attempt) * (0.5 + this.rng() * 0.5));
      }
      const t0 = performance.now();
      try {
        const abortNow = !opts.noAbort && attempt === 0 && this.cfg.abortRate > 0 && this.rng() < this.cfg.abortRate;
        const res = await this.post(body, abortNow);
        const text = await res.text();
        this.c.bytesCmd += Buffer.byteLength(text);
        this.c.http[res.status] = (this.c.http[res.status] ?? 0) + 1;
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after') ?? 1);
          await sleep(ra * 1000 * (1 + this.rng()));
          continue;
        }
        if (res.status >= 500) continue;
        result = { status: res.status, body: JSON.parse(text) as CommandResult };
        if (this.c.rtts.length < 100_000) this.c.rtts.push(performance.now() - t0);
        break;
      } catch (e) {
        if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) this.c.timeouts++;
        else this.c.networkErrors++;
      }
    }
    if (!result) return null;
    if (result.body.ok) this.c.ok++;
    else this.c.errors[result.body.error ?? 'UNKNOWN'] = (this.c.errors[result.body.error ?? 'UNKNOWN'] ?? 0) + 1;
    // Deliberate duplicates: the server must answer ok for a duplicate of an accepted command.
    const dups = opts.dups ?? (this.rng() < this.cfg.dupRate ? 1 + (this.rng() < 0.3 ? 1 : 0) : 0);
    for (let i = 0; i < dups; i++) {
      this.c.dupSent++;
      void this.post(body, false)
        .then(async r => {
          const t = await r.text();
          this.c.bytesCmd += Buffer.byteLength(t);
          if (result!.body.ok) {
            try {
              if (r.status !== 429 && !(JSON.parse(t) as CommandResult).ok) this.c.dupMismatch++;
            } catch {
              this.c.dupMismatch++;
            }
          }
        })
        .catch(() => undefined);
    }
    return result;
  }

  private async post(body: string, abortAfterSend: boolean): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), abortAfterSend ? 1 + Math.floor(this.rng() * 3) : 8000);
    try {
      return await fetch(`${this.cfg.target}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
