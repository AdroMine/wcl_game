import test from 'node:test';
import assert from 'node:assert/strict';
import { addPoints, formTeams, harness, pairByCode, playRound2, teamVotesR2, toR2Pairing } from './helpers.ts';
import type { Harness } from './helpers.ts';
import { calculateClashPoints, calculateTeamStance, computeMoral, newClash } from '../../server/engine/round2.ts';
import { R2_SCORING } from '../../server/engine/config.ts';
import { briefingSeconds } from '../../server/content.ts';
import { gameStateProblem } from '../../server/persistence/validate.ts';
import { normalizeRestoredState, playerPrivate, round2MatchView } from '../../server/engine/index.ts';
import type { Clash } from '../../server/engine/index.ts';

// ---- golden values ported from tests/test_round2.ts ----------------------------------------

test('golden: team stance is a majority of cast votes; tie -> TRUCE', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  assert.equal(calculateTeamStance({ p1: 'TRUCE', p2: 'TRUCE', p3: 'TRUCE', p4: 'AMBUSH', p5: 'AMBUSH' }, ids), 'TRUCE');
  assert.equal(calculateTeamStance({ p1: 'TRUCE', p2: 'AMBUSH', p3: 'AMBUSH', p4: 'AMBUSH', p5: 'AMBUSH' }, ids), 'AMBUSH');
  // abstentions (missing votes) are ignored
  assert.equal(calculateTeamStance({ p1: 'TRUCE', p2: 'AMBUSH', p3: 'AMBUSH' }, ids), 'AMBUSH');
  // RULE_DECISIONS Q1: ties are TRUCE even if the old Negotiator (p1) voted AMBUSH
  assert.equal(calculateTeamStance({ p1: 'AMBUSH', p2: 'AMBUSH', p3: 'TRUCE', p4: 'TRUCE' }, ids), 'TRUCE');
  assert.equal(calculateTeamStance({ p1: 'TRUCE', p2: 'AMBUSH', p3: 'AMBUSH', p4: 'TRUCE' }, ids), 'TRUCE');
  // nobody voted counts as a tie
  assert.equal(calculateTeamStance({}, ids), 'TRUCE');
  // votes of non-members do not count
  assert.equal(calculateTeamStance({ x: 'AMBUSH', y: 'AMBUSH', p1: 'TRUCE' }, ids), 'TRUCE');
});

test('golden: scoring matrix for all three clashes', () => {
  const m = R2_SCORING;
  const pts = (a: 'TRUCE' | 'AMBUSH', b: 'TRUCE' | 'AMBUSH', n: number) => {
    const r = calculateClashPoints(a, b, n, m);
    return [r.team_a_pts, r.team_b_pts];
  };
  assert.deepEqual(pts('TRUCE', 'TRUCE', 1), [75, 75]);
  assert.deepEqual(pts('AMBUSH', 'TRUCE', 1), [150, 0]);
  assert.deepEqual(pts('AMBUSH', 'AMBUSH', 1), [15, 15]);
  assert.deepEqual(pts('TRUCE', 'TRUCE', 2), [150, 150]);
  assert.deepEqual(pts('TRUCE', 'AMBUSH', 2), [0, 300]);
  assert.deepEqual(pts('AMBUSH', 'AMBUSH', 2), [30, 30]);
  assert.deepEqual(pts('TRUCE', 'TRUCE', 3), [225, 225]);
  assert.deepEqual(pts('AMBUSH', 'TRUCE', 3), [450, 0]);
  assert.deepEqual(pts('AMBUSH', 'AMBUSH', 3), [45, 45]);
});

function clashes(...stances: ['TRUCE' | 'AMBUSH', 'TRUCE' | 'AMBUSH'][]): Clash[] {
  return stances.map(([a, b], i) => ({ ...newClash(i + 1), resolved: true, stanceA: a, stanceB: b }));
}

