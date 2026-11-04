// Pure selectors the server uses to build views. They never return tokenHash, codewords, other
// teams' votes before reveal, or admin data. Everything returned is plain JSON.
import { R3, ROLES, ROLE_IDS, ROUND1_HINT_COST } from './config.ts';
import { crewSizeOf, uniqueRoleSlots } from './common.ts';
import { r1ElapsedSeconds } from './clock.ts';
import { ROUND1_HINTS, parseTabletCodeword } from './round1.ts';
import { r3ActiveTeamIds, sailboatCapacity } from './round3.ts';
import { normalizeEmojiCode } from './teamCodes.ts';
import type { ErrorCode, GameState, MoralStatus, Phase, RoleId, SdAction, Stance, Step, Vessel, WaveReport } from './types.ts';

const roleName = (id: RoleId): string => ROLES.find(r => r.id === id)?.name ?? id;

// ---- phase ------------------------------------------------------------------

export interface PhaseInfo {
  phase: Phase;
  step: Step;
  clash: number;
  wave: number;
  phaseSeq: number;
  version: number;
  endsAt: number | null;
  paused: boolean;
  /** Milliseconds left in the step (frozen while paused), or null when the step is untimed. */
  remainingMs: number | null;
}

export function phaseInfo(state: GameState, now: number): PhaseInfo {
  const ref = state.pausedAt ?? now;
  return {
    phase: state.phase,
    step: state.step,
    clash: state.clash,
    wave: state.wave,
    phaseSeq: state.phaseSeq,
    version: state.version,
    endsAt: state.endsAt,
    paused: state.pausedAt != null,
    remainingMs: state.endsAt == null ? null : Math.max(0, state.endsAt - ref),
  };
}

// ---- teams ------------------------------------------------------------------

export interface TeamPublic {
  id: string;
  name: string;
  emojiCode: string;
  battleCode: string;
  size: number;
  members: { playerId: string; name: string; role: RoleId; roleName: string }[];
  missingRoles: RoleId[];
  score: number;
}

export function teamPublic(state: GameState, teamId: string): TeamPublic | null {
  const t = state.teams[teamId];
  if (!t) return null;
  const members = t.playerIds.map(pid => {
    const p = state.players[pid];
    return { playerId: pid, name: p.name, role: p.role, roleName: roleName(p.role) };
  });
  const present = new Set(members.map(m => m.role));
  return {
    id: t.id,
    name: t.name,
    emojiCode: t.emojiCode,
    battleCode: t.battleCode,
    size: members.length,
    members,
    missingRoles: ROLE_IDS.filter(r => !present.has(r)),
    score: t.score,
  };
}

export interface TeamPreview {
  id: string;
  name: string;
  emojiCode: string;
  memberCount: number;
  maxMembers: number;
  isFull: boolean;
  leaderName: string;
  members: { name: string; role: RoleId; roleName: string }[];
  hasRoleConflict: boolean;
  conflictingRoleName?: string;
}

export function previewTeamByEmoji(
  state: GameState,
  code: string,
  playerId?: string,
): { ok: true; preview: TeamPreview } | { ok: false; error: ErrorCode } {
  const target = normalizeEmojiCode(code);
  if (!target) return { ok: false, error: 'INVALID_CODE' };
  const team = state.teamOrder.map(id => state.teams[id]).find(t => normalizeEmojiCode(t.emojiCode) === target);
  if (!team) return { ok: false, error: 'UNKNOWN_CODE' };
  const members = team.playerIds.map(pid => {
    const p = state.players[pid];
    return { name: p.name, role: p.role, roleName: roleName(p.role) };
  });
  const me = playerId ? state.players[playerId] : undefined;
  const conflict = !!me && members.length < uniqueRoleSlots(state) && members.some(m => m.role === me.role);
  return {
    ok: true,
    preview: {
      id: team.id,
      name: team.name,
      emojiCode: team.emojiCode,
      memberCount: members.length,
      maxMembers: crewSizeOf(state),
      isFull: members.length >= crewSizeOf(state),
      leaderName: members[0]?.name ?? 'Captain',
      members,
      hasRoleConflict: conflict,
      ...(conflict && me ? { conflictingRoleName: roleName(me.role) } : {}),
    },
  };
}

// ---- player -----------------------------------------------------------------

export interface PlayerPrivate {
  playerId: string;
  name: string;
  role: RoleId;
  roleName: string;
  teamId: string | null;
  /** Only this player's own piece (slot) of the crew's tablet, only during Round 1. */
  r1: { slot: number; slotCount: number } | null;
  /** The player's own vote in the current clash / wave / standoff. */
  myVote: { r2: Stance | null; r3: Vessel | null; sd: SdAction | null };
}

