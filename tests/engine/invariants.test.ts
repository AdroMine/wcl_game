import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness, pairByCode, setupR3, teamVotesR2, toR2Pairing, toVote, voteR3 } from './helpers.ts';
import {
  due,
  leaderboard,
  phaseInfo,
  playerPrivate,
  previewTeamByEmoji,
  reduce,
  round1TeamStatus,
  round2MatchView,
  round3FleetRows,
  round3TeamView,
  round3WaveReport,
  suddenDeathView,
  teamPublic,
} from '../../server/engine/index.ts';
import type { Command, GameState } from '../../server/engine/index.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function everySelector(s: GameState, now: number): string {
  const out: unknown[] = [leaderboard(s, 100), round3FleetRows(s), phaseInfo(s, now)];
  for (const tid of s.teamOrder) {
    out.push(teamPublic(s, tid), round1TeamStatus(s, tid, now), round2MatchView(s, tid), round3TeamView(s, tid), suddenDeathView(s, tid));
    out.push(previewTeamByEmoji(s, s.teams[tid].emojiCode));
  }
  for (const w of [1, 2, 3]) out.push(round3WaveReport(s, w));
  return JSON.stringify(out);
}

test('determinism: same state + command + now gives deep-equal results; input is not mutated', () => {
  const { h } = setupR3(101, [5, 5, 4, 3], (c, _t, i) => (i === 1 && c === 1 ? 'AMBUSH' : 'TRUCE'));
  const before = JSON.stringify(h.state);
  const cmd: Command = { commandId: 'det-1', type: 'ADMIN_ADJUST_DEADLINE', actor: { kind: 'admin' }, payload: { seconds: 33 } };
  const a = reduce(h.state, cmd, { now: h.now });
  const b = reduce(h.state, cmd, { now: h.now });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(h.state), before, 'input state must not be mutated');
  // also across a long scripted game: two runs give identical states
  const run = () => {
    const g = setupR3(77, [5, 5, 5, 5], (c, _t, i) => (i === 3 && c === 2 ? 'AMBUSH' : 'TRUCE'));
    toVote(g.h);
    voteR3(g.h, g.t[0], 'GHOST_SHIP');
    g.h.nextDeadline();
    return g.h.state;
  };
  assert.deepEqual(run(), run());
});

test('duplicate commandId is a no-op: unchanged state, no events, no error', () => {
  const h = harness();
  h.join('a');
  const c: Command = { commandId: 'dup-1', type: 'CREATE_TEAM', actor: { kind: 'player', playerId: 'a' }, payload: { name: 'X' } };
  const first = reduce(h.state, c, { now: 5 });
  assert.equal(first.error, undefined);
  assert.ok(first.events.length > 0);
  const second = reduce(first.state, c, { now: 6 });
  assert.equal(second.state, first.state);
  assert.deepEqual(second.events, []);
  assert.equal(second.error, undefined);
  assert.equal(Object.keys(second.state.teams).length, 1);
});

test('duplicate join with a different commandId but same playerId is still one player', () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.join('same');
  assert.equal(h.state.playerOrder.length, 1);
});

test('errors leave state unchanged except for recording the commandId; the repeat is silent', () => {
  const h = harness();
  h.join('a');
  const before = clone(h.state);
  const c: Command = { commandId: 'err-1', type: 'R1_SUBMIT', actor: { kind: 'player', playerId: 'a' }, payload: { answer: 'x' } };
  const r = reduce(h.state, c, { now: 1 });
  assert.equal(r.error, 'NOT_IN_TEAM');
  assert.deepEqual({ ...r.state, applied: [] }, { ...before, applied: [] });
  assert.equal(r.state.version, before.version);
  assert.deepEqual(r.state.applied, [...before.applied, 'err-1']);
  const again = reduce(r.state, c, { now: 2 });
  assert.equal(again.error, undefined);
  assert.equal(again.state, r.state);
});

test('malformed commands are rejected without throwing', () => {
  const h = harness();
  const bad = [null, 5, {}, { commandId: '', type: 'X', actor: { kind: 'admin' }, payload: {} }, { commandId: 'x', type: 'X', actor: { kind: 'robot' }, payload: {} }, { commandId: 'x', type: 'X', actor: { kind: 'player' }, payload: {} }];
  for (const b of bad) {
    const r = reduce(h.state, b as unknown as Command, { now: 0 });
    assert.equal(r.error, 'INVALID_PAYLOAD');
    assert.equal(r.state, h.state);
  }
  const weird = ['JOIN', 'CREATE_TEAM', 'R1_SUBMIT', 'R2_VOTE', 'R3_VOTE', 'ADMIN_MOVE_PLAYER', 'ADMIN_SET_DURATIONS', 'ADMIN_ADD_PLAYER'];
  h.join('a');
  for (const type of weird) {
    for (const payload of [null, 7, 'x', [], { a: 1 }, { teamId: {} , playerId: [], name: 5, vote: {}, vessel: 1, answer: 4 }]) {
      for (const actor of [{ kind: 'player' as const, playerId: 'a' }, { kind: 'admin' as const }]) {
        assert.doesNotThrow(() => reduce(h.state, { commandId: `w-${type}-${Math.random()}`, type, actor, payload }, { now: 1 }));
      }
    }
  }
});

