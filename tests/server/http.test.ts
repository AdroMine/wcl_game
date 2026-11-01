import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADMIN_TOKEN, Player, admin, adminGet, cid, startServer } from './harness.ts';
import type { TestServer } from './harness.ts';
import type { CommandResult, Meta, View } from '../../shared/protocol.ts';

let srv: TestServer;
before(async () => {
  srv = await startServer({ limits: { adminFailures: { ratePerSec: 5, burst: 100 } } });
});
after(async () => {
  await srv.cleanup();
});

test('command dedupe over HTTP: the same commandId applies once, both calls report ok', async () => {
  const p = new Player(srv.url, 1);
  await p.join('Dupe Tester');
  const before = srv.app.runtime.state.version;
  const id = cid();
  const a = await p.cmd('CREATE_TEAM', { name: 'Twice' }, id);
  const b = await p.cmd('CREATE_TEAM', { name: 'Twice' }, id);
  assert.ok(a.body.ok && b.body.ok);
  assert.equal(a.body.v, before + 1);
  assert.equal(b.body.v, a.body.v);
  assert.equal(Object.values(srv.app.runtime.state.teams).filter(t => t.name === 'Twice').length, 1);
  // same command with a NEW id is a real second attempt: the engine rejects it (already in a team)
  const c = await p.cmd('CREATE_TEAM', { name: 'Twice' });
  assert.equal(c.body.ok, false);
  assert.equal(c.body.error, 'ALREADY_IN_TEAM');
  // a duplicate of a rejected command reports ok (deduped) without changing anything
  const rej = cid();
  const r1 = await p.cmd('REROLL_ROLE', {}, rej);
  const r2 = await p.cmd('REROLL_ROLE', {}, rej);
  assert.equal(r1.body.error, 'ALREADY_IN_TEAM');
  assert.ok(r2.body.ok);
});

test('join is idempotent per player and cannot be hijacked with another token', async () => {
  const p = new Player(srv.url, 2);
  await p.join('Original');
  await p.join('Original'); // retry with a new commandId: no-op
  const hijack = new Player(srv.url, 2);
  (hijack as { token: string }).token = 'a-different-token-0123456789abcdef';
  const r = await hijack.cmd('JOIN', { name: 'Evil' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'UNAUTHORIZED');
  assert.equal(srv.app.runtime.state.players[p.id].name, 'Original');
  assert.equal(Object.values(srv.app.runtime.state.players).filter(x => x.id === p.id).length, 1);
  // the stored credential is a hash, never the token
  const stored = srv.app.runtime.state.players[p.id].tokenHash;
  assert.notEqual(stored, p.token);
  assert.match(stored, /^[0-9a-f]{64}$/);
});

test('auth: bad token and unknown player are 401; malformed bodies are 400; bad JSON is 400', async () => {
  const p = new Player(srv.url, 3);
  await p.join();
  const bad = new Player(srv.url, 3);
  (bad as { token: string }).token = 'wrong-token-wrong-token-wrong';
  assert.equal((await bad.cmd('REROLL_ROLE')).status, 401);
  const ghost = new Player(srv.url, 999);
  const g = await ghost.cmd('REROLL_ROLE');
  assert.equal(g.status, 401);
  assert.equal(g.body.error, 'UNAUTHORIZED');
  const post = (body: string) => fetch(`${srv.url}/api/command`, { method: 'POST', body });
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post(JSON.stringify({ commandId: 'x' }))).status, 400);
  const r = await post(JSON.stringify({ commandId: 'abc', playerId: p.id, token: p.token, type: 'R3_VOTE', payload: { vessel: 'NOPE' } }));
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as CommandResult).error, 'BAD_REQUEST');
  // a player cannot send admin commands through the player endpoint
  const adm = await post(JSON.stringify({ commandId: 'abc2', playerId: p.id, token: p.token, type: 'ADMIN_START_GAME', payload: {} }));
  assert.equal(adm.status, 400);
});

