// due(state, now): system commands for every deadline that has passed. Pure.
// The commandId is derived from the phase sequence number, so each step advances at most once
// (the reducer also rejects a stale sequence number).
import type { Command, GameState } from './types.ts';

export function due(state: GameState, now: number): Command[] {
  if (state.pausedAt != null) return [];
  if (state.endsAt == null || now < state.endsAt) return [];
  return [
    {
      commandId: `sys:advance:${state.phaseSeq}`,
      type: 'SYS_ADVANCE',
      actor: { kind: 'system' },
      payload: { phaseSeq: state.phaseSeq },
    },
  ];
}
