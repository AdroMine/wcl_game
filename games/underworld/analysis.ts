// Shared, pure helpers for the end-of-game export (export.ts) and the "Underworld Wrapped" recap (recap.ts).
// They read a GameState and never change it. Server side only: no React, no I/O, no clock, no randomness,
// and only `import type` from the engine (the engine imports this disk through config.ts, so a value import
// back into the engine would be a cycle).
import type { GameState, Stance, Vessel } from '../../server/engine/types.ts';

export type ClashOutcome = 'MUTUAL_TRUCE' | 'BETRAYER' | 'BETRAYED' | 'BRAWL' | 'BYE';

/** One crew's side of one resolved clash (every match gives two of these), or a bye clash of an unpaired crew. */
export interface ClashSide {
  matchId: string | null;
  clash: number;
  teamId: string;
  rivalId: string | null;
  stance: Stance | null;
  rivalStance: Stance | null;
  pts: number;
  outcome: ClashOutcome;
}

/** From one crew's point of view: BETRAYER = it ambushed a truce, BETRAYED = it kept the truce and was ambushed. */
export function stanceOutcome(mine: Stance, theirs: Stance): Exclude<ClashOutcome, 'BYE'> {
  if (mine === 'TRUCE' && theirs === 'TRUCE') return 'MUTUAL_TRUCE';
  if (mine === 'AMBUSH' && theirs === 'TRUCE') return 'BETRAYER';
  if (mine === 'TRUCE' && theirs === 'AMBUSH') return 'BETRAYED';
  return 'BRAWL';
}

/** Every resolved clash of every match (cancelled matches keep the clashes resolved before the cancel), plus bye clashes. */
export function clashSides(s: GameState): ClashSide[] {
  const out: ClashSide[] = [];
  for (const m of Object.values(s.r2.matches)) {
    for (const c of m.clashes) {
      if (!c.resolved || !c.stanceA || !c.stanceB) continue;
      if (s.teams[m.teamA]) {
        out.push({ matchId: m.id, clash: c.clash, teamId: m.teamA, rivalId: s.teams[m.teamB] ? m.teamB : null, stance: c.stanceA, rivalStance: c.stanceB, pts: c.ptsA, outcome: stanceOutcome(c.stanceA, c.stanceB) });
      }
      if (s.teams[m.teamB]) {
        out.push({ matchId: m.id, clash: c.clash, teamId: m.teamB, rivalId: s.teams[m.teamA] ? m.teamA : null, stance: c.stanceB, rivalStance: c.stanceA, pts: c.ptsB, outcome: stanceOutcome(c.stanceB, c.stanceA) });
      }
    }
  }
  for (const [tid, got] of Object.entries(s.r2.bye ?? {})) {
    if (!s.teams[tid] || s.r2.matchOfTeam[tid]) continue;
    got.forEach((pts, i) => out.push({ matchId: null, clash: i + 1, teamId: tid, rivalId: null, stance: null, rivalStance: null, pts, outcome: 'BYE' }));
  }
  return out;
}

export interface WaveVotes {
  wave: number;
  teamId: string;
  /** One entry per crew member at that wave; `vessel` is null when the player did not vote. */
  votes: { playerId: string; vessel: Vessel | null }[];
  /** Target crew of the Stygian Leash armed that wave, if any. */
  leash: string | null;
}

const CHAR_VESSEL: Record<string, Vessel | null> = { R: 'ROWBOAT', S: 'SAILBOAT', G: 'GHOST_SHIP', '-': null };

/** Expand r3.voteLog (compact strings aligned to a roster that is carried forward) into per-player votes. */
export function decodeVoteLog(s: GameState): WaveVotes[] {
  const log = s.r3?.voteLog ?? [];
  const roster: Record<string, string[]> = {};
  const out: WaveVotes[] = [];
  for (const e of log) {
    if (e.members) roster[e.teamId] = e.members;
    const members = roster[e.teamId] ?? [];
    out.push({
      wave: e.wave,
      teamId: e.teamId,
      votes: members.map((playerId, i) => ({ playerId, vessel: CHAR_VESSEL[e.votes[i] ?? '-'] ?? null })),
      leash: e.leash ?? null,
    });
  }
  return out;
}

/** Final standings order: the same sort as the leaderboard (score, then name, then id). rank is 1-based. */
export function finalRanking(s: GameState): { teamId: string; rank: number }[] {
  const rows = s.teamOrder.map(id => s.teams[id]);
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return rows.map((t, i) => ({ teamId: t.id, rank: i + 1 }));
}

/** Server time (ms) at which the game entered FINISHED, or null when it has not. */
export function finishedAt(s: GameState): number | null {
  for (let i = s.phaseLog.length - 1; i >= 0; i--) if (s.phaseLog[i].phase === 'FINISHED') return s.phaseLog[i].at;
  return null;
}

/** Server time (ms) at which the first phase after the lobby began (the start of the game), or null. */
export function startedAt(s: GameState): number | null {
  const e = s.phaseLog.find(x => x.phase !== 'LOBBY');
  return e ? e.at : null;
}