test('Q7 moral status: Honourable / Betrayed / Aggressor / Blood Feud (+ nemesis)', () => {
  const T = 'TRUCE';
  const A = 'AMBUSH';
  const honourable = clashes([T, T], [T, T], [T, T]);
  assert.equal(computeMoral(honourable, 'A', 'B').status, 'HONOURABLE');
  assert.equal(computeMoral(honourable, 'B', 'A').status, 'HONOURABLE');
  assert.equal(computeMoral(honourable, 'A', 'B').nemesisTeamId, null);

  const bBetraysA = clashes([T, A], [T, A], [T, T]);
  const a = computeMoral(bBetraysA, 'A', 'B');
  assert.equal(a.status, 'BETRAYED');
  assert.equal(a.nemesisTeamId, 'B');
  assert.equal(computeMoral(bBetraysA, 'B', 'A').status, 'AGGRESSOR');
  assert.equal(computeMoral(bBetraysA, 'B', 'A').nemesisTeamId, null);

  // equal ambushes both ways -> Blood Feud
  assert.equal(computeMoral(clashes([A, T], [T, A], [T, T]), 'A', 'B').status, 'BLOOD_FEUD');
  // all-mutual-ambush -> Blood Feud, no bonus
  assert.equal(computeMoral(clashes([A, A], [A, A], [A, A]), 'A', 'B').status, 'BLOOD_FEUD');
  // two mutual truces and one mutual ambush -> not honourable, Blood Feud
  assert.equal(computeMoral(clashes([T, T], [T, T], [A, A]), 'A', 'B').status, 'BLOOD_FEUD');
  // more ambushes by me than them -> Aggressor even with one reciprocal
  assert.equal(computeMoral(clashes([A, T], [A, T], [T, A]), 'A', 'B').status, 'AGGRESSOR');
  assert.equal(computeMoral([], 'A', 'B').status, 'NONE');
});

// ---- engine behaviour -----------------------------------------------------------------------

function r2(sizes = [5, 5, 4, 3]): { h: Harness; t: string[] } {
  const h = harness(21);
  const t = formTeams(h, sizes);
  toR2Pairing(h);
  return { h, t };
}

test('pairing: own code, unknown code, bad format, already paired, same pairing is a no-op', () => {
  const { h, t } = r2();
  const p0 = h.state.teams[t[0]].playerIds[0];
  assert.equal(h.as(p0, 'R2_PAIR', { code: h.state.teams[t[0]].emojiCode }), 'OWN_CODE');
  assert.equal(h.as(p0, 'R2_PAIR', { code: '  ' }), 'INVALID_CODE');
  assert.equal(h.as(p0, 'R2_PAIR', { code: '07' }), 'UNKNOWN_CODE');
  assert.equal(h.as(p0, 'R2_PAIR', { code: '🔥🔥🔥🔥🔥🔥' }), 'UNKNOWN_CODE');
  pairByCode(h, t[0], t[1]);
  const v = h.state.version;
  // the rival can re-enter the same pairing from the other side, and so can the first team
  pairByCode(h, t[1], t[0]);
  pairByCode(h, t[0], t[1]);
  assert.equal(h.state.version, v);
  // either side already paired -> error
  assert.equal(h.as(h.state.teams[t[2]].playerIds[0], 'R2_PAIR', { code: h.state.teams[t[0]].emojiCode }), 'ALREADY_PAIRED');
  assert.equal(h.as(h.state.teams[t[0]].playerIds[1], 'R2_PAIR', { code: h.state.teams[t[2]].emojiCode }), 'ALREADY_PAIRED');
  assert.equal(h.state.phase, 'R2_PAIRING');
});

test('pairing: clash 1 starts automatically once every team is paired', () => {
  const { h, t } = r2();
  pairByCode(h, t[0], t[1]);
  assert.equal(h.state.phase, 'R2_PAIRING');
  pairByCode(h, t[2], t[3]);
  assert.equal(h.state.phase, 'R2_CLASH');
  assert.equal(h.state.step, 'BRIEFING');
  assert.equal(h.state.clash, 1);
  assert.equal(h.state.endsAt, h.now + briefingSeconds(2) * 1000);
  // the briefing plays first: no votes; the global clash clock (VOTE 60 s: talk and vote) starts when it ends
  assert.equal(h.as(h.state.teams[t[0]].playerIds[0], 'R2_VOTE', { vote: 'TRUCE' }), 'WRONG_PHASE');
  h.nextDeadline();
  assert.equal(h.state.step, 'VOTE');
  assert.equal(h.state.endsAt, h.now + 60_000);
  // voting is open from the very first second of the clash
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R2_VOTE', { vote: 'TRUCE' }));
});

test('briefing: admin skip step skips the Round 2 briefing', () => {
  const { h, t } = r2();
  pairByCode(h, t[0], t[1]);
  pairByCode(h, t[2], t[3]);
  h.tick(2);
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  assert.equal(h.state.step, 'VOTE');
  assert.equal(h.state.endsAt, h.now + 60_000);
});

