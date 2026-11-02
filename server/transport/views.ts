// Builds the per-player View from engine selectors.
//
// Cost model: the team-shared part is built once per (teamId, state version) and the global part
// (phase, board, fleet) once per version, so a flush costs about 40 team builds plus 200 tiny
// per-player merges. Hard guarantees (tested): a view is never more than 4096 bytes, and never
// contains a token hash, a token, a codeword, another player's private data, other teams' votes
// before the reveal, or any teammate's individual vote.
import { createHash } from 'node:crypto';
import { instructionFor, titleFor } from '../content.ts';
import { checkPlayer } from '../auth.ts';
import {
  crewSizeOf,
  leaderboard,
  phaseInfo,
  playerPrivate,
  podium,
  round1Tablet,
  round1TeamStatus,
  round2MatchView,
  round3FleetRows,
  round3SailboatCapacity,
  round3TeamView,
  round3WaveReport,
  suddenDeathView,
  teamPublic,
} from '../engine/index.ts';
import type { FleetRow, GameState } from '../engine/index.ts';
import { LIMITS } from '../../shared/protocol.ts';
import type { MeView, PhaseView, R1View, R2View, R3View, ScreenView, TeamView, View } from '../../shared/protocol.ts';

const VESSEL_CODE: Record<string, string> = { ROWBOAT: 'R', SAILBOAT: 'S', GHOST_SHIP: 'G' };
const FLEET_ROWS = 8;
const BOARD_ROWS = 10;

/** The part of a view that does not carry v / serverNow (those are spliced in at send time). */
type Rest = Omit<View, 'v' | 'serverNow'>;

export interface BuiltView {
  /** Complete JSON text, including v and serverNow. */
  json: string;
  /** Hash of the content excluding v and serverNow. Used for change detection and ETag. */
  hash: string;
  bytes: number;
  /** True when the player id and token matched a known player. */
  known: boolean;
}

interface GlobalPart {
  phase: PhaseView;
  board: [string, number][];
  boardTotal: number;
  ranks: Map<string, number>;
  lobby?: { players: number; teams: number; crewSize: number };
  fleetAll: FleetRow[];
  fleetTop: [string, number, number, string][];
  fleetPos: Map<string, number>;
  activeCrews: number;
  escapedCount: number;
  sailboatCapacity: number;
  podiumNames: string[];
}

