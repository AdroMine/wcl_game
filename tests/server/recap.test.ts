// GET /api/recap (public, after FINISHED) and the admin export endpoints.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { ADMIN_TOKEN, adminGet, startServer } from './harness.ts';
import type { TestServer } from './harness.ts';
import { runSimulation } from '../sim/simulate.ts';
import type { RecapData } from '../../games/underworld/recap.ts';

let finished: TestServer;
let lobby: TestServer;
before(async () => {
  const sim = runSimulation({ seed: 5, players: 80 });
  assert.equal(sim.state.phase, 'FINISHED');
  finished = await startServer({ initialState: sim.state, noPersistence: true });
  lobby = await startServer({ noPersistence: true });
});
after(async () => {
  await finished.cleanup();
  await lobby.cleanup();
});

function rawGet(url: string, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(`${url}${path}`, { headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('/api/recap answers 404 (not cacheable) until the game is FINISHED', async () => {
  const res = await fetch(`${lobby.url}/api/recap`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('/api/recap after FINISHED: public JSON, ETag/304, gzip, crew-level only', async () => {
  const res = await fetch(`${finished.url}/api/recap?v=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control')!, /public/);
  const etag = res.headers.get('etag')!;
  assert.ok(etag);
  const recap = (await res.json()) as RecapData;
  assert.equal(recap.game, 'underworld');
  assert.equal(recap.crews.length, finished.app.runtime.state.teamOrder.length);
  const text = JSON.stringify(recap);
  for (const p of Object.values(finished.app.runtime.state.players)) assert.ok(!text.includes(p.id) && !text.includes(p.tokenHash));

  const again = await fetch(`${finished.url}/api/recap`, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);

  const gz = await rawGet(finished.url, '/api/recap', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gz.headers.etag, etag);
  assert.deepEqual(JSON.parse(gunzipSync(gz.body).toString('utf8')), recap);
  assert.ok(gz.body.length < Buffer.byteLength(text) / 2, 'gzip helps');
  const plain = await rawGet(finished.url, '/api/recap', { 'Accept-Encoding': 'identity' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(plain.body.toString('utf8')), recap);
});

test('200 phones fetching the recap at once are all served from one build', async () => {
  const rs = await Promise.all(Array.from({ length: 200 }, () => fetch(`${finished.url}/api/recap`)));
  assert.ok(rs.every(r => r.status === 200));
  const etags = new Set(rs.map(r => r.headers.get('etag')));
  assert.equal(etags.size, 1);
  await Promise.all(rs.map(r => r.arrayBuffer()));
});

test('admin export.json and export.csv: need the admin token, download as attachments, hold no secrets', async () => {
  for (const path of ['/api/admin/export.json', '/api/admin/export.csv']) {
    assert.equal((await fetch(`${finished.url}${path}`)).status, 401);
    assert.equal((await fetch(`${finished.url}${path}?token=${ADMIN_TOKEN}`)).status, 401, 'the token in the URL is not accepted');
  }
  const j = await adminGet(finished.url, '/api/admin/export.json');
  assert.equal(j.status, 200);
  assert.match(j.headers.get('content-type')!, /application\/json/);
  assert.match(j.headers.get('content-disposition')!, /attachment; filename="underworld-export-v\d+\.json"/);
  assert.equal(j.headers.get('cache-control'), 'no-store');
  const jt = await j.text();
  const doc = JSON.parse(jt) as { crews: unknown[]; round3: { waves: unknown[] } };
  assert.equal(doc.crews.length, finished.app.runtime.state.teamOrder.length);
  assert.ok(doc.round3.waves.length > 0);
  const c = await adminGet(finished.url, '/api/admin/export.csv');
  assert.equal(c.status, 200);
  assert.match(c.headers.get('content-type')!, /text\/csv/);
  assert.match(c.headers.get('content-disposition')!, /\.csv"/);
  const ct = await c.text();
  assert.ok(ct.split('\r\n').length > 100);
  for (const text of [jt, ct]) {
    assert.ok(!text.includes(ADMIN_TOKEN));
    for (const p of Object.values(finished.app.runtime.state.players)) assert.ok(!text.includes(p.tokenHash));
  }
  // available in any phase (partial data), not only when finished
  assert.equal((await adminGet(lobby.url, '/api/admin/export.json')).status, 200);
});
