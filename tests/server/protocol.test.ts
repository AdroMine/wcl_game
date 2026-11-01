import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_ERROR_CODES,
  ERROR_CODES,
  ERROR_MESSAGES,
  PLAYER_COMMAND_TYPES,
  cleanText,
  randomToken,
  validateAdminBody,
  validateCommandEnvelope,
  validatePlayerPayload,
} from '../../shared/protocol.ts';
import type { ErrorCode as EngineCode } from '../../server/engine/index.ts';
import { COMMAND_TYPES } from '../../server/engine/index.ts';

// Compile-time check: the shared list of engine codes is exactly the engine's ErrorCode union.
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _same: Eq<(typeof ENGINE_ERROR_CODES)[number], EngineCode> = true;
void _same;

const good = { commandId: 'cmd-1', playerId: 'player-abc', token: 'abcdefghijklmnopqrstuv', type: 'R2_VOTE', payload: { vote: 'TRUCE' } };

test('every player command type is an engine player command', () => {
  for (const t of PLAYER_COMMAND_TYPES) assert.ok(COMMAND_TYPES.includes(t), t);
});

test('every error code has a message and no duplicates', () => {
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
  for (const c of ERROR_CODES) assert.ok(ERROR_MESSAGES[c], c);
});

test('envelope: accepts a well formed command', () => {
  const r = validateCommandEnvelope(good);
  assert.ok(r.ok);
});

test('envelope: rejects bad shapes', () => {
  const bad: unknown[] = [
    null,
    [],
    'x',
    { ...good, commandId: '' },
    { ...good, commandId: 'x'.repeat(129) },
    { ...good, commandId: 'has space' },
    { ...good, playerId: 'short' },
    { ...good, playerId: '__proto__' },
    { ...good, playerId: 'constructor' },
    { ...good, playerId: 'has space here' },
    { ...good, token: 'tooshort' },
    { ...good, token: 'x'.repeat(200) },
    { ...good, type: 'ADMIN_START_GAME' },
    { ...good, type: 'NOPE' },
    { ...good, extra: 1 },
    { ...good, payload: { vote: 'MAYBE' } },
    { ...good, payload: [] },
    { ...good, payload: { vote: 'TRUCE', hack: 1 } },
  ];
  for (const b of bad) {
    const r = validateCommandEnvelope(b);
    assert.equal(r.ok, false, JSON.stringify(b));
    if (!r.ok) assert.equal(r.error, 'BAD_REQUEST');
  }
});

test('payloads: names are trimmed, collapsed, stripped and length-capped', () => {
  const r = validatePlayerPayload('JOIN', { name: `  A‮B\u0000   C  ${'x'.repeat(50)}` });
  assert.ok(r.ok);
  const name = (r as { ok: true; value: { name: string } }).value.name;
  assert.ok(name.length <= 24);
  assert.ok(name.startsWith('AB C x'));
  assert.ok(!/[‮\u0000]/.test(name));
  assert.deepEqual(validatePlayerPayload('JOIN', {}), { ok: true, value: {} });
  assert.deepEqual(validatePlayerPayload('JOIN', { name: '   ' }), { ok: true, value: {} });
  assert.equal(validatePlayerPayload('JOIN', { name: 5 }).ok, false);
  assert.equal(validatePlayerPayload('RENAME_TEAM', { name: '  ' }).ok, false);
  const t = validatePlayerPayload('CREATE_TEAM', { name: 'y'.repeat(100) });
  assert.ok(t.ok && (t.value as { name: string }).name.length === 32);
});

test('payloads: enums and codes', () => {
  assert.equal(validatePlayerPayload('R1_HINT', { hint: 4 }).ok, false);
  assert.equal(validatePlayerPayload('R1_HINT', { hint: '1' }).ok, false);
  assert.ok(validatePlayerPayload('R1_HINT', { hint: 2 }).ok);
  assert.ok(validatePlayerPayload('R2_PAIR', { code: ' 07 ' }).ok);
  assert.equal(validatePlayerPayload('R2_PAIR', { code: '7' }).ok, false);
  assert.equal(validatePlayerPayload('R2_PAIR', { code: '123' }).ok, false);
  assert.equal(validatePlayerPayload('R3_VOTE', { vessel: 'SUBMARINE' }).ok, false);
  assert.ok(validatePlayerPayload('R3_VOTE', { vessel: 'GHOST_SHIP' }).ok);
  assert.ok(validatePlayerPayload('SD_VOTE', { action: 'RAM' }).ok);
  assert.equal(validatePlayerPayload('SD_VOTE', { action: 'ram' }).ok, false);
  assert.equal(validatePlayerPayload('LEAVE_TEAM', { x: 1 }).ok, false);
  assert.ok(validatePlayerPayload('R3_ARM_LEASH', undefined).ok);
  assert.equal(validatePlayerPayload('R1_SUBMIT', { answer: '   ' }).ok, false);
  const a = validatePlayerPayload('R1_SUBMIT', { answer: ` ${'a'.repeat(300)} ` });
  assert.ok(a.ok && (a.value as { answer: string }).answer.length === 64);
  assert.ok(validatePlayerPayload('JOIN_TEAM', { code: '🔥💀⚡' }).ok);
});

test('admin body validation', () => {
  assert.ok(validateAdminBody({ type: 'ADMIN_START_GAME' }).ok);
  assert.equal(validateAdminBody({ type: 'JOIN' }).ok, false);
  assert.equal(validateAdminBody({ type: 'ADMIN_X', commandId: 'bad id' }).ok, false);
  assert.equal(validateAdminBody({ type: 'ADMIN_X', payload: 5 }).ok, false);
});

test('cleanText and randomToken', () => {
  assert.equal(cleanText('  a \n\t b ', 10), 'a b');
  assert.equal(cleanText(5, 10), '');
  const t = randomToken();
  assert.ok(t.length >= 22 && /^[A-Za-z0-9_-]+$/.test(t));
  assert.notEqual(randomToken(), randomToken());
});
