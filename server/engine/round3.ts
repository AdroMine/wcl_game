// Round 3: Escape from Tartarus. Pure rules ported from src/lib/round3Engine.ts; orchestration
// (session init, vote and leash recording, wave resolution, escapes/podium, admin sudden death)
// ported from src/lib/supabaseService.ts lines 2117-2833, minus database calls and adjusted by
// RULE_DECISIONS: Q1/Q2 safest-vessel tie-break (no roles), Q4 sailboat capacity floor(30%) with
// a minimum of 1, Q5 4-priority ranking kept, Q6 Stygian Leash only, Q9 waves until 3 escaped.
import { R3, SD_ACTIONS, VESSELS_SAFEST_FIRST } from './config.ts';
import { asObj, rankEscapees } from './common.ts';
import { setStep } from './clock.ts';
import { briefingSeconds } from '../content.ts';
import { computeAllMoral } from './round2.ts';
import type {
  GameEvent,
  GameState,
  Handler,
  LeashEvent,
  R3State,
  SdAction,
  SuddenDeath,
  Vessel,
  WaveVoteLog,
  WaveOutcome,
  WaveReport,
} from './types.ts';
import { NOOP, fail } from './types.ts';

// ---- ported pure functions --------------------------------------------------

export function calculateHeadstartMeters(cumulativeScore: number): number {
  const raw = Math.floor(Math.max(0, cumulativeScore) / R3.headstartDivisor);
  return Math.min(R3.maxHeadstart, raw);
}

export function calculateRound3StartingDistance(
  cumulativeScore: number,
  honourable: boolean,
): { startingMeters: number; headstartMeters: number; honorBonusMeters: number } {
  const headstartMeters = calculateHeadstartMeters(cumulativeScore);
  const honorBonusMeters = honourable ? R3.honourBonus : 0;
  return { startingMeters: headstartMeters + honorBonusMeters, headstartMeters, honorBonusMeters };
}

/**
 * Majority of votes cast by members. Tie -> safest tied vessel (Rowboat, Sailboat, Ghost Ship).
 * Nobody voted -> Rowboat. No role tie-break (RULE_DECISIONS Q1/Q2).
 */
export function resolveTeamVesselChoice(votes: Record<string, Vessel>, memberIds: string[]): Vessel {
  const counts: Record<Vessel, number> = { ROWBOAT: 0, SAILBOAT: 0, GHOST_SHIP: 0 };
  for (const pid of memberIds) {
    const v = votes[pid];
    if (v && counts[v] !== undefined) counts[v]++;
  }
  const max = Math.max(counts.ROWBOAT, counts.SAILBOAT, counts.GHOST_SHIP);
  if (max === 0) return 'ROWBOAT';
  return VESSELS_SAFEST_FIRST.find(v => counts[v] === max) as Vessel;
}

export function calculateVoteUnanimity(votes: Record<string, Vessel>, memberIds: string[], chosen: Vessel): number {
  if (memberIds.length <= 0) return 0;
  let n = 0;
  for (const pid of memberIds) if (votes[pid] === chosen) n++;
  return n / memberIds.length;
}

export function getVesselBoldnessRank(v: Vessel): number {
  return v === 'GHOST_SHIP' ? 3 : v === 'SAILBOAT' ? 2 : 1;
}

export interface CrossingCandidate {
  id: string;
  newTotalDistance: number;
  vessel: Vessel;
  unanimity: number;
  priorScore: number;
}

/**
 * Same-wave crossers (RULE_DECISIONS Q5): 1) distance overshoot, 2) vessel boldness,
 * 3) vote unanimity, 4) prior R1+R2 points. Remaining ties keep input order (stable sort).
 */
// RULE-QUESTION: "prior R1+R2 points" is read as the team's current score (R1 + R2 + admin adjustments), and
// a complete tie on all four priorities falls back to team creation order. The rules do not cover either case.
export function sortCrossingCandidates<T extends CrossingCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (b.newTotalDistance !== a.newTotalDistance) return b.newTotalDistance - a.newTotalDistance;
    const ba = getVesselBoldnessRank(a.vessel);
    const bb = getVesselBoldnessRank(b.vessel);
    if (bb !== ba) return bb - ba;
    if (Math.abs(b.unanimity - a.unanimity) > 0.001) return b.unanimity - a.unanimity;
    return b.priorScore - a.priorScore;
  });
}

