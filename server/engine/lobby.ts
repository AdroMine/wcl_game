// Lobby: join, leave, teams (create / join by emoji code / leave /
// rename) and admin auto-grouping. Behaviour ported from src/lib/supabaseService.ts
// (supabaseJoinPlayer, supabaseCreateTeam, supabaseJoinTeamByEmoji,
// supabaseLeaveTeam, supabaseAdminAutoGroup) and src/components/LobbyTeamFormation.tsx.
import { MAX_TEAM_NAME } from './config.ts';
import { asObj, cleanName, crewSizeOf, detachPlayer, maxJoinSize, recomputeScore, reqString } from './common.ts';
import { resyncR1Slots } from './r1slots.ts';
import { nextId, nextNumber } from './ids.ts';
import { rngShuffle } from './rng.ts';
import { generateTeamEmojiCode, normalizeEmojiCode } from './teamCodes.ts';
import type { GameEvent, GameState, Handler, Player, Team } from './types.ts';
import { NOOP, fail } from './types.ts';

export function findTeamByEmoji(d: GameState, code: string): Team | null {
  const target = normalizeEmojiCode(code);
  if (!target) return null;
  for (const tid of d.teamOrder) {
    const t = d.teams[tid];
    if (normalizeEmojiCode(t.emojiCode) === target) return t;
  }
  return null;
}

/** Create a team with fresh unique codes. Returns null if codes are exhausted. */
export function createTeamRecord(d: GameState, name: string): Team | null {
  const emojis = new Set<string>();
  for (const tid of d.teamOrder) {
    emojis.add(d.teams[tid].emojiCode);
  }
  const emojiCode = generateTeamEmojiCode(d, emojis);
  if (!emojiCode) return null;
  const id = nextId(d, 't');
  const team: Team = {
    id,
    name,
    emojiCode,
    playerIds: [],
    r1Points: 0,
    r2Points: 0,
    adminAdjust: 0,
    score: 0,
    r1: null,
  };
  recomputeScore(team);
  d.teams[id] = team;
  d.teamOrder.push(id);
  return team;
}

export function addToTeam(d: GameState, team: Team, p: Player): void {
  team.playerIds.push(p.id);
  p.teamId = team.id;
  resyncR1Slots(d, team);
}

const join: Handler = (d, c, _now, ev) => {
  const o = asObj(c.payload);
  const id = reqString(o, 'playerId', 64);
  const tokenHash = reqString(o, 'tokenHash', 256);
  if (!id || !tokenHash) return fail('INVALID_PAYLOAD');
  if (c.actor.kind !== 'player' || c.actor.playerId !== id) return fail('FORBIDDEN');
  const name = cleanName(o!.name);
  const existing = d.players[id];
  if (existing) {
    // Re-join only updates the display name.
    if (name && name !== existing.name) {
      existing.name = name;
      ev.push({ type: 'PLAYER_RENAMED', playerId: id });
      return undefined;
    }
    return NOOP;
  }
  const n = nextNumber(d);
  d.players[id] = {
    id,
    name: name || `Shade-${n}`,
    tokenHash,
    teamId: null,
    joinedSeq: n,
  };
  d.playerOrder.push(id);
  ev.push({ type: 'PLAYER_JOINED', playerId: id });
  return undefined;
};

function requireLobby(d: GameState) {
  return d.phase === 'LOBBY' ? undefined : fail('WRONG_PHASE');
}

const leaveGame: Handler = (d, c, _now, ev) => {
  const bad = requireLobby(d);
  if (bad) return bad;
  const p = d.players[(c.actor as { playerId: string }).playerId];
  removePlayer(d, p);
  ev.push({ type: 'PLAYER_LEFT', playerId: p.id });
  return undefined;
};

export function removePlayer(d: GameState, p: Player): void {
  detachPlayer(d, p);
  delete d.players[p.id];
  d.playerOrder = d.playerOrder.filter(id => id !== p.id);
}

