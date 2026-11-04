// Sudden Death visuals: the "what beats what" triangle and the timed reveal (your pick, their pick, the winner).
import React, { useEffect, useId, useRef } from 'react';
import { Shield, Swords, Trophy, Wind } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { SdAction } from '../../../../../shared/protocol.ts';

export const SD_META: Record<SdAction, { name: string; fill: string; Icon: typeof Shield }> = {
  SHIELDS: { name: 'Shields', fill: '#1d4ed8', Icon: Shield },
  RAM: { name: 'Ram', fill: '#b91c1c', Icon: Swords },
  SAILS: { name: 'Sails', fill: '#047857', Icon: Wind },
};

/** Who beats whom (winner -> loser) and the verb shown on the arrow. Same rule as the server. */
const BEATS: { from: SdAction; to: SdAction; verb: string }[] = [
  { from: 'SHIELDS', to: 'RAM', verb: 'blocks' },
  { from: 'RAM', to: 'SAILS', verb: 'smashes' },
  { from: 'SAILS', to: 'SHIELDS', verb: 'outrun' },
];

export function sdBeats(a: SdAction, b: SdAction): boolean {
  return BEATS.some(x => x.from === a && x.to === b);
}

const W = 300;
const H = 300;
const R = 40;
const POS: Record<SdAction, { x: number; y: number }> = {
  SHIELDS: { x: 62, y: 84 },
  RAM: { x: 238, y: 84 },
  SAILS: { x: 150, y: 226 },
};
const CENTRE = { x: 150, y: 131 };

function arc(from: SdAction, to: SdAction) {
  const a = POS[from];
  const b = POS[to];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const s = { x: a.x + ux * (R + 6), y: a.y + uy * (R + 6) };
  const e = { x: b.x - ux * (R + 12), y: b.y - uy * (R + 12) };
  const m = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
  const ol = Math.hypot(m.x - CENTRE.x, m.y - CENTRE.y) || 1;
  const ox = (m.x - CENTRE.x) / ol;
  const oy = (m.y - CENTRE.y) / ol;
  return {
    d: `M ${s.x} ${s.y} Q ${m.x + ox * 30} ${m.y + oy * 30} ${e.x} ${e.y}`,
    label: { x: m.x + ox * 46, y: m.y + oy * 46 },
  };
}

/**
 * The three maneuvers in a circle with arrows from winner to loser.
 * `marks` puts crew labels next to a maneuver; `result` highlights the deciding arrow and dims the loser.
 */
