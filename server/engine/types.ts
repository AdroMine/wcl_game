// Core engine types. GameState is plain JSON: objects keyed by id, arrays, numbers,
// strings, booleans and null. Never use undefined, Map, Set or Date inside the state.

export type Phase =
  | 'LOBBY'
  | 'R1_ACTIVE'
  | 'R1_RESULTS'
  | 'R2_PAIRING'
  | 'R2_CLASH'
  | 'R2_RESULTS'
  | 'R3_ACTIVE'
  | 'R3_RESULTS'
  | 'FINISHED';

export type Step =
  | 'BRIEFING'
  | 'HUDDLE'
  | 'PARLEY'
  | 'VOTE'
  | 'DEBRIEF'
  | 'BLUFF'
  | 'REVEAL'
  | 'SUDDEN_DEATH'
  | null;

export type RoleId = 'navigator' | 'oracle' | 'scholar' | 'torchbearer' | 'negotiator';
export type Stance = 'TRUCE' | 'AMBUSH';
export type Vessel = 'ROWBOAT' | 'SAILBOAT' | 'GHOST_SHIP';
export type SdAction = 'SHIELDS' | 'RAM' | 'SAILS';
export type MoralStatus = 'HONOURABLE' | 'BETRAYED' | 'AGGRESSOR' | 'BLOOD_FEUD' | 'NONE';

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNKNOWN_COMMAND'
  | 'FORBIDDEN'
  | 'UNKNOWN_PLAYER'
  | 'UNKNOWN_TEAM'
  | 'NOT_IN_TEAM'
  | 'ALREADY_IN_TEAM'
  | 'WRONG_PHASE'
  | 'PAUSED'
  | 'ALREADY_PAUSED'
  | 'NOT_PAUSED'
  | 'TEAM_FULL'
  | 'ROLE_TAKEN'
  | 'UNKNOWN_CODE'
  | 'INVALID_CODE'
  | 'OWN_CODE'
  | 'ALREADY_PAIRED'
  | 'NO_CODES_LEFT'
  | 'WRONG_ANSWER'
  | 'HINT_LOCKED'
  | 'ROUND_CLOSED'
  | 'NOT_PLAYING'
  | 'VOTE_CLOSED'
  | 'ALREADY_ESCAPED'
  | 'NO_LEASH'
  | 'INVALID_TARGET'
  | 'TARGET_ESCAPED'
  | 'NOT_TIMED'
  | 'NOT_DUE'
  | 'STALE'
  | 'INVALID_DURATION'
  | 'SAME_TEAM'
  | 'NOT_IN_DUEL'
  | 'NO_STANDOFF'
  | 'NOT_PAIRED';

export type Actor =
  | { kind: 'player'; playerId: string }
  | { kind: 'admin' }
  | { kind: 'system' };

export interface Command {
  commandId: string;
  type: string;
  actor: Actor;
  payload: unknown;
}

export interface Ctx {
  now: number;
}

export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
  error?: ErrorCode;
}

export interface Durations {
  r1Seconds: number;
  r2: { HUDDLE: number; PARLEY: number; VOTE: number; DEBRIEF: number };
  r3: { BLUFF: number; VOTE: number; REVEAL: number };
  sdSeconds: number;
  /** Maximum crew size N (3..6, default 5). Old snapshots lack it: always read it through crewSizeOf(). */
  crewSize: number;
}

export interface Player {
  id: string;
  name: string;
  role: RoleId;
  /** Opaque hash stored for the server to compare. NEVER expose through selectors. */
  tokenHash: string;
  teamId: string | null;
  joinedSeq: number;
}

export interface R1TeamState {
  /** The answer. NEVER expose through selectors. */
  codeword: string;
  /** playerId -> slot index, frozen at Round 1 start. */
  slots: Record<string, number>;
  size: number;
  hintsTaken: number[];
  hintTexts: Record<string, string>;
  solved: boolean;
  solveSeconds: number | null;
  points: number;
  solvedBy: string | null;
  markedByAdmin: boolean;
}

export interface Team {
  id: string;
  name: string;
  emojiCode: string;
  battleCode: string;
  playerIds: string[];
  r1Points: number;
  r2Points: number;
  adminAdjust: number;
  /** Always r1Points + r2Points + adminAdjust. */
  score: number;
  r1: R1TeamState | null;
}

