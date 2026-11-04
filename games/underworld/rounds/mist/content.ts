// ROUND 2: SHADES IN THE MIST. Everything an organizer may want to edit for this round.
//
// - briefing.sentences / rules / objective: the story lines, rule boxes and goal box of the briefing.
//   The briefing's length is NOT set by hand: the server computes it from the word count of these
//   texts (shared/briefing.ts), and the phones animate on the same schedule.
// - R2_CLASHES: how many clashes each pair of crews plays.
// - R2_SCORING: points per clash (key = clash number) for each outcome. Changing numbers changes
//   scoring: ask the organizer first (docs/GAME_MASTER_RULES_AND_DESIGN.md, docs/RULE_DECISIONS.md).
// - R2_DURATIONS: default seconds of each clash step (the host can change them live).
// - stances / moralStatuses: names (and explanations for the moral legacies) shown on phones.
// - instructions: the line shown on the projector for each step of this round.
import type { Briefing, MoralStatus, Stance } from '../../../../shared/protocol.ts';

export const briefing: Briefing = {
  stageNumber: 2,
  title: 'Shades in the Mist',
  subtitle: 'The 3-Clash Social Dilemma',
  sentences: [
    'You flee through the door into a vast, misty hall.',
    'Another door swings open: another crew of shades emerges from the shadows.',
    'Are they friends or foes?',
    'You must decide before you can move forward.',
  ],
  rules: [
    { title: '1. Private Huddle (50s)', desc: "Discuss and decide within your team: Truce or Ambush." },
    { title: '2. The Dialogue (40s)', desc: 'Talk with your rivals. Bluffing is 100% permitted!' },
    { title: '3. Secret Blind Vote (25s)', desc: 'Vote on phone. Majority decides; Tie = Truce.' },
  ],
  objective: '3 Clashes with escalating stakes (up to +900 PTS). See points for each decisions on next screen',
};

export const R2_CLASHES = 3;
export interface Round2ScoringTier {
  both_truce: number;
  ambush_win: number;
  truce_loss: number;
  both_ambush: number;
}
export const R2_SCORING: Record<string, Round2ScoringTier> = {
  '1': { both_truce: 75, ambush_win: 150, truce_loss: 0, both_ambush: 15 },
  '2': { both_truce: 150, ambush_win: 300, truce_loss: 0, both_ambush: 30 },
  '3': { both_truce: 225, ambush_win: 450, truce_loss: 0, both_ambush: 45 },
};

/** Default seconds of each step of a clash. */
export const R2_DURATIONS = { HUDDLE: 50, PARLEY: 40, VOTE: 25, DEBRIEF: 40 };

export const stances: { id: Stance; name: string }[] = [
  { id: 'TRUCE', name: 'Truce' },
  { id: 'AMBUSH', name: 'Ambush' },
];

export const moralStatuses: { id: MoralStatus; name: string; note: string }[] = [
  { id: 'HONOURABLE', name: 'Honourable', note: 'Truce in all three clashes: +75m head start.' },
  { id: 'BETRAYED', name: 'Betrayed', note: 'Ambushed more than you ambushed: you hold the Stygian Leash.' },
  { id: 'AGGRESSOR', name: 'Aggressor', note: 'You ambushed more than you were ambushed.' },
  { id: 'BLOOD_FEUD', name: 'Blood Feud', note: 'Everything else.' },
  { id: 'NONE', name: 'Unmatched', note: 'No resolved clashes.' },
];

/** Projector line shown while the briefing step plays (kept apart so it lists before the round lines). */
export const briefingInstructions: Record<string, string> = { 'R2_CLASH/BRIEFING': 'Round 2 briefing: the story plays, then the first clash starts.' };

/** Projector lines keyed by phase (or phase/step). */
export const instructions: Record<string, string> = {
  R2_PAIRING: 'Round 2: find your rival crew. One of you types their 2-digit battle code to link the crews.',
  'R2_CLASH/HUDDLE': 'Huddle with your own crew. Whisper: Truce or Ambush?',
  'R2_CLASH/PARLEY': 'Face your rival crew and talk. Bluffing is allowed.',
  'R2_CLASH/VOTE': 'Vote now on your phone. The majority of your crew decides. A tie is a Truce.',
  'R2_CLASH/DEBRIEF': 'The clash is scored. See what your rival chose.',
  R2_RESULTS: 'Round 2 is over. Moral legacies are decided: Honourable, Betrayed, Aggressor or Blood Feud.',
};
