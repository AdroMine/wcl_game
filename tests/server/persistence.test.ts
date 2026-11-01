import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Player, admin, sleep, startServer } from './harness.ts';
import { FileSnapshotStore, Persistence, SupabaseSnapshotStore, bootState, gameStateProblem, pauseRestored } from '../../server/persistence/index.ts';
import { createInitialState, reduce } from '../../server/engine/index.ts';
import type { GameState } from '../../server/engine/index.ts';
import { loadConfig } from '../../server/config.ts';
import { Runtime } from '../../server/runtime.ts';

const tmp = () => mkdtemp(join(tmpdir(), 'wcl-persist-'));

function sampleState(players = 6): GameState {
  let s = createInitialState({ seed: 77 });
  const apply = (type: string, actor: { kind: 'admin' } | { kind: 'player'; playerId: string }, payload: unknown = {}) => {
    s = reduce(s, { commandId: `${type}-${s.version}-${Math.random()}`, type, actor, payload }, { now: 5_000 }).state;
  };
  for (let i = 0; i < players; i++) apply('JOIN', { kind: 'player', playerId: `player-${i}-pad` }, { playerId: `player-${i}-pad`, tokenHash: `hash${i}`.padEnd(64, '0'), name: `P${i}` });
  apply('ADMIN_AUTO_GROUP', { kind: 'admin' });
  return s;
}

// ---- state validation ------------------------------------------------------------------------

test('gameStateProblem accepts real states and rejects broken ones', () => {
  const s = sampleState();
  assert.equal(gameStateProblem(s), null);
  assert.equal(gameStateProblem(JSON.parse(JSON.stringify(s))), null);
  assert.ok(gameStateProblem(null));
  assert.ok(gameStateProblem({}));
  assert.ok(gameStateProblem({ ...s, phase: 'NOPE' }));
  assert.ok(gameStateProblem({ ...s, players: [] }));
  assert.ok(gameStateProblem({ ...s, playerOrder: ['ghost'] }));
  const p = Object.keys(s.players)[0];
  assert.ok(gameStateProblem({ ...s, players: { ...s.players, [p]: { ...s.players[p], role: 'wizard' } } }));
  assert.ok(gameStateProblem({ ...s, players: { ...s.players, [p]: { ...s.players[p], teamId: 'missing' } } }));
  assert.ok(gameStateProblem({ ...s, config: { ...s.config, r2: null } }));
});

// ---- file store --------------------------------------------------------------------------------

