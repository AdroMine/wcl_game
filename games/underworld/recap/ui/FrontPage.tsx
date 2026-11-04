// "The Underworld Times": the single shareable front page of the night, one phone screen, built to be
// screenshotted and posted. Display only: every word and number comes from the public recap (recap.front);
// the words themselves are edited in games/underworld/recapContent.ts.
import React from 'react';
import type { FrontMedal, RecapData } from '../../recap.ts';

const MEDAL_BG = ['#e5cb87', '#c9ced8', '#b8834a'];
const MEDAL_NAME = ['Gold', 'Silver', 'Bronze'];
const WRAP = '[overflow-wrap:anywhere]';
const BALANCE = '[text-wrap:balance]';
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function editionLine(recap: RecapData): string {
  const f = recap.front;
  let date = '';
  if (recap.finishedAt) {
    try {
      date = new Date(recap.finishedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
    } catch {
      date = '';
    }
  }
  return [f.volume, date, plural(f.crews, 'crew'), plural(f.shades, 'shade')].filter(Boolean).join(' · ').toUpperCase();
}

const Rule: React.FC<{ thick?: boolean; className?: string }> = ({ thick, className = '' }) => <div className={`${thick ? 'border-t-[3px]' : 'border-t'} border-[#c4a45a] ${className}`} />;

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className={`mb-1.5 mt-3 text-xs font-mono font-bold tracking-[0.08em] text-[#c4a45a] ${BALANCE}`}>{children}</h4>
);

/** Tile wash (the hue at ~12% over the page) and the lighter number ink for each tile edge colour. */
const TONE: Record<string, { bg: string; num: string }> = {
  '#4cc38a': { bg: '#13261d', num: '#6fdca5' },
  '#e8a33c': { bg: '#2a2112', num: '#f2b85c' },
  '#e05d5d': { bg: '#2b1616', num: '#f08080' },
  '#c4a45a': { bg: '#251f12', num: '#e5cb87' },
  '#a78bfa': { bg: '#1d1a2c', num: '#c4b5fd' },
  '#5aa9e6': { bg: '#12212e', num: '#8cc8f2' },
};

const Tile: React.FC<{ color: string; emoji: string; num: React.ReactNode; caption: string; sub?: string; testId?: string }> = ({ color, emoji, num, caption, sub, testId }) => (
  <div
    data-testid={testId}
    className="min-w-0 rounded-md px-2.5 pb-2 pt-1.5"
    style={{ borderTop: `3px solid ${color}`, background: TONE[color]?.bg ?? '#14161e' }}
  >
    <div className="flex items-center gap-2 font-serif font-black leading-none tabular-nums lining-nums" style={{ color: TONE[color]?.num ?? '#f4f0e8' }}>
      <span className="text-[34px]">{num}</span>
      <span aria-hidden className="text-[24px]">{emoji}</span>
    </div>
    <div className="mt-1.5 text-[15px] leading-[1.3] text-[#e4e7ec]">{caption}</div>
    {sub && <div className={`mt-1 text-[15px] leading-[1.3] text-[#b7bdc9] ${WRAP}`}>{sub}</div>}
  </div>
);

