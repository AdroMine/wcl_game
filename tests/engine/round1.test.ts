import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness } from './helpers.ts';
import type { Harness } from './helpers.ts';
import { calculateRound1Score, generateHintText, ROUND1_HINTS } from '../../server/engine/round1.ts';
import { briefingSeconds } from '../../server/content.ts';
import { playerPrivate, round1Tablet, round1TeamStatus } from '../../server/engine/index.ts';
import type { GameState } from '../../server/engine/index.ts';

// ---- golden values ported from tests/test_hints_and_scoring.ts (sections 1-4) -------------

test('golden: hint configuration (2m, 3m, 4m, -30 each)', () => {
  assert.equal(ROUND1_HINTS.length, 3);
  assert.deepEqual(ROUND1_HINTS.map(h => h.availableAfterSeconds), [120, 180, 240]);
  assert.ok(ROUND1_HINTS.every(h => h.penaltyPoints === 30));
});

test('golden: hint text identifies left, right and centre players', () => {
  const members = [
    { slotIndex: 0, playerName: 'Orpheus', roleName: 'Navigator' },
    { slotIndex: 1, playerName: 'Elena', roleName: 'Oracle' },
    { slotIndex: 2, playerName: 'Marcus', roleName: 'Scholar' },
    { slotIndex: 3, playerName: 'Hesper', roleName: 'Torchbearer' },
    { slotIndex: 4, playerName: 'Damon', roleName: 'Negotiator' },
  ];
  const h1 = generateHintText(1, 5, members);
  assert.ok(h1.includes('Orpheus') && h1.includes('LEFT'));
  const h2 = generateHintText(2, 5, members);
  assert.ok(h2.includes('Damon') && h2.includes('RIGHT'));
  const h3 = generateHintText(3, 5, members);
  assert.ok(h3.includes('Marcus') && h3.includes('CENTER'));
});

test('golden: scoring curve', () => {
  assert.equal(calculateRound1Score(45, 0).finalPoints, 300);
  assert.equal(calculateRound1Score(90, 0).finalPoints, 250);
  assert.equal(calculateRound1Score(140, 1).finalPoints, 170);
  assert.equal(calculateRound1Score(210, 2).finalPoints, 90);
  assert.equal(calculateRound1Score(320, 3).finalPoints, 50);
});

test('golden: speed tier boundaries use whole seconds (RULE_DECISIONS)', () => {
  const base = (s: number) => calculateRound1Score(s, 0).finalPoints;
  assert.deepEqual([0, 60, 61, 120, 121, 180, 181, 240, 241, 300].map(base), [300, 300, 250, 250, 200, 200, 150, 150, 100, 100]);
  assert.equal(calculateRound1Score(59.9, 0).finalPoints, 300);
});

// ---- engine behaviour ----------------------------------------------------------------------

function started(sizes = [5, 4]): { h: Harness; teams: string[] } {
  const h = harness(11);
  const teams = formTeams(h, sizes);
  h.ok(h.admin('ADMIN_START_GAME'));
  h.nextDeadline(); // the briefing ends: the 5:00 clock starts now
  return { h, teams };
}

test('start: the briefing runs first; the 5:00 clock starts when it ends', () => {
  const h = harness(11);
  const teams = formTeams(h, [5, 4, 3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.state.phase, 'R1_ACTIVE');
  assert.equal(h.state.step, 'BRIEFING');
  assert.equal(h.state.endsAt, h.now + briefingSeconds(1) * 1000);
  assert.equal(h.state.r1.startedAt, null);
  const t0 = teams[0];
  const word = h.state.teams[t0].r1!.codeword;
  const p = h.state.teams[t0].playerIds[0];
  // nothing is accepted while the story plays
  assert.equal(h.as(p, 'R1_SUBMIT', { answer: word }), 'WRONG_PHASE');
  assert.equal(h.as(p, 'R1_HINT', { hint: 1 }), 'WRONG_PHASE');
  assert.equal(h.admin('ADMIN_MARK_R1_SOLVED', { teamId: t0 }), 'WRONG_PHASE');
  assert.equal(h.state.teams[t0].r1Points, 0);
  // the clock starts at the end of the briefing
  const briefingEnd = h.state.endsAt!;
  h.tick(briefingSeconds(1) - 1);
  assert.equal(h.runDue(), 0);
  h.tick(1);
  assert.equal(h.runDue(), 1);
  assert.equal(h.state.step, null);
  assert.equal(h.state.r1.startedAt, briefingEnd);
  assert.equal(h.state.endsAt, briefingEnd + 300_000);
  h.tick(45);
  h.ok(h.as(p, 'R1_SUBMIT', { answer: word }));
  assert.equal(h.state.teams[t0].r1Points, 300, 'speed tiers count from the end of the briefing');
});

test('briefing: admin skip step skips the briefing and starts the clock', () => {
  const h = harness(11);
  formTeams(h, [4]);
  h.ok(h.admin('ADMIN_START_GAME'));
  h.tick(3);
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  assert.equal(h.state.step, null);
  assert.equal(h.state.phase, 'R1_ACTIVE');
  assert.equal(h.state.r1.startedAt, h.now);
  assert.equal(h.state.endsAt, h.now + 300_000);
});

test('briefing: pause during the briefing freezes it', () => {
  const h = harness(11);
  formTeams(h, [4]);
  h.ok(h.admin('ADMIN_START_GAME'));
  const ends = h.state.endsAt!;
  h.tick(10);
  h.ok(h.admin('ADMIN_PAUSE'));
  h.tick(500);
  assert.equal(h.runDue(), 0);
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.state.endsAt, ends + 500_000);
  assert.equal(h.state.r1.startedAt, null);
});