test('pairing: admin force start leaves unpaired teams out, admin can pair/unpair/auto-pair', () => {
  const { h, t } = r2([5, 5, 5]);
  assert.equal(h.admin('ADMIN_R2_PAIR', { teamA: t[0], teamB: t[0] }), 'SAME_TEAM');
  h.ok(h.admin('ADMIN_R2_PAIR', { teamA: t[0], teamB: t[1] }));
  h.ok(h.admin('ADMIN_R2_UNPAIR', { teamId: t[1] }));
  assert.equal(h.state.r2.matchOfTeam[t[0]], undefined);
  h.ok(h.admin('ADMIN_R2_AUTO_PAIR'));
  assert.equal(Object.keys(h.state.r2.matches).length, 1);
  assert.equal(h.state.phase, 'R2_PAIRING'); // one team is left over
  const sitter = t.find(x => !h.state.r2.matchOfTeam[x])!;
  h.ok(h.admin('ADMIN_R2_FORCE_START'));
  assert.equal(h.state.phase, 'R2_CLASH');
  playRound2(h, () => 'TRUCE');
  assert.equal(h.state.phase, 'R2_RESULTS');
  assert.equal(h.state.teams[sitter].r2Points, 450); // bye: Truce points for every clash
  assert.equal(h.state.r2.moral[sitter].status, 'HONOURABLE'); // recompense for the round it could not play
});

// ---- bye crews (organizer ruling, Nov 3 2026) -----------------------------------------------

test('bye: an odd crew left over receives both_truce for clashes 1..3 as each resolves', () => {
  const { h, t } = r2([5, 5, 5]);
  pairByCode(h, t[0], t[1]);
  const bye = t[2];
  h.ok(h.admin('ADMIN_R2_FORCE_START'));
  const seen: number[] = [];
  while (h.state.phase === 'R2_CLASH') {
    if (h.state.step === 'VOTE') {
      teamVotesR2(h, t[0], 'TRUCE');
      teamVotesR2(h, t[1], 'TRUCE');
      assert.equal(h.state.teams[bye].r2Points, seen.reduce((a, n) => a + n, 0), 'not yet credited during the vote');
    }
    h.nextDeadline();
    const got = h.state.r2.bye[bye] ?? [];
    if (got.length > seen.length) seen.push(got[got.length - 1]);
  }
  assert.deepEqual(h.state.r2.bye[bye], [R2_SCORING['1'].both_truce, R2_SCORING['2'].both_truce, R2_SCORING['3'].both_truce]);
  assert.equal(h.state.teams[bye].r2Points, 450);
  assert.equal(h.state.teams[bye].score, h.state.teams[bye].r1Points + 450 + h.state.teams[bye].adminAdjust);
  assert.equal(h.state.r2.moral[bye].status, 'HONOURABLE');
  assert.equal(h.state.r2.moral[bye].nemesisTeamId, null);
  assert.equal(h.state.r2.bye[t[0]], undefined, 'paired crews get no bye');
  assert.equal(h.state.teams[t[0]].r2Points, 450);
  const v = round2MatchView(h.state, bye)!;
  assert.equal(v.paired, false);
  assert.deepEqual(v.bye, [75, 150, 225]);
});

test('bye: force-start with three unpaired crews credits each of them', () => {
  const { h, t } = r2([5, 5, 5]);
  h.ok(h.admin('ADMIN_R2_FORCE_START'));
  playRound2(h, () => null);
  assert.equal(h.state.phase, 'R2_RESULTS');
  for (const tid of t) {
    assert.deepEqual(h.state.r2.bye[tid], [75, 150, 225]);
    assert.equal(h.state.teams[tid].r2Points, 450);
    assert.equal(h.state.r2.moral[tid].status, 'HONOURABLE');
  }
});

test('bye: state survives a JSON round trip and an old snapshot without r2.bye restores', () => {
  const { h, t } = r2([5, 5, 5]);
  pairByCode(h, t[0], t[1]);
  playRound2(h, () => 'TRUCE');
  const copy = JSON.parse(JSON.stringify(h.state));
  assert.deepEqual(copy, h.state);
  const old = JSON.parse(JSON.stringify(h.state));
  delete old.r2.bye;
  const restored = normalizeRestoredState(old);
  assert.deepEqual(restored.r2.bye, {});
  assert.equal(normalizeRestoredState(restored), restored, 'idempotent');
  assert.deepEqual(round2MatchView(restored, t[2])!.bye, []);
  assert.equal(gameStateProblem(old), null, 'old snapshot still validates');
  assert.equal(gameStateProblem(copy), null);
});