export interface Clash {
  clash: number;
  votesA: Record<string, Stance>;
  votesB: Record<string, Stance>;
  resolved: boolean;
  stanceA: Stance | null;
  stanceB: Stance | null;
  ptsA: number;
  ptsB: number;
}

export interface Match {
  id: string;
  teamA: string;
  teamB: string;
  clashes: Clash[];
  /** Set when a team of the match is deleted; no further clashes are scored. */
  cancelled: boolean;
}

export interface Moral {
  status: MoralStatus;
  rivalTeamId: string | null;
  /** Betrayed team's nemesis = its rival. */
  nemesisTeamId: string | null;
  mutualTruce: number;
  myAmbush: number;
  rivalAmbush: number;
  mutualAmbush: number;
}

export interface R3Team {
  distance: number;
  startDistance: number;
  honourBonus: boolean;
  leashHolder: boolean;
  nemesis: string | null;
  leashUsed: boolean;
  escaped: boolean;
  escapeRank: number | null;
  escapedInWave: number | null;
}

export interface LeashEvent {
  holder: string;
  target: string;
  kind: 'ANCHOR_SIPHON' | 'WRECK_DRAG' | 'LEASH_SNAPPED';
  holderDelta: number;
  targetDelta: number;
}

export interface WaveOutcome {
  vessel: Vessel;
  unanimity: number;
  baseMeters: number;
  leashDelta: number;
  gained: number;
  newDistance: number;
  escaped: boolean;
  escapeRank: number | null;
}

export interface WaveReport {
  wave: number;
  activeCrews: number;
  sailboatCapacity: number;
  sailboatCapsized: boolean;
  ghostCollided: boolean;
  ghostSoloTeamId: string | null;
  leashEvents: LeashEvent[];
  outcomes: Record<string, WaveOutcome>;
}

export interface SuddenDeath {
  teamA: string;
  teamB: string;
  votesA: Record<string, SdAction>;
  votesB: Record<string, SdAction>;
  stanceA: SdAction | null;
  stanceB: SdAction | null;
  resolved: boolean;
  winnerTeamId: string | null;
  text: string | null;
}

export interface R3State {
  teams: Record<string, R3Team>;
  /** Votes of the current wave: teamId -> playerId -> vessel. Reset at the start of each wave. */
  votes: Record<string, Record<string, Vessel>>;
  /** Armed Stygian Leash of the current wave: holder teamId -> target teamId. */
  leash: Record<string, string>;
  reports: WaveReport[];
  escapeOrder: string[];
  sd: SuddenDeath | null;
  sdHistory: SuddenDeath[];
}

export interface ReturnTo {
  phase: Phase;
  step: Step;
  clash: number;
  wave: number;
  remainingMs: number | null;
}

export interface PhaseLogEntry {
  seq: number;
  phase: Phase;
  step: Step;
  clash: number;
  wave: number;
  at: number;
}

export interface GameState {
  version: number;
  phaseSeq: number;
  /** mulberry32 state */
  rng: number;
  idCounter: number;
  phase: Phase;
  step: Step;
  clash: number;
  wave: number;
  phaseStartedAt: number;
  endsAt: number | null;
  pausedAt: number | null;
  returnTo: ReturnTo | null;
  phaseLog: PhaseLogEntry[];
  config: Durations;
  players: Record<string, Player>;
  playerOrder: string[];
  teams: Record<string, Team>;
  teamOrder: string[];
  r1: { startedAt: number | null; closed: boolean };
  r2: {
    matches: Record<string, Match>;
    matchOfTeam: Record<string, string>;
    moral: Record<string, Moral>;
  };
  r3: R3State | null;
  /** Bounded ring of applied commandIds (oldest first). */
  applied: string[];
}

// ---- handler plumbing -------------------------------------------------------

export type HandlerResult = { error: ErrorCode } | { noop: true } | undefined;
export type Handler = (d: GameState, c: Command, now: number, ev: GameEvent[]) => HandlerResult;

export function fail(error: ErrorCode): { error: ErrorCode } {
  return { error };
}
export const NOOP: { noop: true } = { noop: true };
