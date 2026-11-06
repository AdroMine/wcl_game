import React, { useEffect } from 'react';
import { Trophy, Crown, X, Users } from 'lucide-react';
import { useGame } from '../game/useGame';
import { ordinal } from './ui';

const RankBadge: React.FC<{ index: number }> = ({ index }) => {
  if (index === 0)
    return (
      <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-tr from-amber-600 via-amber-400 to-yellow-200 border border-amber-300 text-[#08090c] font-black text-sm flex items-center justify-center shadow-lg">
        <Crown className="w-4 h-4 fill-current" />
      </div>
    );
  if (index === 1)
    return (
      <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-tr from-slate-400 via-slate-300 to-slate-100 border border-slate-200 text-[#08090c] font-black text-sm flex items-center justify-center shadow">
        2
      </div>
    );
  if (index === 2)
    return (
      <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-tr from-amber-800 via-amber-700 to-amber-600 border border-amber-600 text-amber-100 font-black text-sm flex items-center justify-center shadow">
        3
      </div>
    );
  return (
    <div className="w-8 h-8 shrink-0 rounded-full bg-[#161922] border border-[#2a2e3d] text-[#a9b4c7] font-mono font-bold text-sm flex items-center justify-center">{index + 1}</div>
  );
};

/** The top-10 list from the view. Shared by the drawer and the results screens. */
export const BoardList: React.FC<{ limit?: number }> = ({ limit = 10 }) => {
  const { view } = useGame();
  const board = view?.board ?? [];
  const mine = view?.team;
  if (board.length === 0) {
    return (
      <div className="text-center py-10 space-y-2 text-[#a9b4c7]">
        <Users className="w-8 h-8 mx-auto opacity-40 text-[#c4a45a]" />
        <p className="text-base">No crews registered yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5" data-testid="board-list">
      {board.slice(0, limit).map(([name, score], i) => {
        const you = !!mine && mine.name === name && mine.score === score;
        return (
          <div
            key={`${name}-${i}`}
            className={`p-3 min-h-[56px] rounded-2xl border flex items-center justify-between gap-2 ${
              you ? 'bg-gradient-to-r from-[#161922] via-[#202533] to-[#161922] border-[#c4a45a] shadow-beacon' : 'bg-[#161922]/60 border-[#2a2e3d]'
            }`}
            style={you ? ({ '--beacon-glow': 'rgba(196, 164, 90, 0.3)' } as React.CSSProperties) : undefined}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <RankBadge index={i} />
              <h4 className="min-w-0 text-base leading-snug font-serif font-black text-[#f4f0e8] [overflow-wrap:anywhere]">{name}</h4>
              {you && <span className="shrink-0 text-sm font-bold bg-[#c4a45a] text-[#08090c] px-1.5 rounded">You</span>}
            </div>
            <div className="text-lg font-mono font-black tabular-nums text-[#c4a45a] shrink-0 pl-2">
              {score} <span className="text-sm font-normal">pts</span>
            </div>
          </div>
        );
      })}
      {mine && !board.slice(0, limit).some(([n, sc]) => n === mine.name && sc === mine.score) && (
        <p data-testid="board-you" className="text-center text-lg font-serif font-black text-[#e5cb87]">
          You: {ordinal(mine.rank)} of {view?.boardTotal ?? board.length} · {mine.score} pts
        </p>
      )}

    </div>
  );
};

export const LeaderboardDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { view } = useGame();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  const mine = view?.team;
  return (
    <div
      data-testid="board-drawer"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog" aria-modal="true" aria-label="Standings"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/75 backdrop-blur-sm overscroll-contain"
    >
      <div className="w-full max-w-[480px] mx-auto bg-[#10121a] border-t border-x border-[#2a2e3d] flex flex-col overflow-hidden max-h-[85vh] rounded-t-3xl shadow-2xl">
        <div className="p-4 border-b border-[#2a2e3d] flex items-center justify-between bg-[#161922]/70">
          <div className="flex items-center space-x-2">
            <Trophy className="w-5 h-5 text-[#c4a45a]" />
            <div>
              <h3 className="text-lg font-serif font-black text-[#f4f0e8] tracking-wide">Underworld standings</h3>
              <p className="text-sm text-[#a9b4c7]">
                {mine ? `Your crew: rank ${mine.rank} of ${view?.boardTotal ?? '?'}` : `${view?.boardTotal ?? 0} crews`} · ranked by pts
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close standings" className="w-11 h-11 flex items-center justify-center rounded-lg border border-[#3a4157] text-[#a9b4c7] hover:text-[#f4f0e8]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          <BoardList />
        </div>
        <div className="p-3 border-t border-[#2a2e3d] bg-[#08090c] text-sm text-[#a9b4c7] text-center">Top 10 crews</div>
      </div>
    </div>
  );
};
