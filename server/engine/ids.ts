// Deterministic ids from a counter stored in state. Never time-based.
import type { GameState } from './types.ts';

export function nextId(d: Pick<GameState, 'idCounter'>, prefix: string): string {
  d.idCounter += 1;
  return `${prefix}${d.idCounter.toString(36)}`;
}

/** Plain counter value for default names (e.g. "Crew #7"). */
export function nextNumber(d: Pick<GameState, 'idCounter'>): number {
  d.idCounter += 1;
  return d.idCounter;
}
