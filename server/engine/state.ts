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
 * Organizer ruling, Nov 4 2026 (docs/RULE_DECISIONS.md): Round 2 clashes are VOTE (talk and vote) then DEBRIEF,
 * Round 3 waves are VOTE then REVEAL. Snapshots written before that ruling are brought to the new shape:
 *  - config: r2 {HUDDLE, PARLEY, VOTE, DEBRIEF} and r3 {BLUFF, VOTE, REVEAL} become r2 {VOTE, DEBRIEF} and
 *    r3 {VOTE, REVEAL}. Old default lengths give the new defaults (VOTE 60 / DEBRIEF 15, VOTE 40); a value the host
 *    customised is kept (new VOTE = old talk steps + old VOTE; DEBRIEF and REVEAL unchanged).
 *  - step: a game sitting in HUDDLE, PARLEY or BLUFF (also a Sudden Death returnTo) moves to that clash's or wave's
 *    VOTE step, with endsAt = the old step's endsAt + one full VOTE length (the remaining time of the old step plus a
 *    full new VOTE; pure, needs no clock). Votes already recorded are kept.
 */
function migrateTimingRuling(state: GameState): GameState {
  let out = state;
  const cfg = out.config as unknown as { r2: Record<string, number>; r3: Record<string, number> };
  if ('HUDDLE' in cfg.r2 || 'PARLEY' in cfg.r2) {
    const o = cfg.r2;
    const isOld = o.HUDDLE === 50 && o.PARLEY === 40 && o.VOTE === 25;
    const vote = isOld ? DEFAULT_DURATIONS.r2.VOTE : (o.HUDDLE ?? 0) + (o.PARLEY ?? 0) + (o.VOTE ?? 0);
    const debrief = o.DEBRIEF === 40 ? DEFAULT_DURATIONS.r2.DEBRIEF : o.DEBRIEF;
    out = { ...out, config: { ...out.config, r2: { VOTE: vote, DEBRIEF: debrief } } };
  }
  if ('BLUFF' in cfg.r3) {
    const o = cfg.r3;
    const isOld = o.BLUFF === 55 && o.VOTE === 20;
    const vote = isOld ? DEFAULT_DURATIONS.r3.VOTE : (o.BLUFF ?? 0) + (o.VOTE ?? 0);
    out = { ...out, config: { ...out.config, r3: { VOTE: vote, REVEAL: o.REVEAL } } };
  }
  const old = (s: string | null) => s === 'HUDDLE' || s === 'PARLEY' || s === 'BLUFF';
  if (old(out.step)) {
    const len = (out.phase === 'R3_ACTIVE' ? out.config.r3.VOTE : out.config.r2.VOTE) * 1000;
    out = { ...out, step: 'VOTE', endsAt: out.endsAt == null ? null : out.endsAt + len };
  }
  if (out.returnTo && old(out.returnTo.step)) out = { ...out, returnTo: { ...out.returnTo, step: 'VOTE' } };
  return out;
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
  // Snapshots written before the game-data export have no wrong-guess record and no per-wave vote log.
  if (Object.values(out.teams).some(t => t.r1 && !(t.r1 as Partial<NonNullable<typeof t.r1>>).wrong)) {
    const teams = { ...out.teams };
    for (const [id, t] of Object.entries(teams)) {
      if (t.r1 && !(t.r1 as Partial<NonNullable<typeof t.r1>>).wrong) teams[id] = { ...t, r1: { ...t.r1, wrong: { count: 0, log: [] } } };
    }
    out = { ...out, teams };
  }
  out = migrateTimingRuling(out);
  if (out.r3 && !Array.isArray((out.r3 as Partial<NonNullable<GameState['r3']>>).voteLog)) out = { ...out, r3: { ...out.r3, voteLog: [] } };
  return out;
}
