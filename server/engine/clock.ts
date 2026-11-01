// Timeline primitives shared by every round module. Contains no round logic, so round
// modules and phases.ts can both import it without import cycles.
import type { GameEvent, GameState, Phase, Step } from './types.ts';

/** The "effective now": frozen at pausedAt while the game is paused. */
export function effNow(d: Pick<GameState, 'pausedAt'>, now: number): number {
  return d.pausedAt ?? now;
}

/**
 * Enter a new phase/step. Increments the phase sequence number (which names the system
 * command that advances it), stores an absolute endsAt and logs the transition.
 */
export function setStep(
  d: GameState,
  now: number,
  phase: Phase,
  step: Step,
  opts: { durationMs: number | null; clash?: number; wave?: number },
  ev: GameEvent[],
): void {
  const base = effNow(d, now);
  d.phase = phase;
  d.step = step;
  d.clash = opts.clash ?? 0;
  d.wave = opts.wave ?? 0;
  d.phaseSeq += 1;
  d.phaseStartedAt = base;
  d.endsAt = opts.durationMs == null ? null : base + opts.durationMs;
  d.phaseLog.push({ seq: d.phaseSeq, phase, step, clash: d.clash, wave: d.wave, at: now });
  ev.push({ type: 'PHASE_CHANGED', phase, step, clash: d.clash, wave: d.wave, seq: d.phaseSeq, endsAt: d.endsAt });
}

/** Whole seconds of unpaused time since Round 1 started. */
export function r1ElapsedSeconds(d: GameState, now: number): number {
  if (d.r1.startedAt == null) return 0;
  return Math.max(0, Math.floor((effNow(d, now) - d.r1.startedAt) / 1000));
}