test('start: every team gets a 2-word codeword, slots frozen = index in player list', () => {
  const { h, teams } = started([5, 4, 3]);
  assert.equal(h.state.phase, 'R1_ACTIVE');
  assert.equal(h.state.endsAt, h.now + 300_000);
  for (const tid of teams) {
    const t = h.state.teams[tid];
    assert.match(t.r1!.codeword, /^[A-Z]+ [A-Z]+$/);
    assert.equal(t.r1!.size, t.playerIds.length);
    t.playerIds.forEach((pid, i) => assert.equal(t.r1!.slots[pid], i));
  }
});

/** Every current member holds a distinct slot 0..n-1 and slotCount = n, as the phones would see it. */
function assertPieces(state: GameState, teamId: string): void {
  const t = state.teams[teamId];
  const n = t.playerIds.length;
  const seen = t.playerIds.map(pid => {
    const r1 = playerPrivate(state, pid)!.r1!;
    assert.equal(r1.slotCount, n, 'slotCount = member count');
    return r1.slot;
  });
  assert.deepEqual(seen.slice().sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i), 'no missing or duplicate piece');
  assert.equal(t.r1!.size, n);
}

for (const size of [3, 4, 5, 6]) {
  test(`pieces: a crew of ${size} gets exactly ${size} pieces and the tablet lines`, () => {
    const { h, teams } = started([size]);
    assertPieces(h.state, teams[0]);
    const t = h.state.teams[teams[0]];
    t.playerIds.forEach((pid, i) => assert.equal(playerPrivate(h.state, pid)!.r1!.slot, i));
    const [w1, w2] = t.r1!.codeword.split(' ');
    assert.deepEqual(round1Tablet(h.state, teams[0]), { line1: w1, line2: w2 });
  });
}

test('pieces: a mid-round move, add and remove recompute both crews', () => {
  const { h, teams } = started([5, 3, 4]);
  const [a, b, c] = teams;
  const mover = h.state.teams[a].playerIds[1];
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: mover, teamId: b }));
  assert.equal(h.state.teams[a].playerIds.length, 4);
  assert.equal(h.state.teams[b].playerIds.length, 4);
  assertPieces(h.state, a);
  assertPieces(h.state, b);
  assert.equal(h.state.teams[b].r1!.slots[mover], 3, 'the mover is last in the new crew join order');
  const first = h.state.teams[c].playerIds[0];
  h.ok(h.admin('ADMIN_REMOVE_PLAYER', { playerId: first }));
  assert.equal(h.state.teams[c].playerIds.length, 3);
  assertPieces(h.state, c);
  h.ok(h.admin('ADMIN_ADD_PLAYER', { name: 'Late', teamId: c }));
  assertPieces(h.state, c);
  assert.equal(h.state.teams[c].r1!.size, 4);
  h.join('stray');
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'stray', teamId: a }));
  assertPieces(h.state, a);
  assert.equal(h.state.teams[a].r1!.size, 5);
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'stray', teamId: null }));
  assertPieces(h.state, a);
  assert.equal(h.state.teams[a].r1!.size, 4);
});