test('timeline: 3 clashes x VOTE 60 (talk and vote), DEBRIEF 15 on one global clock', () => {
  const { h, t } = r2([5, 5]);
  pairByCode(h, t[0], t[1]);
  const start = h.now;
  const seen: string[] = [];
  let at = start;
  while (h.state.phase === 'R2_CLASH') {
    seen.push(`${h.state.clash}:${h.state.step}:${(h.state.endsAt! - at) / 1000}`);
    at = h.state.endsAt!;
    h.nextDeadline();
  }
  assert.deepEqual(seen, [
    `1:BRIEFING:${briefingSeconds(2)}`,
    '1:VOTE:60', '1:DEBRIEF:15',
    '2:VOTE:60', '2:DEBRIEF:15',
    '3:VOTE:60', '3:DEBRIEF:15',
  ]);
  assert.equal(h.state.phase, 'R2_RESULTS');
  assert.equal(h.state.endsAt, null);
});

test('no early advance: everyone voting does not move the clock', () => {
  const { h, t } = r2([5, 5]);
  pairByCode(h, t[0], t[1]);
  h.nextDeadline(); // now VOTE
  assert.equal(h.state.step, 'VOTE');
  const ends = h.state.endsAt;
  teamVotesR2(h, t[0], 'TRUCE');
  teamVotesR2(h, t[1], 'TRUCE');
  assert.equal(h.runDue(), 0);
  assert.equal(h.state.step, 'VOTE');
  assert.equal(h.state.endsAt, ends);
});

test('votes: only during VOTE, first vote is final, closed at the deadline', () => {
  const { h, t } = r2([5, 5]);
  pairByCode(h, t[0], t[1]);
  const p = h.state.teams[t[0]].playerIds[0];
  assert.equal(h.as(p, 'R2_VOTE', { vote: 'TRUCE' }), 'WRONG_PHASE'); // BRIEFING
  h.nextDeadline(); // VOTE: open from the first second
  assert.equal(h.as(p, 'R2_VOTE', { vote: 'MAYBE' }), 'INVALID_PAYLOAD');
  h.ok(h.as(p, 'R2_VOTE', { vote: 'TRUCE' }));
  const v = h.state.version;
  h.ok(h.as(p, 'R2_VOTE', { vote: 'AMBUSH' })); // ignored
  assert.equal(h.state.version, v);
  assert.equal(playerPrivate(h.state, p)!.myVote.r2, 'TRUCE');
  h.now = h.state.endsAt!;
  assert.equal(h.as(h.state.teams[t[0]].playerIds[1], 'R2_VOTE', { vote: 'TRUCE' }), 'VOTE_CLOSED');
});

test('unpaired team members cannot vote', () => {
  const { h, t } = r2([5, 5, 5]);
  pairByCode(h, t[0], t[1]);
  h.ok(h.admin('ADMIN_R2_FORCE_START'));
  h.nextDeadline();
  assert.equal(h.as(h.state.teams[t[2]].playerIds[0], 'R2_VOTE', { vote: 'TRUCE' }), 'NOT_PAIRED');
});

test('scoring: applied exactly once per clash at the end of VOTE; score = R1 + R2', () => {
  const { h, t } = r2([5, 5]);
  addPoints(h, t[0], 40);
  pairByCode(h, t[0], t[1]);
  h.nextDeadline();
  teamVotesR2(h, t[0], 'AMBUSH');
  teamVotesR2(h, t[1], 'TRUCE');
  assert.equal(h.state.teams[t[0]].r2Points, 0); // not yet scored
  h.nextDeadline(); // VOTE -> DEBRIEF scores the clash
  assert.equal(h.state.step, 'DEBRIEF');
  assert.equal(h.state.teams[t[0]].r2Points, 150);
  assert.equal(h.state.teams[t[1]].r2Points, 0);
  assert.equal(h.state.teams[t[0]].score, 190);
  // a duplicate system command for the old step does nothing
  const before = JSON.stringify(h.state.teams);
  h.send('SYS_ADVANCE', { kind: 'system' }, { phaseSeq: h.state.phaseSeq - 1 }, { id: 'late-dup' });
  assert.equal(JSON.stringify(h.state.teams), before);
  // full round: ambush/truce in clash 1 then mutual truce, then mutual ambush
  playRound2(h, c => (c === 3 ? 'AMBUSH' : 'TRUCE'));
  assert.equal(h.state.teams[t[0]].r2Points, 150 + 150 + 45);
  assert.equal(h.state.teams[t[1]].r2Points, 0 + 150 + 45);
});

