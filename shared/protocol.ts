// The wire protocol shared by the game server and the web client.
// This is the ONLY module both sides import: it must stay free of Node imports and of any
// dependency. Validation is hand-written (it stands in for zod, see CLAUDE.md).

export const PROTOCOL_VERSION = 1;

// ---- identifiers and limits -------------------------------------------------

export const LIMITS = {
  /** Display names of players. */
  name: 24,
  teamName: 32,
  answer: 64,
  emojiCode: 32,
  commandId: 128,
  playerIdMin: 6,
  playerId: 64,
  /** The client-chosen secret: random, at least 128 bits (22 base64url or 32 hex characters). */
  tokenMin: 22,
  tokenMax: 128,
  commandBodyBytes: 8 * 1024,
  /** Hard ceiling for a view sent to a phone. */
  viewBytes: 4096,
} as const;

/** Crew size N (RULE_DECISIONS Q11): set by the admin in the lobby. */
export const CREW_SIZE_MIN = 3;
export const CREW_SIZE_MAX = 6;
export const CREW_SIZE_DEFAULT = 5;

export const ROLE_IDS = ['navigator', 'oracle', 'scholar', 'torchbearer', 'negotiator'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const PHASES = [
  'LOBBY',
  'R1_ACTIVE',
  'R1_RESULTS',
  'R2_PAIRING',
  'R2_CLASH',
  'R2_RESULTS',
  'R3_ACTIVE',
  'R3_RESULTS',
  'FINISHED',
] as const;
export type PhaseName = (typeof PHASES)[number];
/**
 * BRIEFING is the server-timed story step at the start of R1_ACTIVE, of R2_CLASH (before clash 1's HUDDLE) and of
 * R3_ACTIVE (before wave 1's BLUFF). No submissions or votes are accepted and the round's real clock has not started.
 */
export type StepName = 'BRIEFING' | 'HUDDLE' | 'PARLEY' | 'VOTE' | 'DEBRIEF' | 'BLUFF' | 'REVEAL' | 'SUDDEN_DEATH';

export type Stance = 'TRUCE' | 'AMBUSH';
export type Vessel = 'ROWBOAT' | 'SAILBOAT' | 'GHOST_SHIP';
export type SdAction = 'SHIELDS' | 'RAM' | 'SAILS';
export type MoralStatus = 'HONOURABLE' | 'BETRAYED' | 'AGGRESSOR' | 'BLOOD_FEUD' | 'NONE';

// ---- error codes ------------------------------------------------------------

/** Codes produced by the game engine (kept in sync with server/engine/types.ts by a test). */
export const ENGINE_ERROR_CODES = [
  'INVALID_PAYLOAD',
  'UNKNOWN_COMMAND',
  'FORBIDDEN',
  'UNKNOWN_PLAYER',
  'UNKNOWN_TEAM',
  'NOT_IN_TEAM',
  'ALREADY_IN_TEAM',
  'WRONG_PHASE',
  'PAUSED',
  'ALREADY_PAUSED',
  'NOT_PAUSED',
  'TEAM_FULL',
  'ROLE_TAKEN',
  'UNKNOWN_CODE',
  'INVALID_CODE',
  'OWN_CODE',
  'ALREADY_PAIRED',
  'NO_CODES_LEFT',
  'WRONG_ANSWER',
  'HINT_LOCKED',
  'ROUND_CLOSED',
  'NOT_PLAYING',
  'VOTE_CLOSED',
  'ALREADY_ESCAPED',
  'NO_LEASH',
  'INVALID_TARGET',
  'TARGET_ESCAPED',
  'NOT_TIMED',
  'NOT_DUE',
  'STALE',
  'INVALID_DURATION',
  'SAME_TEAM',
  'NOT_IN_DUEL',
  'NO_STANDOFF',
  'NOT_PAIRED',
] as const;

/** Codes produced by the transport layer. */
export const TRANSPORT_ERROR_CODES = ['BAD_REQUEST', 'UNAUTHORIZED', 'RATE_LIMITED', 'PAYLOAD_TOO_LARGE'] as const;

export const ERROR_CODES = [...ENGINE_ERROR_CODES, ...TRANSPORT_ERROR_CODES] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];
export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Short messages the UI may show as a fallback. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_PAYLOAD: 'That did not look right.',
  UNKNOWN_COMMAND: 'Unknown action.',
  FORBIDDEN: 'Not allowed.',
  UNKNOWN_PLAYER: 'Player not found.',
  UNKNOWN_TEAM: 'Team not found.',
  NOT_IN_TEAM: 'You are not in a team.',
  ALREADY_IN_TEAM: 'You are already in a team.',
  WRONG_PHASE: 'Not available right now.',
  PAUSED: 'The game is paused.',
  ALREADY_PAUSED: 'Already paused.',
  NOT_PAUSED: 'Not paused.',
  TEAM_FULL: 'That team is full.',
  ROLE_TAKEN: 'Your role is already taken in that team.',
  UNKNOWN_CODE: 'No team has that code.',
  INVALID_CODE: 'That code is not valid.',
  OWN_CODE: 'That is your own code.',
  ALREADY_PAIRED: 'Already paired.',
  NO_CODES_LEFT: 'No team codes left.',
  WRONG_ANSWER: 'Not the codeword.',
  HINT_LOCKED: 'That hint is not unlocked yet.',
  ROUND_CLOSED: 'The round is closed.',
  NOT_PLAYING: 'Your team is not playing this round.',
  VOTE_CLOSED: 'Voting is closed.',
  ALREADY_ESCAPED: 'Your crew has already escaped.',
  NO_LEASH: 'You have no Stygian Leash.',
  INVALID_TARGET: 'Invalid target.',
  TARGET_ESCAPED: 'That crew has already escaped.',
  NOT_TIMED: 'This step has no timer.',
  NOT_DUE: 'Not due yet.',
  STALE: 'Out of date.',
  INVALID_DURATION: 'Invalid duration.',
  SAME_TEAM: 'Pick two different teams.',
  NOT_IN_DUEL: 'Your crew is not in the standoff.',
  NO_STANDOFF: 'No standoff is running.',
  NOT_PAIRED: 'Your team has no rival.',
  BAD_REQUEST: 'Malformed request.',
  UNAUTHORIZED: 'Not authorised.',
  RATE_LIMITED: 'Slow down.',
  PAYLOAD_TOO_LARGE: 'Request too large.',
};

