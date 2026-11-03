import test from 'node:test';
import assert from 'node:assert/strict';
import { addPoints, formTeams, harness, pairByCode, playRound2, setDistance, setupR3, toR2Pairing, toReveal, toVote, voteR3 } from './helpers.ts';
import {
  calculateHeadstartMeters,
  calculateRound3StartingDistance,
  calculateVoteUnanimity,
  evaluateWave,
  resolveSdStance,
  resolveSuddenDeath,
  resolveTeamVesselChoice,
  sailboatCapacity,
  sortCrossingCandidates,
} from '../../server/engine/round3.ts';
import type { WaveTeamInput } from '../../server/engine/round3.ts';
import type { Vessel } from '../../server/engine/index.ts';
import { briefingSeconds } from '../../server/content.ts';
import { phaseInfo, playerPrivate, podium, round3FleetRows, round3SailboatCapacity, round3TeamView, round3WaveReport } from '../../server/engine/index.ts';

// ---- golden values ported from tests/test_round3.ts ----------------------------------------

test('golden: head-start = min(200, floor(points / 5))', () => {
  assert.equal(calculateHeadstartMeters(0), 0);
  assert.equal(calculateHeadstartMeters(250), 50);
  assert.equal(calculateHeadstartMeters(500), 100);
  assert.equal(calculateHeadstartMeters(1000), 200);
  assert.equal(calculateHeadstartMeters(2000), 200);
  assert.equal(calculateHeadstartMeters(-40), 0);
});

test('golden: starting distance adds +75 for Honourable crews', () => {
  assert.deepEqual(calculateRound3StartingDistance(250, true), { startingMeters: 125, headstartMeters: 50, honorBonusMeters: 75 });
  assert.equal(calculateRound3StartingDistance(500, false).startingMeters, 100);
  assert.equal(calculateRound3StartingDistance(1000, true).startingMeters, 275);
});

const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];

test('golden: vessel choice by majority; ties go to the safest tied vessel; nobody voted -> Rowboat', () => {
  assert.equal(resolveTeamVesselChoice({ p1: 'ROWBOAT', p2: 'ROWBOAT', p3: 'ROWBOAT', p4: 'SAILBOAT', p5: 'SAILBOAT' }, ids), 'ROWBOAT');
  // old test expected the Negotiator (p2) to break the tie towards SAILBOAT; roles no longer matter (Q1/Q2)
  assert.equal(resolveTeamVesselChoice({ p1: 'ROWBOAT', p2: 'SAILBOAT', p3: 'ROWBOAT', p4: 'SAILBOAT' }, ids), 'ROWBOAT');
  assert.equal(resolveTeamVesselChoice({ p1: 'GHOST_SHIP', p2: 'SAILBOAT', p3: 'GHOST_SHIP', p4: 'SAILBOAT' }, ids), 'SAILBOAT');
  assert.equal(resolveTeamVesselChoice({ p1: 'GHOST_SHIP', p2: 'SAILBOAT', p3: 'ROWBOAT' }, ids), 'ROWBOAT');
  assert.equal(resolveTeamVesselChoice({ p1: 'GHOST_SHIP' }, ids), 'GHOST_SHIP');
  assert.equal(resolveTeamVesselChoice({}, ids), 'ROWBOAT');
  assert.equal(resolveTeamVesselChoice({ zz: 'GHOST_SHIP' }, ids), 'ROWBOAT'); // non-members ignored
});

test('golden: vote unanimity', () => {
  assert.equal(calculateVoteUnanimity({ p1: 'ROWBOAT', p2: 'ROWBOAT', p3: 'ROWBOAT', p4: 'ROWBOAT', p5: 'ROWBOAT' }, ids, 'ROWBOAT'), 1);
  assert.ok(Math.abs(calculateVoteUnanimity({ p1: 'ROWBOAT', p2: 'ROWBOAT', p3: 'ROWBOAT', p4: 'SAILBOAT' }, ids, 'ROWBOAT') - 0.6) < 0.001);
});

