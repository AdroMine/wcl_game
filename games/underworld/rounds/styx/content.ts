// ROUND 3: ESCAPE FROM TARTARUS (the River Styx escape royale). Everything an organizer may want to edit.
//
// - briefing.sentences / rules / objective: the story lines, rule boxes and goal box of the briefing.
//   The briefing's length is NOT set by hand: the server computes it from the word count of these
//   texts (shared/briefing.ts), and the phones animate on the same schedule.
// - R3: the numbers of the race (target distance, head start, bonuses, podium size, distance per vessel).
//   Changing numbers changes scoring: ask the organizer first (docs/GAME_MASTER_RULES_AND_DESIGN.md).
// - VESSELS_SAFEST_FIRST: tie-break order when a crew's vote is split.
// - SD_ACTIONS: the three Sudden Death moves.
// - R3_DURATIONS / SD_SECONDS: default seconds of each wave step and of Sudden Death (the host can change them live).
// - vessels (names, icons, notes) and sdActions: what phones show.
// - instructions: the line shown on the projector for each step of this round.
import type { Briefing } from '../../../../shared/protocol.ts';
import type { SdAction, Vessel } from '../../../../server/engine/types.ts';

export const briefing: Briefing = {
  stageNumber: 3,
  title: 'Escape from Tartarus',
  subtitle: 'The River Styx Escape Royale',
  sentences: [
    'You cross Tartarus and finally spot the exit across the River Styx!',
    "But Cerberus howls behind you—Hades's hound is closing in!",
    'Across the bank, the door is slowly closing.',
    'There are precious few minutes left. And 3 boats in front of you!',
    'Which boat will you select? And which will others?',
  ],
  rules: [
    { title: '1. Choose Your Vessel', desc: 'Rowboat 🚣: safe (+150m). Sailboat ⛵: fast (+300m, but holds at most 30% of the active crews). Ghost Ship⚡: Surge (+450m, one crew only).' },
    { title: '2. Congestion Hazards', desc: 'An overcrowded Sailboat capsizes (0m for everyone aboard). Two or more Ghost Ships collide (-50m each).' },
    { title: '3. Moral Legacies', desc: 'If you were betrayed: unleash the Stygian Leash once to take revenge on your rival and draw them back!' },
  ],
  objective: 'Reach 1,000m. Waves continue until 3 crews have escaped: the first three to cross win Gold, Silver and Bronze.',
};

export const R3 = {
  targetDistance: 1000,
  headstartDivisor: 5,
  maxHeadstart: 200,
  honourBonus: 75,
  sailboatCapacityPercent: 0.3,
  podiumSize: 3,
  anchorSiphon: 50,
  wreckBonus: 100,
  vessel: {
    ROWBOAT: { success: 150, fail: 150 },
    SAILBOAT: { success: 300, fail: 0 },
    GHOST_SHIP: { success: 450, fail: -50 },
  } as Record<Vessel, { success: number; fail: number }>,
};

/** Safest first: used for tie-breaking vessel votes (RULE_DECISIONS Q1/Q2). */
export const VESSELS_SAFEST_FIRST: readonly Vessel[] = ['ROWBOAT', 'SAILBOAT', 'GHOST_SHIP'];
export const SD_ACTIONS: readonly SdAction[] = ['SHIELDS', 'RAM', 'SAILS'];

/** Default seconds of each step of a wave, and of the Sudden Death standoff. */
export const R3_DURATIONS = { BLUFF: 55, VOTE: 20, REVEAL: 25 };
export const SD_SECONDS = 40;
/** Seconds every phone shows the Sudden Death reveal (both picks, then the winner) before the game moves on. */
export const SD_REVEAL_SECONDS = 12;

export const vessels: { id: Vessel; name: string; icon: string; success: number; fail: number; note: string }[] = [
  { id: 'ROWBOAT', name: 'Rowboat', icon: '🚣', success: R3.vessel.ROWBOAT.success, fail: R3.vessel.ROWBOAT.fail, note: 'Always safe.' },
  { id: 'SAILBOAT', name: 'Sailboat', icon: '⛵', success: R3.vessel.SAILBOAT.success, fail: R3.vessel.SAILBOAT.fail, note: 'Capsizes if more than 30% of the active crews board.' },
  { id: 'GHOST_SHIP', name: 'Ghost Ship', icon: '⚡', success: R3.vessel.GHOST_SHIP.success, fail: R3.vessel.GHOST_SHIP.fail, note: 'Only one crew may take it; two or more collide.' },
];

export const sdActions: { id: SdAction; name: string }[] = [
  { id: 'SHIELDS', name: 'Shields' },
  { id: 'RAM', name: 'Ram' },
  { id: 'SAILS', name: 'Sails' },
];

/** Projector line shown while the briefing step plays (kept apart so it lists before the round lines). */
export const briefingInstructions: Record<string, string> = { 'R3_ACTIVE/BRIEFING': 'Round 3 briefing: the story plays, then wave 1 starts.' };

/** Projector lines keyed by phase (or phase/step). */
export const instructions: Record<string, string> = {
  'R3_ACTIVE/BLUFF': 'Decision time: which boat will your crew select? Talk to other groups too to find their strategy and influence their choice.',
  'R3_ACTIVE/VOTE': 'Vote for your vessel now. The majority of your crew decides.',
  'R3_ACTIVE/REVEAL': 'The vessels are revealed. Watch the river.',
  'R3_ACTIVE/SUDDEN_DEATH': 'Sudden Death standoff between two crews. Shields beat Ram, Ram beats Sails, Sails beat Shields.',
  R3_RESULTS: 'The river is crossed. Congratulations to the podium.',
};
