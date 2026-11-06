// "Underworld Wrap" on a phone: a full-screen story of swipeable cards, one idea each, crew-level only (nothing names a
// player). Opened from the end screen (src/components/FinishedScreen.tsx); display only. The data is the public recap
// document (useRecap). This whole file is a lazy chunk, so none of it is in the main player bundle.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useGame } from '../../../../src/game/useGame';
import { ordinal } from '../../../../src/components/ui';
import type { RecapCrew, RecapData } from '../../recap.ts';
import { useRecap } from './useRecap.ts';

const STANCE_ICON: Record<string, string> = { T: '🤝', A: '🗡️' };
const MEDAL = ['🥇', '🥈', '🥉'];
const MEDAL_NAME = ['Gold', 'Silver', 'Bronze'];
const count = (s: string, ch: string): number => s.split(ch).length - 1;

interface CardDef {
  id: string;
  emoji: string;
  big: string;
  lines: string[];
  /** Small label above the card, e.g. "Your results". */
  label?: string;
}

/** The cards for one crew (`crew` undefined: a spectator sees only the room-wide cards). Cards without data are not in the list. */
export function buildCards(recap: RecapData, crew: RecapCrew | undefined): CardDef[] {
  const cards: CardDef[] = [];
  if (crew) {
    const place = crew.ranks.length > 0 ? crew.ranks[crew.ranks.length - 1] : crew.rank;
    const metres = crew.metres.length > 0 ? Math.round(crew.metres[crew.metres.length - 1]) : 0;
    const medal = crew.escape >= 1 && crew.escape <= 3;
    cards.push({
      id: 'crew',
      label: 'Your results',
      emoji: medal ? MEDAL[crew.escape - 1] : '🌊',
      big: medal ? MEDAL_NAME[crew.escape - 1] : ordinal(place),
      lines: [`${crew.emoji} ${crew.name}`, `${metres} m`],
    });

    const icons = [...crew.stances].map(c => STANCE_ICON[c]).filter(Boolean);
    if (icons.length > 0) {
      const d = count(crew.outcomes, 'D');
      const line = d > 0 ? (d === 1 ? 'Betrayed once' : `Betrayed ${d} times`) : count(crew.stances, 'A') > 0 ? 'You struck first' : 'Truce all the way';
      cards.push({ id: 'round2', label: 'Your results · Round 2', emoji: '', big: icons.join(' '), lines: [line] });
    }
  }
  const truce = recap.betrayal.reduce((a, b) => a + b.truce, 0);
  const ambush = recap.betrayal.reduce((a, b) => a + b.ambush, 0);
  if (truce + ambush > 0) {
    const t = truce >= ambush;
    cards.push({ id: 'room', emoji: t ? '🤝' : '🗡️', big: `${Math.round(((t ? truce : ambush) / (truce + ambush)) * 100)}%`, lines: [`chose ${t ? 'Truce' : 'Betrayal'}`] });
  }
  for (const id of ['treacherous', 'saints', 'comeback']) {
    const a = recap.awards.find(x => x.id === id);
    const c = a ? recap.crews[a.crew] : undefined;
    if (a && c) {
      const names = [a.crew, ...(a.tied ?? [])].map(i => `${recap.crews[i].emoji} ${recap.crews[i].name}`);
      cards.push({ id: `award-${id}`, emoji: a.emoji, big: a.title, lines: [...names, a.stat] });
    }
  }
  cards.push({ id: 'teaser', emoji: '🎄', big: recap.teaser.title, lines: [] });
  return cards;
}