test('golden: crossing candidates 4-priority ranking', () => {
  const c = (id: string, d: number, vessel: Vessel, unanimity: number, priorScore: number) => ({ id, newTotalDistance: d, vessel, unanimity, priorScore });
  const sorted = sortCrossingCandidates([
    c('t1', 1020, 'GHOST_SHIP', 1.0, 200),
    c('t2', 1150, 'ROWBOAT', 0.6, 150),
    c('t3', 1100, 'ROWBOAT', 0.8, 300),
    c('t4', 1100, 'SAILBOAT', 0.8, 250),
    c('t5', 1100, 'SAILBOAT', 1.0, 400),
  ]);
  assert.deepEqual(sorted.map(x => x.id), ['t2', 't5', 't4', 't3', 't1']);
  // priority 4: prior points
  const tie = sortCrossingCandidates([c('a', 1100, 'ROWBOAT', 1, 100), c('b', 1100, 'ROWBOAT', 1, 300)]);
  assert.deepEqual(tie.map(x => x.id), ['b', 'a']);
});

test('Q4: sailboat capacity = max(1, floor(30% of active crews))', () => {
  assert.equal(sailboatCapacity(7), 2);
  assert.equal(sailboatCapacity(40), 12);
  assert.equal(sailboatCapacity(4), 1);
  assert.equal(sailboatCapacity(3), 1);
  assert.equal(sailboatCapacity(1), 1);
  assert.equal(sailboatCapacity(10), 3);
});

function inputs(spec: Record<string, [Vessel, number, string?]>): WaveTeamInput[] {
  return Object.entries(spec).map(([id, [vessel, distance, leashTarget]]) => ({
    id,
    vessel,
    unanimity: 1,
    priorScore: 0,
    distance,
    leashTarget: leashTarget ?? null,
  }));
}

test('golden: congestion — sailboat overload capsizes every boarder (0 m), rowboat +150', () => {
  const r = evaluateWave(inputs({ tA: ['SAILBOAT', 100], tB: ['SAILBOAT', 100], tC: ['SAILBOAT', 100], tD: ['ROWBOAT', 100] }), 1, 0).report;
  assert.equal(r.sailboatCapacity, 1);
  assert.equal(r.sailboatCapsized, true);
  assert.equal(r.outcomes.tA.baseMeters, 0);
  assert.equal(r.outcomes.tA.newDistance, 100);
  assert.equal(r.outcomes.tD.baseMeters, 150);
  assert.equal(r.outcomes.tD.newDistance, 250);
});

test('congestion — a sailboat within capacity gets +300', () => {
  const r = evaluateWave(inputs({ tA: ['SAILBOAT', 100], tB: ['ROWBOAT', 100], tC: ['ROWBOAT', 100], tD: ['ROWBOAT', 100] }), 1, 0).report;
  assert.equal(r.sailboatCapsized, false);
  assert.equal(r.outcomes.tA.newDistance, 400);
});

test('golden: ghost ship — solo +450, collision -50 for every boarder', () => {
  const solo = evaluateWave(inputs({ tA: ['GHOST_SHIP', 100], tB: ['SAILBOAT', 100], tC: ['ROWBOAT', 100], tD: ['ROWBOAT', 100] }), 1, 0).report;
  assert.equal(solo.ghostSoloTeamId, 'tA');
  assert.equal(solo.ghostCollided, false);
  assert.equal(solo.outcomes.tA.newDistance, 550);
  const col = evaluateWave(inputs({ tA: ['GHOST_SHIP', 100], tB: ['GHOST_SHIP', 100], tC: ['ROWBOAT', 100], tD: ['ROWBOAT', 100] }), 1, 0).report;
  assert.equal(col.ghostCollided, true);
  assert.equal(col.outcomes.tA.newDistance, 50);
  assert.equal(col.outcomes.tB.newDistance, 50);
});

test('golden: Stygian Leash — siphon, wreck drag, snap (Q6)', () => {
  const siphon = evaluateWave(inputs({ tA: ['ROWBOAT', 100, 'tB'], tB: ['GHOST_SHIP', 100], tC: ['ROWBOAT', 100], tD: ['ROWBOAT', 100] }), 1, 0);
  assert.equal(siphon.report.leashEvents[0].kind, 'ANCHOR_SIPHON');
  assert.equal(siphon.report.outcomes.tA.newDistance, 300);
  assert.equal(siphon.report.outcomes.tB.newDistance, 500);
  assert.deepEqual(siphon.leashConsumedBy, ['tA']);

  const wreck = evaluateWave(inputs({ tA: ['ROWBOAT', 100, 'tB'], tB: ['GHOST_SHIP', 100], tC: ['GHOST_SHIP', 100], tD: ['ROWBOAT', 100] }), 1, 0);
  assert.equal(wreck.report.leashEvents[0].kind, 'WRECK_DRAG');
  assert.equal(wreck.report.outcomes.tA.newDistance, 350);
  assert.equal(wreck.report.outcomes.tB.newDistance, 0); // 100 - 50 - 100 floored at 0

  const snap = evaluateWave(inputs({ tA: ['GHOST_SHIP', 100, 'tB'], tB: ['ROWBOAT', 100], tC: ['GHOST_SHIP', 100], tD: ['ROWBOAT', 100] }), 1, 0);
  assert.equal(snap.report.leashEvents[0].kind, 'LEASH_SNAPPED');
  assert.equal(snap.report.outcomes.tA.newDistance, 50); // collision only, no leash gain
  assert.equal(snap.report.outcomes.tB.newDistance, 250); // target not penalised
  assert.deepEqual(snap.leashConsumedBy, ['tA']);
});

