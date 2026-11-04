// End-of-game data export for the organizer: one analysis-friendly JSON document and one flat CSV
// (a row per vote or action). Pure functions of a GameState, called by the generic admin endpoints
// (GET /api/admin/export.json and /api/admin/export.csv). Admin-only data: it holds player names and
// each crew's codeword, but never a token hash or the admin token.
import type { GameState, Team } from '../../server/engine/types.ts';
import { clashSides, decodeVoteLog, finalRanking, finishedAt, startedAt } from './analysis.ts';

export const EXPORT_FORMAT = 1;

const nameOfPlayer = (s: GameState, id: string): string => s.players[id]?.name ?? '';
const roleOfPlayer = (s: GameState, id: string): string => s.players[id]?.role ?? '';
const crewName = (s: GameState, id: string | null): string => (id ? (s.teams[id]?.name ?? id) : '');

/** The analysis-friendly document. `exportedAt` is passed in (the engine and these functions never read a clock). */
export function buildGameExport(s: GameState, exportedAt: number): Record<string, unknown> {
  const ranking = finalRanking(s);
  const rankOf = new Map(ranking.map(r => [r.teamId, r.rank] as const));
  const sides = clashSides(s);
  const playersOf = (t: Team) => t.playerIds.map(id => ({ id, name: nameOfPlayer(s, id), role: roleOfPlayer(s, id) }));

  const crews = s.teamOrder.map(id => {
    const t = s.teams[id];
    const mo = s.r2.moral[id];
    const t3 = s.r3?.teams[id];
    return {
      id,
      name: t.name,
      emojiCode: t.emojiCode,
      battleCode: t.battleCode,
      rank: rankOf.get(id) ?? null,
      score: t.score,
      r1Points: t.r1Points,
      r2Points: t.r2Points,
      members: playersOf(t),
      round1: t.r1
        ? {
            codeword: t.r1.codeword,
            solved: t.r1.solved,
            solveSeconds: t.r1.solveSeconds,
            points: t.r1.points,
            hintsTaken: t.r1.hintsTaken,
            wrongGuesses: { count: t.r1.wrong?.count ?? 0, log: (t.r1.wrong?.log ?? []).map(([atSecond, guess]) => ({ atSecond, guess })) },
          }
        : null,
      round2: {
        rivalId: s.r2.matchOfTeam[id] ? (sides.find(x => x.teamId === id && x.rivalId)?.rivalId ?? null) : null,
        moral: mo ? { status: mo.status, nemesisId: mo.nemesisTeamId, mutualTruce: mo.mutualTruce, myAmbush: mo.myAmbush, rivalAmbush: mo.rivalAmbush, mutualAmbush: mo.mutualAmbush } : null,
        byePoints: s.r2.bye?.[id] ?? null,
      },
      round3: t3
        ? {
            startDistance: t3.startDistance,
            distance: t3.distance,
            honourBonus: t3.honourBonus,
            leashHolder: t3.leashHolder,
            nemesisId: t3.nemesis,
            leashUsed: t3.leashUsed,
            escaped: t3.escaped,
            escapeRank: t3.escapeRank,
            escapedInWave: t3.escapedInWave,
          }
        : null,
    };
  });

  const round1 = s.teamOrder.map(id => {
    const t = s.teams[id];
    return {
      crewId: id,
      crew: t.name,
      solved: t.r1?.solved ?? false,
      solveSeconds: t.r1?.solveSeconds ?? null,
      points: t.r1?.points ?? 0,
      hintsTaken: t.r1?.hintsTaken ?? [],
      wrongGuessCount: t.r1?.wrong?.count ?? 0,
      wrongGuesses: (t.r1?.wrong?.log ?? []).map(([atSecond, guess]) => ({ atSecond, guess })),
    };
  });

  const round2Clashes: Record<string, unknown>[] = [];
  for (const m of Object.values(s.r2.matches)) {
    const ta = s.teams[m.teamA];
    const tb = s.teams[m.teamB];
    for (const c of m.clashes) {
      if (!c.resolved) continue;
      const votesOf = (t: Team | undefined, bucket: Record<string, string>) =>
        (t?.playerIds ?? []).map(id => ({ playerId: id, name: nameOfPlayer(s, id), vote: bucket[id] ?? null }));
      round2Clashes.push({
        matchId: m.id,
        clash: c.clash,
        cancelled: m.cancelled,
        crewA: { id: m.teamA, name: crewName(s, m.teamA), stance: c.stanceA, points: c.ptsA, votes: votesOf(ta, c.votesA) },
        crewB: { id: m.teamB, name: crewName(s, m.teamB), stance: c.stanceB, points: c.ptsB, votes: votesOf(tb, c.votesB) },
        outcomeA: sides.find(x => x.matchId === m.id && x.clash === c.clash && x.teamId === m.teamA)?.outcome ?? null,
        outcomeB: sides.find(x => x.matchId === m.id && x.clash === c.clash && x.teamId === m.teamB)?.outcome ?? null,
      });
    }
  }
  const byes = sides.filter(x => x.outcome === 'BYE').map(x => ({ crewId: x.teamId, crew: crewName(s, x.teamId), clash: x.clash, points: x.pts }));

  const votes = decodeVoteLog(s);
  const waves = (s.r3?.reports ?? []).map(rep => ({
    wave: rep.wave,
    activeCrews: rep.activeCrews,
    sailboatCapacity: rep.sailboatCapacity,
    sailboatCapsized: rep.sailboatCapsized,
    ghostCollided: rep.ghostCollided,
    ghostSoloCrewId: rep.ghostSoloTeamId,
    leashEvents: rep.leashEvents.map(e => ({ holderId: e.holder, holder: crewName(s, e.holder), targetId: e.target, target: crewName(s, e.target), kind: e.kind, holderDelta: e.holderDelta, targetDelta: e.targetDelta })),
    crews: Object.entries(rep.outcomes).map(([tid, o]) => {
      const wv = votes.find(v => v.wave === rep.wave && v.teamId === tid);
      return {
        crewId: tid,
        crew: crewName(s, tid),
        vessel: o.vessel,
        unanimity: Math.round(o.unanimity * 1000) / 1000,
        baseMeters: o.baseMeters,
        leashDelta: o.leashDelta,
        metres: o.gained,
        newDistance: o.newDistance,
        escaped: o.escaped,
        escapeRank: o.escapeRank,
        crashed: (o.vessel === 'SAILBOAT' && rep.sailboatCapsized) || (o.vessel === 'GHOST_SHIP' && rep.ghostCollided),
        leashTargetId: wv?.leash ?? null,
        // null when the game was recorded before votes were logged (older snapshots)
        votes: wv ? wv.votes.map(v => ({ playerId: v.playerId, name: nameOfPlayer(s, v.playerId), vote: v.vessel })) : null,
      };
    }),
  }));

  const suddenDeath = (s.r3?.sdHistory ?? []).map(sd => {
    const side = (teamId: string, bucket: Record<string, string>, stance: string | null) => ({
      crewId: teamId,
      crew: crewName(s, teamId),
      stance,
      votes: (s.teams[teamId]?.playerIds ?? []).map(id => ({ playerId: id, name: nameOfPlayer(s, id), vote: bucket[id] ?? null })),
    });
    return { crewA: side(sd.teamA, sd.votesA, sd.stanceA), crewB: side(sd.teamB, sd.votesB, sd.stanceB), winnerCrewId: sd.winnerTeamId, text: sd.text };
  });

  return {
    format: EXPORT_FORMAT,
    game: 'underworld',
    exportedAt,
    exportedAtIso: new Date(exportedAt).toISOString(),
    game_meta: {
      version: s.version,
      phase: s.phase,
      startedAt: startedAt(s),
      finishedAt: finishedAt(s),
      players: s.playerOrder.length,
      crews: s.teamOrder.length,
      crewSize: s.config.crewSize,
      durations: s.config,
      r3Waves: s.r3?.reports.length ?? 0,
    },
    timeline: s.phaseLog.map(e => ({ seq: e.seq, phase: e.phase, step: e.step, clash: e.clash, wave: e.wave, at: e.at })),
    crews,
    round1,
    round2: { clashes: round2Clashes, byes },
    round3: { waves, escapeOrder: s.r3?.escapeOrder ?? [] },
    suddenDeath,
    standings: ranking.map(r => {
      const t = s.teams[r.teamId];
      return { rank: r.rank, crewId: t.id, crew: t.name, score: t.score, r1Points: t.r1Points, r2Points: t.r2Points, distance: s.r3?.teams[t.id]?.distance ?? null, escapeRank: s.r3?.teams[t.id]?.escapeRank ?? null };
    }),
    podium: (s.r3?.escapeOrder ?? []).slice(0, 3).map((id, i) => ({ place: i + 1, crewId: id, crew: crewName(s, id) })),
  };
}

