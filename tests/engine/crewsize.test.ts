import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness, pairByCode, skipBriefing, toR2Pairing, toReveal, toVote } from './helpers.ts';
import { crewSizeOf, createInitialState, normalizeRestoredState, playerPrivate, previewTeamByEmoji, reduce } from '../../server/engine/index.ts';
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

test('crew size N is the max for create/join', () => {
  for (const N of [3, 4, 5, 6]) {
    const h = harness(N);
    h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: N }));
    h.join('lead');
    h.ok(h.as('lead', 'CREATE_TEAM', {}));
    const tid = h.state.players.lead.teamId!;
    const code = h.state.teams[tid].emojiCode;
    for (let i = 1; i < N; i++) {
      h.join(`j${N}_${i}`);
      h.ok(h.as(`j${N}_${i}`, 'JOIN_TEAM', { code }));
    }
    assert.equal(h.state.teams[tid].playerIds.length, N, `N=${N} crew fills up`);
    h.join('over');
    assert.equal(h.as('over', 'JOIN_TEAM', { code }), 'TEAM_FULL', `N=${N}: crew of N is full`);
    // the preview reports N
    const r = previewTeamByEmoji(h.state, code);
    assert.ok(r.ok && r.preview.maxMembers === N && r.preview.isFull);
  }
});

test('crew size 6: a sixth member joins and a seventh is refused', () => {
  const h = harness(4);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 6 }));
  const [tid] = formTeams(h, [5]);
  h.join('x0');
  h.ok(h.as('x0', 'JOIN_TEAM', { code: h.state.teams[tid].emojiCode }));
  assert.equal(h.state.teams[tid].playerIds.length, 6);
  h.join('x1');
  assert.equal(h.as('x1', 'JOIN_TEAM', { code: h.state.teams[tid].emojiCode }), 'TEAM_FULL');
});

test('auto-group sizes for every crew size N', () => {
  const sizes = (n: number, N: number) => planCrewSizes(n, N).sort((a, b) => b - a);
  // N = 5 (the default)
  assert.deepEqual([7, 8, 9, 10, 11, 13].map(n => sizes(n, 5)), [[5, 2], [5, 3], [5, 4], [5, 5], [5, 5], [5, 5, 3]]);
  // N = 3
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => sizes(n, 3)), [[2], [3], [3], [3, 2], [3, 3], [3, 3], [3, 3, 2], [3, 3, 3], [3, 3, 3]]);
  // N = 4
  assert.deepEqual([6, 7, 8, 9, 10, 11].map(n => sizes(n, 4)), [[4, 2], [4, 3], [4, 4], [4, 4], [4, 4, 2], [4, 4, 3]]);
  // N = 6: never above 6
  assert.deepEqual([4, 5, 8, 9, 12, 13, 14].map(n => sizes(n, 6)), [[4], [5], [6, 2], [6, 3], [6, 6], [6, 6], [6, 6, 2]]);
  assert.deepEqual([0, 1].map(n => sizes(n, 5)), [[], []]);
  for (let N = 3; N <= 6; N++) for (let n = 0; n <= 60; n++) assert.ok(planCrewSizes(n, N).every(s => s >= 2 && s <= N), `n=${n} N=${N}`);
});

test('auto-group builds crews of N, a remainder of 2+ is a smaller crew, a single leftover is left for the admin', () => {
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
      unassigned: Object.values(h.state.players).filter(p => !p.teamId).length,
    };
  };
  assert.deepEqual(run(5, 3).got, [3, 2]);
  assert.deepEqual(run(10, 3).got, [3, 3, 3]);
  assert.equal(run(10, 3).unassigned, 1);
  assert.deepEqual(run(13, 6).got, [6, 6]);
  assert.equal(run(13, 6).unassigned, 1);
  assert.deepEqual(run(8, 5).got, [5, 3]);
  assert.deepEqual(run(9, 5).got, [5, 4]);
  assert.deepEqual(run(13, 4).got, [4, 4, 4]);
  assert.equal(run(13, 4).unassigned, 1);
  assert.deepEqual(run(14, 4).got, [4, 4, 4, 2]);
  const big = run(200, 4);
  assert.equal(big.got.length, 50);
  assert.equal(big.unassigned, 0);
  const six = run(200, 6); // 33 crews of 6 + a crew of 2
  assert.equal(six.got.reduce((a, b) => a + b, 0), 200);
  assert.ok(six.got.every(s => s >= 2 && s <= 6));
  assert.equal(six.got[six.got.length - 1], 2);
});

