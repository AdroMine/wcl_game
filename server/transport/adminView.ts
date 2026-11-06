// Full admin snapshot for the control panel. Admin-only: it includes things a phone never sees
// (every team's codeword, ids, hint state, R3 state). It never includes token hashes.
import { createHash } from 'node:crypto';
import { crewSizeOf } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';

export interface AdminViewInput {
  state: GameState;
  connected: ReadonlySet<string>;
  sid: string;
  now: number;
  notice: string | null;
}

export function buildAdminView(input: AdminViewInput): { stable: string; hash: string } {
  const { state: s, connected } = input;
  const votes = (b: Record<string, string>) => Object.keys(b).length;
  const stable = {
    sid: input.sid,
    v: s.version,
    phase: { name: s.phase, step: s.step, clash: s.clash, wave: s.wave, phaseSeq: s.phaseSeq, endsAt: s.endsAt, paused: s.pausedAt != null, pausedAt: s.pausedAt, startedAt: s.phaseStartedAt },
    config: s.config,
    /** Maximum crew size N (3..6), settable in the lobby with ADMIN_SET_CREW_SIZE. */
    crewSize: crewSizeOf(s),
    notice: input.notice,
    counts: { players: s.playerOrder.length, teams: s.teamOrder.length, connected: s.playerOrder.filter(id => connected.has(id)).length },
    players: s.playerOrder.map(id => {
      const p = s.players[id];
      return { id, name: p.name, teamId: p.teamId, connected: connected.has(id), canLogin: p.tokenHash !== '' };
    }),
    teams: s.teamOrder.map(id => {
      const t = s.teams[id];
      return {
        id,
        name: t.name,
        emojiCode: t.emojiCode,
        playerIds: t.playerIds,
        r1Points: t.r1Points,
        r2Points: t.r2Points,
        score: t.score,
        r1: t.r1 ? { codeword: t.r1.codeword, solved: t.r1.solved, points: t.r1.points, solveSeconds: t.r1.solveSeconds, hintsTaken: t.r1.hintsTaken } : null,
      };
    }),
    matches: Object.values(s.r2.matches).map(m => ({
      id: m.id,
      teamA: m.teamA,
      teamB: m.teamB,
      cancelled: m.cancelled,
      clashes: m.clashes.map(c => ({ clash: c.clash, resolved: c.resolved, stanceA: c.stanceA, stanceB: c.stanceB, ptsA: c.ptsA, ptsB: c.ptsB, votedA: votes(c.votesA), votedB: votes(c.votesB) })),
    })),
    unpairedTeamIds: s.teamOrder.filter(id => !s.r2.matchOfTeam[id]),
    moral: s.r2.moral,
    byePoints: s.r2.bye ?? {},
    r3: s.r3
      ? {
          teams: s.r3.teams,
          escapeOrder: s.r3.escapeOrder,
          leashArmed: s.r3.leash,
          votedThisWave: Object.fromEntries(Object.entries(s.r3.votes).map(([tid, b]) => [tid, votes(b)])),
          waves: s.r3.reports.length,
          lastReport: s.r3.reports[s.r3.reports.length - 1] ?? null,
          sd: s.r3.sd ? { ...s.r3.sd, votesA: votes(s.r3.sd.votesA), votesB: votes(s.r3.sd.votesB) } : null,
        }
      : null,
  };
  const json = JSON.stringify(stable);
  return { stable: json, hash: createHash('sha1').update(json).digest('base64url').slice(0, 16) };
}