test('file store: atomic write keeps latest and previous, no temp file is left, corrupt latest falls back', async () => {
  const dir = await tmp();
  try {
    const store = new FileSnapshotStore(dir);
    assert.equal(await store.loadLatest(), null);
    const a = sampleState();
    await store.save({ version: a.version, savedAt: 1000, stateJson: JSON.stringify(a) });
    const b = { ...a, version: a.version + 5 };
    await store.save({ version: b.version, savedAt: 2000, stateJson: JSON.stringify(b) });
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['snapshot.latest.json', 'snapshot.previous.json']);
    const latest = await store.loadLatest();
    assert.equal(latest?.version, b.version);
    assert.equal(latest?.savedAt, 2000);
    assert.deepEqual(latest?.state, b);
    // a torn write of the latest file must not lose the game
    await writeFile(join(dir, 'snapshot.latest.json'), (await readFile(join(dir, 'snapshot.latest.json'), 'utf8')).slice(0, 500));
    const fallback = await store.loadLatest();
    assert.equal(fallback?.version, a.version);
    // a crash between the two renames leaves only "previous": still restorable
    await rm(join(dir, 'snapshot.latest.json'));
    assert.equal((await store.loadLatest())?.version, a.version);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file store: a stray temp file from a crash is ignored and overwritten', async () => {
  const dir = await tmp();
  try {
    const store = new FileSnapshotStore(dir);
    await writeFile(join(dir, 'snapshot.tmp.json'), '{"half":');
    const s = sampleState();
    await store.save({ version: s.version, savedAt: 1, stateJson: JSON.stringify(s) });
    assert.equal((await store.loadLatest())?.version, s.version);
    assert.ok(!(await readdir(dir)).includes('snapshot.tmp.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- restore into PAUSED ---------------------------------------------------------------------

test('pauseRestored freezes the clock at the snapshot time and keeps the version', () => {
  let s = sampleState(10);
  s = reduce(s, { commandId: 'start', type: 'ADMIN_START_GAME', actor: { kind: 'admin' }, payload: {} }, { now: 10_000 }).state;
  const remaining = s.endsAt! - 20_000;
  const p = pauseRestored(s, 20_000, 'boot1');
  assert.equal(p.pausedAt, 20_000);
  assert.equal(p.version, s.version);
  assert.equal(p.endsAt! - p.pausedAt!, remaining);
  // downtime of an hour does not eat the remaining time
  const resumed = reduce(p, { commandId: 'r', type: 'ADMIN_RESUME', actor: { kind: 'admin' }, payload: {} }, { now: 20_000 + 3_600_000 }).state;
  assert.equal(resumed.endsAt! - (20_000 + 3_600_000), remaining);
  assert.equal(pauseRestored(p, 99, 'boot2'), p, 'already paused: untouched');
});

test('server restart restores the same state version, PAUSED; players keep their credentials', async () => {
  const dir = await tmp();
  try {
    const a = await startServer({ keepDir: dir, persistence: { intervalMs: 50 } });
    const players = Array.from({ length: 8 }, (_, i) => new Player(a.url, i + 1));
    for (const p of players) await p.join(p.id);
    assert.ok((await admin(a.url, 'ADMIN_AUTO_GROUP')).ok);
    assert.ok((await admin(a.url, 'ADMIN_START_GAME')).ok);
    const before = a.app.runtime.state;
    const view = await players[0].view();
    assert.equal(view.phase.name, 'R1_ACTIVE');
    await a.app.persistence!.flush();
    await a.close();

    const b = await startServer({ keepDir: dir, persistence: { intervalMs: 50 } });
    const after = b.app.runtime.state;
    assert.equal(b.app.restoredFrom?.startsWith('file'), true);
    assert.equal(after.version, before.version, 'same state version');
    assert.ok(after.pausedAt != null, 'restored into PAUSED');
    assert.equal(after.phase, before.phase);
    assert.deepEqual(Object.keys(after.players), Object.keys(before.players));
    assert.deepEqual(after.teams, before.teams);
    assert.notEqual(b.app.runtime.sid, a.app.runtime.sid, 'new process id so clients accept the restart');
    const again = new Player(b.url, 1); // same id and token, new port
    const v2 = await again.view();
    assert.equal(v2.me?.name, again.id, 'same token still works');
    assert.equal(v2.phase.paused, true);
    assert.equal(v2.me?.slice?.join('\n'), view.me?.slice?.join('\n'), 'same private slice');
    // nothing advances while paused, then an admin resume continues the round
    assert.ok(b.app.runtime.state.pausedAt != null);
    assert.ok((await admin(b.url, 'ADMIN_RESUME')).ok);
    assert.equal(b.app.runtime.state.pausedAt, null);
    await b.cleanup();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a fresh boot starts a new game with a random seed; unreadable snapshots are ignored', async () => {
  const dir = await tmp();
  try {
    const p1 = new Persistence(loadConfig({ SNAPSHOT_DIR: dir }), { loadAttempts: 1 });
    const p2 = new Persistence(loadConfig({ SNAPSHOT_DIR: dir }), { loadAttempts: 1 });
    const s1 = (await bootState(p1)).state;
    const s2 = (await bootState(p2)).state;
    assert.equal(s1.phase, 'LOBBY');
    assert.notEqual(s1.rng, s2.rng);
    await writeFile(join(dir, 'snapshot.latest.json'), 'not json');
    assert.equal((await bootState(p1)).restoredFrom, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- snapshot schedule -----------------------------------------------------------------------------

test('snapshots: immediately at every phase change, every interval only when dirty', async () => {
  const dir = await tmp();
  try {
    const s = await startServer({ keepDir: dir, persistence: { intervalMs: 150 } });
    const p = new Player(s.url, 1);
    await p.join();
    await sleep(400); // dirty -> written by the interval timer
    const store = new FileSnapshotStore(dir);
    assert.equal((await store.loadLatest())?.version, s.app.runtime.state.version);
    const writes1 = s.app.persistence!.status().stores.file.writes;
    await sleep(450); // not dirty: nothing new
    assert.equal(s.app.persistence!.status().stores.file.writes, writes1);
    // phase change: no waiting for the interval (set it long to prove it)
    const long = await startServer({ persistence: { intervalMs: 60_000 } });
    const q = new Player(long.url, 1);
    await q.join();
    await admin(long.url, 'ADMIN_AUTO_GROUP');
    const before = long.app.persistence!.status().stores.file.writes;
    await admin(long.url, 'ADMIN_START_GAME');
    await sleep(250);
    const st = long.app.persistence!.status();
    assert.ok(st.stores.file.writes > before, 'snapshot written at the phase change');
    assert.equal(st.lastSnapshotOk, true);
    assert.ok(st.snapshotAgeSec !== null && st.snapshotAgeSec < 2);
    assert.equal((await new FileSnapshotStore(long.dir).loadLatest())?.state.phase, 'R1_ACTIVE');
    await long.cleanup();
    await s.cleanup();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('graceful close writes a final snapshot', async () => {
  const s = await startServer({ persistence: { intervalMs: 60_000 } });
  const p = new Player(s.url, 1);
  await p.join('Final');
  const v = s.app.runtime.state.version;
  await s.close();
  const snap = await new FileSnapshotStore(s.dir).loadLatest();
  assert.equal(snap?.version, v);
  await s.cleanup();
});

// ---- Supabase against a local fake -----------------------------------------------------------------

interface Row {
  id: number;
  created_at: string;
  version: number;
  state: unknown;
}

class FakeSupabase {
  rows: Row[] = [];
  nextId = 1;
  mode: 'ok' | 'error' | 'slow' = 'ok';
  requests: { method: string; url: string; headers: IncomingMessage['headers'] }[] = [];
  server: Server;
  url = '';
  constructor() {
    this.server = createServer((req, res) => {
      this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      if (this.mode === 'error') {
        res.writeHead(503).end('down');
        return;
      }
      if (this.mode === 'slow') return; // never answers
      const u = new URL(req.url ?? '/', 'http://x');
      if (!u.pathname.endsWith('/rest/v1/snapshots')) {
        res.writeHead(404).end();
        return;
      }
      if (req.headers.apikey !== 'sb_secret_TESTKEY' || req.headers.authorization !== 'Bearer sb_secret_TESTKEY') {
        res.writeHead(401).end('{}');
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c as Buffer));
      req.on('end', () => {
        if (req.method === 'POST') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { version: number; state: unknown };
          this.rows.push({ id: this.nextId++, created_at: new Date().toISOString(), version: body.version, state: body.state });
          res.writeHead(201).end();
        } else if (req.method === 'GET') {
          const order = u.searchParams.get('order');
          let rows = [...this.rows];
          if (order === 'id.desc') rows.reverse();
          const offset = Number(u.searchParams.get('offset') ?? 0);
          const limit = Number(u.searchParams.get('limit') ?? rows.length);
          rows = rows.slice(offset, offset + limit);
          const select = (u.searchParams.get('select') ?? '*').split(',');
          const out = rows.map(r => (select.includes('*') ? r : Object.fromEntries(select.map(k => [k, (r as unknown as Record<string, unknown>)[k]]))));
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
        } else if (req.method === 'DELETE') {
          const m = /^lt\.(\d+)$/.exec(u.searchParams.get('id') ?? '');
          if (!m) {
            res.writeHead(400).end();
            return;
          }
          this.rows = this.rows.filter(r => r.id >= Number(m[1]));
          res.writeHead(204).end();
        } else res.writeHead(405).end();
      });
    });
  }
  async start(): Promise<void> {
    await new Promise<void>(r => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>(r => this.server.close(() => r()));
  }
}

test('supabase store: insert, prune to the latest 50, restore the newest', async () => {
  const fake = new FakeSupabase();
  await fake.start();
  try {
    const store = new SupabaseSnapshotStore({ url: fake.url, key: 'sb_secret_TESTKEY', keep: 50 });
    assert.equal(await store.loadLatest(), null);
    const base = sampleState();
    for (let i = 1; i <= 60; i++) {
      const st = { ...base, version: i };
      await store.save({ version: i, savedAt: i, stateJson: JSON.stringify(st) });
    }
    assert.equal(fake.rows.length, 50);
    assert.equal(fake.rows[0].version, 11, 'oldest kept row is #11');
    assert.equal(fake.rows.at(-1)!.version, 60);
    const latest = await store.loadLatest();
    assert.equal(latest?.version, 60);
    assert.deepEqual(latest?.state.players, base.players);
    // auth headers were sent on every request
    assert.ok(fake.requests.every(r => r.headers.apikey === 'sb_secret_TESTKEY' && r.headers.authorization === 'Bearer sb_secret_TESTKEY'));
    const post = fake.requests.find(r => r.method === 'POST')!;
    assert.match(post.headers['content-type']!, /json/);
  } finally {
    await fake.stop();
  }
});

test('supabase store: bad key, outage and timeouts throw sanitised errors', async () => {
  const fake = new FakeSupabase();
  await fake.start();
  try {
    const wrong = new SupabaseSnapshotStore({ url: fake.url, key: 'sb_secret_WRONGKEY', timeoutMs: 300 });
    await assert.rejects(wrong.save({ version: 1, savedAt: 1, stateJson: '{}' }), (e: Error) => /HTTP 401/.test(e.message) && !e.message.includes('WRONGKEY'));
    fake.mode = 'error';
    const store = new SupabaseSnapshotStore({ url: fake.url, key: 'sb_secret_TESTKEY', timeoutMs: 300 });
    await assert.rejects(store.loadLatest(), /HTTP 503/);
    fake.mode = 'slow';
    await assert.rejects(store.loadLatest(), /timeout/);
    await fake.stop();
    await assert.rejects(store.loadLatest(), /network error/);
  } finally {
    await fake.stop().catch(() => undefined);
  }
});

test('supabase outage never crashes or blocks the game; snapshots resume when it returns; no secret is logged', async () => {
  const fake = new FakeSupabase();
  await fake.start();
  const logs: string[] = [];
  const origWarn = console.warn;
  const origErr = console.error;
  console.warn = (...a: unknown[]) => logs.push(a.join(' '));
  console.error = (...a: unknown[]) => logs.push(a.join(' '));
  const dir = await tmp();
  try {
    fake.mode = 'error';
    const s = await startServer({
      keepDir: dir,
      env: { SNAPSHOT_STORE: 'supabase', SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY' },
      persistence: { intervalMs: 60_000, backoffBaseMs: 60, loadAttempts: 2, loadRetryMs: 10 },
    });
    assert.equal(s.app.restoredFrom, null, 'unreachable store at boot: fresh game, not a crash');
    const p = new Player(s.url, 1);
    await p.join('Resilient');
    const t0 = Date.now();
    await admin(s.url, 'ADMIN_AUTO_GROUP');
    await admin(s.url, 'ADMIN_START_GAME'); // phase change => snapshot attempt against the dead store
    assert.ok(Date.now() - t0 < 500, 'the game did not wait for the store');
    await sleep(300);
    let st = s.app.persistence!.status();
    assert.equal(st.stores.supabase.ok, false);
    assert.equal(st.lastSnapshotOk, false);
    assert.equal(st.stores.file.ok, true, 'file store keeps working');
    assert.equal((await p.view()).phase.name, 'R1_ACTIVE', 'game keeps serving');
    assert.equal((await (await fetch(`${s.url}/health`)).json() as { lastSnapshotOk: boolean }).lastSnapshotOk, false);
    // outage ends: the writer retries with backoff and catches up with the newest state
    fake.mode = 'ok';
    await sleep(900);
    st = s.app.persistence!.status();
    assert.equal(st.stores.supabase.ok, true, JSON.stringify(st));
    assert.ok(fake.rows.length >= 1);
    assert.equal(fake.rows.at(-1)!.version, s.app.runtime.state.version);
    await s.cleanup();
    assert.ok(!logs.join('\n').includes('sb_secret_TESTKEY'), 'secret key never logged');
    assert.ok(logs.some(l => l.includes('supabase')), 'failures were logged');
  } finally {
    console.warn = origWarn;
    console.error = origErr;
    await fake.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('boot restores the newest snapshot from supabase (and prefers it over an older file)', async () => {
  const fake = new FakeSupabase();
  await fake.start();
  const dirA = await tmp();
  const dirB = await tmp();
  try {
    const env = { SNAPSHOT_STORE: 'supabase', SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY' };
    const a = await startServer({ keepDir: dirA, env, persistence: { intervalMs: 50 } });
    for (let i = 1; i <= 5; i++) await new Player(a.url, i).join(`S${i}`);
    await admin(a.url, 'ADMIN_AUTO_GROUP');
    await a.app.persistence!.flush();
    const v = a.app.runtime.state.version;
    await a.close();
    assert.equal(fake.rows.at(-1)!.version, v);
    // a different machine (empty disk) comes up from Supabase alone
    const b = await startServer({ keepDir: dirB, env, persistence: { intervalMs: 50 } });
    assert.equal(b.app.restoredFrom, 'supabase');
    assert.equal(b.app.runtime.state.version, v);
    assert.ok(b.app.runtime.state.pausedAt != null);
    assert.equal(b.app.runtime.state.playerOrder.length, 5);
    await b.close();
  } finally {
    await fake.stop();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test('runtime persistence listener: snapshot content equals the live state', async () => {
  const dir = await tmp();
  try {
    const rt = new Runtime(sampleState());
    const p = new Persistence(loadConfig({ SNAPSHOT_DIR: dir }), { intervalMs: 20 });
    p.start(rt);
    rt.apply({ commandId: 'x1', type: 'ADMIN_RENAME_TEAM', actor: { kind: 'admin' }, payload: { teamId: rt.state.teamOrder[0], name: 'Renamed Crew' } });
    await sleep(120);
    const snap = await new FileSnapshotStore(dir).loadLatest();
    assert.deepEqual(snap?.state, JSON.parse(JSON.stringify(rt.state)));
    await p.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
