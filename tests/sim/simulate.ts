// Deterministic whole-game simulation: 200 players, ~40 teams, all three rounds, a fake clock and
// a seeded RNG. Used by `npm run sim` and by property.test.ts.
//
// The planner reads the engine state at the start of each tick and emits commands from its own
// seeded RNG stream. Chaos (shuffling, duplicate resends, snapshot/restore) uses a *separate*
// RNG stream, so toggling it never changes which commands the planner decides to send.
import { due, leaderboard, podium, reduce } from '../../server/engine/index.ts';
import type { Command, ErrorCode, GameState } from '../../server/engine/index.ts';
import { createInitialState } from '../../server/engine/index.ts';
import { calculateRound1Score } from '../../server/engine/round1.ts';
import { calculateClashPoints } from '../../server/engine/round2.ts';
import { briefingSeconds } from '../../server/content.ts';

export interface SimOptions {
  seed: number;
  players?: number;
  /** Shuffle independent player commands within a tick during Rounds 1-3. */
  shuffle?: boolean;
  /** Probability of re-sending a command with the SAME commandId (immediately or a few ticks later). */
  dupSameId?: number;
  /** Probability of re-sending an idempotent command with a NEW commandId a few ticks later. */
  dupNewId?: number;
  /** Replace the state by JSON.parse(JSON.stringify(state)) at this tick. */
  snapshotAtTick?: number | null;
  measure?: boolean;
  /** Observer called once per tick after the planner's commands were applied (read-only; used by server tests). */
  onTick?: (state: GameState, tick: number, now: number) => void;
}