test('leash on a target that is no longer racing fizzles and is not consumed', () => {
  const r = evaluateWave(inputs({ tA: ['ROWBOAT', 100, 'gone'], tB: ['ROWBOAT', 100] }), 1, 0);
  assert.equal(r.report.leashEvents.length, 0);
  assert.deepEqual(r.leashConsumedBy, []);
});

test('golden: podium allocation on crossing 1000 m', () => {
  const r = evaluateWave(inputs({ tA: ['GHOST_SHIP', 800], tB: ['ROWBOAT', 900], tC: ['ROWBOAT', 850], tD: ['ROWBOAT', 100] }), 3, 0);
  assert.equal(r.report.outcomes.tA.escapeRank, 1); // 1250
  assert.equal(r.report.outcomes.tB.escapeRank, 2); // 1050
  assert.equal(r.report.outcomes.tC.escapeRank, 3); // 1000
  assert.equal(r.report.outcomes.tD.escapeRank, null);
  assert.deepEqual(r.escapedInOrder, ['tA', 'tB', 'tC']);
  const later = evaluateWave(inputs({ tB: ['ROWBOAT', 900] }), 4, 2);
  assert.equal(later.report.outcomes.tB.escapeRank, 3);
});

test('golden: sudden death maneuvers', () => {
  assert.equal(resolveSuddenDeath('SHIELDS', 'RAM').winner, 'team_a');
  assert.equal(resolveSuddenDeath('RAM', 'SAILS').winner, 'team_a');
  assert.equal(resolveSuddenDeath('SAILS', 'SHIELDS').winner, 'team_a');
  assert.equal(resolveSuddenDeath('RAM', 'SHIELDS').winner, 'team_b');
  assert.equal(resolveSuddenDeath('SHIELDS', 'SHIELDS').winner, 'tie');
});

test('sudden death team stance: majority; tie/nobody -> Shields, Ram, Sails order; no role tie-break', () => {
  assert.equal(resolveSdStance({ p1: 'RAM', p2: 'RAM', p3: 'SAILS' }, ids), 'RAM');
  assert.equal(resolveSdStance({ p1: 'SAILS', p2: 'RAM' }, ids), 'RAM');
  assert.equal(resolveSdStance({}, ids), 'SHIELDS');
});

// ---- engine behaviour -----------------------------------------------------------------------

test('round 3 start: head-start from R1+R2 points, +75 Honourable, leash for the Betrayed', () => {
  const { h, t } = setupR3(31, [5, 5, 5, 5], (c, tid, i) => (i === 1 && c <= 2 ? 'AMBUSH' : 'TRUCE'));
  // t0/t1: t1 ambushes twice. R2: t0 = 0+0+225 = 225, t1 = 150+300+225 = 675. t2/t3 all truce = 450 each.
  assert.equal(h.state.phase, 'R3_ACTIVE');
  assert.equal(h.state.step, 'BLUFF');
  assert.equal(h.state.wave, 1);
  const r = h.state.r3!.teams;
  assert.equal(r[t[0]].distance, 45); // floor(225/5)
  assert.equal(r[t[1]].distance, 135); // floor(675/5)
  assert.equal(r[t[2]].distance, 90 + 75); // floor(450/5) + Winds of Olympus
  assert.equal(r[t[3]].distance, 165);
  assert.equal(r[t[0]].leashHolder, true);
  assert.equal(r[t[0]].nemesis, t[1]);
  assert.equal(r[t[1]].leashHolder, false);
  assert.equal(r[t[2]].leashHolder, false);
  assert.equal(r[t[2]].honourBonus, true);
});