// ---- commands ---------------------------------------------------------------

export const PLAYER_COMMAND_TYPES = [
  'JOIN',
  'LEAVE_GAME',
  'REROLL_ROLE',
  'CREATE_TEAM',
  'JOIN_TEAM',
  'LEAVE_TEAM',
  'RENAME_TEAM',
  'R1_SUBMIT',
  'R1_HINT',
  'R2_PAIR',
  'R2_VOTE',
  'R3_VOTE',
  'R3_ARM_LEASH',
  'SD_VOTE',
] as const;
export type PlayerCommandType = (typeof PLAYER_COMMAND_TYPES)[number];

export interface PlayerCommandPayloads {
  JOIN: { name?: string };
  LEAVE_GAME: Record<string, never>;
  REROLL_ROLE: Record<string, never>;
  CREATE_TEAM: { name?: string };
  JOIN_TEAM: { code: string };
  LEAVE_TEAM: Record<string, never>;
  RENAME_TEAM: { name: string };
  R1_SUBMIT: { answer: string };
  R1_HINT: { hint: 1 | 2 | 3 };
  R2_PAIR: { code: string };
  R2_VOTE: { vote: Stance };
  R3_VOTE: { vessel: Vessel };
  R3_ARM_LEASH: Record<string, never>;
  SD_VOTE: { action: SdAction };
}

