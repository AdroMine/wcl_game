// A small Server-Sent Events client on top of fetch streaming. It exposes what the swarm needs:
// parsed events, the server's retry hint, byte counts, and a way to stop reading (slow readers).
export interface SseEvent {
  id: string | null;
  event: string;
  data: string;
}

export interface SseHandlers {
  onOpen?: (status: number) => void;
  onEvent: (e: SseEvent) => void;
  onRetry?: (ms: number) => void;
  onBytes?: (n: number) => void;
}

/** Incremental parser: feed text chunks, get complete events. */
export class SseParser {
  private buf = '';
  private data: string[] = [];
  private id: string | null = null;
  private event = 'message';
  retry: number | null = null;

  feed(chunk: string): SseEvent[] {
    this.buf += chunk;
    const out: SseEvent[] = [];
    let nl: number;
    while ((nl = this.buf.search(/\r\n|\n|\r/)) >= 0) {
      const m = /^(\r\n|\n|\r)/.exec(this.buf.slice(nl))!;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + m[0].length);
      if (line === '') {
        if (this.data.length > 0) out.push({ id: this.id, event: this.event, data: this.data.join('\n') });
        this.data = [];
        this.event = 'message';
        continue;
      }
      if (line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      let value = i < 0 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') this.data.push(value);
      else if (field === 'event') this.event = value;
      else if (field === 'id') this.id = value;
      else if (field === 'retry' && /^\d+$/.test(value)) this.retry = Number(value);
    }
    return out;
  }
}

export class SseConnection {
  private abort = new AbortController();
  private paused = false;
  private resumeFn: (() => void) | null = null;
  bytes = 0;
  readonly done: Promise<{ error?: string }>;

  constructor(url: string, handlers: SseHandlers, init: { headers?: Record<string, string> } = {}) {
    this.done = this.run(url, handlers, init);
  }

  private async run(url: string, h: SseHandlers, init: { headers?: Record<string, string> }): Promise<{ error?: string }> {
    try {
      const res = await fetch(url, { headers: { Accept: 'text/event-stream', ...init.headers }, signal: this.abort.signal });
      h.onOpen?.(res.status);
      if (!res.ok || !res.body) return { error: `HTTP ${res.status}` };
      const parser = new SseParser();
      const dec = new TextDecoder();
      const reader = res.body.getReader();
      let lastRetry: number | null = null;
      for (;;) {
        while (this.paused) await new Promise<void>(r => (this.resumeFn = r));
        const { value, done } = await reader.read();
        if (done) return {};
        this.bytes += value.byteLength;
        h.onBytes?.(value.byteLength);
        for (const e of parser.feed(dec.decode(value, { stream: true }))) h.onEvent(e);
        if (parser.retry !== null && parser.retry !== lastRetry) {
          lastRetry = parser.retry;
          h.onRetry?.(parser.retry);
        }
      }
    } catch (e) {
      if (this.abort.signal.aborted) return {};
      return { error: e instanceof Error ? e.message : 'error' };
    }
  }

  /** Stop consuming the stream without closing it (simulates a stalled phone). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.resumeFn?.();
    this.resumeFn = null;
  }

  close(): void {
    this.abort.abort();
    this.resumeFn?.();
  }
}