test('start distance caps the head-start at 200 m', () => {
  const h = harness(33);
  const t = formTeams(h, [5, 5]);
  toR2Pairing(h);
  pairByCode(h, t[0], t[1]);
  playRound2(h, () => 'TRUCE');
  addPoints(h, t[0], 5000);
  h.ok(h.admin('ADMIN_START_R3'));
  assert.equal(h.state.r3!.teams[t[0]].distance, 200 + 75);
  assert.equal(h.state.r3!.teams[t[0]].startDistance, 275);
});

test('wave timeline: BLUFF 55, VOTE 20, REVEAL 25; wave resolves at the start of REVEAL', () => {
  const { h, t } = setupR3(34, [5, 5], () => 'TRUCE');
  const seen: string[] = [];
  let at = h.now;
  for (let i = 0; i < 3; i++) {
    seen.push(`${h.state.wave}:${h.state.step}:${(h.state.endsAt! - at) / 1000}`);
    at = h.state.endsAt!;
    h.nextDeadline();
    if (h.state.step === 'REVEAL') assert.equal(h.state.r3!.reports.length, 1); // resolved on entry
  }
  assert.deepEqual(seen, ['1:BLUFF:55', '1:VOTE:20', '1:REVEAL:25']);
  assert.ok(t.length === 2);
});

test('votes: only during VOTE, first vote final, escaped crews cannot vote', () => {
  const { h, t } = setupR3(35, [5, 5, 5, 5], () => 'TRUCE');
  const p = h.state.teams[t[0]].playerIds[0];
  assert.equal(h.as(p, 'R3_VOTE', { vessel: 'ROWBOAT' }), 'WRONG_PHASE');
  toVote(h);
  assert.equal(h.as(p, 'R3_VOTE', { vessel: 'CANOE' }), 'INVALID_PAYLOAD');
  h.ok(h.as(p, 'R3_VOTE', { vessel: 'GHOST_SHIP' }));
  const v = h.state.version;
  h.ok(h.as(p, 'R3_VOTE', { vessel: 'ROWBOAT' }));
  assert.equal(h.state.version, v);
  assert.equal(playerPrivate(h.state, p)!.myVote.r3, 'GHOST_SHIP');
  assert.deepEqual(round3TeamView(h.state, t[0])!.voting, { votedCount: 1, teamSize: 5 });
  h.now = h.state.endsAt!;
  assert.equal(h.as(h.state.teams[t[0]].playerIds[1], 'R3_VOTE', { vessel: 'ROWBOAT' }), 'VOTE_CLOSED');
});

test('wave resolution: team choice by majority, tie -> safest, nobody -> rowboat; distances update', () => {
  const { h, t } = setupR3(36, [5, 5, 5, 5], () => 'TRUCE');
  const start = Object.fromEntries(t.map(id => [id, h.state.r3!.teams[id].distance]));
  toVote(h);
  const [a, b, c, d] = t;
  // a: 3 sailboat vs 2 ghost -> sailboat. b: 2 ghost + 2 rowboat (tie) -> rowboat. c: nobody. d: 5 ghost.
  const pa = h.state.teams[a].playerIds;
  pa.slice(0, 3).forEach(p => h.ok(h.as(p, 'R3_VOTE', { vessel: 'SAILBOAT' })));
  pa.slice(3).forEach(p => h.ok(h.as(p, 'R3_VOTE', { vessel: 'GHOST_SHIP' })));
  const pb = h.state.teams[b].playerIds;
  pb.slice(0, 2).forEach(p => h.ok(h.as(p, 'R3_VOTE', { vessel: 'GHOST_SHIP' })));
  pb.slice(2, 4).forEach(p => h.ok(h.as(p, 'R3_VOTE', { vessel: 'ROWBOAT' })));
  voteR3(h, d, 'GHOST_SHIP');
  toReveal(h);
  const out = h.state.r3!.reports[0].outcomes;
  assert.equal(out[a].vessel, 'SAILBOAT');
  assert.equal(out[b].vessel, 'ROWBOAT');
  assert.equal(out[c].vessel, 'ROWBOAT');
  assert.equal(out[d].vessel, 'GHOST_SHIP');
  assert.equal(h.state.r3!.reports[0].sailboatCapacity, 1);
  assert.equal(h.state.r3!.teams[a].distance, start[a] + 300);
  assert.equal(h.state.r3!.teams[b].distance, start[b] + 150);
  assert.equal(h.state.r3!.teams[d].distance, start[d] + 450);
  assert.equal(out[a].unanimity, 0.6);
});