export interface CommandEnvelope<T extends string = string, P = unknown> {
  commandId: string;
  playerId: string;
  token: string;
  type: T;
  payload: P;
}

/** The body of POST /api/command; also the shape the client builds. */
export type PlayerCommand = {
  [K in PlayerCommandType]: CommandEnvelope<K, PlayerCommandPayloads[K]>;
}[PlayerCommandType];

/** Response of POST /api/command and POST /api/admin/command. */
export interface CommandResult {
  ok: boolean;
  /** State version after the command (also returned for duplicates and for rejected commands). */
  v: number;
  error?: ErrorCode;
  message?: string;
}

// ---- hand-written validators ------------------------------------------------

export type Validated<T> = { ok: true; value: T } | { ok: false; error: 'BAD_REQUEST'; message: string };

const bad = (message: string): { ok: false; error: 'BAD_REQUEST'; message: string } => ({ ok: false, error: 'BAD_REQUEST', message });

const ID_RE = /^[A-Za-z0-9_-]+$/;
const COMMAND_ID_RE = /^[A-Za-z0-9_.:~-]+$/;
const TOKEN_RE = /^[A-Za-z0-9_\-+/=.~]+$/;
// control characters, zero-width characters and bidirectional overrides
// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Trim, drop control and bidi characters, collapse whitespace, cap the length. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(STRIP_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isValidPlayerId(v: unknown): v is string {
  // `in Object.prototype` rejects '__proto__', 'constructor', 'toString' and friends, which would collide with plain-object state maps.
  return typeof v === 'string' && v.length >= LIMITS.playerIdMin && v.length <= LIMITS.playerId && ID_RE.test(v) && !(v in Object.prototype);
}

export function isValidToken(v: unknown): v is string {
  return typeof v === 'string' && v.length >= LIMITS.tokenMin && v.length <= LIMITS.tokenMax && TOKEN_RE.test(v);
}

export function isValidCommandId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= LIMITS.commandId && COMMAND_ID_RE.test(v);
}

function noExtra(o: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(o).every(k => allowed.includes(k));
}

