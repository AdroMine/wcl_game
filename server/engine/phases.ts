// The global phase machine. The server owns the clock: every team is in the same phase at the
// same second. Timed steps advance via SYS_ADVANCE (see due.ts); phases without a timer
// (LOBBY, R1_RESULTS, R2_PAIRING, R2_RESULTS, R3_RESULTS) are left by admin commands.
import { R2_CLASHES, MIN_DEADLINE_MS, SD_REVEAL_SECONDS } from './config.ts';
import { setStep } from './clock.ts';
import { closeRound1, startRound1Clock } from './round1.ts';
import { beginNextClash, computeAllMoral, resolveClash } from './round2.ts';
import { r3ShouldFinish, resolveSd, resolveWave, startNextWave } from './round3.ts';
import type { GameEvent, GameState, Handler, HandlerResult } from './types.ts';
import { fail } from './types.ts';

function exitSuddenDeath(d: GameState, now: number, ev: GameEvent[]): void {
  resolveSd(d, ev);
  const rt = d.returnTo;
  d.returnTo = null;
  if (!rt) {
    setStep(d, now, 'R3_RESULTS', null, { durationMs: null }, ev);
    return;
  }
  setStep(
    d,
    now,
    rt.phase,
    rt.step,
    { durationMs: rt.remainingMs == null ? null : Math.max(rt.remainingMs, MIN_DEADLINE_MS), clash: rt.clash, wave: rt.wave },
    ev,
  );
}

/**
 * The Sudden Death clock ran out (or the host skipped): resolve the standoff and keep the
 * SUDDEN_DEATH step open for SD_REVEAL_SECONDS so every phone can show both picks and the winner.
 * When the reveal ends (or is skipped), leave Sudden Death.
 */
function suddenDeathTimeUp(d: GameState, now: number, ev: GameEvent[]): void {
  if (d.r3?.sd && !d.r3.sd.resolved) {
    resolveSd(d, ev);
    setStep(d, now, d.phase, 'SUDDEN_DEATH', { durationMs: SD_REVEAL_SECONDS * 1000, clash: d.clash, wave: d.wave }, ev);
    return;
  }
  exitSuddenDeath(d, now, ev);
}

/** Move the current timed step to the next one. Caller has checked the deadline (or admin skip). */
export function advance(d: GameState, now: number, ev: GameEvent[]): HandlerResult {
  const c = d.config;
  switch (d.phase) {
    case 'R1_ACTIVE':
      if (d.step === 'BRIEFING') {
        // The story is over: the 5:00 clock (deadline, hint unlocks, speed tiers) starts now.
        startRound1Clock(d, now);
        setStep(d, now, 'R1_ACTIVE', null, { durationMs: c.r1Seconds * 1000 }, ev);
        return undefined;
      }
      closeRound1(d);
      setStep(d, now, 'R1_RESULTS', null, { durationMs: null }, ev);
      return undefined;
    case 'R2_CLASH':
      switch (d.step) {
        case 'BRIEFING': // the global clash clock starts now: clash 1 begins with its huddle
          setStep(d, now, 'R2_CLASH', 'HUDDLE', { durationMs: c.r2.HUDDLE * 1000, clash: d.clash }, ev);
          return undefined;
        case 'HUDDLE':
          setStep(d, now, 'R2_CLASH', 'PARLEY', { durationMs: c.r2.PARLEY * 1000, clash: d.clash }, ev);
          return undefined;
        case 'PARLEY':
          setStep(d, now, 'R2_CLASH', 'VOTE', { durationMs: c.r2.VOTE * 1000, clash: d.clash }, ev);
          return undefined;
        case 'VOTE':
          resolveClash(d, ev); // scored exactly once, here
          setStep(d, now, 'R2_CLASH', 'DEBRIEF', { durationMs: c.r2.DEBRIEF * 1000, clash: d.clash }, ev);
          return undefined;
        case 'DEBRIEF':
          if (d.clash < R2_CLASHES) {
            beginNextClash(d, d.clash + 1);
            setStep(d, now, 'R2_CLASH', 'HUDDLE', { durationMs: c.r2.HUDDLE * 1000, clash: d.clash + 1 }, ev);
          } else {
            computeAllMoral(d);
            setStep(d, now, 'R2_RESULTS', null, { durationMs: null }, ev);
          }
          return undefined;
        default:
          return fail('NOT_TIMED');
      }
    case 'R3_ACTIVE':
      switch (d.step) {
        case 'BRIEFING': // wave 1 starts now
          setStep(d, now, 'R3_ACTIVE', 'BLUFF', { durationMs: c.r3.BLUFF * 1000, wave: d.wave }, ev);
          return undefined;
        case 'BLUFF':
          setStep(d, now, 'R3_ACTIVE', 'VOTE', { durationMs: c.r3.VOTE * 1000, wave: d.wave }, ev);
          return undefined;
        case 'VOTE':
          resolveWave(d, ev); // wave resolved at the start of REVEAL (Q9 / brief)
          setStep(d, now, 'R3_ACTIVE', 'REVEAL', { durationMs: c.r3.REVEAL * 1000, wave: d.wave }, ev);
          return undefined;
        case 'REVEAL':
          if (r3ShouldFinish(d)) setStep(d, now, 'R3_RESULTS', null, { durationMs: null }, ev);
          else startNextWave(d, now, ev);
          return undefined;
        case 'SUDDEN_DEATH':
          suddenDeathTimeUp(d, now, ev);
          return undefined;
        default:
          return fail('NOT_TIMED');
      }
    case 'R3_RESULTS':
      if (d.step === 'SUDDEN_DEATH') {
        suddenDeathTimeUp(d, now, ev);
        return undefined;
      }
      return fail('NOT_TIMED');
    default:
      return fail('NOT_TIMED');
  }
}

/** End Round 3 immediately (admin). A running standoff is resolved first. */
export function endRound3(d: GameState, now: number, ev: GameEvent[]): HandlerResult {
  if (d.phase !== 'R3_ACTIVE') return fail('WRONG_PHASE');
  if (d.step === 'SUDDEN_DEATH') resolveSd(d, ev);
  d.returnTo = null;
  setStep(d, now, 'R3_RESULTS', null, { durationMs: null }, ev);
  return undefined;
}

const sysAdvance: Handler = (d, c, now, ev) => {
  const seq = (c.payload as { phaseSeq?: unknown } | null)?.phaseSeq;
  if (seq !== d.phaseSeq) return fail('STALE');
  if (d.pausedAt != null) return fail('PAUSED');
  if (d.endsAt == null) return fail('NOT_TIMED');
  if (now < d.endsAt) return fail('NOT_DUE');
  return advance(d, now, ev);
};

export const phaseHandlers: Record<string, Handler> = {
  SYS_ADVANCE: sysAdvance,
};
