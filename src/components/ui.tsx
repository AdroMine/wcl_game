// Small shared pieces: class strings, helpers. The only timer on a phone is the rope (Rope.tsx).
import React, { useEffect } from 'react';

export const CARD = 'bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl';
export const LABEL = 'text-sm font-serif font-bold text-[#e5cb87]';
export const BTN_GOLD =
  'w-full min-h-[56px] py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-black text-base tracking-wide flex items-center justify-center space-x-2 shadow-gold-glow transition-all disabled:opacity-50';
export const BTN_DARK =
  'w-full min-h-[56px] py-3 px-4 rounded-xl bg-[#161922] hover:bg-[#202533] border border-[#3a4157] hover:border-[#c4a45a] text-[#f4f0e8] font-serif font-bold text-base tracking-wide flex items-center justify-center space-x-2 transition-all disabled:opacity-50';

let overlays = 0;
/**
 * A full-screen layer (briefing, modal, drawer, table alignment) is open. The paused banner moves up under the rope so it
 * never covers the layer's own header, and the layer reserves var(--paused-h) at its top while the game is paused.
 */
export function useOverlay(active = true) {
  useEffect(() => {
    if (!active) return;
    overlays++;
    document.documentElement.classList.add('has-overlay');
    return () => {
      overlays = Math.max(0, overlays - 1);
      if (overlays === 0) document.documentElement.classList.remove('has-overlay');
    };
  }, [active]);
}

/** Top padding for a full-screen layer: safe area, a small gap, and room for the paused banner when it shows. */
export const OVERLAY_TOP = 'calc(env(safe-area-inset-top, 0px) + 14px + var(--paused-h, 0px))';

/** True when the player asked the OS for less motion: no pulses, bounces or confetti. */
export function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
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

export function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export type Children = { children?: React.ReactNode };
