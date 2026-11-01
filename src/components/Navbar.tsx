import React, { useState } from 'react';
import { Trophy, LogOut, Users } from 'lucide-react';
import { useGame } from '../game/useGame';
import { RoleIcon, useRoles } from './ui';

export const Navbar: React.FC<{ onToggleBoard: () => void }> = ({ onToggleBoard }) => {
  const { view, status, send } = useGame();
  const { byId } = useRoles();
  const [showLeave, setShowLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const me = view?.me;
  const role = me ? byId(me.role) : undefined;
  const canLeave = !!me && view?.phase.name === 'LOBBY';

  const dot =
    status === 'live' ? 'bg-emerald-400 animate-pulse' : status === 'polling' ? 'bg-amber-400' : status === 'connecting' ? 'bg-sky-400' : 'bg-red-400';
  const label = status === 'live' ? 'LIVE' : status === 'polling' ? 'POLL' : status === 'connecting' ? 'CONNECTING' : status === 'offline' ? 'OFFLINE' : 'RECONNECTING';

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#08090c]/95 backdrop-blur-md border-b border-[#3a4157] px-4 py-2.5 transition-colors">
        <div className="max-w-[480px] mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded border border-[#c4a45a]/80 bg-[#161922] flex items-center justify-center text-[#e5cb87] font-serif font-black text-xs shadow-gold-glow">
              Ω
            </div>
            <div>
              <h1 className="text-xs font-serif font-bold tracking-wider text-[#f4f0e8] uppercase">Underworld</h1>
              <div className="flex items-center space-x-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
                <span data-testid="conn-status" className="text-[10px] text-[#a9b4c7] font-mono tracking-tight">
                  {label}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleBoard}
              aria-label="Open leaderboard"
              data-testid="open-board"
              className="w-11 h-11 flex items-center justify-center rounded border border-[#3a4157] bg-[#161922] text-[#e5cb87] hover:bg-[#202533] transition-colors"
            >
              <Trophy className="w-5 h-5" />
            </button>

            {role && (
              <div
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border"
                style={{ borderColor: role.color, backgroundColor: `${role.color}15`, color: role.color }}
              >
                <RoleIcon icon={role.icon} className="w-4 h-4" />
                <span className="font-semibold text-[11px] hidden xs:inline">{role.name}</span>
                {view?.team?.emojiCode && (
                  <span className="text-xs tracking-wider ml-0.5" title={`Team Code: ${view.team.emojiCode}`}>
                    {view.team.emojiCode}
                  </span>
                )}
                {!view?.team && <Users className="w-3.5 h-3.5" />}
              </div>
            )}

            {canLeave && (
              <button
                onClick={() => setShowLeave(true)}
                aria-label="Leave game"
                className="w-11 h-11 flex items-center justify-center rounded border border-[#3a4157] bg-[#161922] text-[#a9b4c7] hover:text-red-400 hover:border-red-900/50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {showLeave && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-950/50 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-serif font-bold text-[#f4f0e8]">Depart the Underworld?</h3>
              <p className="text-sm text-[#8e95a5] mt-1.5 leading-relaxed">
                Your role <strong className="text-[#f4f0e8]">{role?.name}</strong> and crew spot will be forfeited. Only proceed if leaving the venue.
              </p>
            </div>
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setShowLeave(false)}
                className="flex-1 min-h-[56px] rounded-lg border border-[#2a2e3d] text-sm font-semibold text-[#8e95a5] hover:bg-[#161922] transition-colors"
              >
                Stay in Game
              </button>
              <button
                disabled={leaving}
                onClick={async () => {
                  setLeaving(true);
                  const r = await send('LEAVE_GAME', {});
                  setLeaving(false);
                  if (r.ok) setShowLeave(false);
                }}
                className="flex-1 min-h-[56px] rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                {leaving ? 'Leaving...' : 'Confirm Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