interface TeamPart {
  team: TeamView;
  r1?: R1View;
  r2?: R2View;
  r3?: R3View;
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function contentHash(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('base64url').slice(0, 16);
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

export class ViewBuilder {
  readonly sid: string;
  private notice: string | null = null;
  private epoch = 0;
  private cacheKey = '';
  private global: GlobalPart | null = null;
  private teams = new Map<string, TeamPart>();
  private screenCache: { key: string; json: string; hash: string } | null = null;
  private publicUrl: string | null;
  maxViewBytes = 0;
  degradedViews = 0;
  teamBuilds = 0;
  globalBuilds = 0;

  constructor(opts: { sid: string; publicUrl?: string | null }) {
    this.sid = opts.sid;
    this.publicUrl = opts.publicUrl ?? null;
  }

  setNotice(text: string | null): void {
    this.notice = text && text.length > 0 ? text.slice(0, 200) : null;
    this.epoch++;
  }

  getNotice(): string | null {
    return this.notice;
  }

  /** Force all caches to be rebuilt on next use (restore, resync). */
  invalidate(): void {
    this.epoch++;
  }

  private prepare(state: GameState): void {
    // Every accepted command bumps state.version; a rejected one replaces the state object but not its content.
    const key = `${state.version}:${this.epoch}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.global = null;
    this.teams.clear();
    this.screenCache = null;
  }

  // ---- global part -----------------------------------------------------------

  private buildGlobal(state: GameState): GlobalPart {
    if (this.global) return this.global;
    this.globalBuilds++;
    const info = phaseInfo(state, 0);
    const phase: PhaseView = {
      name: state.phase,
      step: state.step,
      clash: state.clash,
      wave: state.wave,
      endsAt: state.endsAt,
      paused: info.paused,
    };
    if (state.step === 'BRIEFING') phase.startedAt = state.phaseStartedAt;
    if (state.pausedAt != null) {
      phase.pausedAt = state.pausedAt;
      phase.pausedRemainingMs = state.endsAt == null ? 0 : Math.max(0, state.endsAt - state.pausedAt);
    }
    const all = leaderboard(state, state.teamOrder.length);
    const ranks = new Map<string, number>();
    for (const r of all) ranks.set(r.teamId, r.rank);
    const board: [string, number][] = all.slice(0, BOARD_ROWS).map(r => [r.name, r.score]);

    const fleetAll = state.r3 ? round3FleetRows(state) : [];
    const fleetPos = new Map<string, number>();
    fleetAll.forEach((r, i) => fleetPos.set(r.teamId, i + 1));
    const row = (r: FleetRow): [string, number, number, string] => [r.name, r.distance, r.escapedRank ?? 0, r.vessel ? VESSEL_CODE[r.vessel] : ''];
    const names = (ids: (string | null)[]) => ids.filter((x): x is string => !!x).map(id => state.teams[id]?.name ?? id);
    const pod = podium(state);
    const r3 = state.r3;
    this.global = {
      phase,
      board,
      boardTotal: state.teamOrder.length,
      ranks,
      lobby: state.phase === 'LOBBY' ? { players: state.playerOrder.length, teams: state.teamOrder.length, crewSize: crewSizeOf(state) } : undefined,
      fleetAll,
      fleetTop: fleetAll.slice(0, FLEET_ROWS).map(row),
      fleetPos,
      activeCrews: r3 ? state.teamOrder.filter(t => r3.teams[t] && !r3.teams[t].escaped).length : 0,
      escapedCount: r3 ? r3.escapeOrder.length : 0,
      sailboatCapacity: round3SailboatCapacity(state) ?? 0,
      podiumNames: names([pod.gold, pod.silver, pod.bronze]),
    };
    return this.global;
  }

  // ---- team part -------------------------------------------------------------

  private buildTeam(state: GameState, g: GlobalPart, teamId: string): TeamPart | null {
    const cached = this.teams.get(teamId);
    if (cached) return cached;
    const tp = teamPublic(state, teamId);
    if (!tp) return null;
    this.teamBuilds++;
    const team: TeamView = {
      id: tp.id,
      name: tp.name,
      emojiCode: tp.emojiCode,
      battleCode: tp.battleCode,
      members: tp.members.map(m => ({ name: m.name, role: m.role })),
      missingRoles: tp.missingRoles,
      score: tp.score,
      rank: g.ranks.get(teamId) ?? 0,
    };
    const part: TeamPart = { team };

    // Round 1
    if (state.phase === 'R1_ACTIVE' || state.phase === 'R1_RESULTS') {
      const s = round1TeamStatus(state, teamId, 0);
      if (s && s.started) {
        // During the briefing the clock has not started: hints unlock relative to the moment it will (the briefing's end).
        const started = state.r1.startedAt ?? state.endsAt ?? 0;
        const tablet = round1Tablet(state, teamId);
        part.r1 = {
          ...(tablet ? { tablet } : {}),
          solved: s.solved,
          points: s.points,
          closed: s.closed,
          hints: s.hints.map(h => {
            const out: R1View['hints'][number] = { index: h.index, unlocksAt: started + h.unlockAtSeconds * 1000, taken: h.taken };
            if (h.taken && h.text) out.text = h.text;
            return out;
          }),
        };
      }
    }

    // Round 2 (kept through Round 3 so the moral legacy stays visible)
    if (state.phase.startsWith('R2') || state.phase.startsWith('R3') || state.phase === 'FINISHED') {
      const m = round2MatchView(state, teamId);
      if (m) {
        const r2: R2View = { paired: m.paired, clashes: m.history, teamSize: tp.size };
        if (m.paired && m.rivalTeamId && m.rivalName != null) {
          r2.rival = { name: m.rivalName, battleCode: state.teams[m.rivalTeamId]?.battleCode ?? '' };
        }
        if (m.voting) {
          r2.votedCount = m.voting.votedCount;
          r2.votedBy = m.voting.votedBy;
        }
        if (m.moral) r2.moral = m.moral.status;
        part.r2 = r2;
      }
    }

    // Round 3
    const tv = state.r3 ? round3TeamView(state, teamId) : null;
    if (tv && state.r3) {
      const r3: R3View = {
        distance: tv.distance,
        escaped: tv.escaped,
        activeCrews: g.activeCrews,
        escapedCount: g.escapedCount,
        sailboatCapacity: g.sailboatCapacity,
        teamSize: tp.size,
        fleet: g.fleetTop,
      };
      if (tv.escapeRank != null) r3.escapedRank = tv.escapeRank;
      if (tv.honourable) r3.honourable = true;
      if (tv.voting) r3.votedCount = tv.voting.votedCount;
      const pos = g.fleetPos.get(teamId);
      if (pos) r3.myPos = pos;
      if (tv.leash.holder && !tv.leash.used) {
        r3.leash = {
          available: !tv.escaped,
          targetName: tv.leash.nemesisTeamId ? (state.teams[tv.leash.nemesisTeamId]?.name ?? null) : null,
          armed: tv.leash.armed,
        };
      }
      const last = state.r3.reports[state.r3.reports.length - 1];
      const revealed = (state.phase === 'R3_ACTIVE' && state.step === 'REVEAL') || state.phase === 'R3_RESULTS' || state.phase === 'FINISHED';
      // Reports of earlier waves are public once resolved; the current wave only from REVEAL.
      const rep = last && (revealed || last.wave < state.wave) ? round3WaveReport(state, last.wave) : null;
      const mine = rep && last?.outcomes[teamId];
      if (rep && last && mine) {
        r3.lastWave = {
          wave: rep.wave,
          vessel: mine.vessel,
          gained: mine.gained,
          leashDelta: mine.leashDelta,
          sailboatCapsized: rep.sailboatCapsized,
          ghostCollided: rep.ghostCollided,
          capacity: rep.sailboatCapacity,
          vessels: rep.vessels,
        };
        const leashes = rep.leashEvents
          .filter(e => e.holder === teamId || e.target === teamId)
          .map(e => {
            const holder = e.holder === teamId;
            const other = holder ? e.target : e.holder;
            return { kind: e.kind, delta: holder ? e.holderDelta : e.targetDelta, otherName: state.teams[other]?.name ?? '', role: (holder ? 'holder' : 'target') as 'holder' | 'target' };
          });
        if (leashes.length > 0) r3.lastWave.leashes = leashes;
      }
      const sd = suddenDeathView(state, teamId);
      if (sd) {
        const out: NonNullable<R3View['sd']> = {
          teamA: state.teams[sd.teamA]?.name ?? '',
          teamB: state.teams[sd.teamB]?.name ?? '',
          mine: teamId === sd.teamA || teamId === sd.teamB,
          resolved: sd.resolved,
        };
        if (sd.voting) out.votedCount = sd.voting.votedCount;
        if (sd.resolved) {
          out.winner = sd.winnerTeamId ? (state.teams[sd.winnerTeamId]?.name ?? null) : null;
          out.text = sd.text;
        }
        r3.sd = out;
      }
      if (g.podiumNames.length > 0) r3.podium = g.podiumNames;
      part.r3 = r3;
    }
    this.teams.set(teamId, part);
    return part;
  }

  // ---- player view -----------------------------------------------------------

  /**
   * Build the view for a player. `tokenHash` is sha256(token) as presented by the client; when it does
   * not match, the view has no `me` (the client shows the join screen). Never throws for bad input.
   */
  forPlayer(state: GameState, playerId: string | null, tokenHash: string | null, now: number): BuiltView {
    this.prepare(state);
    const g = this.buildGlobal(state);
    const known = !!playerId && !!tokenHash && checkPlayer(state, playerId, tokenHash) === 'ok';
    let me: MeView | undefined;
    let part: TeamPart | null = null;
    if (known && playerId) {
      const priv = playerPrivate(state, playerId);
      if (priv) {
        me = { id: priv.playerId, name: priv.name, role: priv.role, joinedTeam: priv.teamId != null };
        if (priv.r1) {
          me.slot = priv.r1.slot;
          me.slotCount = priv.r1.slotCount;
        }
        const vote = state.phase === 'R2_CLASH' ? priv.myVote.r2 : state.step === 'SUDDEN_DEATH' ? priv.myVote.sd : state.phase === 'R3_ACTIVE' ? priv.myVote.r3 : null;
        if (vote) me.myVote = vote;
        part = priv.teamId ? this.buildTeam(state, g, priv.teamId) : null;
      }
    }
    const ordered = { sid: this.sid, phase: g.phase } as Rest;
    if (me) ordered.me = me;
    if (part) {
      ordered.team = part.team;
      if (part.r1) ordered.r1 = part.r1;
      if (part.r2) ordered.r2 = part.r2;
      if (part.r3) ordered.r3 = part.r3;
    }
    if (g.lobby) ordered.lobby = g.lobby;
    ordered.board = g.board;
    ordered.boardTotal = g.boardTotal;
    if (this.notice) ordered.notice = this.notice;
    return this.seal(ordered, state.version, now, !!me);
  }

  /** Serialise, enforce the 4 KB cap by degrading optional content, record the size. */
  private seal(rest: Rest, version: number, now: number, known: boolean): BuiltView {
    let restJson = JSON.stringify(rest);
    const head = (): number => `{"v":${version},"serverNow":${now},`.length - 1; // the original "{" is replaced
    let bytes = head() + utf8Bytes(restJson);
    if (bytes > LIMITS.viewBytes) {
      this.degradedViews++;
      const steps: (() => void)[] = [
        () => {
          if (rest.r3) rest.r3 = { ...rest.r3, fleet: rest.r3.fleet.slice(0, 4) };
        },
        () => {
          rest.board = rest.board.slice(0, 5);
        },
        () => {
          if (rest.r3) rest.r3 = { ...rest.r3, fleet: rest.r3.fleet.slice(0, 2).map(r => [clip(r[0], 12), r[1], r[2], r[3]] as [string, number, number, string]) };
          rest.board = rest.board.slice(0, 3).map(r => [clip(r[0], 12), r[1]] as [string, number]);
        },
        () => {
          if (rest.team) rest.team = { ...rest.team, members: rest.team.members.map(m => ({ name: clip(m.name, 12), role: m.role })) };
          if (rest.r1) rest.r1 = { ...rest.r1, hints: rest.r1.hints.map(h => (h.text ? { ...h, text: clip(h.text, 80) } : h)) };
        },
        () => {
          if (rest.r3) rest.r3 = { ...rest.r3, fleet: [], sd: rest.r3.sd ? { ...rest.r3.sd, text: null } : undefined };
          rest.board = rest.board.slice(0, 1);
        },
        () => {
          // Optional extras restored from the old UI: who has voted, revealed teammate votes, the all-crews vessel report.
          if (rest.r2) {
            const { votedBy: _votedBy, ...r2 } = rest.r2;
            rest.r2 = { ...r2, clashes: r2.clashes.map(c => ({ ...c, myVotes: '' })) };
          }
          if (rest.r3?.lastWave) {
            const { vessels: _vessels, ...lw } = rest.r3.lastWave;
            rest.r3 = { ...rest.r3, lastWave: { ...lw, vessels: [] } };
          }
        },
        () => {
          delete rest.notice;
          delete rest.r3;
          rest.board = [];
        },
      ];
      for (const step of steps) {
        step();
        restJson = JSON.stringify(rest);
        bytes = head() + utf8Bytes(restJson);
        if (bytes <= LIMITS.viewBytes) break;
      }
    }
    if (bytes > this.maxViewBytes) this.maxViewBytes = bytes;
    return { json: `{"v":${version},"serverNow":${now},${restJson.slice(1)}`, hash: contentHash(restJson), bytes, known };
  }

  // ---- projector view --------------------------------------------------------

  screen(state: GameState, now: number): { json: string; hash: string } {
    this.prepare(state);
    const g = this.buildGlobal(state);
    if (!this.screenCache || this.screenCache.key !== this.cacheKey) {
      const fleet = g.fleetAll.map(r => [r.name, r.distance, r.escapedRank ?? 0, r.vessel ? VESSEL_CODE[r.vessel] : ''] as [string, number, number, string]);
      const rest: Omit<ScreenView, 'v' | 'serverNow'> = {
        sid: this.sid,
        phase: g.phase,
        title: titleFor(state.phase),
        instruction: instructionFor(state.phase, state.step),
        board: g.board,
        counts: { players: state.playerOrder.length, teams: state.teamOrder.length },
      };
      if (state.r3) rest.fleet = fleet;
      if (g.podiumNames.length > 0) rest.podium = g.podiumNames;
      if (this.publicUrl) rest.joinUrl = this.publicUrl;
      if (this.notice) rest.notice = this.notice;
      const restJson = JSON.stringify(rest);
      this.screenCache = { key: this.cacheKey, json: restJson, hash: contentHash(restJson) };
    }
    return { json: `{"v":${state.version},"serverNow":${now},${this.screenCache.json.slice(1)}`, hash: this.screenCache.hash };
  }
}