const MedalRow: React.FC<{ m: FrontMedal; name: string; last: boolean }> = ({ m, name, last }) => (
  <li data-testid="front-medal" data-place={m.place} className={`flex items-center gap-2.5 py-[5px] ${last ? '' : 'border-b border-[#23262f]'}`}>
    <span
      role="img"
      aria-label={MEDAL_NAME[m.place - 1] ?? `Place ${m.place}`}
      className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full font-serif text-[15px] font-black text-[#0b0c10]"
      style={{ background: MEDAL_BG[m.place - 1] ?? '#8e95a5' }}
    >
      {m.place}
    </span>
    <span className={`min-w-0 flex-1 font-serif text-lg font-bold leading-[1.2] text-[#f4f0e8] ${WRAP}`}>{name}</span>
  </li>
);

/** The card itself. Fixed look, fluid width (360 to 430 px phones). */
export const FrontPage: React.FC<{ recap: RecapData }> = ({ recap }) => {
  const f = recap.front;
  const names = (idx: number[]) => idx.map(i => recap.crews[i]?.name).filter((n): n is string => !!n);
  const made = names(f.round3.ghostMadeIt);
  const shown = made.slice(0, 3).join(', ') + (made.length > 3 ? ` +${made.length - 3} more` : '');
  const r2 = f.round2;
  const r3 = f.round3;
  const ghostNone = r3.ghostAttempts === 0;
  return (
    <article data-testid="front-page" className="mx-auto w-full max-w-[430px] rounded-2xl border border-[#23262f] bg-[#0b0c10] lining-nums px-4 pb-3.5 pt-[18px] text-[#f4f0e8]">
      <header className="text-center">
        <Rule thick />
        <Rule className="mt-[3px]" />
        <h2 className="my-1.5 font-serif text-[20px] min-[380px]:text-[23px] font-black leading-[1.1] [text-wrap:balance] text-[#e5cb87]">{f.masthead}</h2>
        <div className={`font-mono text-xs tracking-[0.04em] text-[#b7bdc9] ${BALANCE}`}>{editionLine(recap)}</div>
        <Rule className="mt-1.5" />
        <Rule thick className="mt-[3px]" />
      </header>

      <div className="mt-3 text-xs font-mono font-bold tracking-[0.08em] text-[#c4a45a]">{f.kicker}</div>
      <h3 data-testid="front-headline" className={`mt-1 font-serif text-xl font-bold leading-[1.2] text-[#f4f0e8] ${BALANCE} ${WRAP}`}>
        {f.headline}
      </h3>
      <p className={`mt-1 text-[15px] leading-snug text-[#b7bdc9] ${BALANCE}`}>{f.dek}</p>

      {f.medals.length > 0 && (
        <ol className="mt-2.5">
          {f.medals.map((m, i) => (
            <MedalRow key={m.place} m={m} name={recap.crews[m.crew]?.name ?? ''} last={i === f.medals.length - 1} />
          ))}
        </ol>
      )}

      {r2.clashes > 0 && (
        <section data-testid="front-round2">
          <SectionLabel>{`ROUND 2 · TRUCE OR AMBUSH · ${plural(r2.clashes, 'CLASH', 'CLASHES')}`}</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Tile color="#4cc38a" emoji="🕊️" num={r2.bothTruce} caption="both kept the truce" />
            <Tile color="#e8a33c" emoji="🗡️" num={r2.backstab} caption="one side backstabbed" />
            <Tile color="#e05d5d" emoji="⚔️" num={r2.bothAmbush} caption="both ambushed" />
            <Tile color="#c4a45a" emoji="😇" num={r2.honourable} caption={r2.honourable === 1 ? 'crew honourable all night' : 'crews honourable all night'} />
          </div>
        </section>
      )}

      {r3.waves > 0 && (
        <section data-testid="front-round3">
          <SectionLabel>ROUND 3 · THE RIVER</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Tile
              color="#a78bfa"
              emoji="⚡"
              num={
                ghostNone ? (
                  0
                ) : (
                  <>
                    {r3.ghostCrashed}
                    <span className="text-xl text-[#b7bdc9]">/{r3.ghostAttempts}</span>
                  </>
                )
              }
              caption={ghostNone ? 'No crew dared the Ghost Ship' : 'Ghost Ships crashed'}
              sub={ghostNone ? undefined : made.length > 0 ? `Made it: ${shown}` : 'Nobody made it'}
            />
            <Tile
              color="#5aa9e6"
              emoji="⛵"
              num={r3.sailboatSunk}
              caption={r3.sailboatSunk === 1 ? 'boat sank on the Sailboat' : 'boats sank on the Sailboat'}
              sub={r3.sailboatCapsizedWaves > 0 ? `capsized in ${r3.sailboatCapsizedWaves} of ${plural(r3.waves, 'wave')}` : `never capsized in ${plural(r3.waves, 'wave')}`}
            />
          </div>
        </section>
      )}

      {f.quote && (
        <figure data-testid="front-quote" className="mx-0 mb-0 mt-3 border-y border-[#c4a45a] py-2 text-center">
          <figcaption className="mb-1 font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#c4a45a]">{f.quote.label}</figcaption>
          <blockquote className={`m-0 font-serif text-base font-bold leading-snug text-[#f4f0e8] ${BALANCE} ${WRAP}`}>{f.quote.line}</blockquote>
        </figure>
      )}

      <div className="mt-2.5 text-center font-mono text-xs tracking-[0.04em] text-[#b7bdc9]">{f.next}</div>
    </article>
  );
};

/** Pulsing placeholder with the card's proportions while the recap is fetched. */
export const FrontPageSkeleton: React.FC = () => (
  <div
    data-testid="front-page-loading"
    aria-busy="true"
    aria-label="Loading the front page"
    className="mx-auto w-full max-w-[430px] space-y-3 rounded-2xl border border-[#23262f] bg-[#0b0c10] p-4 motion-safe:animate-pulse"
  >
    <div className="h-14 rounded-md bg-[#161922]" />
    <div className="h-24 rounded-md bg-[#161922]" />
    <div className="h-20 rounded-md bg-[#161922]" />
    <div className="grid grid-cols-2 gap-2">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-24 rounded-md bg-[#14161e]" />
      ))}
    </div>
  </div>
);
