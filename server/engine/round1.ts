// Round 1: The Shattered Tablet.
// Scoring and hint text ported from src/lib/round1Engine.ts. Submit/hint orchestration ported
// from supabaseSubmitRoundAnswer / supabaseRequestRoundHint / supabaseAdminMarkRound1Solved,
// with the server clock and RULE_DECISIONS Q12 (round closes at the deadline).
import { CODEWORDS, ROUND1_FLOOR, ROUND1_HINT_COST } from './config.ts';
import { asObj, recomputeScore, reqInt } from './common.ts';
import { effNow, r1ElapsedSeconds } from './clock.ts';
import { assignSlots, generateHintText, hintTextFor } from './r1slots.ts';
import type { PlayerSlotInfo } from './r1slots.ts';
import { rngPick } from './rng.ts';
import type { GameEvent, GameState, Handler, Team } from './types.ts';
import { NOOP, fail } from './types.ts';

// ---- ported pure functions (src/lib/round1Engine.ts) ------------------------

export interface Round1HintConfig {
  hintIndex: number;
  availableAfterSeconds: number;
  title: string;
  positionTarget: 'LEFT' | 'RIGHT' | 'CENTER';
  penaltyPoints: number;
}

export const ROUND1_HINTS: Round1HintConfig[] = [
  { hintIndex: 1, availableAfterSeconds: 120, title: 'Left Edge Fragment', positionTarget: 'LEFT', penaltyPoints: 30 },
  { hintIndex: 2, availableAfterSeconds: 180, title: 'Right Edge Fragment', positionTarget: 'RIGHT', penaltyPoints: 30 },
  { hintIndex: 3, availableAfterSeconds: 240, title: 'Center Fragment', positionTarget: 'CENTER', penaltyPoints: 30 },
];

export { generateHintText };
export type { PlayerSlotInfo };

export interface Round1ScoreBreakdown {
  elapsedSeconds: number;
  basePoints: number;
  hintPenalty: number;
  hintsTakenCount: number;
  finalPoints: number;
  speedTier: string;
  nextTierInSeconds: number;
}

export function calculateRound1Score(elapsedSeconds: number, hintsTakenCount: number = 0): Round1ScoreBreakdown {
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  let basePoints = 100;
  let speedTier = 'Standard Solve';
  let nextTierInSeconds = 0;
  if (safeElapsed <= 60) {
    basePoints = 300;
    speedTier = '⚡ Legendary (Under 1m)';
    nextTierInSeconds = 60 - safeElapsed;
  } else if (safeElapsed <= 120) {
    basePoints = 250;
    speedTier = '⚡ Swift (Under 2m)';
    nextTierInSeconds = 120 - safeElapsed;
  } else if (safeElapsed <= 180) {
    basePoints = 200;
    speedTier = '🛡️ Steady (Under 3m)';
    nextTierInSeconds = 180 - safeElapsed;
  } else if (safeElapsed <= 240) {
    basePoints = 150;
    speedTier = '⏳ Methodical (Under 4m)';
    nextTierInSeconds = 240 - safeElapsed;
  }
  const hintPenalty = hintsTakenCount * ROUND1_HINT_COST;
  const finalPoints = Math.max(ROUND1_FLOOR, basePoints - hintPenalty);
  return { elapsedSeconds: safeElapsed, basePoints, hintPenalty, hintsTakenCount, finalPoints, speedTier, nextTierInSeconds };
}

export function normalizeAnswer(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '');
}

// ---- state transitions ------------------------------------------------------

/**
 * Called when the game leaves the lobby: assigns codewords and freezes the pieces (one slot per
 * member). The Round 1 clock does NOT start here: it starts when the briefing ends (startRound1Clock).
 */
export function initRound1(d: GameState): void {
  d.r1 = { startedAt: null, closed: false };
  for (const tid of d.teamOrder) {
    const t = d.teams[tid];
    const { slots, size } = assignSlots(t);
    t.r1 = {
      codeword: rngPick(d, CODEWORDS),
      slots,
      size,
      hintsTaken: [],
      hintTexts: {},
      solved: false,
      solveSeconds: null,
      points: 0,
      solvedBy: null,
      markedByAdmin: false,
    };
    t.r1Points = 0;
    recomputeScore(t);
  }
}

/** The briefing ended: the 5:00 clock, hint unlocks and speed tiers all count from now. */
export function startRound1Clock(d: GameState, now: number): number {
  d.r1.startedAt = effNow(d, now);
  return d.r1.startedAt;
}

/** Whether the Round 1 clock is running (false during the briefing). */
export function r1Running(d: GameState): boolean {
  return d.phase === 'R1_ACTIVE' && d.step !== 'BRIEFING';
}

