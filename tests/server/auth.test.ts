import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlayer, createAdminAuth, hashToken, safeEqualHex } from '../../server/auth.ts';
import { createInitialState, reduce } from '../../server/engine/index.ts';
import { RateLimiter } from '../../server/transport/rateLimit.ts';
import { loadConfig } from '../../server/config.ts';

test('hashToken is sha256 hex and stable', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('safeEqualHex: equal, different, different length, empty', () => {
  const h = hashToken('x');
  assert.ok(safeEqualHex(h, h));
  assert.ok(!safeEqualHex(h, hashToken('y')));
  assert.ok(!safeEqualHex(h, h.slice(1)));
  assert.ok(!safeEqualHex('', ''));
});

test('checkPlayer: unknown, bad token, ok, and admin-created players can never log in', () => {
  let s = createInitialState({ seed: 3 });
  s = reduce(s, { commandId: 'j', type: 'JOIN', actor: { kind: 'player', playerId: 'player-1' }, payload: { playerId: 'player-1', tokenHash: hashToken('t1') } }, { now: 1 }).state;
  s = reduce(s, { commandId: 'a', type: 'ADMIN_ADD_PLAYER', actor: { kind: 'admin' }, payload: { name: 'Ghost' } }, { now: 2 }).state;
  assert.equal(checkPlayer(s, 'player-1', hashToken('t1')), 'ok');
  assert.equal(checkPlayer(s, 'player-1', hashToken('t2')), 'bad-token');
  assert.equal(checkPlayer(s, 'nobody-1', hashToken('t1')), 'unknown');
  assert.equal(checkPlayer(s, 'constructor', hashToken('t1')), 'unknown');
  const adm = s.playerOrder.find(id => id.startsWith('adm'))!;
  assert.equal(checkPlayer(s, adm, ''), 'bad-token');
  assert.equal(checkPlayer(s, adm, hashToken('')), 'bad-token');
});

test('admin auth: bearer scheme, constant-time compare, disabled without token', () => {
  const a = createAdminAuth('super-secret-token-123');
  assert.ok(a.enabled);
  assert.ok(a.check('Bearer super-secret-token-123'));
  assert.ok(a.check('bearer super-secret-token-123'));
  assert.ok(!a.check('Bearer super-secret-token-124'));
  assert.ok(!a.check('super-secret-token-123'));
  assert.ok(!a.check('Bearer '));
  assert.ok(!a.check(undefined));
  const off = createAdminAuth(null);
  assert.ok(!off.enabled);
  assert.ok(!off.check('Bearer anything'));
});

test('config: production requires ADMIN_TOKEN, star origin ignored in production', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /ADMIN_TOKEN/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'short' }), /16/);
  const prod = loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'x'.repeat(20), ALLOWED_ORIGIN: '*' });
  assert.equal(prod.allowAnyOrigin, false);
  assert.ok(prod.warnings.some(w => w.includes('ignored')));
  const dev = loadConfig({ ALLOWED_ORIGIN: '*' });
  assert.equal(dev.allowAnyOrigin, true);
  assert.ok(dev.warnings.some(w => w.includes('ADMIN_TOKEN')));
  const multi = loadConfig({ ALLOWED_ORIGIN: 'https://a.example, https://b.example/' });
  assert.deepEqual(multi.allowedOrigins, ['https://a.example', 'https://b.example']);
  assert.equal(multi.allowAnyOrigin, false);
  assert.throws(() => loadConfig({ SNAPSHOT_STORE: 'supabase' }), /SUPABASE_URL/);
  assert.equal(loadConfig({}).port, 3001);
});

test('rate limiter: burst, refill, eviction', () => {
  const rl = new RateLimiter({ ratePerSec: 10, burst: 5, maxKeys: 100 });
  let t = 1000;
  let ok = 0;
  for (let i = 0; i < 10; i++) if (rl.take('a', t)) ok++;
  assert.equal(ok, 5);
  assert.ok(rl.take('b', t));
  t += 200; // 2 tokens
  assert.ok(rl.take('a', t));
  assert.ok(rl.take('a', t));
  assert.ok(!rl.take('a', t));
  assert.ok(rl.retryAfterSec('a') >= 1);
  assert.ok(!rl.has('a', t));
  for (let i = 0; i < 500; i++) rl.take(`k${i}`, t);
  assert.ok(rl.size <= 100 + 1);
});
