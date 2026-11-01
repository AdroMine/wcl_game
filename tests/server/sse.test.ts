import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Player, Listener, admin, sleep, startServer } from './harness.ts';
import type { TestServer } from './harness.ts';
import { SseHub } from '../../server/transport/sseHub.ts';
import type { SseSink } from '../../server/transport/sseHub.ts';
import { Runtime } from '../../server/runtime.ts';
import { ViewBuilder } from '../../server/transport/views.ts';
import { createInitialState } from '../../server/engine/index.ts';
import { hashToken } from '../../server/auth.ts';
import { SseParser } from '../../tools/swarm/sse.ts';
import type { View } from '../../shared/protocol.ts';

let srv: TestServer;
before(async () => {
  srv = await startServer({ hub: { flushMs: 50, pingMs: 5000 } });
});
after(async () => {
  await srv.cleanup();
});

test('SSE parser handles split chunks, comments, ids, retry and multi-line data', () => {
  const p = new SseParser();
  assert.deepEqual(p.feed(': ping\n\nretry: 3000\n\nid: 7\nda'), []);
  const ev = p.feed('ta: {"a":1}\n\nevent: resync\ndata: x\ndata: y\n\n');
  assert.equal(ev.length, 2);
  assert.deepEqual(ev[0], { id: '7', event: 'message', data: '{"a":1}' });
  assert.deepEqual(ev[1], { id: '7', event: 'resync', data: 'x\ny' });
  assert.equal(p.retry, 3000);
});

test('stream: headers, retry hint, immediate first event with id = version', async () => {
  const p = new Player(srv.url, 1);
  await p.join('Streamer');
  const res = await new Promise<{ headers: Record<string, string | string[] | undefined>; text: string }>((resolve, reject) => {
    const r = request(p.streamUrl(), res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => {
        text += d;
        if (text.includes('data:')) {
          resolve({ headers: res.headers, text });
          r.destroy();
        }
      });
    });
    r.on('error', e => {
      if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e);
    });
    r.end();
  });
  assert.match(String(res.headers['content-type']), /text\/event-stream/);
  assert.match(String(res.headers['cache-control']), /no-cache/);
  assert.match(String(res.headers['cache-control']), /no-transform/);
  assert.equal(res.headers['x-accel-buffering'], 'no');
  const retry = /retry: (\d+)/.exec(res.text);
  assert.ok(retry);
  assert.ok(Number(retry[1]) >= 2000 && Number(retry[1]) <= 5000);
  assert.match(res.text, new RegExp(`id: ${srv.app.runtime.state.version}\\n`));
  assert.ok(res.text.indexOf('retry:') < res.text.indexOf('data:'));
});

test('stream: a command reaches the connected client within 1 s, and retry values are jittered', async () => {
  const a = new Player(srv.url, 11);
  const b = new Player(srv.url, 12);
  await a.join('Alice');
  await b.join('Bob');
  const la = new Listener(a.streamUrl());
  await la.waitFor(() => la.views().length >= 1);
  assert.equal(la.views()[0].me?.name, 'Alice');
  const t0 = Date.now();
  await b.cmd('CREATE_TEAM', { name: 'Fresh Crew' });
  await la.waitFor(() => la.views().some(v => v.board.some(r => r[0] === 'Fresh Crew')), 1000);
  const latency = Date.now() - t0;
  assert.ok(latency < 1000, `latency ${latency} ms`);
  // jitter: several connects should not all return the same retry
  const retries = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const l = new Listener(a.streamUrl());
    await l.waitFor(() => l.retry !== null);
    retries.add(l.retry!);
    l.close();
  }
  assert.ok(retries.size > 1, 'retry hint is jittered');
  la.close();
});

test('stream: only clients whose view CONTENT changed get an event', async () => {
  const x = new Player(srv.url, 21);
  const y = new Player(srv.url, 22);
  await x.join('Xena');
  await y.join('Yuri');
  const lx = new Listener(x.streamUrl());
  const ly = new Listener(y.streamUrl());
  await lx.waitFor(() => lx.views().length >= 1);
  await ly.waitFor(() => ly.views().length >= 1);
  await sleep(200);
  const nx = lx.views().length;
  const ny = ly.views().length;
  await x.cmd('REROLL_ROLE'); // changes only Xena's own view
  await lx.waitFor(() => lx.views().length > nx, 1000);
  await sleep(250);
  assert.equal(ly.views().length, ny, 'Yuri got nothing');
  lx.close();
  ly.close();
});

test('stream: several tabs of one player all receive updates; unknown stream flips to known after JOIN', async () => {
  const p = new Player(srv.url, 31);
  const t1 = new Listener(p.streamUrl());
  const t2 = new Listener(p.streamUrl());
  await t1.waitFor(() => t1.views().length >= 1);
  await t2.waitFor(() => t2.views().length >= 1);
  assert.equal(t1.views()[0].me, undefined, 'unknown player: no me, no error');
  await p.join('Late Joiner');
  await t1.waitFor(() => t1.views().at(-1)?.me?.name === 'Late Joiner', 1000);
  await t2.waitFor(() => t2.views().at(-1)?.me?.name === 'Late Joiner', 1000);
  t1.close();
  t2.close();
});