export function playerPrivate(state: GameState, playerId: string): PlayerPrivate | null {
  const p = state.players[playerId];
  if (!p) return null;
  const team = p.teamId ? state.teams[p.teamId] : null;
  let r1: PlayerPrivate['r1'] = null;
  if (team?.r1 && state.phase === 'R1_ACTIVE') {
    const slot = team.r1.slots[playerId];
    if (slot !== undefined) {
      r1 = { slot, slotCount: team.r1.size };
    }
  }
  let r2: Stance | null = null;
  if (team && state.phase === 'R2_CLASH') {
    const mid = state.r2.matchOfTeam[team.id];
    const m = mid ? state.r2.matches[mid] : undefined;
    const clash = m?.clashes[state.clash - 1];
    if (m && clash) r2 = (m.teamA === team.id ? clash.votesA : clash.votesB)[playerId] ?? null;
  }
  let r3: Vessel | null = null;
  let sd: SdAction | null = null;
  if (team && state.r3) {
    if (state.phase === 'R3_ACTIVE') r3 = state.r3.votes[team.id]?.[playerId] ?? null;
    const s = state.r3.sd;
    if (s && !s.resolved) sd = (team.id === s.teamA ? s.votesA : team.id === s.teamB ? s.votesB : {})[playerId] ?? null;
  }
  return {
    playerId,
    name: p.name,
    role: p.role,
    roleName: roleName(p.role),
    teamId: p.teamId,
    r1,
    myVote: { r2, r3, sd },
  };
}

// ---- round 1 ----------------------------------------------------------------

export interface Round1Status {
  started: boolean;
  closed: boolean;
  solved: boolean;
  points: number;
  solveSeconds: number | null;
  elapsedSeconds: number;
  hintsTakenCount: number;
  hintCost: number;
  hints: { index: number; unlockAtSeconds: number; unlocked: boolean; taken: boolean; text: string | null }[];
}

/** The crew's own codeword split into the two tablet lines (own team only, Round 1 only). */
export function round1Tablet(state: GameState, teamId: string): { line1: string; line2: string } | null {
  const r1 = state.teams[teamId]?.r1;
  if (!r1 || state.phase !== 'R1_ACTIVE') return null;
  return parseTabletCodeword(r1.codeword);
}

export function round1TeamStatus(state: GameState, teamId: string, now: number): Round1Status | null {
  const t = state.teams[teamId];
  if (!t) return null;
  const r1 = t.r1;
  const elapsed = state.phase === 'R1_ACTIVE' ? r1ElapsedSeconds(state, now) : 0;
  const afterRound = state.phase !== 'LOBBY' && state.phase !== 'R1_ACTIVE';
  return {
    started: r1 != null,
    closed: state.r1.closed || afterRound,
    solved: r1?.solved ?? false,
    points: r1?.points ?? 0,
    solveSeconds: r1?.solveSeconds ?? null,
    elapsedSeconds: elapsed,
    hintsTakenCount: r1?.hintsTaken.length ?? 0,
    hintCost: ROUND1_HINT_COST,
    hints: ROUND1_HINTS.map(h => ({
      index: h.hintIndex,
      unlockAtSeconds: h.availableAfterSeconds,
      unlocked: state.phase === 'R1_ACTIVE' && elapsed >= h.availableAfterSeconds,
      taken: r1?.hintsTaken.includes(h.hintIndex) ?? false,
      text: r1?.hintTexts[String(h.hintIndex)] ?? null,
    })),
  };
}

// ---- round 2 ----------------------------------------------------------------

export interface Round2MatchView {
  paired: boolean;
  rivalTeamId: string | null;
  rivalName: string | null;
  cancelled: boolean;
  /** Resolved clashes only (stances become visible when the clash is scored, i.e. at DEBRIEF). */
  history: { clash: number; myStance: Stance; rivalStance: Stance; myPts: number; rivalPts: number; myVotes: string }[];
  /**
   * During VOTE only: how many teammates have voted, and who (aligned with the team's member order).
   * Never anyone's actual vote.
   */
  voting: { votedCount: number; teamSize: number; votedBy: boolean[] } | null;
  moral: { status: MoralStatus; rivalTeamId: string | null; nemesisTeamId: string | null } | null;
  /** Unpaired crews only: Truce points awarded per resolved clash (index = clash - 1). */
  bye: number[] | null;
}

