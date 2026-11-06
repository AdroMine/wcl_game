// Test hooks for design checks and screenshots: /wrapped-preview opens the phone "Underworld Wrap" overlay on fixture data
// (no server needed; ?crew=1 previews the second fixture crew) and /front-page shows only the front page (live recap).
import React from 'react';
import { FrontPagePanel } from './FrontPagePanel.tsx';
import type { RecapData } from '../../recap.ts';
import { WrappedOverlay } from './WrappedCards.tsx';

const crew = (name: string, emoji: string, rank: number, extra: object) => ({ name, emoji, rank, score: 900 - rank * 100, stances: 'TTA', outcomes: 'MDB', escape: 0, metres: [0, 300, 650], ranks: [rank, rank, rank], awards: [], ...extra });
const FIXTURE = {
  crews: [crew('The Salty Shades', '🔥🐍🌊', 1, { escape: 1, metres: [0, 400, 1000], ranks: [3, 2, 1] }), crew('Angels of Tartarus', '😇🕊️🌙', 2, { stances: 'TTT', outcomes: 'MDD', escape: 2 }), crew('Late Arrivals', '🐢🐌🕰️', 14, { stances: 'ATT', outcomes: 'BMM' })],
  betrayal: [{ clash: 1, truce: 30, ambush: 10 }, { clash: 2, truce: 24, ambush: 16 }, { clash: 3, truce: 22, ambush: 18 }],
  awards: [
    { id: 'treacherous', title: 'Most Treacherous Crew', emoji: '🗡️', blurb: '', crew: 2, stat: 'ambushed in 1 of 3 clashes' },
    { id: 'saints', title: 'The True Angel', emoji: '😇', blurb: '', crew: 1, stat: 'Truce every clash, betrayed 2 times each', tied: [2] },
    { id: 'comeback', title: 'Comeback Crew', emoji: '🚀', blurb: '', crew: 0, stat: 'from 3rd to 1st on the river' },
  ],
  teaser: { title: 'A Christmas game is coming', lines: [] },
} as unknown as RecapData;

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#08090c] text-[#f4f0e8]">
    <div className="w-full max-w-[480px] mx-auto px-4 py-4">{children}</div>
  </div>
);

export const WrappedPreview: React.FC = () => {
  const n = Math.min(2, Math.max(0, Number(new URLSearchParams(window.location.search).get('crew') ?? 0)));
  const c = FIXTURE.crews[n];
  const [open, setOpen] = React.useState(true);
  return (
    <Shell>
      <button type="button" onClick={() => setOpen(true)} className="w-full min-h-[64px] rounded-2xl bg-[#c4a45a] text-[#08090c] font-serif font-black text-2xl">
        ✨ Underworld Wrap
      </button>
      {open && <WrappedOverlay recap={FIXTURE} team={{ emojiCode: c.emoji, name: c.name }} onClose={() => setOpen(false)} />}
    </Shell>
  );
};

export const FrontPagePreview: React.FC = () => (
  <Shell>
    <FrontPagePanel />
  </Shell>
);
