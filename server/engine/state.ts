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
    r2: { matches: {}, matchOfTeam: {}, moral: {} },
    r3: null,
    applied: [],
  };
}
