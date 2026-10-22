import React, { Suspense, lazy } from 'react';
import { useGameSession } from '../context/GameContext';
import { Clock, PauseCircle, Loader2 } from 'lucide-react';

const AsciiSplitterRound = lazy(() =>
  import('./rounds/AsciiSplitterRound').then(m => ({ default: m.AsciiSplitterRound }))
);
const ShadesInTheMistRound = lazy(() =>
  import('./rounds/ShadesInTheMistRound').then(m => ({ default: m.ShadesInTheMistRound }))
);
const AsymmetricTextPuzzleRound = lazy(() =>
  import('./rounds/AsymmetricTextPuzzleRound').then(m => ({ default: m.AsymmetricTextPuzzleRound }))
);
const OfflineTaskTimerRound = lazy(() =>
  import('./rounds/OfflineTaskTimerRound').then(m => ({ default: m.OfflineTaskTimerRound }))
);
const OdysseyEscapeRoyaleRound = lazy(() =>
  import('./rounds/OdysseyEscapeRoyaleRound').then(m => ({ default: m.OdysseyEscapeRoyaleRound }))
);

export const RoundContainer: React.FC = () => {
  const { currentRound, timeRemainingSeconds, payload } = useGameSession();

  if (!currentRound) {
    return (
      <div className="text-center py-12 space-y-3">
        <h3 className="text-lg font-serif font-bold text-[#f4f0e8]">No Active Round</h3>
        <p className="text-xs text-[#8e95a5]">Waiting for the Game Master to initiate the next challenge.</p>
      </div>
    );
  }

  // Format MM:SS
  const mins = Math.floor(timeRemainingSeconds / 60);
  const secs = timeRemainingSeconds % 60;
  const formattedTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isUrgent = timeRemainingSeconds > 0 && timeRemainingSeconds <= 60;
  const isPaused = payload?.round_is_paused;

  return (
    <div className="space-y-3 py-2">
      {/* Round Top Header with Server-Synced Timer */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex items-center justify-between">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
            Active Descent Stage
          </span>
          <h2 className="text-base font-serif font-black text-[#f4f0e8] leading-tight">
            {currentRound.title}
          </h2>
        </div>

        {/* Global Synchronized Countdown */}
        <div className="text-right">
          <div className="flex items-center space-x-1 justify-end text-[10px] font-mono text-[#8e95a5]">
            <Clock className="w-3 h-3 text-[#c4a45a]" />
            <span>TIME REMAINING</span>
          </div>
          <div className="flex items-center space-x-1.5 justify-end mt-0.5">
            {isPaused ? (
              <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 font-mono text-xs font-bold flex items-center space-x-1">
                <PauseCircle className="w-3.5 h-3.5" />
                <span>PAUSED</span>
              </span>
            ) : (
              <span
                className={`font-mono text-xl font-black tracking-wider transition-colors ${
                  isUrgent
                    ? 'text-red-400 animate-pulse'
                    : 'text-[#f4f0e8]'
                }`}
              >
                {formattedTime}
              </span>
            )}
          </div>
        </div>
      </div>


      {/* Dynamic Pluggable Round Component */}
      <Suspense
        fallback={
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-8 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-6 h-6 text-[#c4a45a] animate-spin" />
            <p className="text-xs font-mono text-[#8e95a5]">Loading descent chamber...</p>
          </div>
        }
      >
        {currentRound.type === 'ASCII_SPLITTER' && <AsciiSplitterRound />}
        {currentRound.type === 'PRISONERS_DILEMMA' && <ShadesInTheMistRound />}
        {currentRound.type === 'ASYMMETRIC_TEXT_PUZZLE' && <AsymmetricTextPuzzleRound />}
        {currentRound.type === 'OFFLINE_TASK_TIMER' && <OfflineTaskTimerRound />}
        {currentRound.type === 'ODYSSEY_ESCAPE_ROYALE' && <OdysseyEscapeRoyaleRound />}
      </Suspense>
    </div>
  );
};
