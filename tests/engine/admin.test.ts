import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness, pairByCode, playRound2, setupR3, skipBriefing, toR2Pairing, toVote } from './helpers.ts';
import { COMMAND_TYPES, phaseInfo, round2MatchView } from '../../server/engine/index.ts';

test('actor kinds are enforced: players cannot run admin commands and vice versa', () => {
  const h = harness();
  h.join('a');
  for (const type of COMMAND_TYPES.filter(t => t.startsWith('ADMIN_'))) {
    assert.equal(h.as('a', type, {}), 'FORBIDDEN', type);
  }
  assert.equal(h.send('SYS_ADVANCE', { kind: 'player', playerId: 'a' }, { phaseSeq: 0 }), 'FORBIDDEN');
  assert.equal(h.send('SYS_ADVANCE', { kind: 'admin' }, { phaseSeq: 0 }), 'FORBIDDEN');
  assert.equal(h.send('CREATE_TEAM', { kind: 'admin' }, {}), 'FORBIDDEN');
  assert.equal(h.send('NOPE', { kind: 'admin' }, {}), 'UNKNOWN_COMMAND');
  assert.equal(h.as('ghost', 'CREATE_TEAM', {}), 'UNKNOWN_PLAYER');
});

test('phase transitions out of untimed phases are admin commands and are order-checked', () => {
  const h = harness();
  formTeams(h, [3, 3]);
  assert.equal(h.admin('ADMIN_START_R2'), 'WRONG_PHASE');
  assert.equal(h.admin('ADMIN_START_R3'), 'WRONG_PHASE');
  assert.equal(h.admin('ADMIN_FINISH'), 'WRONG_PHASE');
  assert.equal(h.admin('ADMIN_SKIP_STEP'), 'NOT_TIMED');
  assert.equal(h.runDue(), 0);
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.admin('ADMIN_START_GAME'), 'WRONG_PHASE');
  h.nextDeadline(); // briefing ends, the clock starts
  assert.equal(h.state.phase, 'R1_ACTIVE');
  h.nextDeadline();
  assert.equal(h.state.phase, 'R1_RESULTS');
  assert.equal(h.runDue(), 0);
  h.ok(h.admin('ADMIN_START_R2'));
  assert.equal(h.state.phase, 'R2_PAIRING');
  h.ok(h.admin('ADMIN_R2_FORCE_START'));
  while (h.state.phase === 'R2_CLASH') h.nextDeadline();
  assert.equal(h.state.phase, 'R2_RESULTS');
  assert.equal(h.runDue(), 0);
  h.ok(h.admin('ADMIN_START_R3'));
  assert.equal(h.state.phase, 'R3_ACTIVE');
  assert.equal(h.state.step, 'BRIEFING');
});

test('pause / resume: double pause and resume-without-pause are errors; deadlines shift', () => {
  const h = harness();
  formTeams(h, [3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.admin('ADMIN_RESUME'), 'NOT_PAUSED');
  const ends = h.state.endsAt!;
  h.tick(10);
  h.ok(h.admin('ADMIN_PAUSE'));
  assert.equal(h.admin('ADMIN_PAUSE'), 'ALREADY_PAUSED');
  assert.equal(phaseInfo(h.state, h.now + 99_999).paused, true);
  assert.equal(phaseInfo(h.state, h.now + 99_999).remainingMs, ends - (h.now));
  h.tick(77);
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.state.endsAt, ends + 77_000);
  assert.equal(h.state.pausedAt, null);
});

test('skip: advances exactly once; duplicate and stale skips are no-ops', () => {
  const h = harness();
  formTeams(h, [3, 3]);
  toR2Pairing(h);
  h.ok(h.admin('ADMIN_R2_FORCE_START'));
  skipBriefing(h);
  assert.equal(h.state.step, 'HUDDLE');
  const seq = h.state.phaseSeq;
  h.ok(h.send('ADMIN_SKIP_STEP', { kind: 'admin' }, { phaseSeq: seq }, { id: 'skip-1' }));
  assert.equal(h.state.step, 'PARLEY');
  h.ok(h.send('ADMIN_SKIP_STEP', { kind: 'admin' }, { phaseSeq: seq }, { id: 'skip-1' })); // same commandId
  assert.equal(h.state.step, 'PARLEY');
  assert.equal(h.send('ADMIN_SKIP_STEP', { kind: 'admin' }, { phaseSeq: seq }, { id: 'skip-2' }), 'STALE');
  assert.equal(h.state.step, 'PARLEY');
});