test('vessel choices are hidden until REVEAL (fleet rows) and the sailboat capacity selector works', () => {
  const { h, t } = setupR3(37, [5, 5, 5, 5, 5, 5, 5], () => 'TRUCE');
  assert.equal(round3SailboatCapacity(h.state), 2); // 7 crews
  toVote(h);
  voteR3(h, t[0], 'GHOST_SHIP');
  assert.ok(round3FleetRows(h.state).every(r => r.vessel === null));
  assert.ok(!JSON.stringify(round3FleetRows(h.state)).includes('GHOST'));
  toReveal(h);
  const rows = round3FleetRows(h.state);
  assert.equal(rows.find(r => r.teamId === t[0])!.vessel, 'GHOST_SHIP');
  assert.equal(rows.find(r => r.teamId === t[1])!.vessel, 'ROWBOAT');
  h.nextDeadline(); // next wave BLUFF: previous choices no longer shown
  assert.ok(round3FleetRows(h.state).every(r => r.vessel === null));
});

function betrayedGame(seed: number) {
  // t0 betrayed by t1 (nemesis t1); t2/t3 honourable
  return setupR3(seed, [5, 5, 5, 5], (c, _tid, i) => (i === 1 && c <= 2 ? 'AMBUSH' : 'TRUCE'));
}

test('leash: only the Betrayed holder can arm it, only during VOTE, target must be the nemesis', () => {
  const { h, t } = betrayedGame(41);
  const holder = h.state.teams[t[0]].playerIds[0];
  const other = h.state.teams[t[2]].playerIds[0];
  assert.equal(h.as(holder, 'R3_ARM_LEASH', {}), 'WRONG_PHASE'); // BLUFF
  toVote(h);
  assert.equal(h.as(other, 'R3_ARM_LEASH', {}), 'NO_LEASH');
  assert.equal(h.as(h.state.teams[t[1]].playerIds[0], 'R3_ARM_LEASH', {}), 'NO_LEASH'); // the aggressor
  assert.equal(h.as(holder, 'R3_ARM_LEASH', { targetTeamId: t[3] }), 'INVALID_TARGET');
  h.ok(h.as(holder, 'R3_ARM_LEASH', { targetTeamId: t[1] }));
  const v = h.state.version;
  h.ok(h.as(h.state.teams[t[0]].playerIds[1], 'R3_ARM_LEASH', {}));
  assert.equal(h.state.version, v);
  assert.equal(round3TeamView(h.state, t[0])!.leash.armed, true);
  assert.equal(round3TeamView(h.state, t[2])!.leash.armed, false);
});

test('leash: siphon applies at REVEAL, is used up, and cannot be armed again', () => {
  const { h, t } = betrayedGame(42);
  toVote(h);
  const d0 = h.state.r3!.teams[t[0]].distance;
  const d1 = h.state.r3!.teams[t[1]].distance;
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R3_VOTE', { vessel: 'ROWBOAT', leashTarget: t[1] })); // arm via vote
  voteR3(h, t[1], 'ROWBOAT');
  toReveal(h);
  assert.equal(h.state.r3!.teams[t[0]].distance, d0 + 150 + 50);
  assert.equal(h.state.r3!.teams[t[1]].distance, d1 + 150 - 50);
  assert.equal(h.state.r3!.teams[t[0]].leashUsed, true);
  assert.equal(h.state.r3!.reports[0].leashEvents[0].kind, 'ANCHOR_SIPHON');
  h.nextDeadline();
  toVote(h);
  assert.equal(h.as(h.state.teams[t[0]].playerIds[0], 'R3_ARM_LEASH', {}), 'NO_LEASH');
});

