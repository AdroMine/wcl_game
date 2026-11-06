import React, { useEffect, useRef, useState } from 'react';
import type { PhaseName } from '../../shared/protocol.ts';
import { useGame } from '../game/useGame';
import { RoundBriefingModal } from './RoundBriefingModal';
import { AsciiSplitterRound } from '../../games/underworld/rounds/tablet/ui/AsciiSplitterRound';
import { ShadesInTheMistRound } from '../../games/underworld/rounds/mist/ui/ShadesInTheMistRound';
import { OdysseyEscapeRoyaleRound } from '../../games/underworld/rounds/styx/ui/OdysseyEscapeRoyaleRound';
import { BoardList } from './LeaderboardDrawer';
import { FinishedScreen } from './FinishedScreen';

function roundOf(name: PhaseName): 1 | 2 | 3 | 0 {
  if (name.startsWith('R1')) return 1;
  if (name.startsWith('R2')) return 2;
  if (name.startsWith('R3')) return 3;
  return 0;
}

/**
 * The "?" in the top line: the round's rules, opened by hand (closable, everything shown). It closes by itself when the
 * game moves to another phase.
 */
export const RulesSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { view, meta } = useGame();
  const name = view?.phase.name;
  const openedIn = useRef<string | undefined>(name);
  useEffect(() => {
    if (open) openedIn.current = name;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && name !== openedIn.current) onClose();
  }, [name, open, onClose]);
  const round = name ? roundOf(name) : 0;
  const briefing = round ? meta?.rounds[round - 1] : undefined;
  if (!open || !briefing) return null;
  return <RoundBriefingModal briefing={briefing} mode="manual" onClose={onClose} />;
};

/**
 * The story/rules briefing is a server-timed step (phase.step === 'BRIEFING'): every phone shows it, driven by server time,
 * and it closes by itself when the step ends. The rope at the top of the screen is the only timer.
 */
export const RoundContainer: React.FC = () => {
  const { view, meta } = useGame();
  const name = view?.phase.name;
  const step = view?.phase.step ?? '';
  const startedAt = view?.phase.startedAt;
  const [dismissedKey, setDismissedKey] = useState('');

  if (!view || !name) return null;
  const round = roundOf(name);
  const briefing = round ? meta?.rounds[round - 1] : undefined;
  const inBriefing = step === 'BRIEFING' && startedAt != null;
  const briefingKey = `${name}:${startedAt}`;
  const autoOpen = inBriefing && !!briefing && dismissedKey !== briefingKey;
  const waiting = inBriefing && !autoOpen;
  const showStandings = name === 'R1_RESULTS' || name === 'R2_RESULTS';

  const body =
    round === 1 ? (
      <AsciiSplitterRound />
    ) : round === 2 ? (
      <ShadesInTheMistRound />
    ) : round === 3 ? (
      <OdysseyEscapeRoyaleRound />
    ) : (
      <FinishedScreen />
    );

  return (
    <div className="space-y-4 py-3">
      {autoOpen && briefing && (
        <RoundBriefingModal briefing={briefing} mode="auto" startedAt={startedAt} endsAt={view.phase.endsAt} onClose={() => setDismissedKey(briefingKey)} />
      )}

      {waiting ? (
        <div data-testid="briefing-waiting" className="min-h-[50vh] flex items-center justify-center">
          <h2 className="text-3xl font-serif font-black text-[#f4f0e8]">Get ready</h2>
        </div>
      ) : (
        body
      )}

      {showStandings && (
        <div className="space-y-2" data-testid="round-standings">
          <BoardList limit={3} />
        </div>
      )}
    </div>
  );
};
