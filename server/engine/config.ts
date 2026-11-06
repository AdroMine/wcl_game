// Rule constants for the engine. Game-agnostic limits live here; everything specific to a game (texts,
// codewords, scoring tables, emblems) lives in games/<game>/ and is re-exported below so the
// engine's imports keep working. Scoring values are fixed in code (RULE_DECISIONS.md); only phase
// durations are editable at run time.
import type { Durations } from './types.ts';
import { ROUND1_SECONDS } from '../../games/underworld/rounds/tablet/content.ts';
import { R2_DURATIONS } from '../../games/underworld/rounds/mist/content.ts';
import { R3_DURATIONS, SD_SECONDS } from '../../games/underworld/rounds/styx/content.ts';
export { SD_REVEAL_SECONDS } from '../../games/underworld/rounds/styx/content.ts';

// Active disk (step 1: Underworld only). Re-exported so engine code imports from './config.ts' as before.
export { TEAM_EMOJI_POOL, TEAM_EMOJI_LABELS } from '../../games/underworld/game.ts';
export { CODEWORDS, ROUND1_HINT_COST, ROUND1_FLOOR } from '../../games/underworld/rounds/tablet/content.ts';
export { R2_CLASHES, R2_SCORING } from '../../games/underworld/rounds/mist/content.ts';
export type { Round2ScoringTier } from '../../games/underworld/rounds/mist/content.ts';
export { R3, VESSELS_SAFEST_FIRST, SD_ACTIONS } from '../../games/underworld/rounds/styx/content.ts';

/** Admin-settable crew size N (RULE_DECISIONS Q11): 3..6, default 5. */
export const CREW_SIZE_MIN = 3;
export const CREW_SIZE_MAX = 6;
export const CREW_SIZE_DEFAULT = 5;
export const DEFAULT_DURATIONS: Durations = {
  r1Seconds: ROUND1_SECONDS,
  r2: { ...R2_DURATIONS },
  r3: { ...R3_DURATIONS },
  sdSeconds: SD_SECONDS,
  crewSize: CREW_SIZE_DEFAULT,
};

/** A deadline can never be moved earlier than now + this (ms). */
export const MIN_DEADLINE_MS = 5000;

export const MAX_APPLIED_IDS = 10000;
export const MAX_NAME = 24;
export const MAX_TEAM_NAME = 32;