test('leash: wreck drag when the nemesis capsizes; snap when the holder crashes', () => {
  const { h, t } = betrayedGame(43);
  toVote(h);
  const d0 = h.state.r3!.teams[t[0]].distance;
  const d1 = h.state.r3!.teams[t[1]].distance;
  const d2 = h.state.r3!.teams[t[2]].distance;
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R3_ARM_LEASH', {}));
  voteR3(h, t[0], 'ROWBOAT');
  voteR3(h, t[1], 'SAILBOAT');
  voteR3(h, t[2], 'SAILBOAT'); // 4 crews -> capacity 1 -> both capsize
  toReveal(h);
  assert.equal(h.state.r3!.reports[0].sailboatCapsized, true);
  assert.equal(h.state.r3!.reports[0].leashEvents[0].kind, 'WRECK_DRAG');
  assert.equal(h.state.r3!.teams[t[0]].distance, d0 + 150 + 100);
  assert.equal(h.state.r3!.teams[t[1]].distance, d1 + 0 - 100);
  assert.equal(h.state.r3!.teams[t[2]].distance, d2);

  const g = betrayedGame(44);
  toVote(g.h);
  const e0 = g.h.state.r3!.teams[g.t[0]].distance;
  const e1 = g.h.state.r3!.teams[g.t[1]].distance;
  g.h.ok(g.h.as(g.h.state.teams[g.t[0]].playerIds[0], 'R3_ARM_LEASH', {}));
  voteR3(g.h, g.t[0], 'GHOST_SHIP');
  voteR3(g.h, g.t[2], 'GHOST_SHIP'); // collision
  toReveal(g.h);
  assert.equal(g.h.state.r3!.reports[0].leashEvents[0].kind, 'LEASH_SNAPPED');
  assert.equal(g.h.state.r3!.teams[g.t[0]].distance, Math.max(0, e0 - 50));
  assert.equal(g.h.state.r3!.teams[g.t[1]].distance, e1 + 150);
  assert.equal(g.h.state.r3!.teams[g.t[0]].leashUsed, true);
});

test('leash target hidden: the armed leash is not in events or in other teams\' views', () => {
  const { h, t } = betrayedGame(45);
  toVote(h);
  const nem = t[1];
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R3_ARM_LEASH', {}));
  assert.ok(!JSON.stringify(h.events).includes(nem));
  assert.ok(!JSON.stringify(round3TeamView(h.state, t[2])).includes(nem));
  assert.ok(!JSON.stringify(round3TeamView(h.state, t[1])).includes('"armed":true'));
});

function nearPortal(seed: number, n: number) {
  const g = setupR3(seed, Array(n).fill(5), () => 'TRUCE');
  return g;
}

test('escape: crews at >= 1000 m stop playing; waves continue until 3 have escaped (Q9)', () => {
  const { h, t } = nearPortal(51, 6);
  // put four crews 20 m from the portal; a rowboat (+150) carries them over
  for (const id of t.slice(0, 4)) setDistance(h, id, 980);
  toVote(h);
  toReveal(h);
  assert.equal(h.state.r3!.escapeOrder.length, 4); // all four cross in wave 1
  h.nextDeadline();
  assert.equal(h.state.phase, 'R3_RESULTS');
  const pod = podium(h.state);
  assert.equal(pod.gold, h.state.r3!.escapeOrder[0]);
  assert.equal(pod.bronze, h.state.r3!.escapeOrder[2]);
  assert.equal(h.state.r3!.teams[h.state.r3!.escapeOrder[3]].escapeRank, 4); // escaped without a medal
});

test('waves keep going when fewer than 3 have escaped; escaped crews no longer vote or race', () => {
  const { h, t } = nearPortal(52, 5);
  setDistance(h, t[0], 980);
  toReveal(h);
  assert.deepEqual(h.state.r3!.escapeOrder, [t[0]]);
  h.nextDeadline();
  assert.equal(h.state.phase, 'R3_ACTIVE');
  assert.equal(h.state.wave, 2);
  assert.equal(h.state.step, 'BLUFF');
  toVote(h);
  assert.equal(h.as(h.state.teams[t[0]].playerIds[0], 'R3_VOTE', { vessel: 'ROWBOAT' }), 'ALREADY_ESCAPED');
  const dist0 = h.state.r3!.teams[t[0]].distance;
  toReveal(h);
  assert.equal(h.state.r3!.teams[t[0]].distance, dist0);
  assert.equal(h.state.r3!.reports[1].activeCrews, 4);
  assert.equal(h.state.r3!.reports[1].sailboatCapacity, 1); // floor(0.3 * 4) = 1
  assert.equal(round3SailboatCapacity(h.state), 1);
});

test('round ends when every active crew has escaped (fewer than 3 crews)', () => {
  const { h, t } = nearPortal(53, 2);
  for (const id of t) setDistance(h, id, 980);
  toReveal(h);
  h.nextDeadline();
  assert.equal(h.state.phase, 'R3_RESULTS');
});

