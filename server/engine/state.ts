import { DEFAULT_DURATIONS } from './config.ts';
import { seedToState } from './rng.ts';
import type { GameState } from './types.ts';

export function createInitialState(opts: { seed: number }): GameState {
  return {
    version: 0,
    phaseSeq: 0,
    rng: seedToState(opts.seed),
    idCounter: 0,
    phase: 'LOBBY',
    step: null,
    clash: 0,
    wave: 0,
    phaseStartedAt: 0,
    endsAt: null,
    pausedAt: null,
    returnTo: null,
    phaseLog: [{ seq: 0, phase: 'LOBBY', step: null, clash: 0, wave: 0, at: 0 }],
    config: structuredClone(DEFAULT_DURATIONS),
    players: {},
    playerOrder: [],
    teams: {},
    teamOrder: [],
    r1: { startedAt: null, closed: false },
    r2: { matches: {}, matchOfTeam: {}, moral: {}, bye: {} },
    r3: null,
    applied: [],
  };
}

/**
 * Fill in fields that snapshots written by older builds lack, so an old snapshot loads with defaults.
 * Returns the same object when nothing is missing. Pure.
 */
export function normalizeRestoredState(state: GameState): GameState {
  let out = state;
  const cfg = out.config as Partial<GameState['config']>;
  if (typeof cfg.crewSize !== 'number') out = { ...out, config: { ...out.config, crewSize: DEFAULT_DURATIONS.crewSize } };
  // Snapshots written before the Round 2 bye rule have no r2.bye.
  if (!(out.r2 as Partial<GameState['r2']>).bye) out = { ...out, r2: { ...out.r2, bye: {} } };
  return out;
}
