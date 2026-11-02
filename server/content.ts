// Static game content served once from GET /api/meta (and the projector instructions).
// Briefing text follows docs/RULE_DECISIONS.md where it differs from the old client copy.
import { CREW_SIZE_DEFAULT, CREW_SIZE_MAX, CREW_SIZE_MIN, DEFAULT_DURATIONS, R2_CLASHES, R2_SCORING, ROLES, ROUND1_HINT_COST, TEAM_EMOJI_POOL, R3 } from './engine/config.ts';
import { ERROR_MESSAGES, LIMITS, PROTOCOL_VERSION } from '../shared/protocol.ts';
import type { Briefing, Meta, PhaseName } from '../shared/protocol.ts';

const ROLE_EXTRA: Record<string, { icon: string; description: string }> = {
  navigator: { icon: 'compass', description: 'Charts subterranean currents and celestial markers in the Stygian mist.' },
  oracle: { icon: 'eye', description: 'Deciphers echoes, prophetic portents, and spectral whispers.' },
  scholar: { icon: 'book', description: 'Knows ancient ciphers, Greek tablets, and forbidden cartography.' },
  torchbearer: { icon: 'flame', description: 'Wields the sacred eternal flame through the cavernous gloom.' },
  negotiator: { icon: 'shield', description: "Strikes pacts with shade sentinels and Charon's ferrymen." },
};

export const ROUND_TITLES = ['The Shattered Tablet', 'Shades in the Mist', 'Escape from Tartarus'] as const;

const BRIEFINGS: Briefing[] = [
  {
    stageNumber: 1,
    title: ROUND_TITLES[0],
    subtitle: 'Reconstruct the Ancient Tomb Codeword',
    sentences: [
      'Your crew is formed.',
      'Walking along Tartarus, you reach a sealed ancient door.',
      'You need a codeword to pass through.',
      'Pieces of a broken ancient stone tablet lie on the ground in front of you.',
      'Can you solve it in time to escape this place?',
    ],
    rules: [
      { title: '1. Re-arrange Pieces', desc: 'Lay phones side-by-side. Match and align the golden fracture runes to reconstruct the ancient stone tablet.' },
      { title: '2. Decipher & Submit', desc: 'Read the connected 2-word phrase. Any teammate can type and submit on their phone screen.' },
    ],
    objective: 'Unseal the tomb gate before 5:00 runs out. Fast solves award up to +300 PTS (50 PTS guaranteed floor). Each hint you take costs 30 PTS.',
  },
  {
    stageNumber: 2,
    title: ROUND_TITLES[1],
    subtitle: 'The 3-Clash Social Dilemma',
    sentences: [
      'You escape through the ancient door and stumble into a vast, cavernous hall as thick Stygian mist rolls in.',
      'Another door swings open to your flank: another crew of shades emerges from the shadows.',
      'Are these trustworthy friends, or enemies who will betray you?',
      'You must decide before you can move forward.',
    ],
    rules: [
      { title: '1. Private Huddle (50s)', desc: "Whisper at your table only. Agree on your team's secret stance: Truce or Ambush." },
      { title: '2. The Dialogue (40s)', desc: 'Face your rival crew across the room to parley and make pacts. Bluffing is 100% permitted!' },
      { title: '3. Secret Blind Vote (25s)', desc: 'Vote privately on your phone. The majority decides; a tied vote counts as Truce.' },
    ],
    objective: '3 Clashes with escalating stakes (up to +900 PTS). Mutual Truce yields shared honour; Ambush risks a mutual brawl (+15 PTS).',
  },
  {
    stageNumber: 3,
    title: ROUND_TITLES[2],
    subtitle: 'The River Styx Escape Royale',
    sentences: [
      'You traverse the deep chambers of Tartarus and can finally see the exit, framed across the wide River Styx.',
      "But the terrifying howls of Cerberus echo behind you: Hades's trusted guardian hound is getting near!",
      'The door, visible across the far bank, is slowly starting to close.',
      'There are precious few minutes left.',
      'Can your crew reach the portal before it seals forever?',
    ],
    rules: [
      { title: '1. Choose Your Vessel', desc: 'Rowboat: safe (+150m). Sailboat: fast (+300m, holds at most 30% of the active crews). Ghost Ship: surge (+450m, one crew only).' },
      { title: '2. Congestion Hazards', desc: 'An overcrowded Sailboat capsizes (0m for everyone aboard). Two or more Ghost Ships collide (-50m each).' },
      { title: '3. Moral Legacies', desc: 'Betrayed: unleash the Stygian Leash once to drain your rival. Honourable: +75m starting boost.' },
    ],
    objective: 'Reach 1,000m. Waves continue until 3 crews have escaped: the first three across win Gold, Silver and Bronze.',
  },
];

/**
 * Seconds the server-timed briefing step lasts for round 1, 2 or 3, computed from the round's story
 * and rules so clients can animate the briefing in sync:
 * ceil(sentences * 2.8 + 3 + (rules + 1) * 2 + 3).
 */
export function briefingSeconds(round: 1 | 2 | 3): number {
  const b = BRIEFINGS[round - 1];
  return Math.ceil(b.sentences.length * 2.8 + 3 + (b.rules.length + 1) * 2 + 3);
}

