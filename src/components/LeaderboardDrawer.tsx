import React from 'react';
import { useGameSession } from '../context/GameContext';
import { Trophy, Crown, X, Users } from 'lucide-react';

export const LeaderboardDrawer: React.FC = () => {
  const { payload, team, isLeaderboardOpen, setIsLeaderboardOpen, lastSyncedAt } = useGameSession();

  const isFullScreenState = payload?.state === 'ROUND_LEADERBOARD';
  const isOpen = isFullScreenState || isLeaderboardOpen;

  if (!isOpen) return null;

  const leaderboard = payload?.teams_leaderboard || [];

  const getRankBadge = (index: number) => {
    switch (index) {
      case 0:
        return (
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-600 via-amber-400 to-yellow-200 border border-amber-300 text-[#08090c] font-black text-sm flex items-center justify-center shadow-lg">
            <Crown className="w-4 h-4 fill-current" />
          </div>
        );
      case 1:
        return (
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-400 via-slate-300 to-slate-100 border border-slate-200 text-[#08090c] font-black text-sm flex items-center justify-center shadow">
            2
          </div>
        );
      case 2:
        return (
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-800 via-amber-700 to-amber-600 border border-amber-600 text-amber-100 font-black text-sm flex items-center justify-center shadow">
            3
          </div>
        );
      default:
        return (
          <div className="w-8 h-8 rounded-full bg-[#161922] border border-[#2a2e3d] text-[#8e95a5] font-mono font-bold text-xs flex items-center justify-center">
            {index + 1}
          </div>
        );
    }
  };

  const formattedSyncTime = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Connecting';

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-end transition-all duration-300 ${
        isFullScreenState ? 'bg-[#08090c]' : 'bg-black/75 backdrop-blur-sm'
      }`}
    >
      <div
        className={`w-full max-w-[480px] mx-auto bg-[#10121a] border-t border-[#2a2e3d] flex flex-col overflow-hidden transition-all duration-300 ${
          isFullScreenState
            ? 'h-full border-none'
            : 'max-h-[85vh] rounded-t-3xl shadow-2xl border-x'
        }`}
      >
        {/* Drawer Drag Bar / Header */}
        <div className="p-4 border-b border-[#2a2e3d] flex items-center justify-between bg-[#161922]/70 relative">
          {!isFullScreenState && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-[#2a2e3d] rounded-full" />
          )}

          <div className="flex items-center space-x-2 pt-1">
            <Trophy className="w-5 h-5 text-[#c4a45a]" />
            <div>
              <h3 className="text-base font-serif font-black text-[#f4f0e8] tracking-wide">
                Underworld Standings
              </h3>
              <p className="text-[10px] font-mono text-[#8e95a5]">
                Live crew rankings across all trials
              </p>
            </div>
          </div>

          {!isFullScreenState && (
            <button
              onClick={() => setIsLeaderboardOpen(false)}
              className="p-1.5 rounded-lg border border-[#2a2e3d] text-[#8e95a5] hover:text-[#f4f0e8] hover:bg-[#202533] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {leaderboard.length === 0 ? (
            <div className="text-center py-12 space-y-2 text-[#8e95a5]">
              <Users className="w-8 h-8 mx-auto opacity-40 text-[#c4a45a]" />
              <p className="text-xs font-mono">No crews registered yet.</p>
              <p className="text-[10px]">Crews will appear here upon assembly.</p>
            </div>
          ) : (
            leaderboard.map((entry, index) => {
              const isYourCrew = team && entry.id === team.id;

              return (
                <div
                  key={entry.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isYourCrew
                      ? 'bg-gradient-to-r from-[#161922] via-[#202533] to-[#161922] border-[#c4a45a] shadow-beacon'
                      : 'bg-[#161922]/60 border-[#2a2e3d]'
                  }`}
                  style={isYourCrew ? ({ '--beacon-glow': 'rgba(196, 164, 90, 0.3)' } as React.CSSProperties) : undefined}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getRankBadge(index)}
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="text-sm font-serif font-black text-[#f4f0e8] tracking-wide">
                            {entry.name}
                          </h4>
                          {isYourCrew && (
                            <span className="text-[9px] font-mono font-bold bg-[#c4a45a] text-[#08090c] px-1.5 py-0.2 rounded">
                              YOU
                            </span>
                          )}
                        </div>

                        {/* Crew members pill summary */}
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {entry.members.map((m, mIdx) => (
                            <span
                              key={mIdx}
                              className="text-[9px] font-mono px-1.5 py-0.2 rounded border"
                              style={{
                                borderColor: `${m.roleColor}40`,
                                backgroundColor: `${m.roleColor}15`,
                                color: m.roleColor,
                              }}
                            >
                              {m.name} ({m.roleName})
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Score and recent delta */}
                    <div className="text-right">
                      <div className="text-base font-mono font-black text-[#c4a45a]">
                        {entry.score} <span className="text-xs font-normal">PTS</span>
                      </div>
                      {entry.roundCompleted && (
                        <div className="text-[10px] font-mono font-bold text-emerald-400 mt-0.5">
                          ✓ Completed
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Strictly Server-Pushed Live Footer (NO manual refresh button per spec) */}
        <div className="p-3 border-t border-[#2a2e3d] bg-[#08090c] flex items-center justify-between text-[10px] font-mono text-[#8e95a5]">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Last updated: {formattedSyncTime} • Live Auto-Sync</span>
          </div>
          <span className="text-[#c4a45a]">UNDERWORLD LEADERBOARD</span>
        </div>
      </div>
    </div>
  );
};
