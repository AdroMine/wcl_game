// Structural validation of a GameState that came from outside (a snapshot file, Supabase, an admin
// upload). It is deliberately strict about shape and cross references, because a malformed state
// would otherwise crash the view builder in the middle of a game.
import { PHASES } from '../../shared/protocol.ts';
import type { GameState } from '../engine/index.ts';

const STEPS = new Set([null, 'BRIEFING', 'HUDDLE', 'PARLEY', 'VOTE', 'DEBRIEF', 'BLUFF', 'REVEAL', 'SUDDEN_DEATH']);

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const numOrNull = (v: unknown): boolean => v === null || isNum(v);

/** Returns an error message, or null when the value looks like a GameState. */
export function gameStateProblem(v: unknown): string | null {
  if (!isObj(v)) return 'state must be an object';
  for (const k of ['version', 'phaseSeq', 'rng', 'idCounter', 'clash', 'wave', 'phaseStartedAt'] as const) {
    if (!isNum(v[k])) return `${k} must be a number`;
  }
  if (!isStr(v.phase) || !(PHASES as readonly string[]).includes(v.phase)) return 'unknown phase';
  if (!STEPS.has(v.step as never)) return 'unknown step';
  if (!numOrNull(v.endsAt)) return 'endsAt must be a number or null';
  if (!numOrNull(v.pausedAt)) return 'pausedAt must be a number or null';
  if (!Array.isArray(v.phaseLog)) return 'phaseLog must be an array';
  if (!Array.isArray(v.applied) || !v.applied.every(isStr)) return 'applied must be an array of strings';
  if (v.returnTo !== null && !isObj(v.returnTo)) return 'returnTo must be an object or null';

  const c = v.config;
  if (!isObj(c) || !isNum(c.r1Seconds) || !isNum(c.sdSeconds) || !isObj(c.r2) || !isObj(c.r3)) return 'config malformed';
  for (const k of ['VOTE', 'DEBRIEF']) if (!isNum((c.r2 as Record<string, unknown>)[k])) return `config.r2.${k} malformed`;
  for (const k of ['VOTE', 'REVEAL']) if (!isNum((c.r3 as Record<string, unknown>)[k])) return `config.r3.${k} malformed`;

  const { players, teams } = v;
  if (!isObj(players) || !isObj(teams)) return 'players and teams must be objects';
  if (!Array.isArray(v.playerOrder) || !v.playerOrder.every(id => isStr(id) && Object.hasOwn(players, id))) return 'playerOrder malformed';
  if (!Array.isArray(v.teamOrder) || !v.teamOrder.every(id => isStr(id) && Object.hasOwn(teams, id))) return 'teamOrder malformed';
  if (v.playerOrder.length !== Object.keys(players).length) return 'playerOrder does not match players';
  if (v.teamOrder.length !== Object.keys(teams).length) return 'teamOrder does not match teams';
  for (const [id, p] of Object.entries(players)) {
    if (!isObj(p) || p.id !== id || !isStr(p.name) || !isStr(p.tokenHash) || !isNum(p.joinedSeq)) return `player ${id} malformed`;
    if (p.teamId !== null) {
      if (!isStr(p.teamId) || !Object.hasOwn(teams, p.teamId)) return `player ${id} points at a missing team`;
      const t = teams[p.teamId] as Record<string, unknown>;
      if (!Array.isArray(t.playerIds) || !t.playerIds.includes(id)) return `player ${id} is not listed by its team`;
    }
  }
  for (const [id, t] of Object.entries(teams)) {
    if (!isObj(t) || t.id !== id || !isStr(t.name) || !isStr(t.emojiCode) || (t.battleCode !== undefined && !isStr(t.battleCode))) return `team ${id} malformed`;
    for (const k of ['r1Points', 'r2Points', 'adminAdjust', 'score'] as const) if (!isNum(t[k])) return `team ${id}.${k} malformed`;
    if (!Array.isArray(t.playerIds) || !t.playerIds.every(pid => isStr(pid) && Object.hasOwn(players, pid) && (players[pid] as Record<string, unknown>).teamId === id)) {
      return `team ${id} members malformed`;
    }
    if (t.r1 !== null) {
      const r = t.r1;
      if (!isObj(r) || !isStr(r.codeword) || !isObj(r.slots) || !Array.isArray(r.hintsTaken) || !isObj(r.hintTexts)) return `team ${id}.r1 malformed`;
      if (r.wrong !== undefined && (!isObj(r.wrong) || !isNum(r.wrong.count) || !Array.isArray(r.wrong.log))) return `team ${id}.r1.wrong malformed`;
    }
  }
  if (!isObj(v.r1)) return 'r1 malformed';
  const r2 = v.r2;
  if (!isObj(r2) || !isObj(r2.matches) || !isObj(r2.matchOfTeam) || !isObj(r2.moral)) return 'r2 malformed';
  if (r2.bye !== undefined && !isObj(r2.bye)) return 'r2.bye malformed';
  for (const [id, m] of Object.entries(r2.matches)) {
    if (!isObj(m) || m.id !== id || !isStr(m.teamA) || !isStr(m.teamB) || !Array.isArray(m.clashes)) return `match ${id} malformed`;
    if (!Object.hasOwn(teams, m.teamA as string) && !m.cancelled) return `match ${id} points at a missing team`;
    for (const cl of m.clashes) if (!isObj(cl) || !isObj(cl.votesA) || !isObj(cl.votesB) || !isNum(cl.clash)) return `match ${id} has a malformed clash`;
  }
  const r3 = v.r3;
  if (r3 !== null) {
    if (!isObj(r3) || !isObj(r3.teams) || !isObj(r3.votes) || !isObj(r3.leash) || !Array.isArray(r3.reports) || !Array.isArray(r3.escapeOrder)) return 'r3 malformed';
    if (r3.voteLog !== undefined && !Array.isArray(r3.voteLog)) return 'r3.voteLog malformed';
    for (const [id, t] of Object.entries(r3.teams)) if (!isObj(t) || !isNum(t.distance) || typeof t.escaped !== 'boolean') return `r3 team ${id} malformed`;
    for (const rep of r3.reports) if (!isObj(rep) || !isObj(rep.outcomes) || !Array.isArray(rep.leashEvents)) return 'r3 report malformed';
  }
  return null;
}

export function isGameState(v: unknown): v is GameState {
  return gameStateProblem(v) === null;
}
