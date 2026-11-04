// Static game content served once from GET /api/meta (and the projector instructions).
// This file holds NO game text: it assembles it from the active game disk (games/underworld/game.ts and
// the content.ts of each round under games/underworld/rounds/). To change a story, rule box, goal,
// role or projector line, edit those files (see games/README.md). A briefing's length is recomputed
// from its word counts (shared/briefing.ts).
import { CREW_SIZE_DEFAULT, CREW_SIZE_MAX, CREW_SIZE_MIN, DEFAULT_DURATIONS } from './engine/config.ts';
import { ERROR_MESSAGES, LIMITS, PROTOCOL_VERSION } from '../shared/protocol.ts';
import { briefingSchedule } from '../shared/briefing.ts';
import type { Meta, PhaseName } from '../shared/protocol.ts';
import { GAME } from '../games/underworld/game.ts';

export const ROUND_TITLES = GAME.roundTitles;
const BRIEFINGS = GAME.rounds.map(r => r.briefing);

/**
 * Seconds the server-timed briefing step lasts for round 1, 2 or 3. It comes from the word counts of
 * the round's story and rules (shared/briefing.ts), so shorter text gives a shorter briefing and the
 * phones animate on the same schedule.
 */
export function briefingSeconds(round: 1 | 2 | 3): number {
  return Math.ceil(briefingSchedule(BRIEFINGS[round - 1]).totalMs / 1000);
}

// Projector lines: the lobby line first, then every round's briefing line, then each round's step lines, then the finish line.
const INSTRUCTIONS: Record<string, string> = {
  LOBBY: GAME.lobbyInstruction,
  ...Object.assign({}, ...GAME.rounds.map(r => r.briefingInstructions)),
  ...Object.assign({}, ...GAME.rounds.map(r => r.instructions)),
  FINISHED: GAME.finishedInstruction,
};

export function titleFor(phase: PhaseName): string {
  if (phase.startsWith('R1')) return GAME.roundTitles[0];
  if (phase.startsWith('R2')) return GAME.roundTitles[1];
  if (phase.startsWith('R3')) return GAME.roundTitles[2];
  return phase === 'LOBBY' ? GAME.title : GAME.finishedTitle;
}

export function instructionFor(phase: PhaseName, step: string | null): string {
  return INSTRUCTIONS[`${phase}/${step}`] ?? INSTRUCTIONS[phase] ?? '';
}

export function buildMeta(): Meta {
  const { tablet, mist, styx } = GAME;
  return {
    protocol: PROTOCOL_VERSION,
    limits: LIMITS,
    roles: GAME.roles.map(r => ({ id: r.id, name: r.name, color: r.color, ...GAME.roleExtra[r.id] })),
    emojiPool: [...GAME.emojiPool],
    // Crew size N is chosen by the admin (3..6, default 5); the current value is in the lobby view (lobby.crewSize).
    teamSize: { min: CREW_SIZE_MIN, target: CREW_SIZE_DEFAULT, max: CREW_SIZE_MAX },
    durations: structuredClone(DEFAULT_DURATIONS),
    rounds: BRIEFINGS.map((b, i) => ({ ...b, briefingSeconds: briefingSeconds((i + 1) as 1 | 2 | 3) })),
    r2Stakes: Array.from({ length: mist.R2_CLASHES }, (_, i) => {
      const t = mist.R2_SCORING[String(i + 1)];
      return { clash: i + 1, bothTruce: t.both_truce, ambushWin: t.ambush_win, truceLoss: t.truce_loss, bothAmbush: t.both_ambush };
    }),
    vessels: styx.vessels,
    stances: mist.stances,
    sdActions: styx.sdActions,
    moralStatuses: mist.moralStatuses,
    hints: tablet.ROUND1_HINT_SECONDS.map((unlocksAfterSeconds, i) => ({ index: i + 1, unlocksAfterSeconds, cost: tablet.ROUND1_HINT_COST })),
    r3: { targetDistance: styx.R3.targetDistance, podiumSize: styx.R3.podiumSize, honourBonus: styx.R3.honourBonus },
    errors: { ...ERROR_MESSAGES },
    instructions: { ...INSTRUCTIONS },
  };
}
