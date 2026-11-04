// THE UNDERWORLD: game-level content. A "disk" is one game; this file describes the game as a whole
// and lists its rounds. Round-specific text and numbers live in rounds/<round>/content.ts.
//
// - TITLE: the name shown on the projector in the lobby (FINISHED_TITLE after the last round).
// - ROUND_TITLES: the round names, in play order (taken from each round's briefing).
// - ROLES / ROLE_EXTRA: the five crew roles (name, colour) and their icon and flavour text.
// - TEAM_EMOJI_POOL / TEAM_EMOJI_LABELS: the crew emblems players choose from, and the words used in team codes.
// - lobbyInstruction / finishedInstruction: projector lines before the first round and after the last.
import type { RoleId } from '../../server/engine/types.ts';
import * as tablet from './rounds/tablet/content.ts';
import * as mist from './rounds/mist/content.ts';
import * as styx from './rounds/styx/content.ts';

export const TITLE = 'The Underworld';
export const FINISHED_TITLE = 'Underworld';

export const ROUND_TITLES = [tablet.briefing.title, mist.briefing.title, styx.briefing.title] as const;

export const ROLES: readonly { id: RoleId; name: string; color: string }[] = [
  { id: 'navigator', name: 'Navigator', color: '#38bdf8' },
  { id: 'oracle', name: 'Oracle', color: '#c084fc' },
  { id: 'scholar', name: 'Scholar', color: '#34d399' },
  { id: 'torchbearer', name: 'Torchbearer', color: '#fb923c' },
  { id: 'negotiator', name: 'Negotiator', color: '#f43f5e' },
];

export const ROLE_EXTRA: Record<string, { icon: string; description: string }> = {
  navigator: { icon: 'compass', description: 'Charts subterranean currents and celestial markers in the Stygian mist.' },
  oracle: { icon: 'eye', description: 'Deciphers echoes, prophetic portents, and spectral whispers.' },
  scholar: { icon: 'book', description: 'Knows ancient ciphers, Greek tablets, and forbidden cartography.' },
  torchbearer: { icon: 'flame', description: 'Wields the sacred eternal flame through the cavernous gloom.' },
  negotiator: { icon: 'shield', description: "Strikes pacts with shade sentinels and Charon's ferrymen." },
};

export const TEAM_EMOJI_POOL = ['🔥', '💀', '⚡', '🌊', '🛡️'] as const;
export const TEAM_EMOJI_LABELS: Record<string, string> = {
  '🔥': 'Fire',
  '💀': 'Skull',
  '⚡': 'Bolt',
  '🌊': 'Wave',
  '🛡️': 'Shield',
};

export const lobbyInstruction = 'Join the game on your phone. Form a crew with different roles, using your team code.';
export const finishedInstruction = 'Thanks for playing. Final standings are on screen.';

/** The disk: what server/content.ts reads. `rounds` is in play order. */
export const GAME = {
  id: 'underworld',
  title: TITLE,
  finishedTitle: FINISHED_TITLE,
  roundTitles: ROUND_TITLES,
  roles: ROLES,
  roleExtra: ROLE_EXTRA,
  emojiPool: TEAM_EMOJI_POOL,
  emojiLabels: TEAM_EMOJI_LABELS,
  lobbyInstruction,
  finishedInstruction,
  rounds: [tablet, mist, styx],
  // Round-specific extras the (still Underworld-shaped) meta needs; the generic round interface is step 2.
  tablet,
  mist,
  styx,
};
