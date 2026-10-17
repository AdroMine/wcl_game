import React from 'react';
import { useGameSession } from '../context/GameContext';
import { AsciiSplitterRound } from './rounds/AsciiSplitterRound';
import { AsymmetricTextPuzzleRound } from './rounds/AsymmetricTextPuzzleRound';
import { OfflineTaskTimerRound } from './rounds/OfflineTaskTimerRound';
import { Clock, PauseCircle } from 'lucide-react';

export const RoundContainer: React.FC = () => {
  const { currentRound, timeRemainingSeconds, payload, team, player, switchPlayer } = useGameSession();

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

      {/* Solo Testing Teammate Switcher Bar */}
      {team && team.player_ids.length > 1 && (
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-xl p-2 flex items-center space-x-1.5 overflow-x-auto text-[10px] font-mono">
          <span className="text-[#8e95a5] flex-shrink-0 px-1 font-bold">SOLO VIEW:</span>
          {team.player_ids.map((pid, idx) => {
            const isCurrent = player?.id === pid;
            const memberInfo = payload?.teams_leaderboard?.find(t => t.id === team.id)?.members[idx];
            return (
              <button
                key={pid}
                onClick={() => switchPlayer(pid)}
                className={`px-2 py-1 rounded-lg border flex-shrink-0 transition-all font-bold ${
                  isCurrent
                    ? 'bg-[#c4a45a] text-[#08090c] border-[#c4a45a]'
                    : 'bg-[#161922] text-[#8e95a5] border-[#2a2e3d] hover:text-[#f4f0e8]'
                }`}
              >
                Slot #{idx + 1}: {memberInfo?.name || `Shade ${idx + 1}`} ({memberInfo?.roleName || 'Role'})
              </button>
            );
          })}
        </div>
      )}

      {/* Dynamic Pluggable Round Component */}
      {currentRound.type === 'ASCII_SPLITTER' && <AsciiSplitterRound />}
      {currentRound.type === 'ASYMMETRIC_TEXT_PUZZLE' && <AsymmetricTextPuzzleRound />}
      {currentRound.type === 'OFFLINE_TASK_TIMER' && <OfflineTaskTimerRound />}
    </div>
  );
};