test('pieces: taken hint texts follow the new layout', () => {
  const { h, teams } = started([5]);
  const t = h.state.teams[teams[0]];
  h.tick(125);
  h.ok(h.as(t.playerIds[0], 'R1_HINT', { hint: 1 }));
  const firstName = h.state.players[t.playerIds[0]].name;
  assert.ok(h.state.teams[teams[0]].r1!.hintTexts['1'].includes(firstName));
  h.ok(h.admin('ADMIN_REMOVE_PLAYER', { playerId: t.playerIds[0] }));
  const now = h.state.teams[teams[0]];
  assert.ok(now.r1!.hintTexts['1'].includes(h.state.players[now.playerIds[0]].name), 'hint now names the new slot 0 member');
  assertPieces(h.state, teams[0]);
});

test('lobby: moving players before Round 1 leaves Round 1 data empty', () => {
  const h = harness(3);
  const [a] = formTeams(h, [4]);
  h.join('x');
  h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: 'x', teamId: a }));
  assert.equal(h.state.teams[a].r1, null);
});

test('private view: each player gets only their own slot; slot count = team size', () => {
  const { h, teams } = started([6, 3]);
  for (const tid of teams) {
    const t = h.state.teams[tid];
    t.playerIds.forEach((pid, i) => {
      const pp = playerPrivate(h.state, pid)!;
      assert.equal(pp.r1!.slot, i);
      assert.equal(pp.r1!.slotCount, t.playerIds.length);
      assert.deepEqual(Object.keys(pp.r1!).sort(), ['slot', 'slotCount']);
    });
  }
});

test('submit: wrong answer -> WRONG_ANSWER, normalisation ignores case, spaces and padding', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  const p = t.playerIds[2];
  assert.equal(h.as(p, 'R1_SUBMIT', { answer: 'NOPE NOPE' }), 'WRONG_ANSWER');
  assert.equal(h.state.teams[teams[0]].r1Points, 0);
  h.tick(45);
  const word = t.r1!.codeword.toLowerCase().replace(' ', '   ');
  h.ok(h.as(p, 'R1_SUBMIT', { answer: `  ${word} ` }));
  assert.equal(h.state.teams[teams[0]].r1!.solved, true);
  assert.equal(h.state.teams[teams[0]].r1Points, 300);
  assert.equal(h.state.teams[teams[0]].score, 300);
});

test('submit: already solved is a no-op success (points not re-awarded)', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  h.tick(30);
  h.ok(h.as(t.playerIds[0], 'R1_SUBMIT', { answer: t.r1!.codeword }));
  const v = h.state.version;
  h.tick(100);
  h.ok(h.as(t.playerIds[1], 'R1_SUBMIT', { answer: t.r1!.codeword }));
  assert.equal(h.state.version, v);
  assert.equal(h.state.teams[teams[0]].r1Points, 300);
});

test('hints: locked before 120/180/240 s, idempotent, each costs 30', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  const p = t.playerIds[0];
  assert.equal(h.as(p, 'R1_HINT', { hint: 1 }), 'HINT_LOCKED');
  h.tick(119);
  assert.equal(h.as(p, 'R1_HINT', { hint: 1 }), 'HINT_LOCKED');
  h.tick(1);
  h.ok(h.as(p, 'R1_HINT', { hint: 1 }));
  const v = h.state.version;
  h.ok(h.as(p, 'R1_HINT', { hint: 1 }));
  assert.equal(h.state.version, v);
  assert.equal(h.as(p, 'R1_HINT', { hint: 2 }), 'HINT_LOCKED');
  assert.equal(h.as(p, 'R1_HINT', { hint: 7 }), 'INVALID_PAYLOAD');
  const st = round1TeamStatus(h.state, teams[0], h.now)!;
  assert.deepEqual(st.hints.map(x => [x.unlocked, x.taken]), [[true, true], [false, false], [false, false]]);
  assert.ok(st.hints[0].text!.includes('LEFT EDGE'));
  assert.ok(st.hints[0].text!.includes(h.state.players[t.playerIds[0]].name));
  // solve at 140 s with one hint -> 200 - 30 = 170
  h.tick(20);
  h.ok(h.as(p, 'R1_SUBMIT', { answer: t.r1!.codeword }));
  assert.equal(h.state.teams[teams[0]].r1Points, 170);
});

test('hints: three hints and a late solve hit the 50 point floor', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  const p = t.playerIds[0];
  h.tick(240);
  for (const i of [1, 2, 3]) h.ok(h.as(p, 'R1_HINT', { hint: i }));
  h.tick(55);
  h.ok(h.as(p, 'R1_SUBMIT', { answer: t.r1!.codeword }));
  assert.equal(h.state.teams[teams[0]].r1Points, 50); // 100 - 90 = 10 -> floor 50
});