const Card: React.FC<{ card: CardDef; index: number }> = ({ card, index }) => (
  <section
    data-testid="wrapped-card"
    data-card={card.id}
    aria-label={`Card ${index + 1}`}
    className="w-full h-full shrink-0 snap-center flex flex-col items-center justify-center gap-4 px-8 text-center bg-gradient-to-b from-[#1a1710] via-[#10121a] to-[#08090c]"
  >
    {card.label && <p className="text-base font-bold uppercase tracking-widest text-[#c4a45a]">{card.label}</p>}
    {card.emoji && <div className="text-7xl">{card.emoji}</div>}
    <h3 className="text-4xl font-serif font-black text-[#e5cb87] leading-tight [overflow-wrap:anywhere]">{card.big}</h3>
    {card.lines.map((l, i) => (
      <p key={i} className="text-xl text-[#f4f0e8] leading-snug [overflow-wrap:anywhere]">
        {l}
      </p>
    ))}
  </section>
);

/** Dialog, scroll-snap track, dots, close. Escape closes; tapping the left or right edge goes back or forward. */
const Shell: React.FC<{ count: number; onClose: () => void; children: React.ReactNode }> = ({ count: n, onClose, children }) => {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const go = useCallback(
    (i: number) => {
      const el = track.current;
      if (el && n > 0) el.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * el.clientWidth, behavior: 'smooth' });
    },
    [n],
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
    };
    window.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', key);
    };
  }, [onClose, go, at]);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 0.25) go(at - 1);
    else if (x > 0.75) go(at + 1);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Underworld Wrap" data-testid="wrapped-overlay" className="fixed inset-0 z-[60] bg-[#08090c] text-[#f4f0e8]">
      <div
        ref={track}
        data-testid="wrapped-track"
        onClick={tap}
        onScroll={e => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        className="absolute inset-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <button
        ref={closeRef}
        type="button"
        data-testid="wrapped-close"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 w-12 h-12 rounded-full bg-[#161922]/90 border border-[#3a4157] text-[#f4f0e8] flex items-center justify-center"
      >
        <X className="w-6 h-6" />
      </button>
      {n > 1 && (
        <div data-testid="wrapped-dots" className="absolute bottom-4 inset-x-0 flex justify-center">
          {Array.from({ length: n }, (_, i) => (
            <button key={i} type="button" aria-label={`Card ${i + 1} of ${n}`} aria-current={i === at} onClick={() => go(i)} className="w-6 h-8 flex items-center justify-center">
              <span className={`block h-1.5 rounded-full transition-all ${i === at ? 'w-5 bg-[#e5cb87]' : 'w-1.5 bg-[#5b6378]'}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** The overlay for a known recap (also used by the /wrapped-preview test route). */
export const WrappedOverlay: React.FC<{ recap: RecapData; team?: { emojiCode: string; name: string }; onClose: () => void }> = ({ recap, team, onClose }) => {
  const crew = team ? (recap.crews.find(c => c.emoji === team.emojiCode && c.name === team.name) ?? recap.crews.find(c => c.emoji === team.emojiCode)) : undefined;
  const cards = buildCards(recap, crew);
  return (
    <Shell count={cards.length} onClose={onClose}>
      {cards.map((c, i) => (
        <Card key={c.id} card={c} index={i} />
      ))}
    </Shell>
  );
};

/** Lazy entry used by the end screen: fetches the recap, then shows the overlay (a loading or error card first). */
export const WrappedCards: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { view } = useGame();
  const { recap, failed, retry } = useRecap(true, view?.sid, view?.v);
  if (recap) return <WrappedOverlay recap={recap} team={view?.team} onClose={onClose} />;
  return (
    <Shell count={0} onClose={onClose}>
      <div className="w-full h-full shrink-0 flex flex-col items-center justify-center gap-4 px-8 text-center" data-testid={failed ? 'wrapped-error' : 'wrapped-loading'}>
        <p className="text-xl text-[#cbd5e1]">{failed ? 'Your cards did not load. Check your signal.' : 'Loading your Wrap…'}</p>
        {failed && (
          <button onClick={retry} className="min-h-[48px] px-5 rounded-xl border border-[#c4a45a]/60 bg-[#161922] text-[#e5cb87] font-serif font-black text-base">
            Try again
          </button>
        )}
      </div>
    </Shell>
  );
};