export interface SimResult {
  state: GameState;
  failures: string[];
  ticks: number;
  commandsApplied: number;
  reduceCalls: number;
  errorCounts: Record<string, number>;
  timesMs: number[];
  podiumNames: { gold: string | null; silver: string | null; bronze: string | null };
  stateBytes: number;
  waves: number;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDEMPOTENT_TYPES = new Set(['JOIN', 'R1_SUBMIT', 'R1_HINT', 'R2_PAIR', 'R2_VOTE', 'R3_VOTE', 'R3_ARM_LEASH', 'SD_VOTE']);
const FORBIDDEN_ERRORS = new Set<ErrorCode>(['INVALID_PAYLOAD', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'UNKNOWN_PLAYER', 'STALE', 'NOT_DUE', 'NOT_TIMED']);

export function runSimulation(opts: SimOptions): SimResult {
  const N = opts.players ?? 200;
  const rnd = mulberry(opts.seed * 7919 + 13); // planner stream
  const chaos = mulberry(opts.seed * 104729 + 7); // chaos stream
  const int = (n: number) => Math.floor(rnd() * n);
  const range = (a: number, b: number) => a + int(b - a + 1);
  const shuffled = <T>(xs: readonly T[]): T[] => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let state = createInitialState({ seed: opts.seed });
  const T0 = 1_700_000_000_000;
  let tick = 0;
  let now = T0;
  let cmdSeq = 0;
  let commandsApplied = 0;
  let reduceCalls = 0;
  const errorCounts: Record<string, number> = {};
  const failures: string[] = [];
  const timesMs: number[] = [];
  const later = new Map<number, Command[]>();
  const firstVote = new Map<string, string>(); // `${phaseSeq}:${playerId}` -> first vote sent
  const fail = (m: string) => {
    if (failures.length < 50) failures.push(m);
  };

  const mk = (type: string, actor: Command['actor'], payload: unknown): Command => ({ commandId: `s${++cmdSeq}`, type, actor, payload });
  const P = (id: string) => ({ kind: 'player' as const, playerId: id });
  const ADMIN = { kind: 'admin' as const };

  function applyOne(c: Command, fromDue = false): void {
    const t0 = opts.measure ? process.hrtime.bigint() : 0n;
    const r = reduce(state, c, { now });
    if (opts.measure) timesMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    reduceCalls++;
    if (r.state !== state) commandsApplied++;
    state = r.state;
    if (r.error) {
      errorCounts[r.error] = (errorCounts[r.error] ?? 0) + 1;
      if (fromDue) fail(`system command failed: ${c.commandId} ${r.error}`);
      else if (FORBIDDEN_ERRORS.has(r.error) && c.type !== 'R2_PAIR') fail(`unexpected ${r.error} from ${c.type} (${JSON.stringify(c.payload)})`);
    }
  }

  function send(c: Command): void {
    applyOne(c);
    if (c.actor.kind === 'player') {
      if ((opts.dupSameId ?? 0) > 0 && chaos() < (opts.dupSameId ?? 0)) {
        if (chaos() < 0.5) applyOne(c);
        else {
          const at = tick + 1 + Math.floor(chaos() * 3);
          if (!later.has(at)) later.set(at, []);
          later.get(at)!.push(c);
        }
      }
      if ((opts.dupNewId ?? 0) > 0 && IDEMPOTENT_TYPES.has(c.type) && chaos() < (opts.dupNewId ?? 0)) {
        const at = tick + 1 + Math.floor(chaos() * 2);
        if (!later.has(at)) later.set(at, []);
        later.get(at)!.push({ ...c, commandId: `${c.commandId}~dup${Math.floor(chaos() * 1e9)}` });
      }
    }
  }

  // ---- planner state -------------------------------------------------------
  const ids = Array.from({ length: N }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const lateJoiners = ids.slice(N - 10);
  const early = shuffled(ids.slice(0, N - 10));
  const joinTick = new Map<string, number>();
  for (const id of early) joinTick.set(id, int(60));
  for (const id of lateJoiners) joinTick.set(id, 150 + int(120)); // during Round 1

  // Team groups formed by players (the rest are left for admin auto-group).
  const groups: string[][] = [];
  {
    const pool = shuffled(early);
    let i = 0;
    const sizes = [3, 4, 5, 5, 5, 5, 6];
    while (pool.length - i > 40) {
      const size = Math.min(sizes[int(sizes.length)], pool.length - i);
      groups.push(pool.slice(i, i + size));
      i += size;
    }
  }
  const createTick = groups.map(() => 70 + int(10));

  let lastSeq = -1;
  let phaseTick0 = 0;
  const sched = new Map<string, Command[]>(); // key `${tickOffsetAbs}` -> commands (built lazily per phase)
  const todo: { at: number; make: () => Command | null }[] = [];
  const personality: Record<string, number> = {};
  const vesselWeights: Record<string, [number, number, number]> = {};
  let pauseResumeAt = -1;
  let sdDone = false;
  let sdVoteTick = -1;
  void sched;

  const members = (tid: string) => state.teams[tid].playerIds;

  function planLobby(): Command[] {
    const out: Command[] = [];
    for (const id of early) {
      if (joinTick.get(id) === tick) out.push(mk('JOIN', P(id), { playerId: id, name: `Name ${id}`, tokenHash: `h-${id}` }));
    }
    groups.forEach((g, gi) => {
      const creator = g[0];
      if (tick === createTick[gi] && state.players[creator] && !state.players[creator].teamId) {
        out.push(mk('CREATE_TEAM', P(creator), { name: `Crew ${gi}` }));
      }
      const cp = state.players[creator];
      if (tick >= 80 && tick < 119 && cp?.teamId && state.teams[cp.teamId]) {
        const t = state.teams[cp.teamId];
        for (const pid of g.slice(1)) {
          const p = state.players[pid];
          if (!p || p.teamId || rnd() > 0.35) continue;
          const conflict = t.playerIds.length < 5 && t.playerIds.some(m => state.players[m].role === p.role);
          if (conflict && rnd() < 0.9) out.push(mk('REROLL_ROLE', P(pid), {}));
          else out.push(mk('JOIN_TEAM', P(pid), { code: t.emojiCode }));
        }
      }
    });
    if (tick === 120) out.push(mk('ADMIN_AUTO_GROUP', ADMIN, {}));
    if (tick === 121) {
      for (const tid of state.teamOrder) if (members(tid).length < 3) out.push(mk('ADMIN_DELETE_TEAM', ADMIN, { teamId: tid }));
    }
    if (tick === 122) out.push(mk('ADMIN_AUTO_GROUP', ADMIN, {}));
    if (tick === 125) out.push(mk('ADMIN_START_GAME', ADMIN, {}));
    return out;
  }

  function planR1(): Command[] {
    const out: Command[] = [];
    // late joiners
    for (const id of lateJoiners) if (joinTick.get(id) === tick) out.push(mk('JOIN', P(id), { playerId: id, name: `Late ${id}`, tokenHash: `h-${id}` }));
    if (state.step === 'BRIEFING') {
      // the story is playing: the clock has not started and nothing may be accepted
      if (state.phaseSeq !== lastSeq) {
        lastSeq = state.phaseSeq;
        phaseTick0 = tick;
        out.push(mk('R1_SUBMIT', P(ids[0]), { answer: 'TOO EARLY' }));
        out.push(mk('R1_HINT', P(ids[1]), { hint: 1 }));
      }
      return out;
    }
    if (state.phaseSeq !== lastSeq) {
      lastSeq = state.phaseSeq;
      phaseTick0 = tick;
      todo.length = 0;
      for (const tid of state.teamOrder) {
        const t = state.teams[tid];
        const solveAt = rnd() < 0.78 ? range(20, 295) : null;
        const hintAts: [number, number][] = [];
        for (const [h, base] of [[1, 120], [2, 180], [3, 240]] as const) {
          if (rnd() < (h === 1 ? 0.4 : 0.25)) {
            const at = base + int(25);
            if (solveAt === null || at < solveAt - 1) hintAts.push([h, at]);
          }
        }
        const who = () => members(tid)[int(members(tid).length)];
        for (const [h, at] of hintAts) todo.push({ at, make: () => mk('R1_HINT', P(who()), { hint: h }) });
        if (solveAt !== null) {
          const w = who();
          const w2 = who();
          todo.push({ at: solveAt, make: () => mk('R1_SUBMIT', P(w), { answer: state.teams[tid].r1!.codeword.toLowerCase() }) });
          if (rnd() < 0.2) todo.push({ at: solveAt, make: () => mk('R1_SUBMIT', P(w2), { answer: ` ${state.teams[tid].r1!.codeword} ` }) });
        }
        for (let k = int(4); k > 0; k--) {
          const at = range(5, 290);
          if (solveAt !== null && at >= solveAt - 1 && at <= solveAt + 1) continue;
          todo.push({ at, make: () => mk('R1_SUBMIT', P(who()), { answer: 'WRONG GUESS' }) });
        }
        void t;
      }
      // Tail: a couple of attempts after the deadline must be refused
      todo.push({ at: 301, make: () => mk('R1_SUBMIT', P(ids[0]), { answer: 'LATE' }) });
    }
    const elapsed = state.r1.startedAt == null ? -1 : Math.floor((now - state.r1.startedAt) / 1000);
    for (let i = todo.length - 1; i >= 0; i--) {
      if (todo[i].at === elapsed) {
        const c = todo[i].make();
        if (c && state.players[(c.actor as { playerId?: string }).playerId ?? ids[0]] !== undefined) out.push(c);
        else if (c && c.actor.kind === 'admin') out.push(c);
        todo.splice(i, 1);
      }
    }
    void phaseTick0;
    return out;
  }

  function planR2Pairing(): Command[] {
    const out: Command[] = [];
    if (state.phaseSeq !== lastSeq) {
      lastSeq = state.phaseSeq;
      phaseTick0 = tick;
      todo.length = 0;
      const order = shuffled(state.teamOrder);
      for (let i = 0; i + 1 < order.length; i += 2) {
        const a = order[i];
        const b = order[i + 1];
        const at = range(2, 25);
        const pa = members(a)[int(members(a).length)];
        const pb = members(b)[int(members(b).length)];
        todo.push({ at, make: () => mk('R2_PAIR', P(pa), { code: state.teams[b]?.battleCode ?? '00' }) });
        if (rnd() < 0.4) todo.push({ at: at + 3, make: () => mk('R2_PAIR', P(pb), { code: state.teams[a]?.battleCode ?? '00' }) });
      }
      // noise: own code, unknown code
      const noisy = members(order[0])[0];
      todo.push({ at: 1, make: () => mk('R2_PAIR', P(noisy), { code: state.teams[order[0]]?.battleCode ?? '00' }) });
      todo.push({ at: 2, make: () => mk('R2_PAIR', P(noisy), { code: '07' }) });
      if (order.length % 2 === 1) todo.push({ at: 40, make: () => mk('ADMIN_R2_FORCE_START', ADMIN, {}) });
      // move the late joiners into teams
      lateJoiners.forEach((id, k) => {
        todo.push({
          at: 1 + (k % 3),
          make: () => {
            const open = state.teamOrder.filter(t => members(t).length < 6);
            if (open.length === 0 || !state.players[id]) return null;
            return mk('ADMIN_MOVE_PLAYER', ADMIN, { playerId: id, teamId: open[(k * 7) % open.length] });
          },
        });
      });
    }
    const elapsed = tick - phaseTick0;
    for (let i = todo.length - 1; i >= 0; i--) {
      if (todo[i].at === elapsed) {
        const c = todo[i].make();
        if (c) out.push(c);
        todo.splice(i, 1);
      }
    }
    return out;
  }

  function planR2Clash(): Command[] {
    const out: Command[] = [];
    if (state.phaseSeq !== lastSeq) {
      lastSeq = state.phaseSeq;
      phaseTick0 = tick;
      todo.length = 0;
      const step = state.step;
      if (state.clash === 1 && step === 'HUDDLE') {
        for (const tid of state.teamOrder) personality[tid] = [0.05, 0.3, 0.6, 0.95][int(4)];
      }
      if (step === 'BRIEFING' || step === 'HUDDLE' || step === 'PARLEY') {
        // votes outside the window must be refused
        const stray = ids[int(N - 10)];
        todo.push({ at: 3, make: () => mk('R2_VOTE', P(stray), { vote: 'TRUCE' }) });
      }
      if (step === 'PARLEY' && state.clash === 2) {
        todo.push({ at: 5, make: () => mk('ADMIN_PAUSE', ADMIN, {}) });
        pauseResumeAt = tick + 5 + 15;
      }
      if (step === 'VOTE') {
        for (const tid of state.teamOrder) {
          if (!state.r2.matchOfTeam[tid]) continue;
          for (const pid of members(tid)) {
            if (rnd() < 0.12) continue; // never votes
            const v = rnd() < personality[tid] ? 'AMBUSH' : 'TRUCE';
            const at = int(22);
            todo.push({ at, make: () => mk('R2_VOTE', P(pid), { vote: v }) });
            if (rnd() < 0.1) todo.push({ at: at + 1 + int(2), make: () => mk('R2_VOTE', P(pid), { vote: v === 'AMBUSH' ? 'TRUCE' : 'AMBUSH' }) });
          }
        }
      }
      if (step === 'DEBRIEF' && state.clash === 3) {
        // nothing: round ends automatically
      }
    }
    if (pauseResumeAt >= 0 && tick === pauseResumeAt) {
      out.push(mk('ADMIN_RESUME', ADMIN, {}));
      pauseResumeAt = -1;
    }
    if (state.pausedAt != null) return out; // the room is frozen while paused
    const elapsed = tick - phaseTick0;
    for (let i = todo.length - 1; i >= 0; i--) {
      if (todo[i].at === elapsed) {
        const c = todo[i].make();
        if (c) out.push(c);
        todo.splice(i, 1);
      }
    }
    return out;
  }

  function planR3(): Command[] {
    const out: Command[] = [];
    const r3 = state.r3!;
    if (state.phaseSeq !== lastSeq) {
      lastSeq = state.phaseSeq;
      phaseTick0 = tick;
      todo.length = 0;
      const step = state.step;
      if (step === 'BRIEFING') todo.push({ at: 2, make: () => mk('R3_VOTE', P(ids[int(N - 10)]), { vessel: 'ROWBOAT' }) });
      if (step === 'BLUFF' && state.wave === 1) {
        for (const tid of state.teamOrder) {
          const a = rnd();
          const b = rnd();
          const c = rnd();
          const s = a + b + c;
          vesselWeights[tid] = [0.2 + a / s, 0.1 + b / s / 1.2, 0.02 + c / s / 3];
        }
      }
      if (step === 'VOTE') {
        for (const tid of state.teamOrder) {
          const t3 = r3.teams[tid];
          if (!t3) continue;
          const w = vesselWeights[tid] ?? [1, 0, 0];
          const total = w[0] + w[1] + w[2];
          for (const pid of members(tid)) {
            if (rnd() < 0.1) continue;
            const x = rnd() * total;
            const vessel = x < w[0] ? 'ROWBOAT' : x < w[0] + w[1] ? 'SAILBOAT' : 'GHOST_SHIP';
            todo.push({ at: int(17), make: () => mk('R3_VOTE', P(pid), { vessel }) });
          }
          if (t3.leashHolder && !t3.leashUsed && rnd() < 0.7) {
            const who = members(tid)[int(members(tid).length)];
            todo.push({ at: int(10), make: () => mk('R3_ARM_LEASH', P(who), {}) });
          }
          if (t3.escaped && rnd() < 0.3) todo.push({ at: 4, make: () => mk('R3_VOTE', P(members(tid)[0]), { vessel: 'ROWBOAT' }) });
        }
      }
      if (step === 'REVEAL' && !sdDone && r3.escapeOrder.length >= 2 && rnd() < 0.7) {
        sdDone = true;
        const [a, b] = r3.escapeOrder;
        todo.push({ at: 2, make: () => mk('ADMIN_TRIGGER_SUDDEN_DEATH', ADMIN, { teamA: a, teamB: b }) });
      }
      if (step === 'SUDDEN_DEATH' && r3.sd) {
        const sd = r3.sd;
        for (const tid of [sd.teamA, sd.teamB]) {
          for (const pid of members(tid)) {
            if (rnd() < 0.15) continue;
            const action = (['SHIELDS', 'RAM', 'SAILS'] as const)[int(3)];
            todo.push({ at: int(30), make: () => mk('SD_VOTE', P(pid), { action }) });
          }
        }
        sdVoteTick = tick;
      }
      if (state.phase === 'R3_ACTIVE' && state.wave >= 30 && step === 'BLUFF') {
        todo.push({ at: 1, make: () => mk('ADMIN_END_R3', ADMIN, {}) });
      }
      if (state.phase === 'R3_RESULTS' && step === null) todo.push({ at: 6, make: () => mk('ADMIN_FINISH', ADMIN, {}) });
    }
    void sdVoteTick;
    const elapsed = tick - phaseTick0;
    for (let i = todo.length - 1; i >= 0; i--) {
      if (todo[i].at === elapsed) {
        const c = todo[i].make();
        if (c) out.push(c);
        todo.splice(i, 1);
      }
    }
    return out;
  }

  function planAdminBetween(): Command[] {
    const out: Command[] = [];
    if (state.phaseSeq !== lastSeq) {
      lastSeq = state.phaseSeq;
      phaseTick0 = tick;
      todo.length = 0;
      if (state.phase === 'R1_RESULTS') todo.push({ at: 8, make: () => mk('ADMIN_START_R2', ADMIN, {}) });
      if (state.phase === 'R2_RESULTS') {
        todo.push({ at: 10, make: () => mk('ADMIN_START_R3', ADMIN, {}) });
      }
    }
    const elapsed = tick - phaseTick0;
    for (let i = todo.length - 1; i >= 0; i--) {
      if (todo[i].at === elapsed) {
        const c = todo[i].make();
        if (c) out.push(c);
        todo.splice(i, 1);
      }
    }
    return out;
  }

  // ---- main loop -------------------------------------------------------------
  const MAX_TICKS = 20000;
  let finishedAtTick = -1;
  for (tick = 0; tick < MAX_TICKS; tick++) {
    now = T0 + tick * 1000;

    // 1. system commands for passed deadlines
    for (let guard = 0; guard < 20; guard++) {
      const cmds = due(state, now);
      if (cmds.length === 0) break;
      for (const c of cmds) {
        applyOne(c, true);
        // the scheduler may fire its command more than once: must be harmless
        if (chaos() < (opts.dupSameId ?? 0)) applyOne(c, true);
      }
    }

    // 2. delayed resends
    const resends = later.get(tick);
    if (resends) {
      later.delete(tick);
      for (const c of resends) applyOne(c);
    }

    // 3. snapshot / restore
    if (opts.snapshotAtTick != null && tick === opts.snapshotAtTick) state = JSON.parse(JSON.stringify(state));

    // 4. planner
    let cmds: Command[] = [];
    switch (state.phase) {
      case 'LOBBY':
        cmds = planLobby();
        break;
      case 'R1_ACTIVE':
        cmds = planR1();
        break;
      case 'R1_RESULTS':
      case 'R2_RESULTS':
        cmds = planAdminBetween();
        break;
      case 'R2_PAIRING':
        cmds = planR2Pairing();
        break;
      case 'R2_CLASH':
        cmds = planR2Clash();
        break;
      case 'R3_ACTIVE':
      case 'R3_RESULTS':
        cmds = planR3();
        break;
      case 'FINISHED':
        break;
    }
    if (state.phase === 'FINISHED') {
      finishedAtTick = tick;
      opts.onTick?.(state, tick, now);
      break;
    }
    if (opts.shuffle && state.phase !== 'LOBBY' && state.phase !== 'R2_PAIRING') {
      // Independent player commands may arrive in any order within a tick; admin commands stay first
      const admin = cmds.filter(c => c.actor.kind === 'admin');
      const players = cmds.filter(c => c.actor.kind !== 'admin');
      for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(chaos() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
      }
      cmds = [...admin, ...players];
    }
    for (const c of cmds) {
      if (c.type === 'R2_VOTE' || c.type === 'R3_VOTE') {
        const k = `${state.phaseSeq}:${(c.actor as { playerId: string }).playerId}`;
        const v = String((c.payload as { vote?: string; vessel?: string }).vote ?? (c.payload as { vessel?: string }).vessel);
        if (!firstVote.has(k)) firstVote.set(k, v);
      }
      send(c);
    }
    opts.onTick?.(state, tick, now);
  }
  if (finishedAtTick < 0) fail(`game did not finish within ${MAX_TICKS} ticks (phase ${state.phase})`);

  checkInvariants(state, firstVote, failures);

  const nameOf = (id: string | null) => (id ? (state.teams[id]?.name ?? id) : null);
  const pod = podium(state);
  return {
    state,
    failures,
    ticks: tick,
    commandsApplied,
    reduceCalls,
    errorCounts,
    timesMs,
    podiumNames: { gold: nameOf(pod.gold), silver: nameOf(pod.silver), bronze: nameOf(pod.bronze) },
    stateBytes: JSON.stringify(state).length,
    waves: state.r3?.reports.length ?? 0,
  };
}

// ---- invariants -----------------------------------------------------------------------------

function checkInvariants(s: GameState, firstVote: Map<string, string>, failures: string[]): void {
  const fail = (m: string) => {
    if (failures.length < 50) failures.push(m);
  };

  // JSON serialisable and round-trips unchanged
  try {
    const round = JSON.parse(JSON.stringify(s));
    if (JSON.stringify(round) !== JSON.stringify(s)) fail('state does not survive a JSON round trip');
  } catch (e) {
    fail(`state is not JSON serialisable: ${String(e)}`);
  }

  // each phase entered exactly once, in order
  const order: string[] = [];
  for (const e of s.phaseLog) if (order[order.length - 1] !== e.phase) order.push(e.phase);
  const expected = ['LOBBY', 'R1_ACTIVE', 'R1_RESULTS', 'R2_PAIRING', 'R2_CLASH', 'R2_RESULTS', 'R3_ACTIVE', 'R3_RESULTS', 'FINISHED'];
  if (JSON.stringify(order) !== JSON.stringify(expected)) fail(`phase order ${JSON.stringify(order)}`);
  for (let i = 1; i < s.phaseLog.length; i++) if (s.phaseLog[i].seq <= s.phaseLog[i - 1].seq) fail('phase sequence not strictly increasing');
  const seen = new Map<string, number>();
  for (const e of s.phaseLog) {
    if (e.phase !== 'R2_CLASH' && e.phase !== 'R3_ACTIVE') continue;
    const k = `${e.phase}/${e.clash}/${e.wave}/${e.step}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const sdEntries = s.phaseLog.filter(e => e.step === 'SUDDEN_DEATH').length;
  for (const [k, n] of seen) {
    const allowed = k.endsWith('/REVEAL') ? 1 + sdEntries : 1;
    if (n > allowed) fail(`step entered ${n} times: ${k}`);
  }
  const r2Steps = s.phaseLog.filter(e => e.phase === 'R2_CLASH').length;
  if (r2Steps !== 13 && s.r2.matches && Object.keys(s.r2.matches).length > 0) fail(`expected 13 R2 steps (briefing + 12), saw ${r2Steps}`);

  // each round opens with a BRIEFING step of the content-derived length, and its real clock starts when it ends
  const briefingEnds = (phase: string, secs: number): void => {
    const i = s.phaseLog.findIndex(e => e.phase === phase && e.step === 'BRIEFING');
    if (i < 0) return fail(`no BRIEFING step in ${phase}`);
    const next = s.phaseLog[i + 1];
    if (!next || next.phase !== phase || next.step === 'BRIEFING') fail(`${phase} does not leave its briefing for a running step`);
    else if (next.at - s.phaseLog[i].at < secs * 1000) fail(`${phase} briefing ended after ${next.at - s.phaseLog[i].at} ms, expected at least ${secs * 1000}`);
    if (s.phaseLog.filter(e => e.phase === phase && e.step === 'BRIEFING').length !== 1) fail(`${phase} entered its briefing more than once`);
  };
  briefingEnds('R1_ACTIVE', briefingSeconds(1));
  if (Object.keys(s.r2.matches).length > 0) briefingEnds('R2_CLASH', briefingSeconds(2));
  if (s.r3) briefingEnds('R3_ACTIVE', briefingSeconds(3));
  {
    const i = s.phaseLog.findIndex(e => e.phase === 'R1_ACTIVE' && e.step === null);
    if (i >= 0 && s.r1.startedAt !== s.phaseLog[i].at) fail('the Round 1 clock must start exactly when the briefing ends');
  }

  // scores = R1 + R2 + admin adjustments, checked independently
  let r2Total = 0;
  let matchTotal = 0;
  for (const m of Object.values(s.r2.matches)) for (const c of m.clashes) matchTotal += c.ptsA + c.ptsB;
  for (const tid of s.teamOrder) {
    const t = s.teams[tid];
    r2Total += t.r2Points;
    if (t.score !== t.r1Points + t.r2Points + t.adminAdjust) fail(`score mismatch ${tid}`);
    if (t.adminAdjust !== 0) fail(`legacy adminAdjust must stay 0 ${tid}: ${t.adminAdjust}`);
    const r1 = t.r1;
    const expectR1 = r1 && r1.solved ? calculateRound1Score(r1.solveSeconds ?? 0, r1.hintsTaken.length).finalPoints : 0;
    if (t.r1Points !== expectR1) fail(`R1 points mismatch ${tid}: ${t.r1Points} vs ${expectR1}`);
    if (r1 && r1.solved && r1.solveSeconds! > 300) fail(`R1 solved after the deadline ${tid}`);
    const mid = s.r2.matchOfTeam[tid];
    const m = mid ? s.r2.matches[mid] : undefined;
    let sum = 0;
    if (m) {
      for (const c of m.clashes) {
        if (!c.resolved) continue;
        const isA = m.teamA === tid;
        const exp = calculateClashPoints(c.stanceA!, c.stanceB!, c.clash);
        const got = isA ? c.ptsA : c.ptsB;
        if (got !== (isA ? exp.team_a_pts : exp.team_b_pts)) fail(`clash points mismatch ${tid} clash ${c.clash}`);
        sum += got;
        // votes counted at most once, only by members of the team
        const bucket = isA ? c.votesA : c.votesB;
        if (Object.keys(bucket).length > t.playerIds.length + 10) fail('more votes than players');
      }
    }
    if (sum !== t.r2Points) fail(`R2 points ${tid}: team ${t.r2Points} vs matches ${sum}`);
  }
  if (r2Total !== matchTotal) fail(`R2 total ${r2Total} vs matches ${matchTotal}`);

  // first vote is final: stored vote equals the first vote sent
  // (R2 vote keys use the VOTE-step phaseSeq; recompute from the phase log)
  for (const m of Object.values(s.r2.matches)) {
    for (const c of m.clashes) {
      const voteStep = s.phaseLog.find(e => e.phase === 'R2_CLASH' && e.step === 'VOTE' && e.clash === c.clash);
      if (!voteStep) continue;
      for (const bucket of [c.votesA, c.votesB]) {
        for (const [pid, v] of Object.entries(bucket)) {
          const first = firstVote.get(`${voteStep.seq}:${pid}`);
          if (first !== undefined && first !== v) fail(`vote of ${pid} in clash ${c.clash} is ${v}, first sent was ${first}`);
        }
      }
    }
  }

  // moral statuses recomputed from clash records
  for (const m of Object.values(s.r2.matches)) {
    for (const [tid, side] of [[m.teamA, 'A'], [m.teamB, 'B']] as const) {
      const mo = s.r2.moral[tid];
      if (!mo) continue;
      let mine = 0;
      let theirs = 0;
      let truces = 0;
      for (const c of m.clashes) {
        const my = side === 'A' ? c.stanceA : c.stanceB;
        const th = side === 'A' ? c.stanceB : c.stanceA;
        if (my === 'AMBUSH' && th === 'TRUCE') mine++;
        if (my === 'TRUCE' && th === 'AMBUSH') theirs++;
        if (my === 'TRUCE' && th === 'TRUCE') truces++;
      }
      const exp = m.clashes.filter(c => c.resolved).length === 0 ? 'NONE' : truces === 3 ? 'HONOURABLE' : theirs > mine ? 'BETRAYED' : mine > theirs ? 'AGGRESSOR' : 'BLOOD_FEUD';
      if (mo.status !== exp) fail(`moral ${tid}: ${mo.status} vs ${exp}`);
      if ((mo.status === 'BETRAYED') !== (mo.nemesisTeamId != null)) fail(`nemesis link ${tid}`);
    }
  }

  // Round 3
  const r3 = s.r3;
  if (r3) {
    const order = r3.escapeOrder;
    if (new Set(order).size !== order.length) fail('escape order has duplicates');
    order.forEach((tid, i) => {
      const t = r3.teams[tid];
      if (!t || !t.escaped || t.escapeRank !== i + 1) fail(`escape rank of ${tid}`);
      if (t.distance < 1000 && !s.phaseLog.some(e => e.step === 'SUDDEN_DEATH')) fail(`escaped below 1000: ${tid} ${t.distance}`);
    });
    for (const [tid, t] of Object.entries(r3.teams)) {
      if (t.escaped && !order.includes(tid)) fail(`escaped team missing from order ${tid}`);
      if (t.distance < 0) fail(`negative distance ${tid}`);
    }
    const p = podium(s);
    const medal = [p.gold, p.silver, p.bronze].filter((x): x is string => x != null);
    if (new Set(medal).size !== medal.length) fail('podium teams not distinct');
    if (medal.length !== Math.min(3, order.length)) fail('podium size');
    // distance chain across waves
    const dist: Record<string, number> = {};
    for (const [tid, t] of Object.entries(r3.teams)) dist[tid] = t.startDistance;
    for (const rep of r3.reports) {
      for (const [tid, o] of Object.entries(rep.outcomes)) {
        const exp = Math.max(0, (dist[tid] ?? 0) + o.gained);
        if (o.newDistance !== exp) fail(`wave ${rep.wave} distance chain ${tid}: ${o.newDistance} vs ${exp}`);
        dist[tid] = o.newDistance;
      }
      const cap = Math.max(1, Math.floor(0.3 * rep.activeCrews));
      if (rep.sailboatCapacity !== cap) fail('sailboat capacity');
      const boarded = Object.values(rep.outcomes).filter(o => o.vessel === 'SAILBOAT').length;
      if (rep.sailboatCapsized !== boarded > cap) fail('sailboat capsize flag');
      const ghosts = Object.values(rep.outcomes).filter(o => o.vessel === 'GHOST_SHIP').length;
      if (rep.ghostCollided !== ghosts >= 2) fail('ghost collision flag');
    }
    if (s.phase === 'FINISHED' && order.length < 3 && Object.values(r3.teams).some(t => !t.escaped) && s.phaseLog.every(e => e.wave < 30)) {
      fail('round 3 ended early without the admin');
    }
  }
}

// ---- CLI ------------------------------------------------------------------------------------

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function main(): void {
  const seed = Number(process.argv[2] ?? 1);
  const t0 = Date.now();
  const r = runSimulation({ seed, measure: true, dupSameId: 0.03, dupNewId: 0.03 });
  const times = r.timesMs.slice().sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  const teams = r.state.teamOrder.length;
  const sizes = r.state.teamOrder.map(t => r.state.teams[t].playerIds.length);
  console.log(`seed ${seed}: ${Object.keys(r.state.players).length} players in ${teams} teams (sizes ${Math.min(...sizes)}-${Math.max(...sizes)}), ${r.ticks} simulated seconds, ${r.waves} Round 3 waves`);
  console.log(`commands: ${r.reduceCalls} reduce calls, ${r.commandsApplied} changed state, ${r.state.applied.length} ids in the dedupe ring`);
  console.log(`reduce time ms: mean ${mean.toFixed(3)}  p50 ${pct(times, 50).toFixed(3)}  p99 ${pct(times, 99).toFixed(3)}  max ${times[times.length - 1]?.toFixed(3)}`);
  console.log(`final state: ${r.stateBytes} bytes of JSON (version ${r.state.version})`);
  console.log(`podium: gold ${r.podiumNames.gold} | silver ${r.podiumNames.silver} | bronze ${r.podiumNames.bronze}`);
  console.log(`top of leaderboard: ${leaderboard(r.state, 3).map(x => `${x.name} ${x.score}`).join(' | ')}`);
  console.log(`error codes seen: ${JSON.stringify(r.errorCounts)}`);
  console.log(`wall time ${Date.now() - t0} ms`);
  if (r.failures.length > 0) {
    console.error(`\nINVARIANT FAILURES (${r.failures.length}):`);
    for (const f of r.failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('all invariants hold');
}

if (process.argv[1] && process.argv[1].endsWith('simulate.ts')) main();
