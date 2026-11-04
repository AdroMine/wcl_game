// ROUND 1: THE SHATTERED TABLET. Everything an organizer may want to edit for this round.
//
// - briefing.sentences: the story lines, shown one by one.
// - briefing.rules: the rule boxes (title + description).
// - briefing.objective: the goal box shown last.
// The briefing's length is NOT set by hand: the server computes it from the word count of these
// texts (shared/briefing.ts), and the phones animate on the same schedule. Shorter text, shorter briefing.
// - CODEWORDS: the secret two-word phrases; each crew is dealt one (the engine picks with the seeded RNG).
// - ROUND1_HINT_COST / ROUND1_HINT_SECONDS: points a hint costs, and the seconds after which hints 1, 2, 3 unlock.
// - ROUND1_FLOOR: the guaranteed minimum score for a solve.
// - ROUND1_SECONDS: how long the round lasts by default (the host can change it live).
// - instructions: the line shown on the projector for each step of this round.
// Changing numbers here changes scoring: ask the organizer first (docs/GAME_MASTER_RULES_AND_DESIGN.md).
import type { Briefing } from '../../../../shared/protocol.ts';

export const briefing: Briefing = {
  stageNumber: 1,
  title: 'The Shattered Tablet',
  subtitle: 'Reconstruct the Ancient Tomb Codeword',
  sentences: [
    'Your crew is formed.',
    'Walking along Tartarus, you reach a sealed ancient door.',
    'You need a codeword to pass through.',
    'Pieces of a broken ancient stone tablet lie on the ground in front of you.',
    'Can you solve it in time to escape this place?',
  ],
  rules: [
    { title: '1. Re-arrange Pieces', desc: 'Match and align phones to see the codeword.' },
    { title: '2. Decipher & Submit', desc: 'Any teammate can submit.' },
  ],
  objective: 'Unseal the tomb gate before 5:00 runs out.',
};

export const CODEWORDS: readonly string[] = [
  'CRIMSON SHADOW',
  'MIDNIGHT BELL',
  'OBSIDIAN GATE',
  'SILENT SPECTER',
  'ANCIENT CURSE',
  'HOLLOW GRAVE',
  'PHANTOM WRATH',
  'BLOOD MOON',
  'BURNING ALTAR',
  'EMERALD TOMB',
];

export const ROUND1_HINT_COST = 30;
export const ROUND1_FLOOR = 50;
/** Seconds into the round after which hint 1, 2 and 3 unlock. */
export const ROUND1_HINT_SECONDS: readonly number[] = [120, 180, 240];
export const ROUND1_SECONDS = 300;

/** Projector line shown while the briefing step plays (kept apart so it lists before the round lines). */
export const briefingInstructions: Record<string, string> = { 'R1_ACTIVE/BRIEFING': 'Round 1 briefing: the story plays, then the 5:00 clock starts.' };

/** Projector lines keyed by phase (or phase/step). */
export const instructions: Record<string, string> = {
  R1_ACTIVE: 'Round 1: lay your crew phones side by side to read the tablet, then any teammate submits the codeword.',
  R1_RESULTS: 'Round 1 is over. Eyes up for the standings.',
};
