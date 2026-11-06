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
    'Beyond the door, another crew steps out of the mist.',
    'Friends, or foes?',
  ],
  rules: [
    { title: '1. Find a rival crew', desc: "Pair up by typing their 3-emoji code.", icon: 'users' },
    { title: '2. Talk (60s)', desc: 'Plot with your crew, bargain with theirs.', icon: 'talk' },
    { title: '3. Vote any time', desc: 'Truce or Ambush, on your phone.', icon: 'vote' },
    { title: '4. Every choice pays differently', desc: 'Both Truce: both score.\nAmbush a Truce: double for you, nothing for them.\nBoth Ambush: crumbs.', icon: 'coins' },
  ],
  objective: 'Three clashes, rising stakes. Exact points show on the next screen.',
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

/**
 * Default seconds of each step of a clash. VOTE: crews talk AND vote, voting open the whole time; DEBRIEF: the reveal.
 * (Organizer ruling, Nov 4 2026: HUDDLE and PARLEY are no longer used.)
 */
export const R2_DURATIONS = { VOTE: 60, DEBRIEF: 15 };

export const stances: { id: Stance; name: string }[] = [
  { id: 'TRUCE', name: 'Truce' },
  { id: 'AMBUSH', name: 'Ambush' },
];

export const moralStatuses: { id: MoralStatus; name: string; note: string }[] = [
  { id: 'HONOURABLE', name: 'Honourable', note: 'Truce in all three clashes: +75m head start.' },
  { id: 'BETRAYED', name: 'Betrayed', note: 'Ambushed more than you ambushed: you may take Revenge in Round 3.' },
  { id: 'AGGRESSOR', name: 'Aggressor', note: 'You ambushed more than you were ambushed.' },
  { id: 'BLOOD_FEUD', name: 'Blood Feud', note: 'Everything else.' },
  { id: 'NONE', name: 'Unmatched', note: 'No resolved clashes.' },
];

/** Projector line shown while the briefing step plays (kept apart so it lists before the round lines). */
export const briefingInstructions: Record<string, string> = { 'R2_CLASH/BRIEFING': 'Round 2 briefing: the story plays, then the first clash starts.' };

/** Projector lines keyed by phase (or phase/step). */
export const instructions: Record<string, string> = {
  R2_PAIRING: "Round 2: find your rival crew. One of you types their crew's emoji code to link the crews.",
  'R2_CLASH/VOTE': 'Talk with your crew and your rival, then vote on your phone. Majority decides; a tie is a Truce.',
  'R2_CLASH/DEBRIEF': 'The clash is scored. See what your rival chose.',
  R2_RESULTS: 'Round 2 is over. Moral legacies are decided: Honourable, Betrayed, Aggressor or Blood Feud.',
};