export function round2MatchView(state: GameState, teamId: string, _playerId?: string): Round2MatchView | null {
  const team = state.teams[teamId];
  if (!team) return null;
  const mid = state.r2.matchOfTeam[teamId];
  const m = mid ? state.r2.matches[mid] : undefined;
  if (!m) {
    return { paired: false, rivalTeamId: null, rivalName: null, cancelled: false, history: [], voting: null, moral: null, bye: state.r2.bye?.[teamId] ?? [] };
  }
  const isA = m.teamA === teamId;
  const rivalId = isA ? m.teamB : m.teamA;
  const history = m.clashes
    .filter(c => c.resolved && c.stanceA && c.stanceB)
    .map(c => {
      const bucket = isA ? c.votesA : c.votesB;
      return {
        clash: c.clash,
        myStance: (isA ? c.stanceA : c.stanceB) as Stance,
        rivalStance: (isA ? c.stanceB : c.stanceA) as Stance,
        myPts: isA ? c.ptsA : c.ptsB,
        rivalPts: isA ? c.ptsB : c.ptsA,
        // Revealed once the clash is scored: one char per current member, in member order: T, A or - (did not vote).
        myVotes: team.playerIds.map(pid => (bucket[pid] === 'TRUCE' ? 'T' : bucket[pid] === 'AMBUSH' ? 'A' : '-')).join(''),
      };
    });
  let voting: Round2MatchView['voting'] = null;
  if (state.phase === 'R2_CLASH' && state.step === 'VOTE' && !m.cancelled) {
    const clash = m.clashes[state.clash - 1];
    if (clash) {
      const bucket = isA ? clash.votesA : clash.votesB;
      const voted = team.playerIds.filter(pid => bucket[pid] !== undefined).length;
      voting = { votedCount: voted, teamSize: team.playerIds.length, votedBy: team.playerIds.map(pid => bucket[pid] !== undefined) };
    }
  }
  const moral = state.r2.moral[teamId];
  const showMoral = state.phase === 'R2_RESULTS' || state.phase === 'R3_ACTIVE' || state.phase === 'R3_RESULTS' || state.phase === 'FINISHED';
  return {
    paired: true,
    rivalTeamId: rivalId,
    rivalName: state.teams[rivalId]?.name ?? null,
    cancelled: m.cancelled,
    history,
    voting,
    moral: showMoral && moral ? { status: moral.status, rivalTeamId: moral.rivalTeamId, nemesisTeamId: moral.nemesisTeamId } : null,
    bye: null,
  };
}

// ---- round 3 ----------------------------------------------------------------

export interface FleetRow {
  teamId: string;
  name: string;
  distance: number;
  escapedRank: number | null;
  /** The vessel this crew took in the wave being revealed (null before REVEAL). */
  vessel: Vessel | null;
}

function vesselsVisible(state: GameState): boolean {
  return (state.phase === 'R3_ACTIVE' && state.step === 'REVEAL') || state.phase === 'R3_RESULTS' || state.phase === 'FINISHED';
}

export function round3FleetRows(state: GameState): FleetRow[] {
  const r3 = state.r3;
  if (!r3) return [];
  const last = r3.reports[r3.reports.length - 1];
  const show = vesselsVisible(state) && !!last;
  const rows: FleetRow[] = state.teamOrder
    .filter(tid => r3.teams[tid])
    .map(tid => ({
      teamId: tid,
      name: state.teams[tid].name,
      distance: r3.teams[tid].distance,
      escapedRank: r3.teams[tid].escaped ? r3.teams[tid].escapeRank : null,
      vessel: show ? (last.outcomes[tid]?.vessel ?? null) : null,
    }));
  rows.sort((a, b) => {
    if (a.escapedRank != null || b.escapedRank != null) {
      if (a.escapedRank == null) return 1;
      if (b.escapedRank == null) return -1;
      return a.escapedRank - b.escapedRank;
    }
    return b.distance - a.distance || a.name.localeCompare(b.name) || a.teamId.localeCompare(b.teamId);
  });
  return rows;
}

/** Max crews that can share the Sailboat in the current wave (null outside Round 3). */
export function round3SailboatCapacity(state: GameState): number | null {
  if (!state.r3) return null;
  return sailboatCapacity(r3ActiveTeamIds(state).length);
}

export interface Round3TeamView {
  distance: number;
  escaped: boolean;
  escapeRank: number | null;
  wave: number;
  sailboatCapacity: number | null;
  voting: { votedCount: number; teamSize: number } | null;
  /** This crew holds the Honourable head start (Winds of Olympus, +75 m). */
  honourable: boolean;
  /** Visible to the team itself only. */
  leash: { holder: boolean; used: boolean; armed: boolean; nemesisTeamId: string | null };
}

export function round3TeamView(state: GameState, teamId: string): Round3TeamView | null {
  const r3 = state.r3;
  const t3 = r3?.teams[teamId];
  const team = state.teams[teamId];
  if (!r3 || !t3 || !team) return null;
  let voting: Round3TeamView['voting'] = null;
  if (state.phase === 'R3_ACTIVE' && state.step === 'VOTE') {
    const votes = r3.votes[teamId] || {};
    voting = { votedCount: team.playerIds.filter(pid => votes[pid] !== undefined).length, teamSize: team.playerIds.length };
  }
  return {
    distance: t3.distance,
    escaped: t3.escaped,
    escapeRank: t3.escaped ? t3.escapeRank : null,
    wave: state.wave,
    sailboatCapacity: round3SailboatCapacity(state),
    voting,
    honourable: t3.honourBonus,
    leash: { holder: t3.leashHolder, used: t3.leashUsed, armed: r3.leash[teamId] !== undefined, nemesisTeamId: t3.leashHolder ? t3.nemesis : null },
  };
}