test('moral status and nemesis are computed at the end of Round 2', () => {
  const { h, t } = r2([5, 5, 5, 5]);
  pairByCode(h, t[0], t[1]);
  pairByCode(h, t[2], t[3]);
  // t0 vs t1: t1 ambushes t0 twice -> t0 BETRAYED, t1 AGGRESSOR. t2 vs t3: all truce.
  playRound2(h, (c, tid) => (tid === t[1] && c <= 2 ? 'AMBUSH' : 'TRUCE'));
  const m = h.state.r2.moral;
  assert.equal(m[t[0]].status, 'BETRAYED');
  assert.equal(m[t[0]].nemesisTeamId, t[1]);
  assert.equal(m[t[1]].status, 'AGGRESSOR');
  assert.equal(m[t[1]].nemesisTeamId, null);
  assert.equal(m[t[2]].status, 'HONOURABLE');
  assert.equal(m[t[3]].status, 'HONOURABLE');
  assert.equal(round2MatchView(h.state, t[0])!.moral!.nemesisTeamId, t[1]);
});

test('nobody voting means TRUCE for both teams', () => {
  const { h, t } = r2([5, 5]);
  pairByCode(h, t[0], t[1]);
  playRound2(h, () => null);
  assert.equal(h.state.teams[t[0]].r2Points, 450);
  assert.equal(h.state.r2.moral[t[0]].status, 'HONOURABLE');
});

test('match view: during VOTE only counts, never anyone\'s vote; results revealed at DEBRIEF', () => {
  const { h, t } = r2([5, 5]);
  pairByCode(h, t[0], t[1]);
  h.nextDeadline();
  const [a, b, c] = h.state.teams[t[0]].playerIds;
  h.ok(h.as(a, 'R2_VOTE', { vote: 'AMBUSH' }));
  h.ok(h.as(b, 'R2_VOTE', { vote: 'AMBUSH' }));
  h.ok(h.as(h.state.teams[t[1]].playerIds[0], 'R2_VOTE', { vote: 'AMBUSH' }));
  const view = round2MatchView(h.state, t[0], c)!;
  assert.deepEqual(view.voting, { votedCount: 2, teamSize: 5, votedBy: [true, true, false, false, false] });
  assert.equal(view.history.length, 0);
  assert.ok(!JSON.stringify(view).includes('AMBUSH'));
  assert.ok(!JSON.stringify(view).includes('TRUCE'));
  assert.equal(view.rivalName, h.state.teams[t[1]].name);
  h.nextDeadline();
  const after = round2MatchView(h.state, t[0], c)!;
  assert.equal(after.voting, null);
  // only cast votes count: 2 AMBUSH vs 0 TRUCE and 1 AMBUSH vs 0 TRUCE -> both AMBUSH -> 15/15
  // the revealed votes are aligned with the member order: a and b ambushed, c and the others did not vote
  assert.deepEqual(after.history, [{ clash: 1, myStance: 'AMBUSH', rivalStance: 'AMBUSH', myPts: 15, rivalPts: 15, myVotes: 'AA---' }]);
});

test('a pause during a clash shifts the deadline and due() returns nothing', () => {
  const { h, t } = r2([5, 5]);
  pairByCode(h, t[0], t[1]);
  h.nextDeadline(); // briefing
  const ends = h.state.endsAt!;
  h.tick(10);
  h.ok(h.admin('ADMIN_PAUSE'));
  h.tick(600);
  assert.equal(h.runDue(), 0);
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.state.endsAt, ends + 600_000);
  assert.equal(h.runDue(), 0);
  h.tick(50);
  assert.equal(h.runDue(), 1);
  assert.equal(h.state.step, 'DEBRIEF');
});

test('pairing: the rival code is matched like JOIN_TEAM (variation selectors, spaces) and old shield codes still pair', () => {
  const { h, t } = r2();
  const [a, b, c, d] = t;
  const p = h.state.teams[a].playerIds[0];
  const code = h.state.teams[b].emojiCode;
  const spaced = Array.from(code).join(' ');
  h.ok(h.as(p, 'R2_PAIR', { code: spaced }), 'pair with spaces');
  assert.ok(h.state.r2.matchOfTeam[a]);
  // an old snapshot's team whose code contains the retired shield emoji
  h.state.teams[c].emojiCode = '🛡️🔥💀';
  h.state.teams[c].battleCode = '42';
  const pd = h.state.teams[d].playerIds[0];
  h.ok(h.as(pd, 'R2_PAIR', { code: '🛡🔥💀' }), 'pair with legacy shield code');
  assert.equal(h.state.r2.matchOfTeam[c], h.state.r2.matchOfTeam[d]);
});
