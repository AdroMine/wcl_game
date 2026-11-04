// "UNDERWORLD WRAPPED": the words of the end-of-game recap. Edit freely; restart the server after a change.
//
// - RECAP_TITLE / RECAP_SUBTITLE: shown on the projector and on every phone.
// - TEASER: the last slide on the projector, and the last card on the phones.
// - AWARDS: the crew-level award cards (never an individual player). `title` is the card name, `emoji` the badge,
//   `blurb` the one-line explanation. Which crew wins each one is decided in recap.ts.
// - SLIDE_TITLES: legacy slide headings (the projector no longer shows the recap).
// - FRONT_PAGE: the words of "The Underworld Times", the single shareable card. The headline reads
//   "<Gold crew>" + escapesFirst + (roomBetrays | roomKeepsPeace); the kicker and the room phrase follow whether
//   ambush stances were at least half of all stances in the Round 2 clashes. {crews} in the dek becomes "42 crews".
// Nothing here changes rules or scoring.

export const RECAP_TITLE = 'Underworld Wrapped';
export const RECAP_SUBTITLE = 'The night the shades will not forget';

export const TEASER = {
  title: 'The Christmas game is coming…',
  lines: ['New crews. New rules. Same bad ideas.', 'Be there.'],
};

export interface AwardDef {
  title: string;
  emoji: string;
  blurb: string;
}

export const AWARDS: Record<string, AwardDef> = {
  treacherous: { title: 'Most Treacherous Crew', emoji: '🗡️', blurb: 'Ambushed the most. Trusted no one.' },
  saints: { title: 'Saints of the Styx', emoji: '😇', blurb: 'Kept the truce every single clash, whatever the rival did.' },
  kamikaze: { title: 'Kamikaze', emoji: '💥', blurb: 'Sailed the Ghost Ship into the most collisions.' },
  revenge: { title: 'Revenge Served Cold', emoji: '🐕', blurb: 'The Stygian Leash that hurt the most.' },
  divided: { title: 'House Divided', emoji: '🏚️', blurb: 'Could never agree on a boat.' },
  comeback: { title: 'Comeback Crew', emoji: '🚀', blurb: 'Climbed the most places on the river.' },
  tablet: { title: 'Fastest Tablet', emoji: '⚡', blurb: 'Cracked the Shattered Tablet first.' },
};

export const SLIDE_TITLES = {
  intro: 'Underworld Wrapped',
  headlines: 'The night in numbers',
  betrayal: 'The betrayal river',
  dilemma: 'The dilemma scoreboard',
  moral: 'Moral legacy wall',
  fleet: 'The fleet, wave by wave',
  race: 'The race replay',
  tablet: 'Tablet speedrun',
  awards: 'The awards',
  podium: 'Escaped Tartarus',
};

export const FRONT_PAGE = {
  masthead: 'The Underworld Times',
  volume: 'VOL. I',
  kickerBetrayal: 'BETRAYAL IN TARTARUS',
  kickerHonour: 'HONOUR AMONG SHADES',
  escapesFirst: 'escapes first as',
  roomBetrays: 'the room turns on itself',
  roomKeepsPeace: 'most of the room keeps the peace',
  noWinnerHeadline: 'Nobody has escaped Tartarus yet',
  dek: '{crews} rebuilt a cursed tablet, bargained with rivals, then raced across the Styx.',
  quoteTreacherousLabel: 'Most treacherous crew',
  quoteSaintsLabel: 'Saints of the Styx',
  next: 'NEXT EDITION: CHRISTMAS',
};
