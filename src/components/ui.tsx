// Small shared pieces: class strings, role icons, the server countdown.
import React from 'react';
import { Compass, Eye, Book, Flame, Shield, PauseCircle } from 'lucide-react';
import { formatClock } from '../game/clock';
import { useGame } from '../game/useGame';
import { useTick } from '../game/useNow';

export const CARD = 'bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl';
export const LABEL = 'text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold';
export const BTN_GOLD =
  'w-full min-h-[56px] py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-black text-base tracking-wide flex items-center justify-center space-x-2 shadow-gold-glow transition-all disabled:opacity-50';
export const BTN_DARK =
  'w-full min-h-[56px] py-3 px-4 rounded-xl bg-[#161922] hover:bg-[#202533] border border-[#3a4157] hover:border-[#c4a45a] text-[#f4f0e8] font-serif font-bold text-sm tracking-wide flex items-center justify-center space-x-2 transition-all disabled:opacity-50';
export const BTN_DANGER =
  'min-h-[56px] px-4 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 text-sm font-mono font-bold flex items-center justify-center space-x-1.5 transition-all disabled:opacity-50';

export function RoleIcon({ icon, className = 'w-5 h-5' }: { icon: string; className?: string }) {
  switch (icon) {
    case 'compass':
      return <Compass className={className} />;
    case 'eye':
      return <Eye className={className} />;
    case 'book':
      return <Book className={className} />;
    case 'flame':
      return <Flame className={className} />;
    default:
      return <Shield className={className} />;
  }
}

export function useRoles() {
  const { meta } = useGame();
  const list = meta?.roles ?? [];
  const byId = (id: string) => list.find(r => r.id === id);
  return { list, byId };
}

/** Big server-driven countdown. Never decides anything; just shows endsAt minus the server clock. */
export function Countdown({
  endsAt,
  className = 'text-4xl',
  urgentBelowMs = 10_000,
  testId = 'countdown',
}: {
  endsAt: number | null | undefined;
  className?: string;
  urgentBelowMs?: number;
  testId?: string;
}) {
  useTick(250);
  const { timeLeftMs, view } = useGame();
  const paused = !!view?.phase.paused;
  const left = timeLeftMs(endsAt);
  if (left === null) return null;
  const urgent = !paused && left > 0 && left <= urgentBelowMs;
  return (
    <span
      data-testid={testId}
      className={`font-mono font-black tracking-wider tabular-nums ${className} ${urgent ? 'text-red-400 animate-pulse' : paused ? 'text-amber-300' : 'text-[#f4f0e8]'}`}
    >
      {formatClock(left)}
      {paused && <PauseCircle className="inline w-5 h-5 ml-2 align-middle" />}
    </span>
  );
}

export function ErrorNote({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div role="alert" className="p-3 rounded-lg bg-red-950/80 border border-red-500/60 text-red-200 text-sm font-medium">
      {text}
    </div>
  );
}

export function pts(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

export type Children = { children?: React.ReactNode };
