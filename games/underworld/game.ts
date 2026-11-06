// THE UNDERWORLD: game-level content. A "disk" is one game; this file describes the game as a whole
// and lists its rounds. Round-specific text and numbers live in rounds/<round>/content.ts.
//
// - TITLE: the name shown on the projector in the lobby (FINISHED_TITLE after the last round).
// - ROUND_TITLES: the round names, in play order (taken from each round's briefing).
// - TEAM_EMOJI_POOL / TEAM_EMOJI_LABELS: the crew emblems players choose from, and the words used in team codes.
// - lobbyInstruction / finishedInstruction: projector lines before the first round and after the last.
import * as tablet from './rounds/tablet/content.ts';
import * as mist from './rounds/mist/content.ts';
import * as styx from './rounds/styx/content.ts';
import { buildRecap } from './recap.ts';
import { buildGameCsv, buildGameExport } from './export.ts';

export const TITLE = 'The Underworld';
export const FINISHED_TITLE = 'Underworld';

export const ROUND_TITLES = [tablet.briefing.title, mist.briefing.title, styx.briefing.title] as const;

export const TEAM_EMOJI_POOL = ['🔥', '💀', '⚡', '🌊'] as const;
export const TEAM_EMOJI_LABELS: Record<string, string> = {
  '🔥': 'Fire',
  '💀': 'Skull',
  '⚡': 'Bolt',
  '🌊': 'Wave',
};

export const lobbyInstruction = 'Join the game on your phone. Form a crew with your friends, using your team code.';
export const finishedInstruction = 'Thanks for playing. Final standings are on screen.';

/** The disk: what server/content.ts reads. `rounds` is in play order. */
export const GAME = {
  id: 'underworld',
  title: TITLE,
  finishedTitle: FINISHED_TITLE,
  roundTitles: ROUND_TITLES,
  emojiPool: TEAM_EMOJI_POOL,
  emojiLabels: TEAM_EMOJI_LABELS,
  lobbyInstruction,
  finishedInstruction,
  rounds: [tablet, mist, styx],
  // End-of-game extras (pure functions of the final state): the public recap, and the admin's data export.
  recap: buildRecap,
  exportJson: buildGameExport,
  exportCsv: buildGameCsv,
  // Round-specific extras the (still Underworld-shaped) meta needs; the generic round interface is step 2.
  tablet,
  mist,
  styx,
};
