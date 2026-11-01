// Round 2: Shades in the Mist. Scoring matrix, stance and nemesis logic ported from
// src/lib/round2Engine.ts and src/lib/round3Engine.ts (evaluateTeamRound2MoralStatus), adjusted by
// RULE_DECISIONS: no role tie-break (tie -> TRUCE), Q7 moral statuses, global timeline,
// pairing by typing the rival's 2-digit code (Q13).
import { R2_CLASHES, R2_SCORING } from './config.ts';
import type { Round2ScoringTier } from './config.ts';
import { asObj, recomputeScore, reqString } from './common.ts';
import { rngShuffle } from './rng.ts';
import { nextId } from './ids.ts';
import { setStep } from './clock.ts';
import type { Clash, GameEvent, GameState, Handler, Match, Moral, Stance } from './types.ts';
import { NOOP, fail } from './types.ts';

// ---- ported pure functions --------------------------------------------------

/**
 * Majority of TRUCE vs AMBUSH among votes cast by current members. Tie (including nobody
 * voting) -> TRUCE. Roles have no effect (RULE_DECISIONS Q1/Q2).
 */
export function calculateTeamStance(votes: Record<string, Stance>, memberIds: string[]): Stance {
  let truce = 0;
  let ambush = 0;
  for (const pid of memberIds) {
    const v = votes[pid];
    if (v === 'TRUCE') truce++;
    else if (v === 'AMBUSH') ambush++;
  }
  return ambush > truce ? 'AMBUSH' : 'TRUCE';
}

export function calculateClashPoints(
  stanceA: Stance,
  stanceB: Stance,
  clashNum: number,
  matrix: Record<string, Round2ScoringTier> = R2_SCORING,
): { team_a_pts: number; team_b_pts: number } {
  const tier = matrix[String(clashNum)] || R2_SCORING[String(clashNum)] || R2_SCORING['1'];
  if (stanceA === 'TRUCE' && stanceB === 'TRUCE') return { team_a_pts: tier.both_truce, team_b_pts: tier.both_truce };
  if (stanceA === 'AMBUSH' && stanceB === 'TRUCE') return { team_a_pts: tier.ambush_win, team_b_pts: tier.truce_loss };
  if (stanceA === 'TRUCE' && stanceB === 'AMBUSH') return { team_a_pts: tier.truce_loss, team_b_pts: tier.ambush_win };
  return { team_a_pts: tier.both_ambush, team_b_pts: tier.both_ambush };
}

/** Moral status per RULE_DECISIONS Q7 (doc wording). */
export function computeMoral(clashes: Clash[], side: 'A' | 'B', rivalTeamId: string): Moral {
  let mutualTruce = 0;
  let myAmbush = 0;
  let rivalAmbush = 0;
  let mutualAmbush = 0;
  let resolved = 0;
  for (const c of clashes) {
    if (!c.resolved || !c.stanceA || !c.stanceB) continue;
    resolved++;
    const mine = side === 'A' ? c.stanceA : c.stanceB;
    const theirs = side === 'A' ? c.stanceB : c.stanceA;
    if (mine === 'TRUCE' && theirs === 'TRUCE') mutualTruce++;
    else if (mine === 'AMBUSH' && theirs === 'TRUCE') myAmbush++;
    else if (mine === 'TRUCE' && theirs === 'AMBUSH') rivalAmbush++;
    else mutualAmbush++;
  }
  let status: Moral['status'];
  if (resolved === 0) status = 'NONE';
  else if (mutualTruce === R2_CLASHES) status = 'HONOURABLE';
  else if (rivalAmbush > myAmbush) status = 'BETRAYED';
  else if (myAmbush > rivalAmbush) status = 'AGGRESSOR';
  else status = 'BLOOD_FEUD';
  return {
    status,
    rivalTeamId,
    nemesisTeamId: status === 'BETRAYED' ? rivalTeamId : null,
    mutualTruce,
    myAmbush,
    rivalAmbush,
    mutualAmbush,
  };
}