test('adjust deadline: +/- seconds, never earlier than now + 5 s, not for untimed phases', () => {
  const h = harness();
  formTeams(h, [3]);
  assert.equal(h.admin('ADMIN_ADJUST_DEADLINE', { seconds: 10 }), 'NOT_TIMED');
  h.ok(h.admin('ADMIN_START_GAME'));
  const ends = h.state.endsAt!;
  h.ok(h.admin('ADMIN_ADJUST_DEADLINE', { seconds: 30 }));
  assert.equal(h.state.endsAt, ends + 30_000);
  h.ok(h.admin('ADMIN_ADJUST_DEADLINE', { seconds: -10_000 }));
  assert.equal(h.state.endsAt, h.now + 5000);
  assert.equal(h.admin('ADMIN_ADJUST_DEADLINE', { seconds: 1.5 }), 'INVALID_PAYLOAD');
  // due() respects the new deadline
  h.tick(4);
  assert.equal(h.runDue(), 0);
  h.tick(1);
  assert.equal(h.runDue(), 1);
});

test('adjust deadline accepts the panel presets: -30, -15, +15, +30, +60 s', () => {
  const h = harness();
  formTeams(h, [3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  // the panel's preset steps: -30, -15, +15, +30, +60 s
  for (const s of [15, 30, 60, -15, -30]) {
    const before = h.state.endsAt!;
    h.ok(h.admin('ADMIN_ADJUST_DEADLINE', { seconds: s }));
    assert.equal(h.state.endsAt, Math.max(before + s * 1000, h.now + 5000));
  }
});

test('move / remove / add players, with team size limits', () => {
  const h = harness();
  const [t0, t1] = formTeams(h, [3, 6]);
  h.join('free');
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'free', teamId: t0 }));
  assert.equal(h.state.players.free.teamId, t0);
  assert.equal(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'free', teamId: t1 }), 'TEAM_FULL');
  assert.equal(h.state.players.free.teamId, t0);
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'p0_0', teamId: null }));
  assert.equal(h.state.teams[t0].playerIds.includes('p0_0'), false);
  h.ok(h.admin('ADMIN_ADD_PLAYER', { name: 'Walk-in', teamId: t0 }));
  const added = h.state.playerOrder[h.state.playerOrder.length - 1];
  assert.equal(h.state.players[added].name, 'Walk-in');
  assert.equal(h.state.players[added].tokenHash, '');
  assert.equal(h.state.players[added].teamId, t0);
  h.ok(h.admin('ADMIN_REMOVE_PLAYER', { playerId: added }));
  assert.equal(h.state.players[added], undefined);
  assert.equal(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'zz', teamId: null }), 'UNKNOWN_PLAYER');
  assert.equal(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'free', teamId: 'nope' }), 'UNKNOWN_TEAM');
});

test('moving the last member away deletes the team', () => {
  const h = harness();
  const [t0, t1] = formTeams(h, [1, 3]);
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'p0_0', teamId: t1 }));
  assert.equal(h.state.teams[t0], undefined);
  assert.deepEqual(h.state.teamOrder, [t1]);
});

test('admin overrides still work after the lobby', () => {
  const h = harness();
  const [t0, t1] = formTeams(h, [3, 3]);
  toR2Pairing(h);
  h.join('late');
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'late', teamId: t0 }));
  assert.equal(h.state.teams[t0].playerIds.length, 4);
  assert.equal(h.state.teams[t0].r1!.slots.late, undefined); // slots stay frozen
  pairByCode(h, t0, t1);
  assert.equal(h.state.phase, 'R2_CLASH');
});