/** Validate (and normalise) the payload of one player command type. */
export function validatePlayerPayload(type: string, payload: unknown): Validated<unknown> {
  const o = payload === undefined || payload === null ? {} : payload;
  if (!isObj(o)) return bad('payload must be an object');
  switch (type) {
    case 'JOIN': {
      if (!noExtra(o, ['name'])) return bad('unexpected field');
      if (o.name !== undefined && typeof o.name !== 'string') return bad('name must be a string');
      const name = cleanText(o.name, LIMITS.name);
      return { ok: true, value: name ? { name } : {} };
    }
    case 'CREATE_TEAM': {
      if (!noExtra(o, ['name'])) return bad('unexpected field');
      if (o.name !== undefined && typeof o.name !== 'string') return bad('name must be a string');
      const name = cleanText(o.name, LIMITS.teamName);
      return { ok: true, value: name ? { name } : {} };
    }
    case 'RENAME_TEAM': {
      if (!noExtra(o, ['name'])) return bad('unexpected field');
      const name = cleanText(o.name, LIMITS.teamName);
      if (!name) return bad('name required');
      return { ok: true, value: { name } };
    }
    case 'LEAVE_GAME':
    case 'REROLL_ROLE':
    case 'LEAVE_TEAM':
    case 'R3_ARM_LEASH':
      if (Object.keys(o).length > 0) return bad('payload must be empty');
      return { ok: true, value: {} };
    case 'JOIN_TEAM': {
      if (!noExtra(o, ['code'])) return bad('unexpected field');
      const code = cleanText(o.code, LIMITS.emojiCode);
      if (!code) return bad('code required');
      return { ok: true, value: { code } };
    }
    case 'R1_SUBMIT': {
      if (!noExtra(o, ['answer'])) return bad('unexpected field');
      const answer = cleanText(o.answer, LIMITS.answer);
      if (!answer) return bad('answer required');
      return { ok: true, value: { answer } };
    }
    case 'R1_HINT': {
      if (!noExtra(o, ['hint'])) return bad('unexpected field');
      if (o.hint !== 1 && o.hint !== 2 && o.hint !== 3) return bad('hint must be 1, 2 or 3');
      return { ok: true, value: { hint: o.hint } };
    }
    case 'R2_PAIR': {
      if (!noExtra(o, ['code'])) return bad('unexpected field');
      const code = typeof o.code === 'string' ? o.code.trim() : '';
      if (!/^\d{2}$/.test(code)) return bad('code must be two digits');
      return { ok: true, value: { code } };
    }
    case 'R2_VOTE':
      if (!noExtra(o, ['vote'])) return bad('unexpected field');
      if (o.vote !== 'TRUCE' && o.vote !== 'AMBUSH') return bad('vote must be TRUCE or AMBUSH');
      return { ok: true, value: { vote: o.vote } };
    case 'R3_VOTE':
      if (!noExtra(o, ['vessel'])) return bad('unexpected field');
      if (o.vessel !== 'ROWBOAT' && o.vessel !== 'SAILBOAT' && o.vessel !== 'GHOST_SHIP') return bad('unknown vessel');
      return { ok: true, value: { vessel: o.vessel } };
    case 'SD_VOTE':
      if (!noExtra(o, ['action'])) return bad('unexpected field');
      if (o.action !== 'SHIELDS' && o.action !== 'RAM' && o.action !== 'SAILS') return bad('unknown action');
      return { ok: true, value: { action: o.action } };
    default:
      return bad('unknown command type');
  }
}

/** Validate a whole POST /api/command body. */
export function validateCommandEnvelope(body: unknown): Validated<CommandEnvelope> {
  if (!isObj(body)) return bad('body must be a JSON object');
  if (!noExtra(body, ['commandId', 'playerId', 'token', 'type', 'payload'])) return bad('unexpected field');
  if (!isValidCommandId(body.commandId)) return bad('invalid commandId');
  if (!isValidPlayerId(body.playerId)) return bad('invalid playerId');
  if (!isValidToken(body.token)) return bad('invalid token');
  if (typeof body.type !== 'string' || !(PLAYER_COMMAND_TYPES as readonly string[]).includes(body.type)) return bad('unknown command type');
  const p = validatePlayerPayload(body.type, body.payload);
  if (!p.ok) return p;
  return { ok: true, value: { commandId: body.commandId, playerId: body.playerId, token: body.token, type: body.type, payload: p.value } };
}

/** Body of POST /api/admin/command. commandId is optional (the server generates one). */
export interface AdminCommandBody {
  commandId?: string;
  type: string;
  payload?: unknown;
}

export function validateAdminBody(body: unknown): Validated<AdminCommandBody> {
  if (!isObj(body)) return bad('body must be a JSON object');
  if (!noExtra(body, ['commandId', 'type', 'payload'])) return bad('unexpected field');
  if (body.commandId !== undefined && !isValidCommandId(body.commandId)) return bad('invalid commandId');
  if (typeof body.type !== 'string' || !/^ADMIN_[A-Z0-9_]{1,48}$/.test(body.type)) return bad('invalid type');
  if (body.payload !== undefined && body.payload !== null && !isObj(body.payload)) return bad('payload must be an object');
  const p = validateAdminPayload(body.type, body.payload);
  if (!p.ok) return p;
  return { ok: true, value: { commandId: body.commandId as string | undefined, type: body.type, payload: p.value } };
}

