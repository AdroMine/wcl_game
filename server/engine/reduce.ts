// reduce(state, command, ctx) -> { state, events, error? }
// Pure and deterministic: no Date.now(), no Math.random(), no I/O. The input state is never
// mutated; a successful command works on a structuredClone and returns the new state.
import { MAX_APPLIED_IDS } from './config.ts';
import { adminHandlers } from './admin.ts';
import { lobbyHandlers } from './lobby.ts';
import { phaseHandlers } from './phases.ts';
import { round1Handlers } from './round1.ts';
import { round2Handlers } from './round2.ts';
import { round3Handlers } from './round3.ts';
import type { Command, Ctx, ErrorCode, GameEvent, GameState, Handler, ReduceResult } from './types.ts';

interface Entry {
  actor: 'player' | 'admin' | 'system';
  fn: Handler;
}

const REGISTRY: Record<string, Entry> = Object.create(null);
for (const [type, fn] of Object.entries({ ...lobbyHandlers, ...round1Handlers, ...round2Handlers, ...round3Handlers })) {
  REGISTRY[type] = { actor: 'player', fn };
}
for (const [type, fn] of Object.entries(adminHandlers)) REGISTRY[type] = { actor: 'admin', fn };
for (const [type, fn] of Object.entries(phaseHandlers)) REGISTRY[type] = { actor: 'system', fn };

export const COMMAND_TYPES: string[] = Object.keys(REGISTRY);

function ringWith(ring: string[], id: string): string[] {
  const next = ring.slice();
  next.push(id);
  if (next.length > MAX_APPLIED_IDS) next.splice(0, next.length - MAX_APPLIED_IDS);
  return next;
}

/** Only the command id is recorded; everything else is shared (states are immutable by convention). */
function recordOnly(state: GameState, id: string, error?: ErrorCode): ReduceResult {
  const next: GameState = { ...state, applied: ringWith(state.applied, id) };
  return error ? { state: next, events: [], error } : { state: next, events: [] };
}

function cloneState(state: GameState): GameState {
  const { applied, ...rest } = state;
  const d = structuredClone(rest) as GameState;
  d.applied = applied; // replaced with a fresh array on commit; never mutated in place
  return d;
}

function wellFormed(c: unknown): c is Command {
  if (c === null || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.commandId !== 'string' || o.commandId.length === 0 || o.commandId.length > 128) return false;
  if (typeof o.type !== 'string') return false;
  const a = o.actor as Record<string, unknown> | null;
  if (a === null || typeof a !== 'object') return false;
  if (a.kind === 'player') return typeof a.playerId === 'string' && a.playerId.length > 0;
  return a.kind === 'admin' || a.kind === 'system';
}

export function reduce(state: GameState, command: Command, ctx: Ctx): ReduceResult {
  if (!wellFormed(command)) return { state, events: [], error: 'INVALID_PAYLOAD' };
  if (state.applied.includes(command.commandId)) return { state, events: [] };

  const entry = REGISTRY[command.type];
  if (!entry) return recordOnly(state, command.commandId, 'UNKNOWN_COMMAND');
  if (command.actor.kind !== entry.actor) return recordOnly(state, command.commandId, 'FORBIDDEN');
  if (command.actor.kind === 'player' && command.type !== 'JOIN' && !state.players[command.actor.playerId]) {
    return recordOnly(state, command.commandId, 'UNKNOWN_PLAYER');
  }

  const d = cloneState(state);
  const events: GameEvent[] = [];
  const res = entry.fn(d, command, ctx.now, events);
  if (res && 'error' in res) {
    if (!res.commit) return recordOnly(state, command.commandId, res.error);
    // The command is refused but its bookkeeping (a recorded wrong guess) is kept.
    d.version += 1;
    d.applied = ringWith(state.applied, command.commandId);
    return { state: d, events, error: res.error };
  }
  if (res && 'noop' in res) return recordOnly(state, command.commandId);
  d.version += 1;
  d.applied = ringWith(state.applied, command.commandId);
  return { state: d, events };
}
