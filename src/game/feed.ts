// LiveFeed: one server-sent-events subscription with every resilience rule from docs/PROTOCOL.md.
//  - keeps the last value on screen when the connection drops,
//  - reconnects with jittered exponential backoff,
//  - after two consecutive failures also polls with If-None-Match until the stream is back,
//  - resyncs when the tab becomes visible, regains focus, comes online or is restored from the page cache,
//  - ignores values with a lower version than the one already shown (same server instance only),
//  - handles the server's `resync` event.
// Used for the phone view (/api/stream) and the projector view (/api/screen/stream).
import { SSE_EVENT_RESYNC } from '../../shared/protocol.ts';
import { rand, reconnectDelayMs } from './backoff.ts';

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

export interface Versioned {
  sid: string;
  v: number;
  serverNow: number;
}

export interface FeedOptions<T extends Versioned> {
  /** Full URL of the SSE endpoint (re-evaluated for every connection). */
  streamUrl: () => string;
  /** Full URL of the polling endpoint. */
  pollUrl: () => string;
  /** Called with every accepted value; `serverNow` is the server clock for this value. */
  onValue: (value: T, serverNow: number) => void;
  onStatus: (status: FeedStatus) => void;
  /** Initial version knowledge (from the cached view), so that older pushes are ignored. */
  initial?: { sid: string; v: number } | null;
}

const WATCHDOG_MS = 40_000;

export class LiveFeed<T extends Versioned> {
  private es: EventSource | null = null;
  private failures = 0;
  private status: FeedStatus = 'connecting';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSid: string | null;
  private lastV: number;
  private forceNext = false;
  private etag: string | null = null;
  private stopped = false;
  private lastResyncAt = 0;
  private pollInFlight = false;

  private readonly opts: FeedOptions<T>;

  constructor(opts: FeedOptions<T>) {
    this.opts = opts;
    this.lastSid = opts.initial?.sid ?? null;
    this.lastV = opts.initial?.v ?? -1;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('focus', this.onWake);
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      window.addEventListener('pageshow', this.onWake);
    }
  }

  stop(): void {
    this.stopped = true;
    this.closeStream();
    this.clearTimers();
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onWake);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('pageshow', this.onWake);
  }

  /** One immediate refresh (used after a command when the stream is not live). */
  pollNow(): void {
    void this.poll();
  }

  private isLive(): boolean {
    return this.status === 'live';
  }

  getStatus(): FeedStatus {
    return this.status;
  }

  // ---- internals ----------------------------------------------------------

  private setStatus(s: FeedStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.opts.onStatus(s);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.reconnectTimer = this.pollTimer = this.watchdogTimer = null;
  }

  private closeStream(): void {
    if (this.es) {
      this.es.onopen = this.es.onmessage = this.es.onerror = null;
      this.es.close();
      this.es = null;
    }
  }

  private accept(value: T, serverNow: number): void {
    const sameServer = this.lastSid === value.sid;
    if (!this.forceNext && sameServer && value.v < this.lastV) return; // an older push overtaken on the wire
    this.forceNext = false;
    this.lastSid = value.sid;
    this.lastV = value.v;
    this.opts.onValue(value, serverNow);
  }

  private connect(): void {
    if (this.stopped) return;
    this.closeStream();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline');
      this.scheduleReconnect();
      return;
    }
    let es: EventSource;
    try {
      es = new EventSource(this.opts.streamUrl());
    } catch {
      this.onStreamDown();
      return;
    }
    this.es = es;
    es.onopen = () => {
      // The connection is open; the status turns 'live' when the first event arrives.
    };
    es.onmessage = ev => {
      let value: T;
      try {
        value = JSON.parse(ev.data) as T;
      } catch {
        return;
      }
      this.failures = 0;
      this.stopPolling();
      this.setStatus('live');
      this.accept(value, value.serverNow);
      this.armWatchdog();
    };
    es.addEventListener(SSE_EVENT_RESYNC, () => {
      // The host pressed "force resync": drop the stream, wait 0 to 2 s, reload everything.
      this.closeStream();
      this.forceNext = true;
      this.etag = null;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), rand(0, 2000));
    });
    es.onerror = () => this.onStreamDown();
  }

  private onStreamDown(): void {
    if (this.stopped) return;
    this.closeStream();
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.failures += 1;
    this.setStatus(navigator.onLine === false ? 'offline' : this.status === 'polling' ? 'polling' : 'reconnecting');
    if (this.failures >= 2) this.startPolling();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = reconnectDelayMs(Math.max(0, this.failures - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Detect a silently dead stream: after a long silence check with a cheap conditional GET. */
  private armWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(async () => {
      if (this.stopped || this.status !== 'live') return;
      const ok = await this.poll();
      if (this.stopped) return;
      if (!ok) this.onStreamDown();
      else this.armWatchdog();
    }, WATCHDOG_MS + rand(0, 10_000));
  }

  private startPolling(): void {
    if (this.pollTimer || this.stopped) return;
    const loop = async () => {
      this.pollTimer = null;
      if (this.stopped || this.isLive()) return;
      await this.poll();
      if (this.stopped || this.isLive()) return;
      this.pollTimer = setTimeout(loop, rand(5000, 10_000));
    };
    this.pollTimer = setTimeout(loop, rand(0, 1500));
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** GET the view with If-None-Match. Returns true when the server answered (200 or 304). */
  private async poll(): Promise<boolean> {
    if (this.pollInFlight) return true;
    this.pollInFlight = true;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const headers: Record<string, string> = {};
      if (this.etag) headers['If-None-Match'] = this.etag;
      const res = await fetch(this.opts.pollUrl(), { headers, cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      if (res.status === 304) {
        if (this.status !== 'live') this.setStatus('polling');
        return true;
      }
      if (!res.ok) return false;
      const value = (await res.json()) as T;
      const et = res.headers.get('ETag');
      if (et) this.etag = et;
      const sn = Number(res.headers.get('X-Server-Now'));
      if (this.status !== 'live') this.setStatus('polling');
      this.accept(value, Number.isFinite(sn) && sn > 0 ? sn : value.serverNow);
      return true;
    } catch {
      return false;
    } finally {
      this.pollInFlight = false;
    }
  }

  /** Reopen the stream and poll once, now (with a short jitter so that a whole pub does not hit the server at one instant). */
  private resync(): void {
    if (this.stopped) return;
    const t = Date.now();
    if (t - this.lastResyncAt < 1500) return;
    this.lastResyncAt = t;
    this.failures = 0;
    this.closeStream();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, rand(0, 400));
    void this.poll().then(ok => {
      if (!ok && !this.stopped && this.status === 'live') this.setStatus('reconnecting');
    });
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') this.resync();
  };
  private onWake = (): void => this.resync();
  private onOnline = (): void => {
    if (this.status === 'offline') this.setStatus('reconnecting');
    this.resync();
  };
  private onOffline = (): void => {
    this.setStatus('offline');
  };
}