/** Payload validators for admin commands that take structured input (the engine re-checks everything). */
export function validateAdminPayload(type: string, payload: unknown): Validated<unknown> {
  const o = payload === undefined || payload === null ? {} : payload;
  if (!isObj(o)) return bad('payload must be an object');
  if (type === 'ADMIN_SET_CREW_SIZE') {
    if (!noExtra(o, ['size'])) return bad('unexpected field');
    if (typeof o.size !== 'number' || !Number.isInteger(o.size) || o.size < CREW_SIZE_MIN || o.size > CREW_SIZE_MAX) {
      return bad(`size must be an integer from ${CREW_SIZE_MIN} to ${CREW_SIZE_MAX}`);
    }
    return { ok: true, value: { size: o.size } };
  }
  return { ok: true, value: o };
}

/** Helpers for clients that generate their own identity. */
export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- views ------------------------------------------------------------------

export interface PhaseView {
  name: PhaseName;
  step: StepName | null;
  clash: number;
  wave: number;
  /** Absolute server time (ms since epoch) at which the step ends; null if untimed. */
  endsAt: number | null;
  paused: boolean;
  /** Only during the BRIEFING step: absolute server time (ms) at which the briefing started (it ends at `endsAt`). */
  startedAt?: number;
  /** Only while paused: the clock is frozen at this server time. */
  pausedAt?: number;
  /** Only while paused: milliseconds left in the step. */
  pausedRemainingMs?: number;
}

export interface MeView {
  id: string;
  name: string;
  role: RoleId;
  joinedTeam: boolean;
  /**
   * Round 1 only: this player's own piece of the crew's tablet: piece `slot` of `slotCount` (0-based, left to right).
   * slotCount always equals the crew's current member count and every member holds a distinct slot; both are
   * recomputed if crew membership changes during Round 1.
   */
  slot?: number;
  slotCount?: number;
  /** The player's own vote in the current clash, wave or standoff. */
  myVote?: string;
}

export interface TeamView {
  id: string;
  name: string;
  emojiCode: string;
  battleCode: string;
  members: { name: string; role: RoleId }[];
  missingRoles: RoleId[];
  score: number;
  /** 1-based rank by score. */
  rank: number;
}

export interface R1View {
  /** The crew's codeword split into the two tablet lines (own crew only, R1_ACTIVE only; draw slice `me.slot` of `me.slotCount`). */
  tablet?: { line1: string; line2: string };
  solved: boolean;
  points: number;
  closed: boolean;
  hints: { index: number; unlocksAt: number; taken: boolean; text?: string }[];
}

export interface R2View {
  paired: boolean;
  rival?: { name: string; battleCode: string };
  /**
   * Resolved clashes only. `myVotes` reveals how each teammate voted once the clash is scored: one character per member of
   * `team.members` in the same order: 'T' truce, 'A' ambush, '-' did not vote.
   */
  clashes: { clash: number; myStance: Stance; rivalStance: Stance; myPts: number; rivalPts: number; myVotes: string }[];
  /** Teammates who have voted in the running vote step (never what they voted). */
  votedCount?: number;
  /** VOTE step only: who has voted, aligned with `team.members` (never what they voted). */
  votedBy?: boolean[];
  teamSize: number;
  moral?: MoralStatus;
}