const INSTRUCTIONS: Record<string, string> = {
  LOBBY: 'Join the game on your phone. Form a crew with different roles, using your team code.',
  'R1_ACTIVE/BRIEFING': 'Round 1 briefing: the story plays, then the 5:00 clock starts.',
  'R2_CLASH/BRIEFING': 'Round 2 briefing: the story plays, then the first clash starts.',
  'R3_ACTIVE/BRIEFING': 'Round 3 briefing: the story plays, then wave 1 starts.',
  R1_ACTIVE: 'Round 1: lay your crew phones side by side to read the tablet, then any teammate submits the codeword. Hints unlock at 2:00, 3:00 and 4:00 and cost 30 points each.',
  R1_RESULTS: 'Round 1 is over. Eyes up for the standings.',
  R2_PAIRING: 'Round 2: find your rival crew. One of you types their 2-digit battle code to link the crews.',
  'R2_CLASH/HUDDLE': 'Huddle with your own crew. Whisper: Truce or Ambush?',
  'R2_CLASH/PARLEY': 'Face your rival crew and talk. Bluffing is allowed.',
  'R2_CLASH/VOTE': 'Vote now on your phone. The majority of your crew decides. A tie is a Truce.',
  'R2_CLASH/DEBRIEF': 'The clash is scored. See what your rival chose.',
  R2_RESULTS: 'Round 2 is over. Moral legacies are decided: Honourable, Betrayed, Aggressor or Blood Feud.',
  'R3_ACTIVE/BLUFF': 'Round 3: choose a vessel as a crew. Sailboat holds 30% of crews, only one crew may take the Ghost Ship. Bluff the room.',
  'R3_ACTIVE/VOTE': 'Vote for your vessel now. The majority of your crew decides.',
  'R3_ACTIVE/REVEAL': 'The vessels are revealed. Watch the river.',
  'R3_ACTIVE/SUDDEN_DEATH': 'Sudden Death standoff between two crews. Shields beat Ram, Ram beats Sails, Sails beat Shields.',
  R3_RESULTS: 'The river is crossed. Congratulations to the podium.',
  FINISHED: 'Thanks for playing. Final standings are on screen.',
};

export function titleFor(phase: PhaseName): string {
  if (phase.startsWith('R1')) return ROUND_TITLES[0];
  if (phase.startsWith('R2')) return ROUND_TITLES[1];
  if (phase.startsWith('R3')) return ROUND_TITLES[2];
  return phase === 'LOBBY' ? 'The Underworld' : 'Underworld';
}

export function instructionFor(phase: PhaseName, step: string | null): string {
  return INSTRUCTIONS[`${phase}/${step}`] ?? INSTRUCTIONS[phase] ?? '';
}

export function buildMeta(): Meta {
  return {
    protocol: PROTOCOL_VERSION,
    limits: LIMITS,
    roles: ROLES.map(r => ({ id: r.id, name: r.name, color: r.color, ...ROLE_EXTRA[r.id] })),
    emojiPool: [...TEAM_EMOJI_POOL],
    // Crew size N is chosen by the admin (3..6, default 5); the current value is in the lobby view (lobby.crewSize).
    teamSize: { min: CREW_SIZE_MIN, target: CREW_SIZE_DEFAULT, max: CREW_SIZE_MAX },
    durations: structuredClone(DEFAULT_DURATIONS),
    rounds: BRIEFINGS.map((b, i) => ({ ...b, briefingSeconds: briefingSeconds((i + 1) as 1 | 2 | 3) })),
    r2Stakes: Array.from({ length: R2_CLASHES }, (_, i) => {
      const t = R2_SCORING[String(i + 1)];
      return { clash: i + 1, bothTruce: t.both_truce, ambushWin: t.ambush_win, truceLoss: t.truce_loss, bothAmbush: t.both_ambush };
    }),
    vessels: [
      { id: 'ROWBOAT', name: 'Rowboat', icon: '🚣', success: R3.vessel.ROWBOAT.success, fail: R3.vessel.ROWBOAT.fail, note: 'Always safe.' },
      { id: 'SAILBOAT', name: 'Sailboat', icon: '⛵', success: R3.vessel.SAILBOAT.success, fail: R3.vessel.SAILBOAT.fail, note: 'Capsizes if more than 30% of the active crews board.' },
      { id: 'GHOST_SHIP', name: 'Ghost Ship', icon: '⚡', success: R3.vessel.GHOST_SHIP.success, fail: R3.vessel.GHOST_SHIP.fail, note: 'Only one crew may take it; two or more collide.' },
    ],
    stances: [
      { id: 'TRUCE', name: 'Truce' },
      { id: 'AMBUSH', name: 'Ambush' },
    ],
    sdActions: [
      { id: 'SHIELDS', name: 'Shields' },
      { id: 'RAM', name: 'Ram' },
      { id: 'SAILS', name: 'Sails' },
    ],
    moralStatuses: [
      { id: 'HONOURABLE', name: 'Honourable', note: 'Truce in all three clashes: +75m head start.' },
      { id: 'BETRAYED', name: 'Betrayed', note: 'Ambushed more than you ambushed: you hold the Stygian Leash.' },
      { id: 'AGGRESSOR', name: 'Aggressor', note: 'You ambushed more than you were ambushed.' },
      { id: 'BLOOD_FEUD', name: 'Blood Feud', note: 'Everything else.' },
      { id: 'NONE', name: 'Unmatched', note: 'No resolved clashes.' },
    ],
    hints: [
      { index: 1, unlocksAfterSeconds: 120, cost: ROUND1_HINT_COST },
      { index: 2, unlocksAfterSeconds: 180, cost: ROUND1_HINT_COST },
      { index: 3, unlocksAfterSeconds: 240, cost: ROUND1_HINT_COST },
    ],
    r3: { targetDistance: R3.targetDistance, podiumSize: R3.podiumSize, honourBonus: R3.honourBonus },
    errors: { ...ERROR_MESSAGES },
    instructions: { ...INSTRUCTIONS },
  };
}
