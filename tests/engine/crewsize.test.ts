import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness } from './helpers.ts';
import { crewSizeOf, createInitialState, normalizeRestoredState, previewTeamByEmoji, reduce } from '../../server/engine/index.ts';
import { planCrewSizes } from '../../server/engine/lobby.ts';
import { validateAdminBody } from '../../shared/protocol.ts';

test('crew size: default 5, admin sets 3..6 in the lobby only, validated', () => {
  const h = harness();
  assert.equal(crewSizeOf(h.state), 5);
  assert.equal(h.admin('ADMIN_SET_CREW_SIZE', { size: 2 }), 'INVALID_PAYLOAD');
  assert.equal(h.admin('ADMIN_SET_CREW_SIZE', { size: 7 }), 'INVALID_PAYLOAD');
  assert.equal(h.admin('ADMIN_SET_CREW_SIZE', { size: 4.5 }), 'INVALID_PAYLOAD');
  assert.equal(h.admin('ADMIN_SET_CREW_SIZE', { size: '4' }), 'INVALID_PAYLOAD');
  assert.equal(h.admin('ADMIN_SET_CREW_SIZE', {}), 'INVALID_PAYLOAD');
  h.join('a');
  assert.equal(h.as('a', 'ADMIN_SET_CREW_SIZE', { size: 4 }), 'FORBIDDEN');
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 4 }));
  assert.equal(crewSizeOf(h.state), 4);
  const v = h.state.version;
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 4 })); // same value: no-op
  assert.equal(h.state.version, v);
  formTeams(h, [3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.admin('ADMIN_SET_CREW_SIZE', { size: 5 }), 'WRONG_PHASE');
  assert.equal(crewSizeOf(h.state), 4);
});

test('crew size: the shared validator accepts 3..6 and rejects the rest', () => {
  const ok = (size: unknown) => validateAdminBody({ type: 'ADMIN_SET_CREW_SIZE', payload: { size } }).ok;
  assert.deepEqual([2, 3, 4, 5, 6, 7, 5.5, '5', null].map(ok), [false, true, true, true, true, false, false, false, false]);
  assert.equal(validateAdminBody({ type: 'ADMIN_SET_CREW_SIZE', payload: { size: 4, extra: 1 } }).ok, false);
});

test('crew size N is the max for create/join; roles are unique among the first min(N,5)', () => {
  for (const N of [3, 4, 5, 6]) {
    const h = harness(N);
    h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: N }));
    h.join('lead');
    h.ok(h.as('lead', 'CREATE_TEAM', {}));
    const tid = h.state.players.lead.teamId!;
    const code = h.state.teams[tid].emojiCode;
    let joined = 1;
    for (let i = 0; i < 80 && joined < N; i++) {
      h.join(`j${N}_${i}`);
      const err = h.as(`j${N}_${i}`, 'JOIN_TEAM', { code });
      if (!err) joined++;
      else assert.equal(err, 'ROLE_TAKEN');
    }
    assert.equal(h.state.teams[tid].playerIds.length, N, `N=${N} crew fills up`);
    h.join('over');
    assert.equal(h.as('over', 'JOIN_TEAM', { code }), 'TEAM_FULL', `N=${N}: crew of N is full`);
    const roles = h.state.teams[tid].playerIds.map(p => h.state.players[p].role);
    assert.equal(new Set(roles).size, Math.min(N, 5), `N=${N}: first min(N,5) members have unique roles`);
    // the preview reports N
    const r = previewTeamByEmoji(h.state, code, 'over');
    assert.ok(r.ok && r.preview.maxMembers === N && r.preview.isFull);
  }
});

test('crew size 6: the sixth member may repeat a role', () => {
  const h = harness(4);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 6 }));
  const [tid] = formTeams(h, [5]);
  // formTeams placed five unique-role members; a sixth with any role joins
  for (let i = 0; i < 20; i++) {
    h.join(`x${i}`);
    if (!h.as(`x${i}`, 'JOIN_TEAM', { code: h.state.teams[tid].emojiCode })) break;
  }
  assert.equal(h.state.teams[tid].playerIds.length, 6);
  const roles = h.state.teams[tid].playerIds.map(p => h.state.players[p].role);
  assert.equal(new Set(roles).size, 5);
});

