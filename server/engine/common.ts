// Shared helpers for command handlers: payload validation and team/player bookkeeping.
import { CREW_SIZE_DEFAULT, CREW_SIZE_MAX, CREW_SIZE_MIN, MAX_NAME, UNIQUE_ROLE_SLOTS } from './config.ts';
import { resyncR1Slots } from './r1slots.ts';
import type { GameState, Player, Team } from './types.ts';

/** The game's crew size N (3..6). Snapshots from before the setting existed read as the default 5. */
export function crewSizeOf(d: Pick<GameState, 'config'>): number {
  const n = (d.config as { crewSize?: unknown }).crewSize;
  return typeof n === 'number' && Number.isInteger(n) && n >= CREW_SIZE_MIN && n <= CREW_SIZE_MAX ? n : CREW_SIZE_DEFAULT;
}

/** Max members when a player creates or joins a crew: N. */
export function maxJoinSize(d: Pick<GameState, 'config'>): number {
  return crewSizeOf(d);
}

/** Max members when the admin adds or moves a player, or auto-group absorbs leftovers: N + 1. */
export function maxAdminSize(d: Pick<GameState, 'config'>): number {
  return crewSizeOf(d) + 1;
}

/** The first this-many members of a crew must have different roles. */
export function uniqueRoleSlots(d: Pick<GameState, 'config'>): number {
  return Math.min(crewSizeOf(d), UNIQUE_ROLE_SLOTS);
}

export function asObj(payload: unknown): Record<string, unknown> | null {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export function reqString(o: Record<string, unknown> | null, key: string, max = 256): string | null {
  if (!o) return null;
  const v = o[key];
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}

export function optString(o: Record<string, unknown> | null, key: string, max = 256): string | null | undefined {
  if (!o || o[key] === undefined || o[key] === null) return undefined;
  const v = o[key];
  if (typeof v !== 'string' || v.length > max) return null;
  return v;
}

export function reqInt(o: Record<string, unknown> | null, key: string): number | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
}

/** Trim and clamp a display name. Returns '' if unusable. */
export function cleanName(v: unknown, max = MAX_NAME): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function recomputeScore(t: Team): void {
  t.score = t.r1Points + t.r2Points + t.adminAdjust;
}

export function teamOfPlayer(d: GameState, p: Player): Team | null {
  return p.teamId ? (d.teams[p.teamId] ?? null) : null;
}

export function rankEscapees(d: GameState): void {
  if (!d.r3) return;
  d.r3.escapeOrder.forEach((tid, i) => {
    const t = d.r3!.teams[tid];
    if (t) t.escapeRank = i + 1;
  });
}

/** Remove a team entirely (members become unassigned) and clean every reference to it. */
export function removeTeam(d: GameState, teamId: string): void {
  const team = d.teams[teamId];
  if (!team) return;
  for (const pid of team.playerIds) {
    const p = d.players[pid];
    if (p) p.teamId = null;
  }
  delete d.teams[teamId];
  d.teamOrder = d.teamOrder.filter(id => id !== teamId);

  const mid = d.r2.matchOfTeam[teamId];
  if (mid) {
    const m = d.r2.matches[mid];
    delete d.r2.matchOfTeam[teamId];
    if (m) {
      if (m.clashes.length === 0) {
        // Not started yet: drop the pairing entirely.
        delete d.r2.matches[mid];
        const other = m.teamA === teamId ? m.teamB : m.teamA;
        if (d.r2.matchOfTeam[other] === mid) delete d.r2.matchOfTeam[other];
      } else {
        m.cancelled = true;
      }
    }
  }
  delete d.r2.moral[teamId];

  const r3 = d.r3;
  if (r3) {
    delete r3.teams[teamId];
    delete r3.votes[teamId];
    delete r3.leash[teamId];
    for (const h of Object.keys(r3.leash)) if (r3.leash[h] === teamId) delete r3.leash[h];
    if (r3.escapeOrder.includes(teamId)) {
      r3.escapeOrder = r3.escapeOrder.filter(id => id !== teamId);
      rankEscapees(d);
    }
    if (r3.sd && !r3.sd.resolved && (r3.sd.teamA === teamId || r3.sd.teamB === teamId)) {
      r3.sd.resolved = true;
      r3.sd.text = 'Standoff cancelled: a contender was removed.';
      r3.sd.winnerTeamId = null;
    }
  }
}

/** Detach a player from their team (deleting the team if it becomes empty). */
export function detachPlayer(d: GameState, p: Player): void {
  const tid = p.teamId;
  if (!tid) return;
  const team = d.teams[tid];
  p.teamId = null;
  if (!team) return;
  team.playerIds = team.playerIds.filter(id => id !== p.id);
  if (team.playerIds.length === 0) removeTeam(d, tid);
  else resyncR1Slots(d, team);
}
