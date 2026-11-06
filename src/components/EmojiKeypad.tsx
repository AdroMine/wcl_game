// The crew-code keypad: three slots on top, the pool as a 2x2 square of big buttons, one backspace.
// Shared by the lobby (join a crew) and Round 2 (type your rival's code). Display and input only.
import React from 'react';
import { Delete } from 'lucide-react';

export const EMOJI_LABELS: Record<string, string> = { '🔥': 'Fire', '💀': 'Skull', '⚡': 'Bolt', '🌊': 'Wave', '🛡️': 'Shield' };
export const CODE_LENGTH = 3;

export const EmojiKeypad: React.FC<{
  pool: string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  slotsTestId?: string;
}> = ({ pool, value, onChange, disabled, slotsTestId }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-center gap-3" data-testid={slotsTestId} aria-label={`Code: ${value.map(e => EMOJI_LABELS[e] ?? e).join(', ') || 'empty'}`}>
      {Array.from({ length: CODE_LENGTH }, (_v, i) => {
        const e = value[i];
        const current = i === value.length;
        return (
          <div
            key={i}
            className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 ${
              e ? 'bg-[#161922] border-[#c4a45a]' : current ? 'bg-[#161922] border-[#c4a45a]/70 border-dashed' : 'bg-[#161922]/50 border-[#2a2e3d] border-dashed'
            }`}
          >
            {e && <span className="text-3xl">{e}</span>}
          </div>
        );
      })}
      <button
        type="button"
        data-testid="key-back"
        aria-label="Delete last symbol"
        onClick={() => onChange(value.slice(0, -1))}
        disabled={disabled || value.length === 0}
        className="w-14 h-16 rounded-2xl border border-[#3a4157] bg-[#161922] text-[#cbd5e1] flex items-center justify-center disabled:opacity-40"
      >
        <Delete className="w-6 h-6" />
      </button>
    </div>
    <div className="grid grid-cols-2 gap-3 max-w-[300px] mx-auto">
      {pool.slice(0, 4).map(e => {
        const label = EMOJI_LABELS[e] ?? e;
        return (
          <button
            key={e}
            type="button"
            data-testid={`key-${label.toLowerCase()}`}
            disabled={disabled || value.length >= CODE_LENGTH}
            onClick={() => onChange([...value, e])}
            className="min-h-[88px] rounded-2xl bg-[#161922] hover:bg-[#202533] border-2 border-[#3a4157] hover:border-[#c4a45a] flex flex-col items-center justify-center gap-0.5 active:scale-95 transition disabled:opacity-50"
          >
            <span className="text-4xl leading-none">{e}</span>
            <span className="text-base font-semibold text-[#cbd5e1]">{label}</span>
          </button>
        );
      })}
    </div>
  </div>
);