export const SdTriangle: React.FC<{
  marks?: Partial<Record<SdAction, string[]>>;
  result?: { winner: SdAction; loser: SdAction } | null;
  className?: string;
}> = ({ marks, result, className }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className ?? 'w-full max-w-[300px] mx-auto'} role="img" aria-label="Shields blocks Ram, Ram smashes Sails, Sails outrun Shields" data-testid="sd-triangle">
      <defs>
        <marker id={`${id}-a`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#a9b4c7" />
        </marker>
        <marker id={`${id}-g`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#e5cb87" />
        </marker>
      </defs>
      {BEATS.map(b => {
        const { d, label } = arc(b.from, b.to);
        const hot = !!result && result.winner === b.from && result.loser === b.to;
        const dim = !!result && !hot;
        return (
          <g key={b.from} opacity={dim ? 0.3 : 1}>
            <path d={d} fill="none" stroke={hot ? '#e5cb87' : '#a9b4c7'} strokeWidth={hot ? 5 : 2.5} markerEnd={`url(#${id}-${hot ? 'g' : 'a'})`} className={hot ? 'animate-pulse' : undefined} />
            <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight={700} fill={hot ? '#e5cb87' : '#cbd5e1'} stroke="#10121a" strokeWidth={4} paintOrder="stroke" fontFamily="ui-monospace, monospace">
              {b.verb}
            </text>
          </g>
        );
      })}
      {(Object.keys(POS) as SdAction[]).map(a => {
        const { x, y } = POS[a];
        const m = SD_META[a];
        const lost = !!result && result.loser === a;
        const won = !!result && result.winner === a;
        const tags = marks?.[a] ?? [];
        const tagY = a === 'SAILS' ? y + R + 18 : y - R - 12;
        return (
          <g key={a} opacity={lost ? 0.35 : 1}>
            {won && <circle cx={x} cy={y} r={R + 7} fill="none" stroke="#e5cb87" strokeWidth={4} />}
            <circle cx={x} cy={y} r={R} fill={m.fill} stroke="#f4f0e8" strokeWidth={2} />
            <m.Icon x={x - 13} y={y - 26} width={26} height={26} color="#ffffff" strokeWidth={2.2} />
            <text x={x} y={y + 18} textAnchor="middle" fontSize="13" fontWeight={800} fill="#ffffff" fontFamily="Georgia, serif">
              {m.name}
            </text>
            {tags.length > 0 && (
              <text x={x} y={tagY} textAnchor="middle" fontSize="12" fontWeight={800} fill="#e5cb87" fontFamily="ui-monospace, monospace">
                {tags.join(' · ').slice(0, 28)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

const PickCard: React.FC<{ who: string; pick: SdAction | undefined; shown: boolean; highlight: boolean }> = ({ who, pick, shown, highlight }) => {
  const m = pick ? SD_META[pick] : null;
  return (
    <div className={`flex-1 min-w-0 rounded-xl border-2 p-3 text-center space-y-1 transition-all duration-500 ${highlight ? 'border-[#e5cb87] bg-[#1f2433]' : 'border-[#3a4157] bg-[#161922]'}`}>
      <div className="text-xs font-mono uppercase text-[#a9b4c7] truncate">{who}</div>
      {shown && m ? (
        <div className="animate-fadeIn flex flex-col items-center gap-1">
          <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: m.fill }}>
            <m.Icon className="w-6 h-6 text-white" />
          </span>
          <span className="text-lg font-serif font-black text-[#f4f0e8]">{m.name}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className="w-12 h-12 rounded-full flex items-center justify-center bg-[#08090c] border border-[#3a4157] text-2xl font-black text-[#e5cb87] animate-pulse">?</span>
          <span className="text-lg font-serif font-black text-[#8e95a5]">...</span>
        </div>
      )}
    </div>
  );
};

/** Reveal timeline in ms from the start of the reveal step (server time, so every phone is in step). */
const SHOW_FIRST = 0;
const SHOW_SECOND = 2500;
const SHOW_WINNER = 5000;

export const SdReveal: React.FC<{
  teamA: string;
  teamB: string;
  side?: 'A' | 'B';
  pickA?: SdAction;
  pickB?: SdAction;
  winner?: string | null;
  winnerSide?: 'A' | 'B' | null;
  text?: string | null;
  /** ms since the reveal started; Infinity shows everything at once. */
  elapsed: number;
  /** Confetti for the winning crew (off for the after-the-fact summary). */
  celebrate?: boolean;
}> = ({ teamA, teamB, side, pickA, pickB, winner, winnerSide, text, elapsed, celebrate = true }) => {
  // Your crew first; spectators see crew A first.
  const firstIsA = side !== 'B';
  const first = firstIsA ? { who: side ? 'Your crew' : teamA, pick: pickA, s: 'A' as const } : { who: 'Your crew', pick: pickB, s: 'B' as const };
  const second = firstIsA ? { who: teamB, pick: pickB, s: 'B' as const } : { who: teamA, pick: pickA, s: 'A' as const };
  const showFirst = elapsed >= SHOW_FIRST;
  const showSecond = elapsed >= SHOW_SECOND;
  const showWinner = elapsed >= SHOW_WINNER;

  const marks: Partial<Record<SdAction, string[]>> = {};
  const mark = (pick: SdAction | undefined, label: string) => {
    if (!pick) return;
    (marks[pick] ??= []).push(label);
  };
  if (showFirst) mark(first.pick, side ? 'YOU' : teamA.slice(0, 12));
  if (showSecond) mark(second.pick, (side ? second.who : teamB).slice(0, 12));

  const result =
    showWinner && pickA && pickB && pickA !== pickB ? (sdBeats(pickA, pickB) ? { winner: pickA, loser: pickB } : { winner: pickB, loser: pickA }) : null;
  const iWon = !!side && winnerSide === side;
  const iLost = !!side && !!winnerSide && winnerSide !== side;

  const fired = useRef(false);
  useEffect(() => {
    if (!celebrate || !showWinner || !iWon || fired.current) return;
    fired.current = true;
    try {
      confetti({ particleCount: 90, spread: 100, origin: { y: 0.4 }, colors: ['#c4a45a', '#f4f0e8', '#e5cb87'] });
    } catch {
      /* ignore */
    }
  }, [celebrate, showWinner, iWon]);

  return (
    <div className="space-y-4" data-testid="sd-reveal">
      <div className="flex items-stretch gap-2">
        <PickCard who={first.who} pick={first.pick} shown={showFirst} highlight={showWinner && winnerSide === first.s} />
        <div className="self-center text-sm font-mono font-black text-red-400">VS</div>
        <PickCard who={second.who} pick={second.pick} shown={showSecond} highlight={showWinner && winnerSide === second.s} />
      </div>

      <SdTriangle marks={marks} result={result} />

      {showWinner ? (
        <div data-testid="sd-winner" className="animate-fadeIn p-4 rounded-xl border-2 border-[#e5cb87] bg-gradient-to-b from-[#2a2410] to-[#10121a] text-center space-y-1">
          <div className="inline-flex items-center gap-1.5 text-sm font-mono font-black text-[#e5cb87]">
            <Trophy className="w-4 h-4" />
            <span>{iWon ? 'YOUR CREW WINS!' : iLost ? 'YOUR CREW LOSES' : 'WINNER'}</span>
          </div>
          <h4 className="text-2xl font-serif font-black text-[#f4f0e8] break-words">{winner ? `${winner} wins` : 'No winner'}</h4>
          {text && <p className="text-sm text-[#cbd5e1]">{text.replace(/^Victory for Challenger [AB]! /, '')}</p>}
        </div>
      ) : (
        <p className="text-center text-base font-mono text-[#e5cb87] animate-pulse">{showSecond ? 'And the winner is...' : 'Revealing the maneuvers...'}</p>
      )}
    </div>
  );
};