// ---- CSV ----------------------------------------------------------------------------------

export const CSV_COLUMNS = ['round', 'unit', 'crew_id', 'crew', 'player_id', 'player', 'role', 'action', 'choice', 'outcome', 'points', 'metres', 'at_second', 'detail'] as const;

/** A text cell: quoted when needed, and a leading = + - @ is defused so a spreadsheet cannot run it as a formula. */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return String(v);
  let t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

type Row = Partial<Record<(typeof CSV_COLUMNS)[number], string | number | null>>;

/** Rows in play order; each is one vote or action. A byte-order mark is prepended so Excel reads the emoji. */
export function buildGameCsv(s: GameState): string {
  const rows: Row[] = [];
  const base = (teamId: string) => ({ crew_id: teamId, crew: crewName(s, teamId) });
  const player = (id: string) => ({ player_id: id, player: nameOfPlayer(s, id), role: roleOfPlayer(s, id) });

  // Round 1: one row per crew, one per hint, one per recorded wrong guess.
  for (const tid of s.teamOrder) {
    const r1 = s.teams[tid].r1;
    if (!r1) continue;
    rows.push({ round: 1, unit: '', ...base(tid), action: 'SOLVE', outcome: r1.solved ? 'SOLVED' : 'UNSOLVED', points: r1.points, at_second: r1.solveSeconds, detail: `hints=${r1.hintsTaken.length};wrong_guesses=${r1.wrong?.count ?? 0}` });
    for (const h of r1.hintsTaken) rows.push({ round: 1, unit: '', ...base(tid), action: 'HINT', choice: h });
    for (const [sec, guess] of r1.wrong?.log ?? []) rows.push({ round: 1, unit: '', ...base(tid), action: 'WRONG_GUESS', choice: guess, at_second: sec });
  }

  // Round 2: one row per member per clash (ABSTAIN when they did not vote), plus unpaired crews' bye rows.
  const sides = clashSides(s);
  const sideOf = new Map(sides.filter(x => x.matchId).map(x => [`${x.matchId}:${x.clash}:${x.teamId}`, x] as const));
  for (const m of Object.values(s.r2.matches)) {
    for (const c of m.clashes) {
      if (!c.resolved) continue;
      for (const [tid, bucket, stance, pts] of [[m.teamA, c.votesA, c.stanceA, c.ptsA], [m.teamB, c.votesB, c.stanceB, c.ptsB]] as const) {
        const t = s.teams[tid];
        if (!t) continue;
        const sd = sideOf.get(`${m.id}:${c.clash}:${tid}`);
        for (const pid of t.playerIds) {
          rows.push({ round: 2, unit: c.clash, ...base(tid), ...player(pid), action: 'VOTE', choice: bucket[pid] ?? 'ABSTAIN', outcome: sd?.outcome ?? '', points: pts, detail: `crew_stance=${stance};rival=${crewName(s, tid === m.teamA ? m.teamB : m.teamA)}` });
        }
      }
    }
  }
  for (const b of sides.filter(x => x.outcome === 'BYE')) rows.push({ round: 2, unit: b.clash, ...base(b.teamId), action: 'BYE', outcome: 'BYE', points: b.pts, detail: 'no rival: mutual Truce points' });

  // Round 3: one row per member per wave, one per armed leash, with the crew's outcome of that wave.
  const wv = decodeVoteLog(s);
  for (const rep of s.r3?.reports ?? []) {
    for (const [tid, o] of Object.entries(rep.outcomes)) {
      const crashed = (o.vessel === 'SAILBOAT' && rep.sailboatCapsized) || (o.vessel === 'GHOST_SHIP' && rep.ghostCollided);
      const outcome = crashed ? (o.vessel === 'SAILBOAT' ? 'CAPSIZED' : 'COLLIDED') : 'SAFE';
      const log = wv.find(v => v.wave === rep.wave && v.teamId === tid);
      const detail = `crew_vessel=${o.vessel};unanimity=${Math.round(o.unanimity * 100)}%;distance=${o.newDistance}${o.escaped ? `;escaped=${o.escapeRank}` : ''}`;
      if (log) {
        for (const v of log.votes) rows.push({ round: 3, unit: rep.wave, ...base(tid), ...player(v.playerId), action: 'VOTE', choice: v.vessel ?? 'ABSTAIN', outcome, metres: o.gained, detail });
      } else {
        rows.push({ round: 3, unit: rep.wave, ...base(tid), action: 'CREW_VESSEL', choice: o.vessel, outcome, metres: o.gained, detail: `${detail};player votes not recorded` });
      }
      if (log?.leash) rows.push({ round: 3, unit: rep.wave, ...base(tid), action: 'LEASH_ARMED', choice: crewName(s, log.leash) });
    }
    for (const e of rep.leashEvents) {
      rows.push({ round: 3, unit: rep.wave, ...base(e.holder), action: 'LEASH_RESULT', choice: crewName(s, e.target), outcome: e.kind, metres: e.holderDelta, detail: `target_delta=${e.targetDelta}` });
    }
  }

  // Sudden Death duels.
  for (const sd of s.r3?.sdHistory ?? []) {
    for (const [tid, bucket, stance] of [[sd.teamA, sd.votesA, sd.stanceA], [sd.teamB, sd.votesB, sd.stanceB]] as const) {
      for (const pid of s.teams[tid]?.playerIds ?? []) {
        rows.push({ round: 'SD', unit: '', ...base(tid), ...player(pid), action: 'VOTE', choice: bucket[pid] ?? 'ABSTAIN', outcome: sd.winnerTeamId == null ? 'NO_WINNER' : sd.winnerTeamId === tid ? 'WIN' : 'LOSS', detail: `crew_action=${stance}` });
      }
    }
  }

  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map(c => cell(r[c])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