// RULE-QUESTION: RULE_DECISIONS lists "Sailboat minimum of 1" as pending confirmation; implemented as max(1, floor(0.30 x crews)).
/** Q4: max = floor(0.30 x active crews), but at least 1 (pending confirmation). */
export function sailboatCapacity(activeCrews: number): number {
  return Math.max(1, Math.floor(R3.sailboatCapacityPercent * activeCrews));
}

export interface WaveTeamInput {
  id: string;
  vessel: Vessel;
  unanimity: number;
  priorScore: number;
  distance: number;
  /** Valid, armed leash target (already checked by the caller) or null. */
  leashTarget: string | null;
}

export interface WaveEvalResult {
  report: WaveReport;
  /** Newly escaped team ids in rank order. */
  escapedInOrder: string[];
  /** Holders whose leash was consumed (applied, siphoned or snapped). */
  leashConsumedBy: string[];
}

export function evaluateWave(inputs: WaveTeamInput[], wave: number, alreadyEscaped: number): WaveEvalResult {
  const active = inputs.length;
  const capacity = sailboatCapacity(active);
  const byVessel: Record<Vessel, string[]> = { ROWBOAT: [], SAILBOAT: [], GHOST_SHIP: [] };
  for (const t of inputs) byVessel[t.vessel].push(t.id);

  const sailboatCapsized = byVessel.SAILBOAT.length > capacity;
  const ghostCollided = byVessel.GHOST_SHIP.length >= 2;
  const ghostSolo = byVessel.GHOST_SHIP.length === 1 ? byVessel.GHOST_SHIP[0] : null;
  const crashed = (v: Vessel): boolean => (v === 'SAILBOAT' ? sailboatCapsized : v === 'GHOST_SHIP' ? ghostCollided : false);

  const byId: Record<string, WaveTeamInput> = {};
  for (const t of inputs) byId[t.id] = t;

  const leashDelta: Record<string, number> = {};
  const leashEvents: LeashEvent[] = [];
  const consumed: string[] = [];
  for (const h of inputs) {
    if (!h.leashTarget) continue;
    const target = byId[h.leashTarget];
    // RULE-QUESTION: if the nemesis escaped or was removed after the leash was armed, the leash
    // fizzles and is NOT consumed (the rules only define float / crash / snap outcomes).
    if (!target) continue;
    let kind: LeashEvent['kind'];
    let holderDelta = 0;
    let targetDelta = 0;
    if (crashed(h.vessel)) {
      kind = 'LEASH_SNAPPED'; // holder's own boat crashed: 0 gained, target not penalised
    } else if (crashed(target.vessel)) {
      kind = 'WRECK_DRAG';
      holderDelta = R3.wreckBonus;
      targetDelta = -R3.wreckBonus;
    } else {
      kind = 'ANCHOR_SIPHON';
      holderDelta = R3.anchorSiphon;
      targetDelta = -R3.anchorSiphon;
    }
    leashDelta[h.id] = (leashDelta[h.id] || 0) + holderDelta;
    leashDelta[target.id] = (leashDelta[target.id] || 0) + targetDelta;
    leashEvents.push({ holder: h.id, target: target.id, kind, holderDelta, targetDelta });
    consumed.push(h.id);
  }

  const outcomes: Record<string, WaveOutcome> = {};
  const crossers: (CrossingCandidate & { id: string })[] = [];
  for (const t of inputs) {
    let base = 0;
    if (t.vessel === 'ROWBOAT') base = R3.vessel.ROWBOAT.success;
    else if (t.vessel === 'SAILBOAT') base = sailboatCapsized ? R3.vessel.SAILBOAT.fail : R3.vessel.SAILBOAT.success;
    else base = ghostSolo === t.id ? R3.vessel.GHOST_SHIP.success : R3.vessel.GHOST_SHIP.fail;
    const ld = leashDelta[t.id] || 0;
    const gained = base + ld;
    const newDistance = Math.max(0, t.distance + gained);
    const escaped = newDistance >= R3.targetDistance;
    outcomes[t.id] = {
      vessel: t.vessel,
      unanimity: t.unanimity,
      baseMeters: base,
      leashDelta: ld,
      gained,
      newDistance,
      escaped,
      escapeRank: null,
    };
    if (escaped) {
      crossers.push({ id: t.id, newTotalDistance: newDistance, vessel: t.vessel, unanimity: t.unanimity, priorScore: t.priorScore });
    }
  }
  const sorted = sortCrossingCandidates(crossers);
  sorted.forEach((c, i) => {
    outcomes[c.id].escapeRank = alreadyEscaped + i + 1;
  });

  return {
    report: {
      wave,
      activeCrews: active,
      sailboatCapacity: capacity,
      sailboatCapsized,
      ghostCollided,
      ghostSoloTeamId: ghostSolo,
      leashEvents,
      outcomes,
    },
    escapedInOrder: sorted.map(c => c.id),
    leashConsumedBy: consumed,
  };
}

