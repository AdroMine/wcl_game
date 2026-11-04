// On a phone after the game, under the final rank: "The Underworld Times" front page (one shareable card), then
// "Underworld Wrapped" for your own crew as screenshot-friendly cards, then the award cards. Crew-level only:
// nothing here names a player. Display only; the data is the public recap document (useRecap). This whole file
// is a lazy chunk (RoundContainer loads it only at FINISHED), so none of it is in the main player bundle.
import React from 'react';
import { useGame } from '../../../../src/game/useGame';
import { CARD, LABEL } from '../../../../src/components/ui';
import type { RecapCrew, RecapData } from '../../recap.ts';
import { AwardCard, MORAL_LABEL, trunc } from './AwardCard.tsx';
import { FrontPage, FrontPageSkeleton } from './FrontPage.tsx';
import { useRecap } from './useRecap.ts';

const BOAT: Record<string, string> = { R: '🚣', S: '⛵', G: '⚡' };
const BOAT_NAME: Record<string, string> = { R: 'Rowboat', S: 'Sailboat', G: 'Ghost Ship' };
const OUTCOME: Record<string, { icon: string; text: string }> = {
  M: { icon: '🤝', text: 'Both kept the truce' },
  B: { icon: '🗡️', text: 'You betrayed them' },
  D: { icon: '💔', text: 'They betrayed you' },
  F: { icon: '⚔️', text: 'Both ambushed: brawl' },
  Y: { icon: '🕊️', text: 'No rival: truce points' },
};

const ordinal = (n: number): string => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};
const count = (s: string, ch: string): number => s.split(ch).length - 1;