// ---- pairing ----------------------------------------------------------------

export function newClash(n: number): Clash {
  return { clash: n, votesA: {}, votesB: {}, resolved: false, stanceA: null, stanceB: null, ptsA: 0, ptsB: 0 };
}

export function pairTeams(d: GameState, a: string, b: string): void {
  const id = nextId(d, 'm');
  const m: Match = { id, teamA: a, teamB: b, clashes: [], cancelled: false };
  d.r2.matches[id] = m;
  d.r2.matchOfTeam[a] = id;
  d.r2.matchOfTeam[b] = id;
}

export function unpairTeam(d: GameState, teamId: string): boolean {
  const mid = d.r2.matchOfTeam[teamId];
  if (!mid) return false;
  const m = d.r2.matches[mid];
  delete d.r2.matches[mid];
  if (m) {
    delete d.r2.matchOfTeam[m.teamA];
    delete d.r2.matchOfTeam[m.teamB];
  }
  return true;
}

export function allTeamsPaired(d: GameState): boolean {
  return d.teamOrder.length > 0 && d.teamOrder.every(tid => d.r2.matchOfTeam[tid] != null);
}

export function initRound2Pairing(d: GameState): void {
  d.r2 = { matches: {}, matchOfTeam: {}, moral: {} };
}

/** Start clash 1 for every pairing. */
export function startClashes(d: GameState, now: number, ev: GameEvent[]): void {
  for (const m of Object.values(d.r2.matches)) {
    m.clashes = [newClash(1)];
  }
  setStep(d, now, 'R2_CLASH', 'HUDDLE', { durationMs: d.config.r2.HUDDLE * 1000, clash: 1 }, ev);
}

export function beginNextClash(d: GameState, n: number): void {
  for (const m of Object.values(d.r2.matches)) {
    if (!m.cancelled) m.clashes.push(newClash(n));
  }
}

function maybeAutoStart(d: GameState, now: number, ev: GameEvent[]): void {
  if (d.phase === 'R2_PAIRING' && allTeamsPaired(d)) startClashes(d, now, ev);
}

export function adminPairAndMaybeStart(d: GameState, a: string, b: string, now: number, ev: GameEvent[]) {
  if (d.phase !== 'R2_PAIRING') return fail('WRONG_PHASE');
  if (a === b) return fail('SAME_TEAM');
  if (!d.teams[a] || !d.teams[b]) return fail('UNKNOWN_TEAM');
  const ma = d.r2.matchOfTeam[a];
  if (ma && ma === d.r2.matchOfTeam[b]) return NOOP;
  // Admin pairing replaces any existing pairing of either team.
  unpairTeam(d, a);
  unpairTeam(d, b);
  pairTeams(d, a, b);
  ev.push({ type: 'R2_PAIRED', teamA: a, teamB: b, by: 'admin' });
  maybeAutoStart(d, now, ev);
  return undefined;
}

export function adminAutoPair(d: GameState, now: number, ev: GameEvent[]) {
  if (d.phase !== 'R2_PAIRING') return fail('WRONG_PHASE');
  const free = rngShuffle(d, d.teamOrder.filter(t => !d.r2.matchOfTeam[t]));
  let pairs = 0;
  for (let i = 0; i + 1 < free.length; i += 2) {
    pairTeams(d, free[i], free[i + 1]);
    ev.push({ type: 'R2_PAIRED', teamA: free[i], teamB: free[i + 1], by: 'admin' });
    pairs++;
  }
  if (pairs === 0) return NOOP;
  maybeAutoStart(d, now, ev);
  return undefined;
}