test('deadline: round closes at 300 s, later submits -> ROUND_CLOSED, unsolved score 0', () => {
  const { h, teams } = started();
  const solver = h.state.teams[teams[0]];
  h.tick(100);
  h.ok(h.as(solver.playerIds[0], 'R1_SUBMIT', { answer: solver.r1!.codeword }));
  h.tick(200); // exactly at the deadline
  // between the deadline and the due() command being applied
  const other = h.state.teams[teams[1]];
  assert.equal(h.as(other.playerIds[0], 'R1_SUBMIT', { answer: other.r1!.codeword }), 'ROUND_CLOSED');
  assert.equal(h.runDue(), 1);
  assert.equal(h.state.phase, 'R1_RESULTS');
  assert.equal(h.as(other.playerIds[0], 'R1_SUBMIT', { answer: other.r1!.codeword }), 'ROUND_CLOSED');
  assert.equal(h.state.teams[teams[1]].score, 0);
  assert.equal(h.state.teams[teams[0]].score, 250);
});

test('submit one second before the deadline is accepted (tier 100)', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  h.tick(299);
  h.ok(h.as(t.playerIds[0], 'R1_SUBMIT', { answer: t.r1!.codeword }));
  assert.equal(h.state.teams[teams[0]].r1Points, 100);
});

test('before the round and for players without a team', () => {
  const h = harness();
  const [tid] = formTeams(h, [3]);
  h.join('loner');
  assert.equal(h.as('p0_0', 'R1_SUBMIT', { answer: 'X' }), 'WRONG_PHASE');
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.as('loner', 'R1_SUBMIT', { answer: 'X' }), 'NOT_IN_TEAM');
  assert.equal(h.as('ghost', 'R1_SUBMIT', { answer: 'X' }), 'UNKNOWN_PLAYER');
  assert.ok(tid);
});

test('pause freezes R1 elapsed time and shifts the deadline', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  const p = t.playerIds[0];
  const ends = h.state.endsAt!;
  h.tick(50);
  h.ok(h.admin('ADMIN_PAUSE'));
  assert.equal(h.as(p, 'R1_SUBMIT', { answer: t.r1!.codeword }), 'PAUSED');
  h.tick(500);
  assert.equal(h.runDue(), 0); // nothing due while paused
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.state.endsAt, ends + 500_000);
  h.tick(20); // 70 s of active time
  h.ok(h.as(p, 'R1_SUBMIT', { answer: t.r1!.codeword }));
  assert.equal(h.state.teams[teams[0]].r1!.solveSeconds, 70);
  assert.equal(h.state.teams[teams[0]].r1Points, 250);
});

test('hints unlock on active time, not wall time, across a pause', () => {
  const { h, teams } = started();
  const p = h.state.teams[teams[0]].playerIds[0];
  h.tick(100);
  h.ok(h.admin('ADMIN_PAUSE'));
  h.tick(1000);
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.as(p, 'R1_HINT', { hint: 1 }), 'HINT_LOCKED'); // only 100 s active
  h.tick(20);
  h.ok(h.as(p, 'R1_HINT', { hint: 1 }));
});

test('admin: mark solved scores as if solved now, with hints taken', () => {
  const { h, teams } = started();
  const p = h.state.teams[teams[0]].playerIds[0];
  h.tick(130);
  h.ok(h.as(p, 'R1_HINT', { hint: 1 }));
  h.ok(h.admin('ADMIN_MARK_R1_SOLVED', { teamId: teams[0] }));
  assert.equal(h.state.teams[teams[0]].r1Points, 170);
  assert.equal(h.state.teams[teams[0]].r1!.markedByAdmin, true);
  const v = h.state.version;
  h.ok(h.admin('ADMIN_MARK_R1_SOLVED', { teamId: teams[0] }));
  assert.equal(h.state.version, v);
  assert.equal(h.admin('ADMIN_MARK_R1_SOLVED', { teamId: 'nope' }), 'UNKNOWN_TEAM');
});

test('selectors never expose the codeword or the token hash', () => {
  const { h, teams } = started();
  const t = h.state.teams[teams[0]];
  const blob = JSON.stringify([
    playerPrivate(h.state, t.playerIds[0]),
    round1TeamStatus(h.state, teams[0], h.now),
  ]);
  assert.ok(!blob.includes(t.r1!.codeword));
  assert.ok(!blob.includes('tokenHash'));
  assert.ok(!blob.includes('hash-'));
});