test('same-wave crossers are ranked by overshoot, boldness, unanimity, then prior points', () => {
  const { h, t } = nearPortal(54, 4);
  // all at 900: a ghost (alone, 1350) beats two rowboats (1050); equal rowboats -> unanimity -> prior points
  for (const id of t) setDistance(h, id, 900);
  addPoints(h, t[1], 500);
  toVote(h);
  voteR3(h, t[3], 'GHOST_SHIP');
  const p2 = h.state.teams[t[2]].playerIds;
  p2.slice(0, 4).forEach(p => h.ok(h.as(p, 'R3_VOTE', { vessel: 'ROWBOAT' }))); // 4/5 unanimity (one abstains)
  voteR3(h, t[0], 'ROWBOAT'); // 5/5
  voteR3(h, t[1], 'ROWBOAT'); // 5/5, more prior points than t0
  toReveal(h);
  assert.deepEqual(h.state.r3!.escapeOrder, [t[3], t[1], t[0], t[2]]);
});

test('admin: end round 3 manually', () => {
  const { h, t } = nearPortal(55, 3);
  setDistance(h, t[0], 0);
  assert.equal(h.state.r3!.teams[t[0]].distance, 0);
  h.ok(h.admin('ADMIN_END_R3'));
  assert.equal(h.state.phase, 'R3_RESULTS');
  assert.equal(h.admin('ADMIN_END_R3'), 'WRONG_PHASE');
  h.ok(h.admin('ADMIN_FINISH'));
  assert.equal(h.state.phase, 'FINISHED');
  assert.equal(h.state.endsAt, null);
});

function sdGame(seed: number) {
  const g = nearPortal(seed, 5);
  const { h, t } = g;
  for (const id of t.slice(0, 3)) setDistance(h, id, 980);
  toReveal(h);
  return g;
}

