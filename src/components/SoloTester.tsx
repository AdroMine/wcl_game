// /solotester: several independent players side by side, each a normal player app in an iframe (/?seat=K).
// Nothing here changes game state or handles an admin token. Seats are separated by namespaced localStorage keys
// (see src/game/session.ts). Drive the game from /admin in another tab.
import React, { useEffect, useState } from 'react';


const FRAME_W = 390;
const FRAME_H = 780;
const GAP = 16;
const MAX_SEATS = 9;
const COUNT_KEY = 'uw.solotester.count';

function readCount(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY));
    return n >= 3 && n <= 6 ? n : 3;
  } catch {
    return 3;
  }
}

export const SoloTester: React.FC = () => {
  const [count, setCount] = useState(readCount);
  const [gen, setGen] = useState(0); // bumping it remounts every iframe
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const choose = (n: number) => {
    setCount(n);
    try {
      localStorage.setItem(COUNT_KEY, String(n));
    } catch {
      /* ignore */
    }
  };

  const resetSeats = () => {
    if (!window.confirm('Forget the identity of every seat? Each seat will join the game again as a new player.')) return;
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^uw\.s\d+\./.test(k)) doomed.push(k);
      }
      for (const k of doomed) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    setGen(g => g + 1);
  };

  // Scale so all seats fit across the screen, but never below 55% (then the row scrolls sideways).
  const fit = (width - GAP * (count + 1)) / (count * FRAME_W);
  const scale = Math.max(0.55, Math.min(1, fit));
  const seats = Array.from({ length: Math.min(count, MAX_SEATS) }, (_, i) => i + 1);

  const btn = 'px-3 py-1.5 rounded-lg border border-[#3a4157] bg-[#161922] text-[#f4f0e8] text-sm font-mono hover:bg-[#242b3b]';

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8]" data-testid="solotester">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#2a2e3d]">
        <h1 className="text-lg font-serif font-black mr-2">Solo tester</h1>
        <label className="flex items-center gap-2 text-sm font-mono text-[#a9b4c7]">
          Seats
          <select
            value={count}
            onChange={e => choose(Number(e.target.value))}
            className="bg-[#161922] border border-[#3a4157] rounded px-2 py-1 text-[#f4f0e8]"
            data-testid="seat-count"
          >
            {[3, 4, 5, 6].map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button onClick={resetSeats} className={btn} data-testid="reset-seats">
          Reset seats
        </button>
        <button onClick={() => setGen(g => g + 1)} className={btn}>
          Reload frames
        </button>
        <a href="/admin" target="_blank" rel="noreferrer" className={btn}>
          Open /admin
        </a>
        <a href="/screen" target="_blank" rel="noreferrer" className={btn}>
          Open /screen
        </a>
        <span className="text-xs text-[#8e95a5] font-mono">Each seat is its own player. Phases are driven from /admin.</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-start" style={{ gap: GAP, padding: GAP, width: 'max-content' }}>
          {seats.map(k => (
            <div key={`${k}-${gen}`} style={{ width: FRAME_W * scale }}>
              <div className="text-center text-sm font-mono font-bold text-[#e5cb87] pb-1">Seat {k}</div>
              <div style={{ width: FRAME_W * scale, height: FRAME_H * scale }} className="rounded-2xl border border-[#3a4157] overflow-hidden bg-black">
                <iframe
                  title={`Seat ${k}`}
                  src={`/?seat=${k}`}
                  style={{ width: FRAME_W, height: FRAME_H, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