test('delete team: members become unassigned; its match is cancelled and the rival keeps its points', () => {
  const h = harness();
  const [t0, t1, t2, t3] = formTeams(h, [3, 3, 3, 3]);
  toR2Pairing(h);
  pairByCode(h, t0, t1);
  pairByCode(h, t2, t3);
  h.nextDeadline(); // briefing
  h.nextDeadline();
  h.nextDeadline();
  h.nextDeadline(); // clash 1 scored: all truce
  assert.equal(h.state.teams[t1].r2Points, 75);
  h.ok(h.admin('ADMIN_DELETE_TEAM', { teamId: t0 }));
  assert.equal(h.state.teams[t0], undefined);
  assert.equal(h.state.players.p0_0.teamId, null);
  assert.equal(h.state.r2.matches[h.state.r2.matchOfTeam[t1]].cancelled, true);
  const view = round2MatchView(h.state, t1)!;
  assert.equal(view.cancelled, true);
  assert.equal(view.rivalName, null);
  // the rest of the game carries on; the cancelled match scores no more clashes
  while (h.state.phase === 'R2_CLASH') h.nextDeadline();
  assert.equal(h.state.teams[t1].r2Points, 75);
  assert.equal(h.state.teams[t2].r2Points, 450);
  h.ok(h.admin('ADMIN_START_R3'));
  assert.equal(h.state.r3!.teams[t0], undefined);
});

test('set durations: applied to later steps; validated', () => {
  const h = harness();
  formTeams(h, [3, 3]);
  assert.equal(h.admin('ADMIN_SET_DURATIONS', { r1Seconds: 2 }), 'INVALID_DURATION');
  assert.equal(h.admin('ADMIN_SET_DURATIONS', { r2: { HUDDLE: 'x' } }), 'INVALID_DURATION');
  h.ok(h.admin('ADMIN_SET_DURATIONS', { r1Seconds: 120, r2: { HUDDLE: 10, PARLEY: 11, VOTE: 12, DEBRIEF: 13 }, r3: { BLUFF: 14, VOTE: 15, REVEAL: 16 }, sdSeconds: 17 }));
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.state.step, 'BRIEFING');
  skipBriefing(h);
  assert.equal(h.state.endsAt, h.now + 120_000);
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  h.ok(h.admin('ADMIN_START_R2'));
  h.ok(h.admin('ADMIN_R2_AUTO_PAIR'));
  skipBriefing(h);
  assert.equal(h.state.endsAt, h.now + 10_000);
  const secs: number[] = [];
  while (h.state.phase === 'R2_CLASH') {
    secs.push((h.state.endsAt! - h.now) / 1000);
    h.nextDeadline();
  }
  assert.deepEqual(secs.slice(0, 4), [10, 11, 12, 13]);
  h.ok(h.admin('ADMIN_START_R3'));
  skipBriefing(h);
  assert.equal(h.state.endsAt, h.now + 14_000);
});

test('reset game returns to an empty lobby and keeps monotonic counters', () => {
  const { h } = setupR3(7, [3, 3], () => 'TRUCE');
  const seq = h.state.phaseSeq;
  const version = h.state.version;
  h.ok(h.admin('ADMIN_RESET_GAME'));
  assert.equal(h.state.phase, 'LOBBY');
  assert.equal(h.state.playerOrder.length, 0);
  assert.equal(h.state.teamOrder.length, 0);
  assert.equal(h.state.r3, null);
  assert.ok(h.state.phaseSeq > seq);
  assert.ok(h.state.version > version);
  assert.equal(h.state.endsAt, null);
  h.join('again');
  assert.equal(h.state.playerOrder.length, 1);
});

test('a skipped VOTE step still resolves the wave exactly once', () => {
  const { h } = setupR3(9, [3, 3, 3], () => 'TRUCE');
  toVote(h);
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  assert.equal(h.state.step, 'REVEAL');
  assert.equal(h.state.r3!.reports.length, 1);
  void playRound2;
});

test('removed admin tools are rejected as unknown commands (no manual score, distance, honour, solved or rename)', () => {
  const h = harness();
  const [t] = formTeams(h, [3]);
  const before = JSON.stringify(h.state.teams[t]);
  for (const type of ['ADMIN_ADJUST_SCORE', 'ADMIN_ADJUST_DISTANCE', 'ADMIN_TOGGLE_HONOUR', 'ADMIN_MARK_R1_SOLVED', 'ADMIN_RENAME_TEAM']) {
    assert.equal(h.admin(type, { teamId: t, delta: 100, name: 'Hacked' }), 'UNKNOWN_COMMAND', type);
  }
  assert.equal(JSON.stringify(h.state.teams[t]), before);
});
