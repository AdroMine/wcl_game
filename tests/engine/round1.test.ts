import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness } from './helpers.ts';
import type { Harness } from './helpers.ts';
import { calculateRound1Score, generateHintText, ROUND1_HINTS } from '../../server/engine/round1.ts';
import { getAllAsciiSlices } from '../../server/engine/ascii.ts';
import { playerPrivate, round1TeamStatus } from '../../server/engine/index.ts';

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

test('golden: slicing resamples every word into uniform slices', () => {
  for (const word of ['ORACLE', 'CERBERUS', 'CHARON', 'HYDRA', 'MINOTAUR']) {
    const slices = getAllAsciiSlices(word, 5, 'HORIZONTAL');
    assert.equal(slices.length, 5);
    const len = slices[0][0].length;
    for (const s of slices) {
      assert.equal(s.length, 3);
      assert.ok(s.every(l => l.length === len));
    }
  }
});

// ---- engine behaviour ----------------------------------------------------------------------

function started(sizes = [5, 4]): { h: Harness; teams: string[] } {
  const h = harness(11);
  const teams = formTeams(h, sizes);
  h.ok(h.admin('ADMIN_START_GAME'));
  return { h, teams };
}

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

test('private slice: each player gets only their own slice; slice count = team size', () => {
  const { h, teams } = started([6, 3]);
  for (const tid of teams) {
    const t = h.state.teams[tid];
    const all = getAllAsciiSlices(t.r1!.codeword, t.playerIds.length, 'HORIZONTAL');
    t.playerIds.forEach((pid, i) => {
      const pp = playerPrivate(h.state, pid)!;
      assert.equal(pp.r1!.slot, i);
      assert.equal(pp.r1!.slotCount, t.playerIds.length);
      assert.deepEqual(pp.r1!.slice, all[i]);
    });
  }
  assert.equal(playerPrivate(h.state, h.state.teams[teams[1]].playerIds[0])!.r1!.slice.length, 5); // 15 rows / 3
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
