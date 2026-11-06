import React, { useState } from 'react';
import { Trophy, LogOut, CircleHelp } from 'lucide-react';
import type { PhaseView } from '../../shared/protocol.ts';
import { useGame } from '../game/useGame';

/** "Round 2 · Clash 1": Round, then Clash or Wave. Never "phase" or "descent stage". */
export function topLine(ph: PhaseView | undefined): string {
  if (!ph) return 'Underworld';
  const n = ph.name;
  if (n === 'LOBBY') return 'Lobby';
  if (n === 'FINISHED') return 'The night is over';
  const round = n.startsWith('R1') ? 1 : n.startsWith('R2') ? 2 : n.startsWith('R3') ? 3 : 0;
  if (!round) return 'Underworld';
  const parts = [`Round ${round}`];
  if (n === 'R2_CLASH' && ph.clash > 0) parts.push(`Clash ${ph.clash}`);
  else if (n === 'R3_ACTIVE' && ph.step === 'SUDDEN_DEATH') parts.push('Sudden Death');
  else if (n === 'R3_ACTIVE' && ph.wave > 0) parts.push(`Wave ${ph.wave}`);
  else if (n.endsWith('_RESULTS')) parts.push('Results');
  return parts.join(' · ');
}

export const Navbar: React.FC<{ onToggleBoard: () => void; onOpenRules: () => void }> = ({ onToggleBoard, onOpenRules }) => {
  const { view, status, synced, send } = useGame();
  const [showLeave, setShowLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const me = view?.me;
  const inLobby = view?.phase.name === 'LOBBY';
  const canLeave = !!me && inLobby;
  const inRound = !!view && /^R[123]_/.test(view.phase.name);

  // One tiny status dot replaces the old banners: green live, amber weak, red offline.
  const down = status === 'reconnecting' || status === 'offline' || (!synced && !!view);
  const dot = down ? 'bg-red-400' : status === 'polling' ? 'bg-amber-400' : status === 'connecting' ? 'bg-sky-400' : 'bg-emerald-400';
  const label = down ? 'Offline, reconnecting' : status === 'polling' ? 'Weak connection' : status === 'connecting' ? 'Connecting' : 'Connected';

  return (
    <>
      <header
        className="sticky top-0 z-40 bg-[#08090c]/95 backdrop-blur-md border-b border-[#2a2e3d] px-4 pb-1.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      >
        <div className="flex items-center justify-between gap-2 min-h-[44px]">
          <div className="flex items-center gap-2 min-w-0">
            <span data-testid="conn-status" title={label} role="img" aria-label={label} className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
            <h1 data-testid="round-title" className="text-base font-serif font-bold text-[#f4f0e8] truncate">
              {topLine(view?.phase)}
            </h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {inRound && (
              <button
                onClick={onOpenRules}
                aria-label="Rules"
                data-testid="open-rules"
                className="w-11 h-11 flex items-center justify-center rounded-lg border border-[#3a4157] bg-[#161922] text-[#e5cb87] hover:bg-[#202533] transition-colors"
              >
                <CircleHelp className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onToggleBoard}
              aria-label="Open leaderboard"
              data-testid="open-board"
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-[#3a4157] bg-[#161922] text-[#e5cb87] hover:bg-[#202533] transition-colors"
            >
              <Trophy className="w-5 h-5" />
            </button>
            {canLeave && (
              <button
                onClick={() => setShowLeave(true)}
                aria-label="Leave game"
                className="w-11 h-11 flex items-center justify-center rounded-lg border border-[#3a4157] bg-[#161922] text-[#a9b4c7] hover:text-red-400 hover:border-red-900/50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {showLeave && (
        <div role="dialog" aria-modal="true" aria-label="Leave game" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-950/50 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-serif font-bold text-[#f4f0e8]">Depart the Underworld?</h3>
              <p className="text-base text-[#a9b4c7] mt-1.5 leading-relaxed">
                Your crew spot will be forfeited. Only proceed if leaving the venue.
              </p>
            </div>
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setShowLeave(false)}
                className="flex-1 min-h-[56px] rounded-lg border border-[#2a2e3d] text-base font-semibold text-[#cbd5e1] hover:bg-[#161922] transition-colors"
              >
                Stay in game
              </button>
              <button
                disabled={leaving}
                onClick={async () => {
                  setLeaving(true);
                  const r = await send('LEAVE_GAME', {});
                  setLeaving(false);
                  if (r.ok) setShowLeave(false);
                }}
                className="flex-1 min-h-[56px] rounded-lg bg-red-600 hover:bg-red-700 text-white text-base font-bold transition-colors disabled:opacity-50"
              >
                {leaving ? 'Leaving…' : 'Leave game'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