test('auto-group sizes for every crew size N', () => {
  const sizes = (n: number, N: number) => planCrewSizes(n, N).sort((a, b) => b - a);
  // N = 5 (the default): the same results as before the setting existed
  assert.deepEqual([7, 8, 9, 10, 11, 12, 13].map(n => sizes(n, 5)), [[4, 3], [5, 3], [5, 4], [5, 5], [5, 5], [5, 5], [5, 5, 3]]);
  // N = 3
  assert.deepEqual([3, 4, 6, 7, 8, 9].map(n => sizes(n, 3)), [[3], [3], [3, 3], [3, 3], [3, 3], [3, 3, 3]]);
  // N = 4: remainders of 1-2 are absorbed, 3 is its own crew
  assert.deepEqual([6, 7, 8, 9, 10, 11].map(n => sizes(n, 4)), [[3, 3], [4, 3], [4, 4], [4, 4], [4, 4], [4, 4, 3]]);
  // N = 6
  assert.deepEqual([4, 5, 8, 9, 12, 13, 14].map(n => sizes(n, 6)), [[4], [5], [5, 3], [6, 3], [6, 6], [6, 6], [6, 6]]);
  assert.deepEqual(sizes(2, 5), []);
});

test('auto-group builds crews of N and absorbs 1-2 leftovers (so a few crews have N+1)', () => {
  const run = (n: number, N: number) => {
    const h = harness(3);
    h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: N }));
    for (let i = 0; i < n; i++) h.join(`p${i}`);
    h.ok(h.admin('ADMIN_AUTO_GROUP'));
    return {
      h,
      got: Object.values(h.state.teams)
        .map(t => t.playerIds.length)
        .sort((a, b) => b - a),
    };
  };
  assert.deepEqual(run(10, 3).got, [4, 3, 3]);
  assert.deepEqual(run(13, 4).got, [5, 4, 4]);
  assert.deepEqual(run(14, 4).got, [5, 5, 4]);
  assert.deepEqual(run(12, 6).got, [6, 6]);
  assert.deepEqual(run(13, 6).got, [7, 6]);
  assert.deepEqual(run(11, 3).got, [4, 4, 3]);
  const big = run(200, 4);
  assert.equal(big.got.length, 50);
  assert.ok(Object.values(big.h.state.players).every(p => p.teamId));
  const six = run(200, 6); // 33 crews of 6 + a remainder of 2 absorbed
  assert.equal(six.got.reduce((a, b) => a + b, 0), 200);
  assert.ok(six.got.every(s => s >= 3 && s <= 7));
});

test('admin add/move allow N + 1 (the auto-group overflow), not more', () => {
  const h = harness(2);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 3 }));
  const [tid] = formTeams(h, [3]);
  h.join('m1');
  h.join('m2');
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'm1', teamId: tid }));
  assert.equal(h.state.teams[tid].playerIds.length, 4);
  assert.equal(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'm2', teamId: tid }), 'TEAM_FULL');
  assert.equal(h.admin('ADMIN_ADD_PLAYER', { name: 'Z', teamId: tid }), 'TEAM_FULL');
});

test('old snapshots without crewSize load with the default 5', () => {
  const s = createInitialState({ seed: 1 });
  const old = JSON.parse(JSON.stringify(s));
  delete old.config.crewSize;
  assert.equal(crewSizeOf(old), 5);
  const migrated = normalizeRestoredState(old);
  assert.equal(migrated.config.crewSize, 5);
  assert.equal(normalizeRestoredState(migrated), migrated, 'idempotent');
  // an old state still runs (without migration too)
  const r = reduce(old, { commandId: 'x1', type: 'ADMIN_SET_CREW_SIZE', actor: { kind: 'admin' }, payload: { size: 6 } }, { now: 1 });
  assert.equal(r.error, undefined);
  assert.equal(crewSizeOf(r.state), 6);
  const j = reduce(old, { commandId: 'x2', type: 'JOIN', actor: { kind: 'player', playerId: 'pl1' }, payload: { playerId: 'pl1', name: 'A', tokenHash: 'h' } }, { now: 1 });
  assert.equal(j.error, undefined);
});