test('payload over 8 KB is rejected with 413 PAYLOAD_TOO_LARGE', async () => {
  const p = new Player(srv.url, 4);
  const big = JSON.stringify({ commandId: cid(), playerId: p.id, token: p.token, type: 'JOIN', payload: { name: 'x'.repeat(9000) } });
  const res = await fetch(`${srv.url}/api/command`, { method: 'POST', body: big });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as CommandResult).error, 'PAYLOAD_TOO_LARGE');
});

test('admin endpoints require the bearer token', async () => {
  for (const [method, path] of [['GET', '/api/admin/view'], ['GET', '/api/admin/backup'], ['POST', '/api/admin/command'], ['POST', '/api/admin/restore'], ['POST', '/api/admin/resync']] as const) {
    const none = await fetch(`${srv.url}${path}`, { method, body: method === 'POST' ? '{}' : undefined });
    assert.equal(none.status, 401, `${path} without token`);
    const wrong = await fetch(`${srv.url}${path}`, { method, headers: { Authorization: 'Bearer nope' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(wrong.status, 401, `${path} with wrong token`);
  }
  const ok = await admin(srv.url, 'ADMIN_RENAME_TEAM', { teamId: 'nope', name: 'x' });
  assert.equal(ok.ok, false);
  assert.equal(ok.error, 'UNKNOWN_TEAM');
  const unknown = await fetch(`${srv.url}/api/admin/command`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify({ type: 'ADMIN_NOPE' }) });
  assert.equal(unknown.status, 400);
});

test('admin brute force is rate limited per IP', async () => {
  const s = await startServer({ limits: { adminFailures: { ratePerSec: 0.001, burst: 3 } } });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await fetch(`${s.url}/api/admin/view`, { headers: { Authorization: `Bearer guess-${i}` } })).status);
    assert.deepEqual(codes.slice(0, 3), [401, 401, 401]);
    assert.ok(codes.slice(3).every(c => c === 429), JSON.stringify(codes));
    // even the right token is refused while the budget is spent: guesses are not evaluated
    assert.equal((await adminGet(s.url, '/api/admin/view')).status, 429);
  } finally {
    await s.cleanup();
  }
});

test('admin is disabled (503) when no ADMIN_TOKEN is configured', async () => {
  const s = await startServer({ env: { ADMIN_TOKEN: '' } });
  try {
    assert.equal((await fetch(`${s.url}/api/admin/view`, { headers: { Authorization: 'Bearer anything' } })).status, 503);
  } finally {
    await s.cleanup();
  }
});

test('polling fallback: ETag and 304 until the content changes', async () => {
  const p = new Player(srv.url, 5);
  await p.join('Poller');
  const url = `${srv.url}/api/view?playerId=${p.id}&token=${p.token}`;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag')!;
  assert.ok(etag);
  assert.ok(first.headers.get('x-server-now'));
  const v1 = (await first.json()) as View;
  assert.equal(v1.me?.name, 'Poller');
  const again = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get('etag'), etag);
  assert.ok(again.headers.get('x-server-now'));
  // unrelated change somewhere else in the same version space does not change THIS player's content
  const other = new Player(srv.url, 6);
  await other.cmd('JOIN', { name: 'Other' }); // lobby counts change => content changes (lobby.players)
  const changed = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('etag'), etag);
  // changing own name changes the view
  await p.cmd('JOIN', { name: 'Renamed' });
  const third = await fetch(url, { headers: { 'If-None-Match': changed.headers.get('etag')! } });
  assert.equal(third.status, 200);
  assert.equal(((await third.json()) as View).me?.name, 'Renamed');
});

test('view for unknown credentials is a 200 without `me`, never an error', async () => {
  for (const q of ['', '?playerId=nobody-1234&token=whatever-whatever-whatever', '?playerId=%00%00&token=%%%', `?playerId=${'x'.repeat(500)}&token=${'y'.repeat(500)}`]) {
    const res = await fetch(`${srv.url}/api/view${q}`);
    assert.equal(res.status, 200, q);
    const v = (await res.json()) as View;
    assert.equal(v.me, undefined);
    assert.ok(v.phase);
  }
});