const pair: Handler = (d, c, now, ev) => {
  if (d.phase !== 'R2_PAIRING') return fail('WRONG_PHASE');
  if (d.pausedAt != null) return fail('PAUSED');
  const p = d.players[(c.actor as { playerId: string }).playerId];
  if (!p.teamId) return fail('NOT_IN_TEAM');
  const code = reqString(asObj(c.payload), 'code', 8)?.trim();
  if (!code || !/^\d{2}$/.test(code)) return fail('INVALID_CODE');
  const mine = d.teams[p.teamId];
  if (mine.battleCode === code) return fail('OWN_CODE');
  const rival = d.teamOrder.map(id => d.teams[id]).find(t => t.battleCode === code);
  if (!rival) return fail('UNKNOWN_CODE');
  const mm = d.r2.matchOfTeam[mine.id];
  const rm = d.r2.matchOfTeam[rival.id];
  if (mm && mm === rm) return NOOP;
  if (mm || rm) return fail('ALREADY_PAIRED');
  pairTeams(d, mine.id, rival.id);
  ev.push({ type: 'R2_PAIRED', teamA: mine.id, teamB: rival.id, by: 'player' });
  maybeAutoStart(d, now, ev);
  return undefined;
};

const vote: Handler = (d, c, now) => {
  if (d.phase !== 'R2_CLASH' || d.step !== 'VOTE') return fail('WRONG_PHASE');
  if (d.pausedAt != null) return fail('PAUSED');
  if (d.endsAt != null && now >= d.endsAt) return fail('VOTE_CLOSED');
  const pid = (c.actor as { playerId: string }).playerId;
  const p = d.players[pid];
  if (!p.teamId) return fail('NOT_IN_TEAM');
  const v = asObj(c.payload)?.vote;
  if (v !== 'TRUCE' && v !== 'AMBUSH') return fail('INVALID_PAYLOAD');
  const mid = d.r2.matchOfTeam[p.teamId];
  const m = mid ? d.r2.matches[mid] : undefined;
  if (!m || m.cancelled) return fail('NOT_PAIRED');
  const clash = m.clashes[d.clash - 1];
  if (!clash || clash.resolved) return fail('VOTE_CLOSED');
  const bucket = m.teamA === p.teamId ? clash.votesA : clash.votesB;
  if (bucket[pid] !== undefined) return NOOP; // first vote is final
  bucket[pid] = v;
  return undefined;
};

// ---- resolution -------------------------------------------------------------

/** End of VOTE: resolve and score the current clash for every match, exactly once. */
export function resolveClash(d: GameState, ev: GameEvent[]): void {
  for (const m of Object.values(d.r2.matches)) {
    if (m.cancelled) continue;
    const clash = m.clashes[d.clash - 1];
    if (!clash || clash.resolved) continue;
    const ta = d.teams[m.teamA];
    const tb = d.teams[m.teamB];
    if (!ta || !tb) continue;
    clash.stanceA = calculateTeamStance(clash.votesA, ta.playerIds);
    clash.stanceB = calculateTeamStance(clash.votesB, tb.playerIds);
    const pts = calculateClashPoints(clash.stanceA, clash.stanceB, clash.clash);
    clash.ptsA = pts.team_a_pts;
    clash.ptsB = pts.team_b_pts;
    clash.resolved = true;
    ta.r2Points += clash.ptsA;
    tb.r2Points += clash.ptsB;
    recomputeScore(ta);
    recomputeScore(tb);
    ev.push({ type: 'R2_CLASH_RESOLVED', matchId: m.id, clash: clash.clash });
  }
}

export function computeAllMoral(d: GameState): void {
  d.r2.moral = {};
  for (const m of Object.values(d.r2.matches)) {
    if (d.teams[m.teamA]) d.r2.moral[m.teamA] = computeMoral(m.clashes, 'A', m.teamB);
    if (d.teams[m.teamB]) d.r2.moral[m.teamB] = computeMoral(m.clashes, 'B', m.teamA);
  }
}

export function lastClashNumber(): number {
  return R2_CLASHES;
}

export const round2Handlers: Record<string, Handler> = {
  R2_PAIR: pair,
  R2_VOTE: vote,
};