/** One screenshot-friendly card: game name and date on top, the crew under it. */
const WCard: React.FC<{ id: string; recap: RecapData; crew?: RecapCrew; title: string; children: React.ReactNode }> = ({ id, recap, crew, title, children }) => {
  const date = recap.finishedAt ? new Date(recap.finishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return (
    <section data-testid="wrapped-card" data-card={id} className="rounded-3xl border border-[#c4a45a]/60 bg-gradient-to-b from-[#1a1710] via-[#10121a] to-[#0b0c12] p-5 space-y-3 shadow-xl wr-rise">
      <div className="flex items-center justify-between gap-2 text-xs font-mono uppercase tracking-widest text-[#c4a45a] font-bold">
        <span>Underworld Wrapped</span>
        <span>{date}</span>
      </div>
      {crew && (
        <div className="text-sm font-serif font-black text-[#cbd5e1] truncate">
          {crew.emoji} {crew.name}
        </div>
      )}
      <h3 className="text-2xl font-serif font-black text-[#f4f0e8] leading-tight">{title}</h3>
      {children}
    </section>
  );
};

export const WrappedCards: React.FC = () => {
  const { view } = useGame();
  const finished = view?.phase.name === 'FINISHED';
  const { recap, failed, retry } = useRecap(finished, view?.sid, view?.v, 3000);
  if (!finished) return null;
  if (!recap) {
    return (
      <div className="space-y-3" data-testid="wrapped-loading">
        <FrontPageSkeleton />
        {failed ? (
          <div className={`${CARD} text-center space-y-2`} data-testid="wrapped-error">
            <p className="text-sm text-[#cbd5e1]">The front page did not load. Check your signal and try again.</p>
            <button onClick={retry} className="min-h-[48px] px-5 rounded-xl border border-[#c4a45a]/60 bg-[#161922] text-[#e5cb87] font-serif font-black text-sm">
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-center text-[#a9b4c7]">Printing tonight’s front page…</p>
        )}
      </div>
    );
  }
  return <WrappedBody recap={recap} team={view?.team} />;
};

/** The cards for one crew (`team` = its emblem and name; without one only the front page, awards and teaser show). */
export const WrappedBody: React.FC<{ recap: RecapData; team?: { emojiCode: string; name: string } }> = ({ recap, team }) => {
  const idx = team ? recap.crews.findIndex(c => c.emoji === team.emojiCode && c.name === team.name) : -1;
  const mine = idx >= 0 ? idx : team ? recap.crews.findIndex(c => c.emoji === team.emojiCode) : -1;
  const crew = mine >= 0 ? recap.crews[mine] : undefined;

  return (
    <div className="space-y-4" data-testid="wrapped">
      <section className="space-y-2" data-testid="front-page-section">
        <FrontPage recap={recap} />
        <p className="text-center text-sm text-[#b7bdc9]">Screenshot this and share it</p>
      </section>

      {crew && (
        <div className="text-center pt-2">
          <span className={LABEL}>{recap.title}</span>
          <p className="text-sm text-[#a9b4c7]">Your crew’s night, ready to screenshot.</p>
        </div>
      )}
      {crew && <RankCard recap={recap} crew={crew} />}
      {crew && <BetrayalCard recap={recap} crew={crew} />}
      {crew && crew.boats.length > 0 && <BoatsCard recap={recap} crew={crew} />}
      {crew && <TabletCard recap={recap} crew={crew} />}

      {recap.awards.length > 0 && (
        <section className="space-y-3" data-testid="wrapped-awards">
          <div className="text-center">
            <span className={LABEL}>The awards</span>
          </div>
          {recap.awards.map(a => (
            <AwardCard key={a.id} award={a} recap={recap} mine={a.crew === mine} />
          ))}
        </section>
      )}

      <section data-testid="wrapped-teaser" className="rounded-3xl border border-[#c4a45a]/60 bg-[#10121a] p-6 text-center space-y-2">
        <div className="text-4xl">❄️</div>
        <h3 className="text-2xl font-serif font-black text-[#e5cb87] leading-tight">{recap.teaser.title}</h3>
        {recap.teaser.lines.map((l, i) => (
          <p key={i} className="text-sm text-[#cbd5e1]">
            {l}
          </p>
        ))}
      </section>
    </div>
  );
};

// ------------------------------------------------------------------ cards

const RankCard: React.FC<{ recap: RecapData; crew: RecapCrew }> = ({ recap, crew }) => {
  const mine = recap.awards.filter(a => crew.awards.includes(a.id));
  const place = crew.escape > 0 ? ['', 'Gold', 'Silver', 'Bronze'][crew.escape] ?? `#${crew.escape}` : null;
  const first = crew.ranks.length > 0 ? crew.ranks[0] : null;
  const lastR = crew.ranks.length > 0 ? crew.ranks[crew.ranks.length - 1] : null;
  return (
    // The game is won on the river (the podium); points only decide the start of Round 3, so lead with the river.
    <WCard
      id="rank"
      recap={recap}
      crew={crew}
      title={
        crew.escape >= 1 && crew.escape <= 3
          ? `${['🥇', '🥈', '🥉'][crew.escape - 1]} ${place} medal`
          : `Finished ${ordinal(lastR ?? crew.rank)} of ${recap.crews.length}`
      }
    >
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-mono font-black text-[#e5cb87]">{crew.score}</span>
        <span className="text-sm text-[#a9b4c7]">
          points ({ordinal(crew.rank)} on points) · Round 1 {crew.r1Points} + Round 2 {crew.r2Points}
        </span>
      </div>
      {place && <div className="text-base font-bold text-[#f4f0e8]">🏆 Escaped Tartarus: {place}</div>}
      {!place && crew.metres.length > 0 && <div className="text-sm text-[#cbd5e1]">Reached {Math.round(crew.metres[crew.metres.length - 1])} m of {recap.race.target} m on the river.</div>}
      {first !== null && lastR !== null && recap.race.waves > 0 && (
        <div className="text-sm text-[#cbd5e1]">
          On the river: {ordinal(first)} at the start, {ordinal(lastR)} at the end {lastR < first ? '📈' : lastR > first ? '📉' : ''}
        </div>
      )}
      {mine.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {mine.map(a => (
            <span key={a.id} data-testid="wrapped-award" className="inline-flex items-center gap-1.5 rounded-full border border-[#c4a45a] bg-[#1a1710] px-3 py-1.5 text-xs font-bold text-[#e5cb87]">
              {a.emoji} {a.title}
            </span>
          ))}
        </div>
      )}
    </WCard>
  );
};

const BetrayalCard: React.FC<{ recap: RecapData; crew: RecapCrew }> = ({ recap, crew }) => {
  const played = [...crew.stances].filter(c => c !== '-').length;
  const betrayed = count(crew.stances, 'A');
  const rival = crew.rival >= 0 ? recap.crews[crew.rival] : null;
  const m = MORAL_LABEL[crew.moral];
  const title = played === 0 ? 'No clashes for you' : betrayed === 0 ? `You kept the truce ${played} of ${played} times` : `You betrayed ${betrayed} of ${played} times`;
  return (
    <WCard id="betrayal" recap={recap} crew={crew} title={title}>
      <div className="space-y-1.5">
        {[...crew.outcomes].map((o, i) =>
          o === '-' ? null : (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-[#161922] border border-[#2a2e3d] px-3 py-2 text-sm">
              <span className="text-xl">{OUTCOME[o]?.icon}</span>
              <span className="font-mono text-[#a9b4c7] text-xs">Clash {i + 1}</span>
              <span className="text-[#f4f0e8] font-semibold">{OUTCOME[o]?.text}</span>
            </div>
          ),
        )}
      </div>
      {rival && <p className="text-xs text-[#a9b4c7]">Your rival: {rival.emoji} {trunc(rival.name, 24)}</p>}
      {m && (
        <p className="text-sm font-bold" style={{ color: m.color }} data-testid="wrapped-moral">
          Moral legacy: {m.name}. <span className="font-normal text-[#a9b4c7]">{m.blurb}</span>
        </p>
      )}
      <p className="text-xs text-[#8e95a5]">{recap.headlines.find(h => /chose to betray/.test(h))}</p>
    </WCard>
  );
};

const BoatsCard: React.FC<{ recap: RecapData; crew: RecapCrew }> = ({ recap, crew }) => {
  const sailed = [...crew.boats].filter(b => b !== '-');
  const parts: Record<string, number> = {};
  for (const b of sailed) parts[b] = (parts[b] ?? 0) + 1;
  const crashes = count(crew.crashes, 'X');
  const first = crew.ranks[0];
  const lastR = crew.ranks[crew.ranks.length - 1];
  return (
    <WCard id="boats" recap={recap} crew={crew} title="Your boats">
      <div data-testid="wrapped-boats" className="text-4xl leading-tight tracking-wide break-words">
        {[...crew.boats].map((b, i) => (b === '-' ? null : <span key={i}>{BOAT[b]}{crew.crashes[i] === 'X' ? '💥' : ''}</span>))}
      </div>
      <p className="text-sm text-[#cbd5e1]">
        {Object.entries(parts)
          .map(([b, n]) => `${n} × ${BOAT_NAME[b]}`)
          .join(', ')}
        {crashes > 0 ? `. ${crashes === 1 ? 'One crash' : `${crashes} crashes`} 💥` : '. Never crashed.'}
        {crew.unanimity !== null ? ` Your crew agreed on ${Math.round(crew.unanimity * 100)}% of the votes.` : ''}
      </p>
      <p className="text-sm font-semibold text-[#e5cb87]">
        {ordinal(first)} → {ordinal(lastR)} on the river
      </p>
    </WCard>
  );
};

const TabletCard: React.FC<{ recap: RecapData; crew: RecapCrew }> = ({ recap, crew }) => {
  const times = recap.crews.map(c => c.solveSeconds).filter((x): x is number => x !== null);
  const solved = crew.solveSeconds !== null;
  const slower = solved ? recap.crews.filter(c => c.solveSeconds === null || c.solveSeconds > (crew.solveSeconds as number)).length : 0;
  const pctFaster = recap.crews.length > 1 ? Math.round((slower / (recap.crews.length - 1)) * 100) : 0;
  return (
    <WCard id="tablet" recap={recap} crew={crew} title={solved ? `Tablet cracked in ${crew.solveSeconds} s` : 'The tablet beat you'}>
      <p className="text-sm text-[#cbd5e1]">
        {solved ? `Faster than ${pctFaster}% of crews.` : `${times.length} of ${recap.crews.length} crews cracked it.`}{' '}
        {crew.hints > 0 ? `${crew.hints} hint${crew.hints === 1 ? '' : 's'} taken. ` : solved ? 'No hints. ' : ''}
        {crew.wrong > 0 ? `${crew.wrong} wrong guess${crew.wrong === 1 ? '' : 'es'}.` : solved ? 'No wrong guesses.' : ''}
      </p>
    </WCard>
  );
};