test('admin add/move: up to 6 whatever N is (TEAM_FULL at 6), so the leftover can join a crew of N', () => {
  const h = harness(2);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 3 }));
  const [tid] = formTeams(h, [3]);
  for (const id of ['m1', 'm2', 'm3', 'm4']) h.join(id);
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'm1', teamId: tid }), 'N+1 is fine');
  assert.equal(h.state.teams[tid].playerIds.length, 4);
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'm2', teamId: tid }));
  h.ok(h.admin('ADMIN_ADD_PLAYER', { name: 'Z', teamId: tid }));
  assert.equal(h.state.teams[tid].playerIds.length, 6);
  assert.equal(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'm3', teamId: tid }), 'TEAM_FULL');
  assert.equal(h.admin('ADMIN_ADD_PLAYER', { name: 'Y', teamId: tid }), 'TEAM_FULL');
  assert.equal(h.state.teams[tid].playerIds.length, 6);
  // players still only join up to N
  const h2 = harness(2);
  h2.ok(h2.admin('ADMIN_SET_CREW_SIZE', { size: 3 }));
  const [t2] = formTeams(h2, [3]);
  h2.join('late');
  assert.equal(h2.as('late', 'JOIN_TEAM', { code: h2.state.teams[t2].emojiCode }), 'TEAM_FULL');
});

test('a crew of 2 (auto-group remainder) plays: game starts, Round 1 has 2 distinct slices', () => {
  const h = harness(4);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 3 }));
  for (let i = 0; i < 5; i++) h.join(`p${i}`);
  h.ok(h.admin('ADMIN_AUTO_GROUP'));
  const small = Object.values(h.state.teams).find(t => t.playerIds.length === 2)!;
  assert.ok(small);
  h.ok(h.admin('ADMIN_START_GAME'));
  const slots = small.playerIds.map(pid => {
    const r1 = playerPrivate(h.state, pid)!.r1!;
    assert.equal(r1.slotCount, 2);
    return r1.slot;
  });
  assert.deepEqual(slots.slice().sort(), [0, 1]);
});

test('crew of 2: Round 2 1-1 tie -> TRUCE and Round 3 1-1 tie -> safest vessel', () => {
  const h = harness(5);
  const t = formTeams(h, [2, 2]);
  toR2Pairing(h);
  pairByCode(h, t[0], t[1]);
  if (h.state.phase === 'R2_PAIRING') h.ok(h.admin('ADMIN_R2_FORCE_START'));
  while (h.state.phase === 'R2_CLASH') {
    if (h.state.step === 'VOTE') {
      for (const tid of t) {
        const [a, b] = h.state.teams[tid].playerIds;
        h.ok(h.as(a, 'R2_VOTE', { vote: 'TRUCE' }));
        h.ok(h.as(b, 'R2_VOTE', { vote: 'AMBUSH' }));
      }
    }
    h.nextDeadline();
  }
  const matches = Object.values(h.state.r2.matches);
  assert.ok(matches.flatMap(m => m.clashes).length > 0, 'clashes were played');
  for (const m of matches) for (const c of m.clashes) assert.ok(c.stanceA === 'TRUCE' && c.stanceB === 'TRUCE', '1-1 tie is TRUCE');
  h.ok(h.admin('ADMIN_START_R3'));
  skipBriefing(h);
  toVote(h);
  for (const tid of t) {
    const [a, b] = h.state.teams[tid].playerIds;
    h.ok(h.as(a, 'R3_VOTE', { vessel: 'GHOST_SHIP' }));
    h.ok(h.as(b, 'R3_VOTE', { vessel: 'SAILBOAT' }));
  }
  toReveal(h);
  const out = h.state.r3!.reports[0].outcomes;
  for (const tid of t) assert.equal(out[tid].vessel, 'SAILBOAT', '1-1 tie goes to the safer vessel');
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