test('rate limit: per-player command bucket returns 429 RATE_LIMITED', async () => {
  const s = await startServer({ limits: { playerCommands: { ratePerSec: 1, burst: 5 } } });
  try {
    const p = new Player(s.url, 1);
    await p.join();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await p.cmd('REROLL_ROLE')).status);
    assert.ok(codes.filter(c => c === 429).length >= 5, JSON.stringify(codes));
    const last = await p.cmd('REROLL_ROLE');
    assert.equal(last.status, 429);
    assert.equal(last.body.error, 'RATE_LIMITED');
    // another player is unaffected
    const q = new Player(s.url, 2);
    await q.join();
    assert.equal((await q.cmd('REROLL_ROLE')).status, 200);
  } finally {
    await s.cleanup();
  }
});

test('rate limit: per-IP bucket allows a whole pub (>= 300 req/s) and still limits abuse', async () => {
  const s = await startServer();
  try {
    const t0 = Date.now();
    const rs = await Promise.all(Array.from({ length: 400 }, () => fetch(`${s.url}/api/meta`)));
    assert.ok(rs.every(r => r.status === 200), 'default limits let 400 simultaneous requests through');
    void t0;
  } finally {
    await s.cleanup();
  }
  const tight = await startServer({ limits: { ip: { ratePerSec: 1, burst: 10 } } });
  try {
    const rs = await Promise.all(Array.from({ length: 40 }, () => fetch(`${tight.url}/api/view`)));
    const n429 = rs.filter(r => r.status === 429).length;
    assert.ok(n429 >= 20, `got ${n429}`);
    assert.ok(rs.find(r => r.status === 429)!.headers.get('retry-after'));
  } finally {
    await tight.cleanup();
  }
});

test('/api/meta is static and cacheable; views do not repeat it', async () => {
  const res = await fetch(`${srv.url}/api/meta`);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  const meta = (await res.json()) as Meta;
  assert.equal(meta.roles.length, 5);
  assert.ok(meta.rounds.length === 3 && meta.rounds[0].sentences.length > 0);
  assert.ok(meta.emojiPool.length === 5);
  const p = new Player(srv.url, 7);
  await p.join();
  const json = JSON.stringify(await p.view());
  assert.ok(!json.includes('Shattered Tablet') && !json.includes('#38bdf8'));
});

test('/health has the documented fields and no secrets', async () => {
  const res = await fetch(`${srv.url}/health`);
  const h = (await res.json()) as Record<string, unknown>;
  for (const k of ['ok', 'version', 'phase', 'clients', 'commandsPerSec', 'p99ApplyMs', 'eventLoopLagMs', 'heapUsedMB', 'rssMB', 'snapshotAgeSec', 'lastSnapshotOk', 'maxViewBytes', 'uptimeSec']) {
    assert.ok(k in h, `missing ${k}`);
  }
  const text = JSON.stringify(h);
  assert.ok(!text.includes(ADMIN_TOKEN));
  assert.ok(!/token|secret|password|key/i.test(Object.keys(h).join(',')), 'no secret-like keys');
  for (const p of Object.values(srv.app.runtime.state.players)) assert.ok(!text.includes(p.tokenHash));
  assert.equal(typeof h.p99ApplyMs, 'number');
});