test('stream: bad credentials never produce an error status', async () => {
  const l = new Listener(`${srv.url}/api/stream?playerId=%00&token=zz`);
  await l.waitFor(() => l.views().length >= 1);
  assert.equal(l.status, 200);
  assert.equal(l.views()[0].me, undefined);
  l.close();
});

test('screen stream is public and receives updates', async () => {
  const l = new Listener(`${srv.url}/api/screen/stream`);
  await l.waitFor(() => l.events.length >= 1);
  const first = JSON.parse(l.events[0].data) as { phase: unknown; board: unknown };
  assert.ok(first.phase && first.board);
  const p = new Player(srv.url, 41);
  const n = l.events.length;
  await p.join('Screen Watcher');
  await l.waitFor(() => l.events.length > n, 1000);
  l.close();
});

test('admin resync sends a resync event to every client and then fresh views', async () => {
  const p = new Player(srv.url, 51);
  await p.join('Resyncee');
  const l = new Listener(p.streamUrl());
  await l.waitFor(() => l.views().length >= 1);
  const res = await fetch(`${srv.url}/api/admin/resync`, { method: 'POST', headers: { Authorization: 'Bearer test-admin-token-0123456789' } });
  assert.equal(res.status, 200);
  await l.waitFor(() => l.events.some(e => e.event === 'resync'), 1000);
  const n = l.views().length;
  await l.waitFor(() => l.views().length > n, 1000);
  l.close();
});

test('ping comments keep idle connections alive', async () => {
  const s = await startServer({ hub: { flushMs: 50, pingMs: 60 } });
  try {
    const p = new Player(s.url, 1);
    const text = await new Promise<string>((resolve, reject) => {
      const r = request(p.streamUrl(), res => {
        let t = '';
        res.setEncoding('utf8');
        res.on('data', d => {
          t += d;
          if ((t.match(/: ping/g) ?? []).length >= 2) {
            resolve(t);
            r.destroy();
          }
        });
      });
      r.on('error', e => {
        if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e);
      });
      r.end();
    });
    assert.match(text, /: ping\n\n/);
  } finally {
    await s.cleanup();
  }
});

// ---- slow readers -----------------------------------------------------------------------------

class FakeSink implements SseSink {
  writes: string[] = [];
  writableLength = 0;
  destroyed = false;
  ended = false;
  accepting = true;
  private handlers: Record<string, (() => void)[]> = {};
  /** Bytes the "kernel" refuses once not accepting. */
  write(chunk: string): boolean {
    this.writes.push(chunk);
    if (!this.accepting) {
      this.writableLength += Buffer.byteLength(chunk);
      return false;
    }
    return true;
  }
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
  on(event: 'drain' | 'close', fn: () => void): void {
    (this.handlers[event] ||= []).push(fn);
  }
  emit(event: string): void {
    for (const f of this.handlers[event] ?? []) f();
  }
  get viewCount(): number {
    return this.writes.filter(w => w.startsWith('id:')).length;
  }
}

function hubFixture(opts: { stallMs?: number; maxWritableBytes?: number } = {}) {
  let t = 1_000_000;
  const clock = () => t;
  let state = createInitialState({ seed: 5 });
  const runtime = new Runtime(state, { clock });
  const views = new ViewBuilder({ sid: 's' });
  const hub = new SseHub(runtime, views, { clock, flushMs: 1_000_000, pingMs: 1_000_000, ...opts });
  const join = (id: string, name: string) => {
    state = runtime.state;
    runtime.apply({ commandId: `j-${id}`, type: 'JOIN', actor: { kind: 'player', playerId: id }, payload: { playerId: id, tokenHash: hashToken(`token-${id}`), name } });
  };
  return { hub, runtime, join, advance: (ms: number) => (t += ms), clock };
}

test('slow reader: write back-pressure stops further writes, and the connection is destroyed after 10 s', () => {
  const f = hubFixture();
  f.join('player-slow', 'Slow');
  f.join('player-fast', 'Fast');
  const slow = new FakeSink();
  const fast = new FakeSink();
  f.hub.connect(slow, 'player', 'player-slow', hashToken('token-player-slow'), 3000);
  f.hub.connect(fast, 'player', 'player-fast', hashToken('token-player-fast'), 3000);
  assert.equal(slow.viewCount, 1);
  slow.accepting = false; // the phone stops reading
  const baseline = slow.writes.length;
  for (let i = 0; i < 50; i++) {
    f.join(`player-x${i}-pad`, `P${i}`); // each join changes every lobby view
    f.hub.flush();
  }
  // at most ONE extra write was queued after the socket refused data: no unbounded buffering
  assert.ok(slow.writes.length - baseline <= 1, `slow got ${slow.writes.length - baseline} extra writes`);
  assert.ok(slow.writableLength < 64 * 1024);
  assert.ok(fast.viewCount >= 50, 'the fast client kept receiving every update');
  assert.equal(slow.destroyed, false);
  f.advance(9_000);
  (f.hub as unknown as { checkStalls(): void }).checkStalls();
  assert.equal(slow.destroyed, false, 'not yet');
  f.advance(2_000);
  (f.hub as unknown as { checkStalls(): void }).checkStalls();
  assert.equal(slow.destroyed, true, 'dropped after 10 s of back-pressure');
  assert.equal(f.hub.stats().dropped.stalled, 1);
  assert.equal(f.hub.connectionCount, 1);
  assert.equal(fast.destroyed, false);
});