test('applied-id ring is bounded to 10,000 and evicts the oldest', () => {
  const h = harness();
  h.join('a');
  for (let i = 0; i < 10_050; i++) h.send('R1_SUBMIT', { kind: 'player', playerId: 'a' }, { answer: 'x' }, { id: `ring-${i}` });
  assert.equal(h.state.applied.length, 10_000);
  assert.equal(h.state.applied[0], 'ring-50'); // join id c1 + ring-0..ring-49 evicted
  assert.equal(h.state.applied[9999], 'ring-10049');
});

test('state is plain JSON at every phase: round-trip deep equality, no undefined', () => {
  const h = harness(5);
  const snapshots: GameState[] = [];
  const t = formTeams(h, [5, 5, 4, 3]);
  snapshots.push(h.state);
  h.ok(h.admin('ADMIN_START_GAME'));
  snapshots.push(h.state); // R1 briefing
  h.nextDeadline();
  h.tick(125);
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R1_HINT', { hint: 1 }));
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R1_SUBMIT', { answer: h.state.teams[t[0]].r1!.codeword }));
  snapshots.push(h.state);
  h.nextDeadline();
  h.ok(h.admin('ADMIN_START_R2'));
  pairByCode(h, t[0], t[1]);
  pairByCode(h, t[2], t[3]);
  snapshots.push(h.state); // R2 briefing
  h.nextDeadline();
  h.nextDeadline();
  h.nextDeadline();
  teamVotesR2(h, t[0], 'AMBUSH');
  snapshots.push(h.state);
  while (h.state.phase === 'R2_CLASH') h.nextDeadline();
  snapshots.push(h.state);
  h.ok(h.admin('ADMIN_START_R3'));
  snapshots.push(h.state); // R3 briefing
  toVote(h);
  voteR3(h, t[0], 'GHOST_SHIP');
  snapshots.push(h.state);
  h.nextDeadline();
  snapshots.push(h.state);
  h.ok(h.admin('ADMIN_END_R3'));
  h.ok(h.admin('ADMIN_FINISH'));
  snapshots.push(h.state);
  for (const s of snapshots) {
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    assert.ok(!JSON.stringify(s, (_k, v) => (v === undefined ? '__undef__' : v)).includes('__undef__'));
  }
  assert.equal(h.state.phase, 'FINISHED');
});

test('version increases on every successful change, never on errors or no-ops', () => {
  const h = harness();
  let v = h.state.version;
  h.join('a');
  assert.equal(h.state.version, v + 1);
  v = h.state.version;
  h.join('a'); // same name -> no-op
  assert.equal(h.state.version, v);
  assert.equal(h.as('a', 'LEAVE_TEAM'), 'NOT_IN_TEAM');
  assert.equal(h.state.version, v);
  h.ok(h.as('a', 'CREATE_TEAM', {}));
  assert.equal(h.state.version, v + 1);
});

test('due(): fires each step exactly once and never before its deadline', () => {
  const h = harness();
  formTeams(h, [3, 3]);
  toR2Pairing(h);
  h.ok(h.admin('ADMIN_R2_AUTO_PAIR'));
  const fired: string[] = [];
  let guard = 0;
  while (h.state.phase === 'R2_CLASH' && guard++ < 100) {
    const endsAt = h.state.endsAt!;
    assert.deepEqual(due(h.state, endsAt - 1), []);
    h.now = endsAt;
    const cmds = due(h.state, h.now);
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].commandId, `sys:advance:${h.state.phaseSeq}`);
    fired.push(cmds[0].commandId);
    // apply it twice: the second is a no-op
    h.send(cmds[0].type, cmds[0].actor, cmds[0].payload, { id: cmds[0].commandId });
    const seq = h.state.phaseSeq;
    h.send(cmds[0].type, cmds[0].actor, cmds[0].payload, { id: cmds[0].commandId });
    assert.equal(h.state.phaseSeq, seq);
    // a different id for the same, now stale, step is rejected
    assert.equal(h.send(cmds[0].type, cmds[0].actor, cmds[0].payload, { id: 'other-' + guard }), 'STALE');
  }
  assert.equal(fired.length, 7); // briefing + 3 x 2 steps (VOTE, DEBRIEF)
  assert.equal(new Set(fired).size, 7);
  assert.equal(h.state.phase, 'R2_RESULTS');
});