test('team preview: auth required, shows names/roles/missing roles only', async () => {
  const a = new Player(srv.url, 21);
  const b = new Player(srv.url, 22);
  await a.join('Alice');
  await b.join('Bob');
  await a.cmd('CREATE_TEAM', { name: 'Preview Crew' });
  const code = srv.app.runtime.state.teams[srv.app.runtime.state.players[a.id].teamId!].emojiCode;
  const url = `${srv.url}/api/team-preview?code=${encodeURIComponent(code)}&playerId=${b.id}&token=${b.token}`;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const j = (await res.json()) as { ok: boolean; team: Record<string, unknown> & { members: { name: string; role: string }[]; missingRoles: string[] } };
  assert.equal(j.team.name, 'Preview Crew');
  assert.equal(j.team.members[0].name, 'Alice');
  assert.equal(j.team.members.length, 1);
  assert.equal(j.team.missingRoles.length, 4);
  assert.ok(!JSON.stringify(j).includes(a.id), 'no player ids');
  assert.ok(!('id' in j.team));
  assert.equal((await fetch(`${srv.url}/api/team-preview?code=${encodeURIComponent(code)}`)).status, 401);
  assert.equal((await fetch(url.replace(encodeURIComponent(code), encodeURIComponent('🔥🔥🔥')))).status, srv.app.runtime.state.teamOrder.some(t => srv.app.runtime.state.teams[t].emojiCode === '🔥🔥🔥') ? 200 : 404);
});

