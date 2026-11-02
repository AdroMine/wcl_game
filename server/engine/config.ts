// Rule constants. Ported from src/lib/defaultConfig.ts (admin_passcode deliberately dropped).
// Scoring values are fixed in code (RULE_DECISIONS.md); only phase durations are editable.
import type { Durations, RoleId, SdAction, Vessel } from './types.ts';

export const ROLES: readonly { id: RoleId; name: string; color: string }[] = [
  { id: 'navigator', name: 'Navigator', color: '#38bdf8' },
  { id: 'oracle', name: 'Oracle', color: '#c084fc' },
  { id: 'scholar', name: 'Scholar', color: '#34d399' },
  { id: 'torchbearer', name: 'Torchbearer', color: '#fb923c' },
  { id: 'negotiator', name: 'Negotiator', color: '#f43f5e' },
];
export const ROLE_IDS: readonly RoleId[] = ROLES.map(r => r.id);

export const TEAM_MIN = 3;
/** Admin-settable crew size N (RULE_DECISIONS Q11): 3..6, default 5. */
export const CREW_SIZE_MIN = 3;
export const CREW_SIZE_MAX = 6;
export const CREW_SIZE_DEFAULT = 5;
/** Roles are unique among the first min(N, this) members of a crew. */
export const UNIQUE_ROLE_SLOTS = 5;

export const TEAM_EMOJI_POOL = ['🔥', '💀', '⚡', '🌊', '🛡️'] as const;
export const TEAM_EMOJI_LABELS: Record<string, string> = {
  '🔥': 'Fire',
  '💀': 'Skull',
  '⚡': 'Bolt',
  '🌊': 'Wave',
  '🛡️': 'Shield',
};

// Ported from src/lib/tabletEngine.ts / defaultConfig.ts
export const CODEWORDS: readonly string[] = [
  'CRIMSON SHADOW',
  'MIDNIGHT BELL',
  'OBSIDIAN GATE',
  'SILENT SPECTER',
  'ANCIENT CURSE',
  'HOLLOW GRAVE',
  'PHANTOM WRATH',
  'BLOOD MOON',
  'BURNING ALTAR',
  'EMERALD TOMB',
];

export const DEFAULT_DURATIONS: Durations = {
  r1Seconds: 300,
  r2: { HUDDLE: 50, PARLEY: 40, VOTE: 25, DEBRIEF: 40 },
  r3: { BLUFF: 55, VOTE: 20, REVEAL: 25 },
  sdSeconds: 40,
  crewSize: CREW_SIZE_DEFAULT,
};

/** A deadline can never be moved earlier than now + this (ms). */
export const MIN_DEADLINE_MS = 5000;

export const ROUND1_HINT_COST = 30;
export const ROUND1_FLOOR = 50;

export const R2_CLASHES = 3;
export interface Round2ScoringTier {
  both_truce: number;
  ambush_win: number;
  truce_loss: number;
  both_ambush: number;
}
export const R2_SCORING: Record<string, Round2ScoringTier> = {
  '1': { both_truce: 75, ambush_win: 150, truce_loss: 0, both_ambush: 15 },
  '2': { both_truce: 150, ambush_win: 300, truce_loss: 0, both_ambush: 30 },
  '3': { both_truce: 225, ambush_win: 450, truce_loss: 0, both_ambush: 45 },
};

export const R3 = {
  targetDistance: 1000,
  headstartDivisor: 5,
  maxHeadstart: 200,
  honourBonus: 75,
  sailboatCapacityPercent: 0.3,
  podiumSize: 3,
  anchorSiphon: 50,
  wreckBonus: 100,
  vessel: {
    ROWBOAT: { success: 150, fail: 150 },
    SAILBOAT: { success: 300, fail: 0 },
    GHOST_SHIP: { success: 450, fail: -50 },
  } as Record<Vessel, { success: number; fail: number }>,
};

/** Safest first: used for tie-breaking vessel votes (RULE_DECISIONS Q1/Q2). */
export const VESSELS_SAFEST_FIRST: readonly Vessel[] = ['ROWBOAT', 'SAILBOAT', 'GHOST_SHIP'];
export const SD_ACTIONS: readonly SdAction[] = ['SHIELDS', 'RAM', 'SAILS'];

export const MAX_APPLIED_IDS = 10000;
export const MAX_NAME = 24;
export const MAX_TEAM_NAME = 32;