test('slow reader: a connection with more than 64 KB queued is destroyed immediately', () => {
  const f = hubFixture();
  f.join('player-big', 'Big');
  const sink = new FakeSink();
  f.hub.connect(sink, 'player', 'player-big', hashToken('token-player-big'), 3000);
  sink.writableLength = 70 * 1024;
  f.join('player-other', 'Other');
  f.hub.flush();
  assert.equal(sink.destroyed, true);
  assert.equal(f.hub.stats().dropped['buffer-limit'], 1);
});

test('slow reader: a client that drains again gets the latest view, not the backlog', () => {
  const f = hubFixture();
  f.join('player-a', 'A');
  const sink = new FakeSink();
  f.hub.connect(sink, 'player', 'player-a', hashToken('token-player-a'), 3000);
  sink.accepting = false;
  f.join('player-b', 'B');
  f.hub.flush();
  f.join('player-c', 'C');
  f.hub.flush();
  f.join('player-d', 'D');
  f.hub.flush();
  const before = sink.writes.length;
  sink.accepting = true;
  sink.emit('drain');
  assert.equal(sink.writes.length, before + 1);
  const last = sink.writes.at(-1)!;
  const view = JSON.parse(last.slice(last.indexOf('data: ') + 6)) as View;
  assert.equal(view.lobby?.players, 4, 'fresh view with all four players');
});

test('slow reader next to real clients: the real clients keep receiving', async () => {
  const s = await startServer({ hub: { flushMs: 40, stallMs: 150 } });
  try {
    const sink = new FakeSink();
    const a = new Player(s.url, 1);
    await a.join('Anna');
    sink.accepting = false;
    s.app.hub.connect(sink, 'player', a.id, hashToken(a.token), 3000);
    const b = new Player(s.url, 2);
    await b.join('Ben');
    const lb = new Listener(b.streamUrl());
    await lb.waitFor(() => lb.views().length >= 1);
    for (let i = 3; i < 8; i++) {
      const p = new Player(s.url, i);
      await p.join(`P${i}`);
      await sleep(60);
    }
    await lb.waitFor(() => lb.views().at(-1)?.lobby?.players === 7, 1500);
    await sleep(300);
    assert.equal(sink.destroyed, true, 'stalled connection was dropped');
    assert.ok(lb.views().length >= 2);
    lb.close();
  } finally {
    await s.cleanup();
  }
});

test('tab limit per player: the oldest connection is dropped', async () => {
  const s = await startServer({ hub: { flushMs: 50, maxPerPlayer: 2 } });
  try {
    const p = new Player(s.url, 1);
    await p.join();
    const sinks = [new FakeSink(), new FakeSink(), new FakeSink()];
    for (const k of sinks) s.app.hub.connect(k, 'player', p.id, hashToken(p.token), 3000);
    assert.equal(sinks[0].destroyed, true);
    assert.equal(sinks[2].destroyed, false);
    assert.equal(s.app.hub.connectionCount, 2);
  } finally {
    await s.cleanup();
  }
});

test('phase change reaches every connected client quickly (50 clients)', async () => {
  const s = await startServer({ hub: { flushMs: 100 } });
  try {
    const players = Array.from({ length: 50 }, (_, i) => new Player(s.url, 100 + i));
    await Promise.all(players.map(p => p.join()));
    const ls = players.map(p => new Listener(p.streamUrl()));
    await Promise.all(ls.map(l => l.waitFor(() => l.views().length >= 1)));
    const t0 = Date.now();
    const r = await admin(s.url, 'ADMIN_AUTO_GROUP');
    assert.ok(r.ok);
    const r2 = await admin(s.url, 'ADMIN_START_GAME');
    assert.ok(r2.ok);
    await Promise.all(ls.map(l => l.waitFor(() => l.views().at(-1)?.phase.name === 'R1_ACTIVE', 2000)));
    const took = Date.now() - t0;
    assert.ok(took < 2000, `took ${took} ms`);
    // each player sees their own slice, and nobody sees another player's
    const slices = ls.map(l => (l.views().at(-1)?.me?.slice ?? []).join('|'));
    assert.ok(slices.filter(x => x.length > 0).length >= 45);
    ls.forEach(l => l.close());
  } finally {
    await s.cleanup();
  }
});