test('screen-view is public and has no private data', async () => {
  const res = await fetch(`${srv.url}/screen-view`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as Record<string, unknown>;
  assert.ok(j.phase && j.instruction && j.board && j.counts);
  const text = JSON.stringify(j);
  for (const p of Object.values(srv.app.runtime.state.players)) {
    assert.ok(!text.includes(p.tokenHash));
    assert.ok(!text.includes(p.id));
  }
  const etag = res.headers.get('etag')!;
  assert.equal((await fetch(`${srv.url}/screen-view`, { headers: { 'If-None-Match': etag } })).status, 304);
});

test('CORS: allowed origin echoed, others get no CORS headers, preflight answered', async () => {
  const s = await startServer({ env: { ALLOWED_ORIGIN: 'https://play.example.com' } });
  try {
    const ok = await fetch(`${s.url}/api/meta`, { headers: { Origin: 'https://play.example.com' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://play.example.com');
    const no = await fetch(`${s.url}/api/meta`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(no.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${s.url}/api/command`, { method: 'OPTIONS', headers: { Origin: 'https://play.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://play.example.com');
    assert.match(pre.headers.get('access-control-allow-headers')!, /Authorization/);
    assert.match(pre.headers.get('access-control-allow-headers')!, /Content-Type/);
  } finally {
    await s.cleanup();
  }
  const dev = await startServer({ env: { ALLOWED_ORIGIN: '*' } });
  try {
    const r = await fetch(`${dev.url}/api/meta`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  } finally {
    await dev.cleanup();
  }
  const prod = await startServer({ env: { ALLOWED_ORIGIN: '*', NODE_ENV: 'production', ADMIN_TOKEN: 'p'.repeat(24) }, noPersistence: true });
  try {
    const r = await fetch(`${prod.url}/api/meta`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null, 'wildcard is ignored in production');
  } finally {
    await prod.cleanup();
  }
});

test('admin: view (ETag/304), backup, restore (validated, paused), notice', async () => {
  const p = new Player(srv.url, 31);
  await p.join('Backup Bob');
  const v = await adminGet(srv.url, '/api/admin/view');
  assert.equal(v.status, 200);
  const etag = v.headers.get('etag')!;
  const body = (await v.json()) as { players: { id: string }[]; teams: unknown[]; metrics: Record<string, unknown>; counts: { players: number } };
  assert.ok(body.players.some(x => x.id === p.id));
  assert.ok(body.metrics.p99ApplyMs !== undefined);
  assert.ok(!JSON.stringify(body).includes(srv.app.runtime.state.players[p.id].tokenHash));
  const again = await fetch(`${srv.url}/api/admin/view`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'If-None-Match': etag } });
  assert.equal(again.status, 304);

  const backupRes = await adminGet(srv.url, '/api/admin/backup');
  assert.match(backupRes.headers.get('content-disposition')!, /attachment/);
  const backupText = await backupRes.text();
  const backup = JSON.parse(backupText);
  assert.equal(backup.format, 1);
  assert.equal(backup.state.version, srv.app.runtime.state.version);

  // restore garbage is refused
  const bad = await fetch(`${srv.url}/api/admin/restore`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify({ hello: 'world' }) });
  assert.equal(bad.status, 400);
  const bad2 = await fetch(`${srv.url}/api/admin/restore`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify({ ...backup.state, teamOrder: ['ghost'] }) });
  assert.equal(bad2.status, 400);

  // mutate, then restore the backup: the change is undone, the game is paused, version moves forward
  await p.cmd('JOIN', { name: 'Changed Name' });
  assert.equal(srv.app.runtime.state.players[p.id].name, 'Changed Name');
  const vBefore = srv.app.runtime.state.version;
  const restore = await fetch(`${srv.url}/api/admin/restore`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: backupText });
  assert.equal(restore.status, 200);
  const st = srv.app.runtime.state;
  assert.equal(st.players[p.id].name, 'Backup Bob');
  assert.ok(st.pausedAt != null, 'restored into PAUSED');
  assert.ok(st.version > vBefore);
  // bare GameState bodies are accepted too
  const restoreBare = await fetch(`${srv.url}/api/admin/restore`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify(backup.state) });
  assert.equal(restoreBare.status, 200);
  assert.equal((await admin(srv.url, 'ADMIN_RESUME')).ok, true);

  // notice
  const n = await fetch(`${srv.url}/api/admin/notice`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify({ text: 'Back in 2 minutes' }) });
  assert.equal(n.status, 200);
  assert.equal((await p.view()).notice, 'Back in 2 minutes');
});

test('unknown routes are 404 JSON, never 500; HEAD /health works', async () => {
  assert.equal((await fetch(`${srv.url}/api/nope`)).status, 404);
  assert.equal((await fetch(`${srv.url}/api/admin/nope`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })).status, 404);
  assert.equal((await fetch(`${srv.url}/health`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${srv.url}/anything`)).status, 404);
});

test('static serving with STATIC_DIR: content types, SPA fallback, config.json, no traversal', async () => {
  const s = await startServer({ noPersistence: true });
  const dir = join(s.dir, 'www');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(join(dir, 'assets', 'app-abcdef12.js'), 'console.log(1)');
  await writeFile(join(dir, 'assets', 'style.css'), 'body{}');
  await writeFile(join(dir, 'config.json'), '{"apiBase":"https://example.test"}');
  await writeFile(join(s.dir, 'secret.txt'), 'top secret');
  s.config.staticDir = dir;
  try {
    const idx = await fetch(`${s.url}/`);
    assert.match(idx.headers.get('content-type')!, /text\/html/);
    assert.match(await idx.text(), /<title>app<\/title>/);
    const js = await fetch(`${s.url}/assets/app-abcdef12.js`);
    assert.match(js.headers.get('content-type')!, /javascript/);
    assert.match(js.headers.get('cache-control')!, /immutable/);
    assert.match((await fetch(`${s.url}/assets/style.css`)).headers.get('content-type')!, /text\/css/);
    const cfg = await fetch(`${s.url}/config.json`);
    assert.match(cfg.headers.get('content-type')!, /application\/json/);
    assert.equal(((await cfg.json()) as { apiBase: string }).apiBase, 'https://example.test');
    const spa = await fetch(`${s.url}/screen`);
    assert.match(await spa.text(), /<title>app<\/title>/, 'SPA fallback');
    assert.equal((await fetch(`${s.url}/assets/missing.js`)).status, 404);
    const trav = await fetch(`${s.url}/..%2Fsecret.txt`);
    assert.notEqual(await trav.text(), 'top secret');
    // API routes are never shadowed by the SPA fallback
    assert.equal((await fetch(`${s.url}/api/nope`)).status, 404);
    assert.equal((await fetch(`${s.url}/health`)).status, 200);
  } finally {
    await s.cleanup();
  }
});
