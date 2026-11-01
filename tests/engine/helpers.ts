// Test helpers: a tiny harness around reduce()/due() with a fake clock.
import { createInitialState, due, reduce } from '../../server/engine/index.ts';
import type { Actor, Command, ErrorCode, GameEvent, GameState } from '../../server/engine/index.ts';

export interface Harness {
  state: GameState;
  now: number;
  events: GameEvent[];
  lastError: ErrorCode | undefined;
  send(type: string, actor: Actor, payload?: unknown, opts?: { id?: string; now?: number }): ErrorCode | undefined;
  as(playerId: string, type: string, payload?: unknown): ErrorCode | undefined;
  admin(type: string, payload?: unknown): ErrorCode | undefined;
  ok(err: ErrorCode | undefined, msg?: string): void;
  tick(seconds: number): void;
  /** Apply all due() commands (repeating until none are due). Returns how many were applied. */
  runDue(): number;
  /** Advance the fake clock to the current deadline and apply due commands. */
  nextDeadline(): void;
  join(id: string, name?: string): void;
}

export function harness(seed = 1, startNow = 1_000_000): Harness {
  let n = 0;
  const h: Harness = {
    state: createInitialState({ seed }),
    now: startNow,
    events: [],
    lastError: undefined,
    send(type, actor, payload = {}, opts = {}) {
      const c: Command = { commandId: opts.id ?? `c${++n}`, type, actor, payload };
      const r = reduce(h.state, c, { now: opts.now ?? h.now });
      h.state = r.state;
      h.events = r.events;
      h.lastError = r.error;
      return r.error;
    },
    as(playerId, type, payload = {}) {
      return h.send(type, { kind: 'player', playerId }, payload);
    },
    admin(type, payload = {}) {
      return h.send(type, { kind: 'admin' }, payload);
    },
    ok(err, msg) {
      if (err) throw new Error(`${msg ?? 'command'} failed with ${err}`);
    },
    tick(seconds) {
      h.now += Math.round(seconds * 1000);
    },
    runDue() {
      let count = 0;
      for (let guard = 0; guard < 50; guard++) {
        const cmds = due(h.state, h.now);
        if (cmds.length === 0) break;
        for (const c of cmds) {
          const r = reduce(h.state, c, { now: h.now });
          h.state = r.state;
          h.events = r.events;
          h.lastError = r.error;
          count++;
        }
      }
      return count;
    },
    nextDeadline() {
      if (h.state.endsAt == null) throw new Error('no deadline');
      h.now = Math.max(h.now, h.state.endsAt);
      h.runDue();
    },
    join(id, name) {
      h.ok(h.send('JOIN', { kind: 'player', playerId: id }, { playerId: id, name: name ?? id, tokenHash: `hash-${id}` }), `join ${id}`);
    },
  };
  return h;
}

/** Create `sizes.length` teams; team i has sizes[i] members p<i>_<j> with unique roles where possible. */
export function formTeams(h: Harness, sizes: number[]): string[] {
  const teamIds: string[] = [];
  sizes.forEach((size, i) => {
    const ids: string[] = [];
    for (let j = 0; j < size; j++) {
      const id = `p${i}_${j}`;
      h.join(id);
      ids.push(id);
    }
    // Everyone creates/joins; re-roll roles until unique (bounded).
    const first = ids[0];
    h.ok(h.as(first, 'CREATE_TEAM', { name: `Team ${i}` }), 'create team');
    const tid = h.state.players[first].teamId!;
    teamIds.push(tid);
    for (const pid of ids.slice(1)) {
      for (let tries = 0; tries < 30; tries++) {
        const err = h.as(pid, 'JOIN_TEAM', { code: h.state.teams[tid].emojiCode });
        if (!err) break;
        if (err !== 'ROLE_TAKEN') throw new Error(`join failed: ${err}`);
        h.ok(h.as(pid, 'REROLL_ROLE'), 'reroll');
      }
      // Rerolling is random; fall back to the admin override (which ignores role rules).
      if (h.state.players[pid].teamId !== tid) h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: pid, teamId: tid }), `place ${pid}`);
    }
  });
  return teamIds;
}

/** Start the game, skip Round 1 (nobody solves) and open Round 2 pairing. */
export function toR2Pairing(h: Harness): void {
  h.ok(h.admin('ADMIN_START_GAME'));
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  h.ok(h.admin('ADMIN_START_R2'));
}

/** Everyone in the team votes the same way (R2 stance). */
export function teamVotesR2(h: Harness, teamId: string, vote: 'TRUCE' | 'AMBUSH'): void {
  for (const pid of h.state.teams[teamId].playerIds) h.ok(h.as(pid, 'R2_VOTE', { vote }), `vote ${pid}`);
}

/** Pair two teams via battle codes, as players would. */
export function pairByCode(h: Harness, a: string, b: string): void {
  const p = h.state.teams[a].playerIds[0];
  h.ok(h.as(p, 'R2_PAIR', { code: h.state.teams[b].battleCode }), 'pair');
}

/** Run a whole Round 2 where each clash's stances come from `plan(clash, teamId)`. */
export function playRound2(h: Harness, plan: (clash: number, teamId: string) => 'TRUCE' | 'AMBUSH' | null): void {
  if (h.state.phase === 'R2_PAIRING') h.ok(h.admin('ADMIN_R2_FORCE_START'));
  while (h.state.phase === 'R2_CLASH') {
    if (h.state.step === 'VOTE') {
      for (const tid of h.state.teamOrder) {
        if (!h.state.r2.matchOfTeam[tid]) continue;
        const v = plan(h.state.clash, tid);
        if (v) teamVotesR2(h, tid, v);
      }
    }
    h.nextDeadline();
  }
}

/** Fast-forward a game that is in R2_RESULTS into R3 wave 1 BLUFF. */
export function toR3(h: Harness): void {
  h.ok(h.admin('ADMIN_START_R3'));
}

export function voteR3(h: Harness, teamId: string, vessel: 'ROWBOAT' | 'SAILBOAT' | 'GHOST_SHIP'): void {
  for (const pid of h.state.teams[teamId].playerIds) h.ok(h.as(pid, 'R3_VOTE', { vessel }), `r3 vote ${pid}`);
}

/** Teams of the given sizes, paired (0-1, 2-3, ...), Round 2 played with `plan`, Round 3 started. */
export function setupR3(
  seed: number,
  sizes: number[],
  plan: (clash: number, teamId: string, index: number) => 'TRUCE' | 'AMBUSH' | null = () => 'TRUCE',
): { h: Harness; t: string[] } {
  const h = harness(seed);
  const t = formTeams(h, sizes);
  toR2Pairing(h);
  for (let i = 0; i + 1 < t.length; i += 2) pairByCode(h, t[i], t[i + 1]);
  if (h.state.phase === 'R2_PAIRING') h.ok(h.admin('ADMIN_R2_FORCE_START'));
  playRound2(h, (c, tid) => plan(c, tid, t.indexOf(tid)));
  h.ok(h.admin('ADMIN_START_R3'));
  return { h, t };
}

/** Advance Round 3 from its current step to the start of REVEAL (resolving the wave). */
export function toReveal(h: Harness): void {
  let guard = 0;
  while (!(h.state.phase === 'R3_ACTIVE' && h.state.step === 'REVEAL') && guard++ < 10) h.nextDeadline();
}

export function toVote(h: Harness): void {
  let guard = 0;
  while (!(h.state.phase === 'R3_ACTIVE' && h.state.step === 'VOTE') && guard++ < 10) h.nextDeadline();
}