export interface WaveReportView {
  wave: number;
  sailboatCapacity: number;
  sailboatCapsized: boolean;
  ghostCollided: boolean;
  ghostSoloTeamId: string | null;
  leashEvents: { holder: string; target: string; kind: string; holderDelta: number; targetDelta: number }[];
  /** All-crews summary: [vessel code, crews that boarded, outcome, metres per boarding crew] for Rowboat, Sailboat, Ghost Ship. */
  vessels: [string, number, 'SAFE' | 'CAPSIZED' | 'COLLIDED' | 'UNBOARDED', number][];
  rows: { teamId: string; vessel: Vessel; gained: number; newDistance: number; escapeRank: number | null }[];
}

function waveVessels(r: WaveReport): WaveReportView['vessels'] {
  const n: Record<Vessel, number> = { ROWBOAT: 0, SAILBOAT: 0, GHOST_SHIP: 0 };
  for (const o of Object.values(r.outcomes)) n[o.vessel]++;
  return [
    ['R', n.ROWBOAT, n.ROWBOAT === 0 ? 'UNBOARDED' : 'SAFE', n.ROWBOAT === 0 ? 0 : R3.vessel.ROWBOAT.success],
    ['S', n.SAILBOAT, n.SAILBOAT === 0 ? 'UNBOARDED' : r.sailboatCapsized ? 'CAPSIZED' : 'SAFE', n.SAILBOAT === 0 ? 0 : r.sailboatCapsized ? R3.vessel.SAILBOAT.fail : R3.vessel.SAILBOAT.success],
    ['G', n.GHOST_SHIP, n.GHOST_SHIP === 0 ? 'UNBOARDED' : r.ghostCollided ? 'COLLIDED' : 'SAFE', n.GHOST_SHIP === 0 ? 0 : r.ghostCollided ? R3.vessel.GHOST_SHIP.fail : R3.vessel.GHOST_SHIP.success],
  ];
}

/** A wave report, available only once the wave is resolved (REVEAL onwards). */
export function round3WaveReport(state: GameState, wave: number): WaveReportView | null {
  const r = state.r3?.reports.find(x => x.wave === wave);
  if (!r) return null;
  return {
    wave: r.wave,
    sailboatCapacity: r.sailboatCapacity,
    sailboatCapsized: r.sailboatCapsized,
    ghostCollided: r.ghostCollided,
    ghostSoloTeamId: r.ghostSoloTeamId,
    leashEvents: r.leashEvents.map(e => ({ ...e })),
    vessels: waveVessels(r),
    rows: Object.keys(r.outcomes).map(tid => ({
      teamId: tid,
      vessel: r.outcomes[tid].vessel,
      gained: r.outcomes[tid].gained,
      newDistance: r.outcomes[tid].newDistance,
      escapeRank: r.outcomes[tid].escapeRank,
    })),
  };
}

export function podium(state: GameState): { gold: string | null; silver: string | null; bronze: string | null } {
  const o = state.r3?.escapeOrder ?? [];
  return { gold: o[0] ?? null, silver: o[1] ?? null, bronze: o[2] ?? null };
}

export function suddenDeathView(state: GameState, teamId?: string) {
  const sd = state.r3?.sd;
  if (!sd) return null;
  const mine = teamId === sd.teamA ? sd.votesA : teamId === sd.teamB ? sd.votesB : null;
  const t = teamId ? state.teams[teamId] : undefined;
  return {
    teamA: sd.teamA,
    teamB: sd.teamB,
    resolved: sd.resolved,
    active: !sd.resolved && state.step === 'SUDDEN_DEATH',
    voting: !sd.resolved && mine && t ? { votedCount: t.playerIds.filter(p => mine[p] !== undefined).length, teamSize: t.playerIds.length } : null,
    stanceA: sd.resolved ? sd.stanceA : null,
    stanceB: sd.resolved ? sd.stanceB : null,
    winnerTeamId: sd.resolved ? sd.winnerTeamId : null,
    text: sd.resolved ? sd.text : null,
  };
}

// ---- leaderboard ------------------------------------------------------------

export function leaderboard(state: GameState, limit = 10): { rank: number; teamId: string; name: string; score: number }[] {
  const rows = state.teamOrder.map(id => state.teams[id]);
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return rows.slice(0, Math.max(0, limit)).map((t, i) => ({ rank: i + 1, teamId: t.id, name: t.name, score: t.score }));
}