const createTeam: Handler = (d, c, _now, ev) => {
  const bad = requireLobby(d);
  if (bad) return bad;
  const p = d.players[(c.actor as { playerId: string }).playerId];
  if (p.teamId) return fail('ALREADY_IN_TEAM');
  const o = asObj(c.payload);
  const name = cleanName(o?.name, MAX_TEAM_NAME) || `${p.name}'s Crew`;
  const team = createTeamRecord(d, name);
  if (!team) return fail('NO_CODES_LEFT');
  addToTeam(d, team, p);
  ev.push({ type: 'TEAM_CREATED', teamId: team.id });
  return undefined;
};

const joinTeam: Handler = (d, c, _now, ev) => {
  const bad = requireLobby(d);
  if (bad) return bad;
  const p = d.players[(c.actor as { playerId: string }).playerId];
  if (p.teamId) return fail('ALREADY_IN_TEAM');
  const code = reqString(asObj(c.payload), 'code', 64);
  if (!code) return fail('INVALID_PAYLOAD');
  const team = findTeamByEmoji(d, code);
  if (!team) return fail('UNKNOWN_CODE');
  if (team.playerIds.length >= maxJoinSize(d)) return fail('TEAM_FULL');
  addToTeam(d, team, p);
  ev.push({ type: 'TEAM_JOINED', teamId: team.id, playerId: p.id });
  return undefined;
};

const leaveTeam: Handler = (d, c, _now, ev) => {
  const bad = requireLobby(d);
  if (bad) return bad;
  const p = d.players[(c.actor as { playerId: string }).playerId];
  if (!p.teamId) return fail('NOT_IN_TEAM');
  const tid = p.teamId;
  detachPlayer(d, p);
  ev.push({ type: 'TEAM_LEFT', teamId: tid, playerId: p.id, disbanded: !d.teams[tid] });
  return undefined;
};

const renameTeam: Handler = (d, c, _now, ev) => {
  const bad = requireLobby(d);
  if (bad) return bad;
  const p = d.players[(c.actor as { playerId: string }).playerId];
  if (!p.teamId) return fail('NOT_IN_TEAM');
  const name = cleanName(asObj(c.payload)?.name, MAX_TEAM_NAME);
  if (!name) return fail('INVALID_PAYLOAD');
  const team = d.teams[p.teamId];
  if (team.name === name) return NOOP;
  team.name = name;
  ev.push({ type: 'TEAM_RENAMED', teamId: team.id });
  return undefined;
};

/**
 * Crew sizes for `n` unassigned players with crew size N (RULE_DECISIONS Q11): as many crews of N as
 * possible; a remainder of 2 or more forms one smaller crew (so a crew of 2 is possible); a remainder
 * of exactly 1 is not placed (the admin places that player). Returns the sizes of the NEW crews.
 */
export function planCrewSizes(n: number, N: number): number[] {
  if (n < 2) return [];
  const q = Math.floor(n / N);
  const r = n % N;
  const sizes: number[] = Array(q).fill(N);
  if (r >= 2) sizes.push(r);
  return sizes;
}

/**
 * Admin auto-group: unassigned players go into NEW crews of N (crew size setting); a remainder of 2+
 * forms one smaller crew; a single leftover stays unassigned for the admin to place. Existing crews are
 * never topped up or touched. Returns the number of players placed.
 */
export function autoGroup(d: GameState, ev: GameEvent[]): number {
  const free = d.playerOrder.filter(id => !d.players[id].teamId);
  if (free.length === 0) return 0;
  const shuffled = rngShuffle(d, free);

  const sizes = planCrewSizes(shuffled.length, crewSizeOf(d));

  let placed = 0;
  let cursor = 0;
  for (const size of sizes) {
    const team = createTeamRecord(d, `Crew #${d.teamOrder.length + 1}`);
    if (!team) break;
    for (let i = 0; i < size; i++) addToTeam(d, team, d.players[shuffled[cursor++]]);
    placed += size;
    ev.push({ type: 'TEAM_CREATED', teamId: team.id });
  }
  ev.push({ type: 'AUTO_GROUPED', placed });
  return placed;
}

export const lobbyHandlers: Record<string, Handler> = {
  JOIN: join,
  LEAVE_GAME: leaveGame,
  CREATE_TEAM: createTeam,
  JOIN_TEAM: joinTeam,
  LEAVE_TEAM: leaveTeam,
  RENAME_TEAM: renameTeam,
};