/**
 * Sudden Death maneuvers: Shields beats Ram, Ram beats Sails, Sails beats Shields.
 * Identical -> tie (the caller decides by R1+R2 points).
 */
export function resolveSuddenDeath(a: SdAction, b: SdAction): { winner: 'team_a' | 'team_b' | 'tie'; description: string } {
  if (a === b) return { winner: 'tie', description: `Deadlock! Both crews maneuvered with ${a}.` };
  const aWins = (a === 'SHIELDS' && b === 'RAM') || (a === 'RAM' && b === 'SAILS') || (a === 'SAILS' && b === 'SHIELDS');
  const winning = aWins ? a : b;
  const desc =
    winning === 'SHIELDS'
      ? 'Shields deflected the Ramming hull!'
      : winning === 'RAM'
        ? 'Ramming hull smashed through Full Sails!'
        : 'Full Sails outran the guarded Shields!';
  return { winner: aWins ? 'team_a' : 'team_b', description: `${aWins ? 'Victory for Challenger A' : 'Victory for Challenger B'}! ${desc}` };
}

/**
 * Team maneuver by majority. Nobody voted -> SHIELDS; ties -> first tied in the order
 * SHIELDS, RAM, SAILS (old code's behaviour without its Negotiator tie-break).
 */
// RULE-QUESTION: old code's Sudden Death tie order (Shields, Ram, Sails) is kept; not covered by the rules doc.
export function resolveSdStance(votes: Record<string, SdAction>, memberIds: string[]): SdAction {
  const counts: Record<SdAction, number> = { SHIELDS: 0, RAM: 0, SAILS: 0 };
  for (const pid of memberIds) {
    const v = votes[pid];
    if (v && counts[v] !== undefined) counts[v]++;
  }
  const max = Math.max(counts.SHIELDS, counts.RAM, counts.SAILS);
  if (max === 0) return 'SHIELDS';
  return SD_ACTIONS.find(a => counts[a] === max) as SdAction;
}

// ---- state transitions ------------------------------------------------------

export function r3ActiveTeamIds(d: GameState): string[] {
  const r3 = d.r3;
  if (!r3) return [];
  return d.teamOrder.filter(t => r3.teams[t] && !r3.teams[t].escaped);
}

export function r3ShouldFinish(d: GameState): boolean {
  const r3 = d.r3;
  if (!r3) return true;
  const total = d.teamOrder.filter(t => r3.teams[t]).length;
  const escaped = r3.escapeOrder.length;
  return escaped >= R3.podiumSize || total === 0 || escaped >= total;
}

export function startRound3(d: GameState, now: number, ev: GameEvent[]): void {
  computeAllMoral(d);
  const r3: R3State = { teams: {}, votes: {}, leash: {}, reports: [], voteLog: [], escapeOrder: [], sd: null, sdHistory: [] };
  for (const tid of d.teamOrder) {
    const team = d.teams[tid];
    const moral = d.r2.moral[tid];
    const honourable = moral?.status === 'HONOURABLE';
    const start = calculateRound3StartingDistance(team.score, honourable);
    r3.teams[tid] = {
      distance: start.startingMeters,
      startDistance: start.startingMeters,
      honourBonus: honourable,
      leashHolder: moral?.status === 'BETRAYED',
      nemesis: moral?.status === 'BETRAYED' ? moral.nemesisTeamId : null,
      leashUsed: false,
      escaped: false,
      escapeRank: null,
      escapedInWave: null,
    };
  }
  d.r3 = r3;
  if (d.teamOrder.length === 0) {
    setStep(d, now, 'R3_RESULTS', null, { durationMs: null }, ev);
    return;
  }
  // The story plays first (BRIEFING); wave 1's VOTE timer starts when it ends (phases.ts).
  setStep(d, now, 'R3_ACTIVE', 'BRIEFING', { durationMs: briefingSeconds(3) * 1000, wave: 1 }, ev);
}