test('sudden death: admin only, between two escaped crews, 40 s, decides podium order', () => {
  const { h, t } = sdGame(61);
  const order = [...h.state.r3!.escapeOrder];
  assert.equal(order.length, 3);
  const [first, , third] = order;
  assert.equal(h.admin('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: first, teamB: first }), 'SAME_TEAM');
  assert.equal(h.admin('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: first, teamB: t[4] }), 'INVALID_TARGET'); // not escaped
  assert.equal(h.as(h.state.teams[first].playerIds[0], 'SD_VOTE', { action: 'RAM' }), 'NO_STANDOFF');
  const remaining = h.state.endsAt! - h.now;
  h.ok(h.admin('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: first, teamB: third }));
  assert.equal(h.state.step, 'SUDDEN_DEATH');
  assert.equal(h.state.endsAt, h.now + 40_000);
  // third plays Ram against first's Sails and wins
  for (const p of h.state.teams[first].playerIds) h.ok(h.as(p, 'SD_VOTE', { action: 'SAILS' }));
  for (const p of h.state.teams[third].playerIds) h.ok(h.as(p, 'SD_VOTE', { action: 'RAM' }));
  assert.equal(h.as(h.state.teams[t[4]].playerIds[0], 'SD_VOTE', { action: 'RAM' }), 'NOT_IN_DUEL');
  h.nextDeadline();
  assert.equal(h.state.step, 'REVEAL'); // returned to where it was
  assert.ok(h.state.endsAt! - h.now >= Math.min(remaining, 5000));
  assert.equal(h.state.r3!.sd!.winnerTeamId, third);
  assert.equal(h.state.r3!.escapeOrder[0], third);
  assert.equal(h.state.r3!.escapeOrder[2], first);
  assert.equal(podium(h.state).gold, third);
  assert.equal(h.state.r3!.teams[third].escapeRank, 1);
});

test('sudden death: identical maneuvers -> higher R1+R2 points wins', () => {
  const { h } = sdGame(62);
  const [a, , c] = h.state.r3!.escapeOrder;
  addPoints(h, c, 10_000);
  h.ok(h.admin('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: a, teamB: c }));
  h.nextDeadline(); // nobody voted: both SHIELDS -> deadlock
  assert.equal(h.state.r3!.sd!.winnerTeamId, c);
  assert.equal(h.state.r3!.escapeOrder[0], c);
});

test('sudden death: may also be run from the results screen; pause shifts it', () => {
  const { h } = sdGame(63);
  h.nextDeadline(); // -> R3_RESULTS (3 escaped)
  assert.equal(h.state.phase, 'R3_RESULTS');
  const [a, b] = h.state.r3!.escapeOrder;
  h.ok(h.admin('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: a, teamB: b }));
  assert.equal(h.state.phase, 'R3_RESULTS');
  assert.equal(h.state.step, 'SUDDEN_DEATH');
  h.ok(h.admin('ADMIN_PAUSE'));
  const ends = h.state.endsAt!;
  h.tick(300);
  h.ok(h.admin('ADMIN_RESUME'));
  assert.equal(h.state.endsAt, ends + 300_000);
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  assert.equal(h.state.step, null);
  assert.equal(h.state.phase, 'R3_RESULTS');
  assert.equal(phaseInfo(h.state, h.now).remainingMs, null);
});

// ---- briefing step and extra view data ------------------------------------------------------

test('briefing: Round 3 opens with a server-timed BRIEFING; wave 1 BLUFF starts when it ends', () => {
  const h = harness(35);
  const t = formTeams(h, [5, 5]);
  toR2Pairing(h);
  pairByCode(h, t[0], t[1]);
  playRound2(h, () => 'TRUCE');
  h.ok(h.admin('ADMIN_START_R3'));
  assert.equal(h.state.phase, 'R3_ACTIVE');
  assert.equal(h.state.step, 'BRIEFING');
  assert.equal(h.state.wave, 1);
  assert.equal(h.state.endsAt, h.now + briefingSeconds(3) * 1000);
  // no votes and no leash while the story plays
  const p = h.state.teams[t[0]].playerIds[0];
  assert.equal(h.as(p, 'R3_VOTE', { vessel: 'ROWBOAT' }), 'WRONG_PHASE');
  assert.equal(h.as(p, 'R3_ARM_LEASH', {}), 'WRONG_PHASE');
  const end = h.state.endsAt!;
  h.nextDeadline();
  assert.equal(h.state.step, 'BLUFF');
  assert.equal(h.state.wave, 1);
  assert.equal(h.state.endsAt, end + 55_000, 'the wave timers start when the briefing ends');
});

test('briefing: admin skip step skips the Round 3 briefing', () => {
  const h = harness(36);
  const t = formTeams(h, [5, 5]);
  toR2Pairing(h);
  pairByCode(h, t[0], t[1]);
  playRound2(h, () => 'TRUCE');
  h.ok(h.admin('ADMIN_START_R3'));
  h.tick(1);
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  assert.equal(h.state.step, 'BLUFF');
  assert.equal(h.state.endsAt, h.now + 55_000);
});

test('briefing: the briefing durations follow the story and rules', () => {
  // ceil(sentences * 2.8 + 3 + (rules + 1) * 2 + 3): R1 5/2, R2 4/3, R3 5/3
  assert.deepEqual([1, 2, 3].map(r => briefingSeconds(r as 1 | 2 | 3)), [26, 26, 28]);
});

test('view data: honourable flag, all-crews vessel report and every leash event of my crew', () => {
  const { h, t } = setupR3(31, [5, 5, 5, 5], (c, _tid, i) => (i === 1 && c <= 2 ? 'AMBUSH' : 'TRUCE'));
  assert.equal(round3TeamView(h.state, t[2])!.honourable, true);
  assert.equal(round3TeamView(h.state, t[0])!.honourable, false);
  toVote(h);
  voteR3(h, t[0], 'ROWBOAT');
  voteR3(h, t[1], 'SAILBOAT');
  voteR3(h, t[2], 'SAILBOAT');
  voteR3(h, t[3], 'GHOST_SHIP');
  toReveal(h);
  const rep = round3WaveReport(h.state, 1)!;
  // 4 crews: sailboat capacity 1, two boarded -> capsized; one solo ghost ship
  assert.deepEqual(rep.vessels, [
    ['R', 1, 'SAFE', 150],
    ['S', 2, 'CAPSIZED', 0],
    ['G', 1, 'SAFE', 450],
  ]);
});

test('view data: empty vessels read UNBOARDED and a ghost collision reads COLLIDED', () => {
  const { h, t } = setupR3(37, [5, 5, 5, 5], () => 'TRUCE');
  toVote(h);
  voteR3(h, t[0], 'GHOST_SHIP');
  voteR3(h, t[1], 'GHOST_SHIP');
  voteR3(h, t[2], 'GHOST_SHIP');
  voteR3(h, t[3], 'GHOST_SHIP');
  toReveal(h);
  assert.deepEqual(round3WaveReport(h.state, 1)!.vessels, [
    ['R', 0, 'UNBOARDED', 0],
    ['S', 0, 'UNBOARDED', 0],
    ['G', 4, 'COLLIDED', -50],
  ]);
});
