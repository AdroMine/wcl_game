// Test hooks that render the recap against the live game without a player session, for design checks and
// screenshots: /wrapped-preview?crew=N shows the phone recap of crew number N (0 = first place) and /front-page
// shows only the front page. Both read the public recap only.
import React from 'react';
import { FrontPagePanel } from './FrontPagePanel.tsx';
import { useRecap } from './useRecap.ts';
import { WrappedBody } from './WrappedCards.tsx';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#08090c] text-[#f4f0e8]">
    <div className="w-full max-w-[480px] mx-auto px-4 py-4">{children}</div>
  </div>
);

export const WrappedPreview: React.FC = () => {
  const { recap } = useRecap(true, undefined, undefined);
  const n = Number(new URLSearchParams(window.location.search).get('crew') ?? 0);
  if (!recap) return <div className="p-8 text-center text-[#a9b4c7]">Loading the recap…</div>;
  const c = recap.crews[Math.min(Math.max(0, n), recap.crews.length - 1)];
  return (
    <Shell>
      <WrappedBody recap={recap} team={c ? { emojiCode: c.emoji, name: c.name } : undefined} />
    </Shell>
  );
};

export const FrontPagePreview: React.FC = () => (
  <Shell>
    <FrontPagePanel />
  </Shell>
);