export interface R3View {
  distance: number;
  escaped: boolean;
  escapedRank?: number;
  activeCrews: number;
  escapedCount: number;
  sailboatCapacity: number;
  votedCount?: number;
  teamSize: number;
  /** True when this crew holds the Honourable head start (Winds of Olympus, `meta.r3.honourBonus` metres). */
  honourable?: boolean;
  leash?: { available: boolean; targetName: string | null; armed: boolean };
  /** Compact fleet rows: [name, distance, escapedRank (0 = still on the river), vessel code R/S/G or ''] */
  fleet: [string, number, number, string][];
  /** 1-based position of my crew on the river (escaped crews first). */
  myPos?: number;
  /** My crew's outcome in the last resolved wave (from REVEAL on). */
  lastWave?: {
    wave: number;
    vessel: Vessel;
    gained: number;
    leashDelta: number;
    sailboatCapsized: boolean;
    ghostCollided: boolean;
    capacity: number;
    /**
     * All-crews report of that wave: [vessel code 'R'|'S'|'G', crews that boarded, outcome, metres per boarding crew].
     * Always three rows in order Rowboat, Sailboat, Ghost Ship.
     */
    vessels: [string, number, 'SAFE' | 'CAPSIZED' | 'COLLIDED' | 'UNBOARDED', number][];
    /** Every leash event of that wave that involves this crew (as holder or target). */
    leashes?: { kind: string; delta: number; otherName: string; role: 'holder' | 'target' }[];
  };
  sd?: { teamA: string; teamB: string; mine: boolean; votedCount?: number; resolved: boolean; winner?: string | null; text?: string | null };
  podium?: string[];
}

export interface View {
  /** Server instance id: when it changes the server restarted; accept any v. */
  sid: string;
  /** State version. Monotonic within one sid. */
  v: number;
  serverNow: number;
  phase: PhaseView;
  /** Absent when the playerId/token pair is unknown: show the join screen. */
  me?: MeView;
  team?: TeamView;
  r1?: R1View;
  r2?: R2View;
  r3?: R3View;
  /** LOBBY only. `crewSize` is the admin's current maximum crew size N (3..6, default 5). */
  lobby?: { players: number; teams: number; crewSize: number };
  /** Top 10 teams: [name, score]. */
  board: [string, number][];
  boardTotal: number;
  notice?: string;
}

export interface ScreenView {
  sid: string;
  v: number;
  serverNow: number;
  phase: PhaseView;
  title: string;
  instruction: string;
  board: [string, number][];
  fleet?: [string, number, number, string][];
  podium?: string[];
  counts: { players: number; teams: number };
  joinUrl?: string;
  /** LOBBY only: the admin's current maximum crew size N. */
  lobby?: { crewSize: number };
  notice?: string;
}

/** Event names used on the SSE streams. Views are sent as unnamed (message) events. */
export const SSE_EVENT_RESYNC = 'resync';

// ---- static metadata (GET /api/meta) ------------------------------------------

export interface BriefingRule {
  title: string;
  desc: string;
}
export interface Briefing {
  /** Server-timed length of the round's BRIEFING step: ceil(sentences * 2.8 + 3 + (rules + 1) * 2 + 3). Filled in by GET /api/meta. */
  briefingSeconds?: number;
  stageNumber: number;
  title: string;
  subtitle: string;
  sentences: string[];
  rules: BriefingRule[];
  objective: string;
}

export interface Meta {
  protocol: number;
  limits: typeof LIMITS;
  roles: { id: RoleId; name: string; color: string; icon: string; description: string }[];
  emojiPool: string[];
  teamSize: { min: number; target: number; max: number };
  durations: {
    r1Seconds: number;
    r2: { HUDDLE: number; PARLEY: number; VOTE: number; DEBRIEF: number };
    r3: { BLUFF: number; VOTE: number; REVEAL: number };
    sdSeconds: number;
    crewSize: number;
  };
  rounds: Briefing[];
  /** Round 2 points per clash. */
  r2Stakes: { clash: number; bothTruce: number; ambushWin: number; truceLoss: number; bothAmbush: number }[];
  vessels: { id: Vessel; name: string; icon: string; success: number; fail: number; note: string }[];
  stances: { id: Stance; name: string }[];
  sdActions: { id: SdAction; name: string }[];
  moralStatuses: { id: MoralStatus; name: string; note: string }[];
  hints: { index: number; unlocksAfterSeconds: number; cost: number }[];
  r3: { targetDistance: number; podiumSize: number; honourBonus: number };
  errors: Record<string, string>;
  /** Phase/step instruction lines shown on the projector and usable as a banner on phones. */
  instructions: Record<string, string>;
}
