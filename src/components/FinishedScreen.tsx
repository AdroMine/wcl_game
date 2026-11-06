import React, { useState } from 'react';
import { useGame } from '../game/useGame';
import { ordinal } from './ui';
import { Podium } from '../../games/underworld/rounds/styx/ui/OdysseyEscapeRoyaleRound';

// The Wrap (a full-screen card story) is a separate chunk, fetched only when the player taps the button.
const WrappedCards = React.lazy(() => import('../../games/underworld/recap/ui/WrappedCards').then(m => ({ default: m.WrappedCards })));

/** The end screen: podium, "You: Nth" and one button that opens the Wrap overlay. */
export const FinishedScreen: React.FC = () => {
  const { view } = useGame();
  const [open, setOpen] = useState(false);
  const r3 = view?.r3;
  const place = r3?.escaped ? r3.escapedRank : (r3?.myPos ?? view?.team?.rank);
  return (
    <div className="space-y-5 pt-2">
      <Podium names={r3?.podium ?? []} />
      {place ? (
        <p data-testid="final-rank" className="text-center text-2xl font-serif font-black text-[#f4f0e8]">
          You: {ordinal(place)}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="open-wrapped"
        onClick={() => setOpen(true)}
        className="w-full min-h-[64px] rounded-2xl bg-gradient-to-b from-[#e5cb87] to-[#c4a45a] text-[#08090c] font-serif font-black text-2xl shadow-lg active:scale-[0.98]"
      >
        ✨ Underworld Wrap
      </button>
      {open && (
        <React.Suspense fallback={null}>
          <WrappedCards onClose={() => setOpen(false)} />
        </React.Suspense>
      )}
    </div>
  );
};