test('SYS_ADVANCE before the deadline is rejected even with the right sequence number', () => {
  const h = harness();
  formTeams(h, [3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.send('SYS_ADVANCE', { kind: 'system' }, { phaseSeq: h.state.phaseSeq }, { id: 'early' }), 'NOT_DUE');
  assert.equal(h.state.phase, 'R1_ACTIVE');
});

test('pause/resume shifts every active deadline; due() is empty while paused', () => {
  const h = harness();
  formTeams(h, [3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  const ends = h.state.endsAt!;
  h.tick(10);
  h.ok(h.admin('ADMIN_PAUSE'));
  h.now = ends + 1000;
  assert.deepEqual(due(h.state, h.now), []);
  assert.equal(h.send('SYS_ADVANCE', { kind: 'system' }, { phaseSeq: h.state.phaseSeq }, { id: 'while-paused' }), 'PAUSED');
  h.now = ends + 5000;
  const pausedAt = h.state.pausedAt!;
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.state.endsAt, ends + (h.now - pausedAt));
  assert.deepEqual(due(h.state, h.now), []);
  h.now = h.state.endsAt!;
  assert.equal(due(h.state, h.now).length, 1);
});

test('selectors never expose tokenHash, codewords, hints of others or admin data', () => {
  const h = harness(8);
  const t = formTeams(h, [5, 5, 4, 3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  const words = t.map(id => h.state.teams[id].r1!.codeword);
  const check = (label: string) => {
    const blob = everySelector(h.state, h.now) + JSON.stringify(h.state.playerOrder.map(p => playerPrivate(h.state, p)));
    assert.ok(!blob.includes('tokenHash'), `${label}: tokenHash key`);
    assert.ok(!blob.includes('hash-'), `${label}: token hash value`);
    for (const w of words) assert.ok(!blob.includes(w), `${label}: codeword ${w}`);
    assert.ok(!blob.includes('adminAdjust') && !blob.includes('idCounter') && !blob.includes('"rng"'), `${label}: internals`);
  };
  check('R1');
  h.nextDeadline(); // briefing over: the clock runs
  h.tick(250);
  for (const tid of t) for (const i of [1, 2, 3]) h.ok(h.as(h.state.teams[tid].playerIds[0], 'R1_HINT', { hint: i }));
  check('R1 hints');
  h.nextDeadline();
  check('R1 results');
  h.ok(h.admin('ADMIN_START_R2'));
  pairByCode(h, t[0], t[1]);
  pairByCode(h, t[2], t[3]);
  check('R2 pairing');
  h.nextDeadline();
  h.nextDeadline();
  h.nextDeadline();
  check('R2 vote');
  h.nextDeadline();
  check('R2 debrief');
  while (h.state.phase === 'R2_CLASH') h.nextDeadline();
  h.ok(h.admin('ADMIN_START_R3'));
  check('R3');
});

test('selectors never leak foreign votes before reveal (R2 and R3)', () => {
  const h = harness(9);
  const t = formTeams(h, [5, 5]);
  toR2Pairing(h);
  pairByCode(h, t[0], t[1]);
  h.nextDeadline();
  h.nextDeadline();
  h.nextDeadline();
  // only team 0 votes AMBUSH, team 1 never votes
  const voters = h.state.teams[t[0]].playerIds.slice(0, 3);
  for (const p of voters) h.ok(h.as(p, 'R2_VOTE', { vote: 'AMBUSH' }));
  const nonVoter = h.state.teams[t[0]].playerIds[4];
  const rivalPlayer = h.state.teams[t[1]].playerIds[0];
  for (const blob of [
    JSON.stringify(round2MatchView(h.state, t[0], nonVoter)),
    JSON.stringify(round2MatchView(h.state, t[1], rivalPlayer)),
    JSON.stringify(playerPrivate(h.state, nonVoter)),
    JSON.stringify(playerPrivate(h.state, rivalPlayer)),
    everySelector(h.state, h.now),
  ]) {
    assert.ok(!blob.includes('AMBUSH'), 'foreign R2 vote leaked');
  }
  assert.ok(JSON.stringify(playerPrivate(h.state, voters[0])).includes('AMBUSH')); // own vote is visible to the voter
  // Round 3
  const g = setupR3(10, [5, 5, 5], () => 'TRUCE');
  toVote(g.h);
  voteR3(g.h, g.t[0], 'GHOST_SHIP');
  const other = g.h.state.teams[g.t[1]].playerIds[0];
  for (const blob of [JSON.stringify(round3TeamView(g.h.state, g.t[1])), JSON.stringify(playerPrivate(g.h.state, other)), everySelector(g.h.state, g.h.now)]) {
    assert.ok(!blob.includes('GHOST_SHIP'), 'foreign R3 vote leaked before reveal');
  }
});
