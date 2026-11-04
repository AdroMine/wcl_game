import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Trophy } from 'lucide-react';
import type { PhaseName } from '../../shared/protocol.ts';
import { useGame } from '../game/useGame';
import { RoundBriefingModal } from './RoundBriefingModal';
import { AsciiSplitterRound } from '../../games/underworld/rounds/tablet/ui/AsciiSplitterRound';
import { ShadesInTheMistRound } from '../../games/underworld/rounds/mist/ui/ShadesInTheMistRound';
import { OdysseyEscapeRoyaleRound } from '../../games/underworld/rounds/styx/ui/OdysseyEscapeRoyaleRound';
import { BoardList } from './LeaderboardDrawer';
import { CARD, Countdown, LABEL } from './ui';

// The recap (front page, crew cards, awards) is a separate chunk, fetched only when the game is FINISHED.
const WrappedCards = React.lazy(() => import('../../games/underworld/recap/ui/WrappedCards').then(m => ({ default: m.WrappedCards })));

function roundOf(name: PhaseName): 1 | 2 | 3 | 0 {
  if (name.startsWith('R1')) return 1;
  if (name.startsWith('R2')) return 2;
  if (name.startsWith('R3')) return 3;
  return 0;
}

/**
 * The story/rules briefing is a server-timed step (phase.step === 'BRIEFING'): every phone shows it, driven by server time,
 * and it closes by itself when the step ends. The Rules button reopens it manually (closable, everything shown).
 */
export const RoundContainer: React.FC = () => {
  const { view, meta } = useGame();
  const name = view?.phase.name;
  const step = view?.phase.step ?? '';
  const startedAt = view?.phase.startedAt;
  const [showManual, setShowManual] = useState(false);
  const [dismissedKey, setDismissedKey] = useState('');
  const openedIn = useRef<string>('');

  // A manual briefing never covers a vote: close it when the phase moves on or a VOTE step starts.
  useEffect(() => {
    if (showManual && (name !== openedIn.current || step === 'VOTE')) setShowManual(false);
  }, [name, step, showManual]);

  if (!view || !name) return null;
  const round = roundOf(name);
  const briefing = round ? meta?.rounds[round - 1] : undefined;
  const hasTimer = view.phase.endsAt != null;
  const inBriefing = step === 'BRIEFING' && startedAt != null;
  const briefingKey = `${name}:${startedAt}`;
  const autoOpen = inBriefing && !!briefing && dismissedKey !== briefingKey;
  const waiting = inBriefing && !autoOpen;
  const showTimerInHeader = hasTimer && !inBriefing && !(name === 'R2_CLASH' || name === 'R3_ACTIVE');

  const body =
    round === 1 ? (
      <AsciiSplitterRound />
    ) : round === 2 ? (
      <ShadesInTheMistRound />
    ) : round === 3 ? (
      <OdysseyEscapeRoyaleRound />
    ) : (
      <>
        <FinishedCard />
        <React.Suspense fallback={<p className="text-sm text-center text-[#a9b4c7]">Printing tonight’s front page…</p>}>
          <WrappedCards />
        </React.Suspense>
      </>
    );

  return (
    <div className="space-y-3.5 py-2">
      {autoOpen && briefing ? (
        <RoundBriefingModal
          briefing={briefing}
          mode="auto"
          startedAt={startedAt}
          endsAt={view.phase.endsAt}
          onClose={() => setDismissedKey(briefingKey)}
        />
      ) : (
        showManual &&
        briefing && <RoundBriefingModal briefing={briefing} mode="manual" onClose={() => setShowManual(false)} />
      )}

      <div className={`${CARD} flex items-center justify-between !p-4`}>
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center space-x-2">
            <span className={LABEL}>{round ? `Descent Stage #${round}` : 'The Underworld'}</span>
            {briefing && (
              <button
                onClick={() => {
                  openedIn.current = name;
                  setShowManual(true);
                }}
                data-testid="open-rules"
                className="inline-flex items-center space-x-1 px-2.5 min-h-[32px] rounded-full bg-[#161922] border border-[#3a4157] text-[11px] font-mono text-[#e5cb87]"
              >
                <BookOpen className="w-3 h-3" />
                <span>Rules</span>
              </button>
            )}
          </div>
          <h2 data-testid="round-title" className="text-lg font-serif font-black text-[#f4f0e8] leading-tight truncate">
            {briefing?.title ?? 'Final standings'}
          </h2>
        </div>
        {showTimerInHeader && (
          <div className="text-right shrink-0 pl-2">
            <div className="text-[10px] font-mono text-[#a9b4c7]">TIME REMAINING</div>
            <Countdown endsAt={view.phase.endsAt} className="text-2xl" />
          </div>
        )}
      </div>

      {waiting ? (
        <div className={`${CARD} text-center space-y-2`} data-testid="briefing-waiting">
          <span className={LABEL}>Get ready</span>
          <h3 className="text-xl font-serif font-black text-[#f4f0e8]">The round is about to begin</h3>
          <Countdown endsAt={view.phase.endsAt} className="text-3xl" testId="briefing-countdown" />
        </div>
      ) : (
        body
      )}

      {(name.endsWith('_RESULTS') || name === 'FINISHED') && (
        <div className={`${CARD} space-y-3`}>
          <span className={LABEL}>Standings</span>
          <BoardList limit={5} />
        </div>
      )}
    </div>
  );
};

const FinishedCard: React.FC = () => {
  const { view } = useGame();
  const team = view?.team;
  return (
    <div className={`${CARD} text-center space-y-2`}>
      <Trophy className="w-10 h-10 text-[#e5cb87] mx-auto" />
      <h3 className="text-2xl font-serif font-black text-[#f4f0e8]">Thanks for playing</h3>
      {team && (
        <p className="text-base text-[#cbd5e1]" data-testid="final-rank">
          {team.name} finished with {team.score} pts, rank {team.rank} of {view?.boardTotal}.
        </p>
      )}
      <p className="text-sm text-[#a9b4c7]">Open the trophy for the final standings.</p>
    </div>
  );
};
