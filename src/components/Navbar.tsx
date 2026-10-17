import React, { useState } from 'react';
import { useGameSession } from '../context/GameContext';
import { Shield, Trophy, Zap, LogOut, Compass, Eye, Book, Flame, Users } from 'lucide-react';

const ROLE_ICONS: Record<string, React.ReactNode> = {
  compass: <Compass className="w-4 h-4" />,
  eye: <Eye className="w-4 h-4" />,
  book: <Book className="w-4 h-4" />,
  flame: <Flame className="w-4 h-4" />,
  shield: <Shield className="w-4 h-4" />,
};

export const Navbar: React.FC = () => {
  const {
    player,
    role,
    connectionStatus,
    lowDataMode,
    toggleLowDataMode,
    isLeaderboardOpen,
    setIsLeaderboardOpen,
    leave,
  } = useGameSession();

  const [showLeaveModal, setShowLeaveModal] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#08090c]/95 backdrop-blur-md border-b border-[#2a2e3d] px-4 py-2.5 transition-colors">
        <div className="max-w-[480px] mx-auto flex items-center justify-between">
          {/* Logo / Event Title */}
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded border border-[#c4a45a]/60 bg-[#10121a] flex items-center justify-center text-[#c4a45a] font-serif font-black text-xs shadow-gold-glow">
              Ω
            </div>
            <div>
              <h1 className="text-xs font-serif font-bold tracking-wider text-[#f4f0e8] uppercase">
                Underworld
              </h1>
              <div className="flex items-center space-x-1.5">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    connectionStatus === 'connected'
                      ? 'bg-emerald-400 animate-pulse'
                      : connectionStatus === 'polling-fallback'
                      ? 'bg-amber-400'
                      : 'bg-red-400'
                  }`}
                />
                <span className="text-[10px] text-[#8e95a5] font-mono tracking-tight">
                  {connectionStatus === 'connected'
                    ? 'LIVE SSE'
                    : connectionStatus === 'polling-fallback'
                    ? '10s POLL'
                    : 'OFFLINE'}
                </span>
              </div>
            </div>
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center space-x-2">
            {/* Low Data Mode Toggle */}
            <button
              onClick={toggleLowDataMode}
              title={lowDataMode ? 'Low Data Mode Active (Click to disable)' : 'Enable Low Data Mode (Stripped assets & animations)'}
              className={`p-1.5 rounded border text-xs flex items-center space-x-1 transition-all ${
                lowDataMode
                  ? 'bg-[#c4a45a] text-[#08090c] border-[#c4a45a] font-bold'
                  : 'bg-[#161922] text-[#8e95a5] border-[#2a2e3d] hover:text-[#f4f0e8]'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono">{lowDataMode ? 'ECO' : 'DATA'}</span>
            </button>

            {/* Leaderboard Drawer Toggle */}
            <button
              onClick={() => setIsLeaderboardOpen(!isLeaderboardOpen)}
              title="Open Leaderboard"
              className="p-1.5 rounded border border-[#2a2e3d] bg-[#161922] text-[#c4a45a] hover:bg-[#202533] transition-colors relative"
            >
              <Trophy className="w-4 h-4" />
            </button>

            {/* Player Role Beacon Badge & Leave Button */}
            {player && (
              <>
                {role && (
                  <div
                    className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium border"
                    style={{
                      borderColor: role.color,
                      backgroundColor: `${role.color}15`,
                      color: role.color,
                    }}
                  >
                    {ROLE_ICONS[role.icon] || <Users className="w-3.5 h-3.5" />}
                    <span className="font-semibold text-[11px] hidden xs:inline">{role.name}</span>
                    <span className="font-mono text-[10px] opacity-80">[{player.join_code}]</span>
                  </div>
                )}

                <button
                  onClick={() => setShowLeaveModal(true)}
                  title="Leave Game Session"
                  className="p-1.5 rounded border border-[#2a2e3d] bg-[#161922] text-[#8e95a5] hover:text-red-400 hover:border-red-900/50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Leave Game Confirmation Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-950/50 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-serif font-bold text-[#f4f0e8]">Depart the Underworld?</h3>
              <p className="text-xs text-[#8e95a5] mt-1.5 leading-relaxed">
                Your role <strong className="text-[#f4f0e8]">{role?.name}</strong> and crew spot will be forfeited. Only proceed if leaving the venue.
              </p>
            </div>
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setShowLeaveModal(false)}
                className="flex-1 py-2 px-3 rounded-lg border border-[#2a2e3d] text-xs font-semibold text-[#8e95a5] hover:bg-[#161922] transition-colors"
              >
                Stay in Game
              </button>
              <button
                onClick={() => {
                  setShowLeaveModal(false);
                  leave();
                }}
                className="flex-1 py-2 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
              >
                Confirm Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
