// Small pieces shared by the recap cards: names of the moral legacies, a name trimmer and the award card.
import React from 'react';
import type { RecapAward, RecapData } from '../../recap.ts';

export const MORAL_LABEL: Record<string, { name: string; color: string; blurb: string }> = {
  HONOURABLE: { name: 'Honourable', color: '#38bdf8', blurb: 'Truce in every clash' },
  BETRAYED: { name: 'Betrayed', color: '#fb923c', blurb: 'Stabbed in the back. Holds the Leash.' },
  AGGRESSOR: { name: 'Aggressor', color: '#f43f5e', blurb: 'Struck first, struck most' },
  BLOOD_FEUD: { name: 'Blood Feud', color: '#a78bfa', blurb: 'Nobody came out clean' },
};

export const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const AwardCard: React.FC<{ award: RecapAward; recap: RecapData; mine?: boolean }> = ({ award, recap, mine }) => {
  const crew = recap.crews[award.crew];
  return (
    <div
      data-testid="recap-award"
      className={`rounded-3xl border bg-gradient-to-b from-[#1a1710] to-[#10121a] ${mine ? 'border-white' : 'border-[#c4a45a]/70'} p-4 space-y-2 text-center min-w-0 wr-rise`}
    >
      <div className="text-5xl">{award.emoji}</div>
      <div className="text-lg font-serif font-black text-[#e5cb87] leading-tight">{award.title}</div>
      {crew && (
        <div className="text-xl font-serif font-black text-[#f4f0e8] leading-tight [overflow-wrap:anywhere]">
          {crew.emoji} {crew.name}
        </div>
      )}
      <div className="text-sm text-[#cbd5e1]">{award.stat}</div>
      <div className="text-sm text-[#a9b4c7] italic">{award.blurb}</div>
    </div>
  );
};