// RULE-QUESTION: the old code (supabaseService.ts ~2361) awarded an escape bonus to the team score
// (500 / 350 / 200 / 100 by rank). The rules doc and RULE_DECISIONS.md do not mention it, so the
// engine does NOT add points on escape; Round 3 only moves meters and orders the podium.
/** Start of REVEAL: resolve the wave from the recorded votes. Runs exactly once per wave. */
export function resolveWave(d: GameState, ev: GameEvent[]): void {
  const r3 = d.r3;
  if (!r3) return;
  const wave = d.wave;
  const active = r3ActiveTeamIds(d);
  const inputs: WaveTeamInput[] = active.map(tid => {
    const team = d.teams[tid];
    const t3 = r3.teams[tid];
    const votes = r3.votes[tid] || {};
    const vessel = resolveTeamVesselChoice(votes, team.playerIds);
    const target = r3.leash[tid];
    const valid = target && t3.leashHolder && !t3.leashUsed && t3.nemesis === target && r3.teams[target] && !r3.teams[target].escaped;
    return {
      id: tid,
      vessel,
      unanimity: calculateVoteUnanimity(votes, team.playerIds, vessel),
      priorScore: team.score,
      distance: t3.distance,
      leashTarget: valid ? target : null,
    };
  });
  logWaveVotes(d, r3, wave, active, inputs);
  const result = evaluateWave(inputs, wave, r3.escapeOrder.length);
  for (const tid of active) {
    const o = result.report.outcomes[tid];
    r3.teams[tid].distance = o.newDistance;
  }
  for (const tid of result.escapedInOrder) {
    const t3 = r3.teams[tid];
    t3.escaped = true;
    t3.escapedInWave = wave;
    r3.escapeOrder.push(tid);
  }
  rankEscapees(d);
  for (const h of result.leashConsumedBy) r3.teams[h].leashUsed = true;
  r3.reports.push(result.report);
  ev.push({ type: 'R3_WAVE_RESOLVED', wave, escaped: result.escapedInOrder });
}

const VESSEL_CHAR: Record<Vessel, string> = { ROWBOAT: 'R', SAILBOAT: 'S', GHOST_SHIP: 'G' };

/** Keep each active crew's individual votes before r3.votes is reset (append-only; changes no outcome). */
function logWaveVotes(d: GameState, r3: R3State, wave: number, active: string[], inputs: WaveTeamInput[]): void {
  const log = (r3.voteLog ||= []);
  for (let i = 0; i < active.length; i++) {
    const tid = active[i];
    const members = d.teams[tid].playerIds;
    const votes = r3.votes[tid] || {};
    const entry: WaveVoteLog = { wave, teamId: tid, votes: members.map(pid => (votes[pid] ? VESSEL_CHAR[votes[pid]] : '-')).join('') };
    if (rosterOf(log, tid).join('|') !== members.join('|')) entry.members = members.slice();
    const target = inputs[i].leashTarget;
    if (target) entry.leash = target;
    log.push(entry);
  }
}

/** The member list a crew's vote log is currently aligned to (the last entry that carried one). */
function rosterOf(log: WaveVoteLog[], teamId: string): string[] {
  for (let k = log.length - 1; k >= 0; k--) if (log[k].teamId === teamId && log[k].members) return log[k].members as string[];
  return [];
}

export function startNextWave(d: GameState, now: number, ev: GameEvent[]): void {
  const r3 = d.r3!;
  r3.votes = {};
  r3.leash = {};
  setStep(d, now, 'R3_ACTIVE', 'VOTE', { durationMs: d.config.r3.VOTE * 1000, wave: d.wave + 1 }, ev);
}

/** Escape a team outside a wave (admin distance changes). */
export function escapeNow(d: GameState, teamId: string): void {
  const r3 = d.r3!;
  const t3 = r3.teams[teamId];
  if (!t3 || t3.escaped) return;
  t3.escaped = true;
  t3.escapedInWave = d.wave;
  r3.escapeOrder.push(teamId);
  rankEscapees(d);
}

// ---- votes ------------------------------------------------------------------

function armLeash(d: GameState, teamId: string, requested: string | undefined): { error: ReturnType<typeof fail> } | { changed: boolean } {
  const r3 = d.r3!;
  const t3 = r3.teams[teamId];
  if (!t3.leashHolder || t3.leashUsed || !t3.nemesis) return { error: fail('NO_LEASH') };
  if (requested !== undefined && requested !== t3.nemesis) return { error: fail('INVALID_TARGET') };
  const target = r3.teams[t3.nemesis];
  if (!target || !d.teams[t3.nemesis]) return { error: fail('INVALID_TARGET') };
  if (target.escaped) return { error: fail('TARGET_ESCAPED') };
  // RULE-QUESTION: arming the leash is final for the wave (the old code never cleared it either); there is no disarm.
  if (r3.leash[teamId] === t3.nemesis) return { changed: false };
  r3.leash[teamId] = t3.nemesis;
  return { changed: true };
}