/** A crew's codeword as the two lines of the tablet (old src/lib/tabletEngine.ts parseTabletCodeword). */
export function parseTabletCodeword(codeword: string): { line1: string; line2: string } {
  const clean = (codeword || 'CRIMSON SHADOW').trim().toUpperCase();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return { line1: parts[0], line2: parts.slice(1).join(' ') };
  const mid = Math.ceil(clean.length / 2);
  return { line1: clean.slice(0, mid), line2: clean.slice(mid) };
}

export function closeRound1(d: GameState): void {
  d.r1.closed = true;
}

function awardSolve(d: GameState, t: Team, now: number, by: string | null, byAdmin: boolean, ev: GameEvent[]): void {
  const r1 = t.r1!;
  const elapsed = r1ElapsedSeconds(d, now);
  const breakdown = calculateRound1Score(elapsed, r1.hintsTaken.length);
  r1.solved = true;
  r1.solveSeconds = elapsed;
  r1.points = breakdown.finalPoints;
  r1.solvedBy = by;
  r1.markedByAdmin = byAdmin;
  t.r1Points = breakdown.finalPoints;
  recomputeScore(t);
  ev.push({ type: 'R1_SOLVED', teamId: t.id, points: breakdown.finalPoints, seconds: elapsed });
}

function playerTeamForR1(d: GameState, c: { actor: { kind: string; playerId?: string } }): Team | { error: ReturnType<typeof fail> } {
  const p = d.players[c.actor.playerId as string];
  if (!p.teamId) return { error: fail('NOT_IN_TEAM') };
  return d.teams[p.teamId];
}

const submit: Handler = (d, c, now, ev) => {
  const t = playerTeamForR1(d, c as never);
  if ('error' in t) return t.error;
  const answer = asObj(c.payload)?.answer;
  if (typeof answer !== 'string' || answer.length > 200) return fail('INVALID_PAYLOAD');
  if (t.r1?.solved) return NOOP;
  if (d.phase === 'LOBBY') return fail('WRONG_PHASE');
  if (d.phase !== 'R1_ACTIVE' || d.r1.closed) return fail('ROUND_CLOSED');
  if (d.step === 'BRIEFING') return fail('WRONG_PHASE'); // the story is playing: the clock has not started
  if (d.pausedAt != null) return fail('PAUSED');
  if (d.endsAt != null && now >= d.endsAt) return fail('ROUND_CLOSED');
  if (!t.r1) return fail('NOT_PLAYING');
  if (normalizeAnswer(answer) !== normalizeAnswer(t.r1.codeword)) return fail('WRONG_ANSWER');
  awardSolve(d, t, now, (c.actor as { playerId: string }).playerId, false, ev);
  return undefined;
};

// RULE-QUESTION: the rules do not say whether hints must be taken in order; as in the old code any unlocked hint may be taken.
// Hints taken after the team has solved are ignored (no penalty).
const hint: Handler = (d, c, now, ev) => {
  const t = playerTeamForR1(d, c as never);
  if ('error' in t) return t.error;
  const idx = reqInt(asObj(c.payload), 'hint');
  const cfg = ROUND1_HINTS.find(h => h.hintIndex === idx);
  if (!cfg) return fail('INVALID_PAYLOAD');
  if (d.phase === 'LOBBY') return fail('WRONG_PHASE');
  if (d.phase !== 'R1_ACTIVE' || d.r1.closed) return fail('ROUND_CLOSED');
  if (d.step === 'BRIEFING') return fail('WRONG_PHASE');
  if (d.pausedAt != null) return fail('PAUSED');
  if (!t.r1) return fail('NOT_PLAYING');
  if (t.r1.solved || t.r1.hintsTaken.includes(cfg.hintIndex)) return NOOP;
  if (r1ElapsedSeconds(d, now) < cfg.availableAfterSeconds) return fail('HINT_LOCKED');
  t.r1.hintsTaken.push(cfg.hintIndex);
  t.r1.hintsTaken.sort((a, b) => a - b);
  t.r1.hintTexts[String(cfg.hintIndex)] = hintTextFor(d, t, cfg.hintIndex);
  ev.push({ type: 'R1_HINT_TAKEN', teamId: t.id, hint: cfg.hintIndex });
  return undefined;
};

/** Admin: mark a team's Round 1 as solved; scores as if solved right now. */
export function adminMarkSolved(d: GameState, teamId: string, now: number, ev: GameEvent[]): ReturnType<Handler> {
  const t = d.teams[teamId];
  if (!t) return fail('UNKNOWN_TEAM');
  if (d.phase !== 'R1_ACTIVE' || d.step === 'BRIEFING') return fail('WRONG_PHASE');
  if (!t.r1) return fail('NOT_PLAYING');
  if (t.r1.solved) return NOOP;
  awardSolve(d, t, now, null, true, ev);
  return undefined;
}

export const round1Handlers: Record<string, Handler> = {
  R1_SUBMIT: submit,
  R1_HINT: hint,
};
