import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Trophy } from 'lucide-react';
import type { PhaseName } from '../../shared/protocol.ts';
import { useGame } from '../game/useGame';
import { RoundBriefingModal } from './RoundBriefingModal';
import { AsciiSplitterRound } from './rounds/AsciiSplitterRound';
import { ShadesInTheMistRound } from './rounds/ShadesInTheMistRound';
import { OdysseyEscapeRoyaleRound } from './rounds/OdysseyEscapeRoyaleRound';
import { BoardList } from './LeaderboardDrawer';
import { CARD, Countdown, LABEL } from './ui';

const BRIEFED_KEY = 'uw.briefed';
const BRIEF_PHASES: PhaseName[] = ['R1_ACTIVE', 'R2_PAIRING', 'R3_ACTIVE'];

function readBriefed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(BRIEFED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function writeBriefed(list: string[]): void {
  try {
    localStorage.setItem(BRIEFED_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function roundOf(name: PhaseName): 1 | 2 | 3 | 0 {
  if (name.startsWith('R1')) return 1;
  if (name.startsWith('R2')) return 2;
  if (name.startsWith('R3')) return 3;
  return 0;
}

/** Shown once per phase (and never again after a refresh). A new game (lobby) forgets it. */
export const RoundContainer: React.FC = () => {
  const { view, meta } = useGame();
  const name = view?.phase.name;
  const [showBriefing, setShowBriefing] = useState(false);
  const [animate, setAnimate] = useState(false);
  const openedIn = useRef<string>('');
  const step = view?.phase.step ?? '';

  // A briefing never covers a vote: close it when the phase moves on or a VOTE step starts.
  useEffect(() => {
    if (showBriefing && (name !== openedIn.current || step === 'VOTE')) {
      setShowBriefing(false);
      setAnimate(false);
    }
  }, [name, step, showBriefing]);

  useEffect(() => {
    if (!name) return;
    if (name === 'LOBBY') {
      writeBriefed([]);
      return;
    }
    if (BRIEF_PHASES.includes(name)) {
      const seen = readBriefed();
      if (!seen.includes(name)) {
        writeBriefed([...seen, name]);
        openedIn.current = name;
        setAnimate(true);
        setShowBriefing(true);
      }
    }
  }, [name]);

  if (!view || !name) return null;
  const round = roundOf(name);
  const briefing = round ? meta?.rounds[round - 1] : undefined;
  const hasTimer = view.phase.endsAt != null;
  const showTimerInHeader = hasTimer && !(name === 'R2_CLASH' || name === 'R3_ACTIVE');

  const body =
    round === 1 ? (
      <AsciiSplitterRound />
    ) : round === 2 ? (
      <ShadesInTheMistRound />
    ) : round === 3 ? (
      <OdysseyEscapeRoyaleRound />
    ) : (
      <FinishedCard />
    );

  return (
    <div className="space-y-3.5 py-2">
      {showBriefing && briefing && (
        <RoundBriefingModal
          briefing={briefing}
          animate={animate}
          onClose={() => {
            setShowBriefing(false);
            setAnimate(false);
          }}
        />
      )}

      <div className={`${CARD} flex items-center justify-between !p-4`}>
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center space-x-2">
            <span className={LABEL}>{round ? `Descent Stage #${round}` : 'The Underworld'}</span>
            {briefing && (
              <button
                onClick={() => {
                  openedIn.current = name;
                  setAnimate(false);
                  setShowBriefing(true);
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

      {body}

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