function checkWaveVoteOpen(d: GameState, now: number, c: { actor: { kind: string; playerId?: string } }) {
  if (d.phase !== 'R3_ACTIVE' || d.step !== 'VOTE' || !d.r3) return { error: fail('WRONG_PHASE') };
  if (d.pausedAt != null) return { error: fail('PAUSED') };
  if (d.endsAt != null && now >= d.endsAt) return { error: fail('VOTE_CLOSED') };
  const p = d.players[c.actor.playerId as string];
  if (!p.teamId) return { error: fail('NOT_IN_TEAM') };
  const t3 = d.r3.teams[p.teamId];
  if (!t3) return { error: fail('NOT_PLAYING') };
  if (t3.escaped) return { error: fail('ALREADY_ESCAPED') };
  return { player: p, teamId: p.teamId };
}

/** Everyone still racing has voted: close the vote 2 s from now (never later than the existing deadline). */
export const EARLY_REVEAL_MS = 2000;
function maybeRevealEarly(d: GameState, now: number): void {
  const r3 = d.r3;
  if (!r3 || d.pausedAt != null || d.endsAt == null) return;
  let racing = 0;
  for (const tid of d.teamOrder) {
    const t3 = r3.teams[tid];
    if (!t3 || t3.escaped) continue;
    const members = d.teams[tid].playerIds;
    if (members.length === 0) continue;
    racing++;
    const votes = r3.votes[tid] || {};
    if (!members.every(pid => votes[pid] !== undefined)) return;
  }
  if (racing === 0) return;
  d.endsAt = Math.min(d.endsAt, now + EARLY_REVEAL_MS);
}

const vote: Handler = (d, c, now) => {
  const chk = checkWaveVoteOpen(d, now, c as never);
  if ('error' in chk) return chk.error;
  const o = asObj(c.payload);
  const vessel = o?.vessel;
  if (vessel !== 'ROWBOAT' && vessel !== 'SAILBOAT' && vessel !== 'GHOST_SHIP') return fail('INVALID_PAYLOAD');
  const lt = o?.leashTarget;
  if (lt !== undefined && lt !== null && typeof lt !== 'string') return fail('INVALID_PAYLOAD');
  let changed = false;
  if (typeof lt === 'string') {
    const r = armLeash(d, chk.teamId, lt);
    if ('error' in r) return r.error;
    changed = r.changed;
  }
  const r3 = d.r3!;
  const bucket = (r3.votes[chk.teamId] ||= {});
  if (bucket[chk.player.id] === undefined) {
    bucket[chk.player.id] = vessel; // first vote is final
    changed = true;
    maybeRevealEarly(d, now);
  }
  return changed ? undefined : NOOP;
};

const armLeashHandler: Handler = (d, c, now, ev) => {
  const chk = checkWaveVoteOpen(d, now, c as never);
  if ('error' in chk) return chk.error;
  const o = asObj(c.payload);
  const target = o?.targetTeamId;
  if (target !== undefined && target !== null && typeof target !== 'string') return fail('INVALID_PAYLOAD');
  const r = armLeash(d, chk.teamId, typeof target === 'string' ? target : undefined);
  if ('error' in r) return r.error;
  if (!r.changed) return NOOP;
  ev.push({ type: 'R3_LEASH_ARMED', teamId: chk.teamId }); // no target in the event: stays hidden until REVEAL
  return undefined;
};

const sdVote: Handler = (d, c, now) => {
  const r3 = d.r3;
  if (d.step !== 'SUDDEN_DEATH' || !r3?.sd || r3.sd.resolved) return fail('NO_STANDOFF');
  if (d.pausedAt != null) return fail('PAUSED');
  if (d.endsAt != null && now >= d.endsAt) return fail('VOTE_CLOSED');
  const pid = (c.actor as { playerId: string }).playerId;
  const p = d.players[pid];
  if (!p.teamId) return fail('NOT_IN_TEAM');
  const action = asObj(c.payload)?.action;
  if (action !== 'SHIELDS' && action !== 'RAM' && action !== 'SAILS') return fail('INVALID_PAYLOAD');
  const sd = r3.sd;
  const bucket = p.teamId === sd.teamA ? sd.votesA : p.teamId === sd.teamB ? sd.votesB : null;
  if (!bucket) return fail('NOT_IN_DUEL');
  if (bucket[pid] !== undefined) return NOOP;
  bucket[pid] = action;
  return undefined;
};

// ---- sudden death -----------------------------------------------------------

export function triggerSuddenDeath(d: GameState, a: string, b: string, now: number, ev: GameEvent[]) {
  const r3 = d.r3;
  if (!r3) return fail('WRONG_PHASE');
  // RULE-QUESTION: the rules say Sudden Death is admin-triggered "between two crews" to settle the podium.
  // The engine allows it only between two crews that have already escaped, during REVEAL or on the results screen.
  const okPhase = (d.phase === 'R3_ACTIVE' && d.step === 'REVEAL') || (d.phase === 'R3_RESULTS' && d.step !== 'SUDDEN_DEATH');
  if (!okPhase) return fail('WRONG_PHASE');
  if (a === b) return fail('SAME_TEAM');
  if (!r3.teams[a] || !r3.teams[b]) return fail('UNKNOWN_TEAM');
  // The standoff decides the podium order of two crews that have escaped.
  if (!r3.teams[a].escaped || !r3.teams[b].escaped) return fail('INVALID_TARGET');
  r3.sd = { teamA: a, teamB: b, votesA: {}, votesB: {}, stanceA: null, stanceB: null, resolved: false, winnerTeamId: null, text: null };
  const base = d.pausedAt ?? now;
  d.returnTo = {
    phase: d.phase,
    step: d.step,
    clash: d.clash,
    wave: d.wave,
    remainingMs: d.endsAt == null ? null : Math.max(0, d.endsAt - base),
  };
  setStep(d, now, d.phase, 'SUDDEN_DEATH', { durationMs: d.config.sdSeconds * 1000, clash: d.clash, wave: d.wave }, ev);
  ev.push({ type: 'R3_SUDDEN_DEATH_STARTED', teamA: a, teamB: b });
  return undefined;
}

/** Resolve the standoff (timer end, admin skip, or round ended) and reorder the podium. */
export function resolveSd(d: GameState, ev: GameEvent[]): void {
  const r3 = d.r3;
  const sd: SuddenDeath | null | undefined = r3?.sd;
  if (!r3 || !sd || sd.resolved) return;
  const ta = d.teams[sd.teamA];
  const tb = d.teams[sd.teamB];
  sd.resolved = true;
  if (!ta || !tb) return;
  sd.stanceA = resolveSdStance(sd.votesA, ta.playerIds);
  sd.stanceB = resolveSdStance(sd.votesB, tb.playerIds);
  const out = resolveSuddenDeath(sd.stanceA, sd.stanceB);
  let winner: string | null = null;
  let text = out.description;
  if (out.winner === 'team_a') winner = sd.teamA;
  else if (out.winner === 'team_b') winner = sd.teamB;
  else if (ta.score !== tb.score) {
    // Identical maneuvers: higher R1+R2 points wins.
    winner = ta.score > tb.score ? sd.teamA : sd.teamB;
    text += ' The crew with more points wins the deadlock.';
  } else {
    // RULE-QUESTION: identical maneuvers AND identical points; the rules do not say. Podium order is left unchanged.
    text += ' Points are level: podium order unchanged.';
  }
  sd.winnerTeamId = winner;
  sd.text = text;
  if (winner) {
    const order = r3.escapeOrder;
    const ia = order.indexOf(sd.teamA);
    const ib = order.indexOf(sd.teamB);
    if (ia >= 0 && ib >= 0) {
      const winnerIdx = winner === sd.teamA ? ia : ib;
      const loserIdx = winner === sd.teamA ? ib : ia;
      if (winnerIdx > loserIdx) {
        // winner currently ranks below the loser: swap their positions
        const t = order[winnerIdx];
        order[winnerIdx] = order[loserIdx];
        order[loserIdx] = t;
        rankEscapees(d);
      }
    }
  }
  r3.sdHistory.push(structuredClone(sd));
  ev.push({ type: 'R3_SUDDEN_DEATH_RESOLVED', winner });
}

export const round3Handlers: Record<string, Handler> = {
  R3_VOTE: vote,
  R3_ARM_LEASH: armLeashHandler,
  SD_VOTE: sdVote,
};
