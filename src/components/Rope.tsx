// The burning rope: the one and only timer on a phone. A bar fixed at the very top of the viewport that shortens
// right to left as the step's server deadline approaches. It never decides anything; it only displays
// (endsAt - server now) / (step length).
//
// Step length (the 100% mark), in order of trust:
//   1. phase.startedAt, when the server sends it (BRIEFING and SUDDEN_DEATH): endsAt - startedAt, exact.
//   2. meta.durations for the running step (R1 active, R2 VOTE / DEBRIEF, R3 VOTE / REVEAL): the planned length.
//   3. otherwise the time left when this phone first saw the step.
// Whatever the source, the length is kept per step (name + step + clash + wave) and only ever grows to match the time
// left, so an admin extension or a late join can never push the bar past full. While paused the server's frozen
// remaining time is used, so the bar freezes with the game.
import React, { useEffect, useRef, useState } from 'react';
import type { Meta, PhaseView } from '../../shared/protocol.ts';
import { formatClock } from '../game/clock';
import { useGame } from '../game/useGame';
import { useTick } from '../game/useNow';

const VIBRATE_AT = [10, 5, 3, 2, 1];
const ANNOUNCE_AT = [30, 10];

function plannedMs(ph: PhaseView, meta: Meta | null): number | null {
  if (ph.startedAt != null && ph.endsAt != null) return ph.endsAt - ph.startedAt;
  const d = meta?.durations as Partial<Meta['durations']> | undefined;
  if (!d) return null;
  let sec: number | undefined;
  if (ph.name === 'R1_ACTIVE') sec = d.r1Seconds;
  else if (ph.name === 'R2_CLASH') sec = ph.step === 'VOTE' ? d.r2?.VOTE : ph.step === 'DEBRIEF' ? d.r2?.DEBRIEF : undefined;
  else if (ph.name === 'R3_ACTIVE') sec = ph.step === 'VOTE' ? d.r3?.VOTE : ph.step === 'REVEAL' ? d.r3?.REVEAL : undefined;
  return sec != null && sec > 0 ? sec * 1000 : null;
}

export const Rope: React.FC = () => {
  const { view, meta, status, synced, timeLeftMs } = useGame();
  useTick(250);
  const ph = view?.phase;
  const key = view && ph ? `${view.sid}:${ph.name}:${ph.step}:${ph.clash}:${ph.wave}:${ph.startedAt ?? ''}` : '';
  const left = ph ? timeLeftMs(ph.endsAt) : null;
  const paused = !!ph?.paused;

  // Length of this step (see the header). Mutated during render, but idempotent for a given key.
  const lenRef = useRef<{ key: string; ms: number; fired: Set<number>; first: boolean }>({ key: '', ms: 0, fired: new Set(), first: true });
  if (lenRef.current.key !== key) lenRef.current = { key, ms: (ph ? plannedMs(ph, meta) : null) ?? 0, fired: new Set(), first: true };
  if (left != null && left > lenRef.current.ms) lenRef.current.ms = left;
  const total = Math.max(1, lenRef.current.ms);
  const pct = left == null ? 0 : Math.max(0, Math.min(100, (left / total) * 100));
  const secs = left == null ? -1 : Math.ceil(left / 1000);
  const urgent = !paused && left != null && left > 0 && secs <= 10;
  const down = status === 'reconnecting' || status === 'offline' || (!synced && !!view);

  // Haptic ticks and screen-reader announcements, each once per step. Thresholds already passed when the step is first
  // seen are marked silently (a late join must not buzz).
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (left == null || paused) return;
    const st = lenRef.current;
    const crossed = [...VIBRATE_AT, ...ANNOUNCE_AT].filter(t => secs <= t && !st.fired.has(t));
    if (crossed.length === 0) {
      st.first = false;
      return;
    }
    crossed.forEach(t => st.fired.add(t));
    if (!st.first && secs > 0) {
      if (crossed.some(t => VIBRATE_AT.includes(t))) {
        try {
          navigator.vibrate?.(30);
        } catch {
          /* not supported */
        }
      }
      const a = crossed.find(t => ANNOUNCE_AT.includes(t));
      if (a) setAnnounce(`${a} seconds left`);
    }
    st.first = false;
  }, [secs, key, left, paused]);

  // Tap or focus shows the seconds as text for 3 s.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (peekTimer.current && clearTimeout(peekTimer.current)), []);
  const showPeek = () => {
    setPeek(true);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(false), 3000);
  };

  if (!view || left == null) return null;

  const fill = paused
    ? '#7b8394'
    : down
      ? 'repeating-linear-gradient(90deg,#f59e0b 0 9px,transparent 9px 14px)'
      : urgent
        ? '#f97316'
        : 'linear-gradient(90deg,#c4a45a,#e5cb87)';
  const barH = urgent ? 10 : 6;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-[480px]" style={{ top: 'env(safe-area-inset-top, 0px)', zIndex: 100000 }}>
      <div
        data-testid="rope"
        data-state={paused ? 'paused' : down ? 'offline' : urgent ? 'urgent' : 'burning'}
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
        onClick={showPeek}
        onFocus={showPeek}
        className="relative h-[14px] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#e5cb87]"
      >
        <div className="absolute inset-x-0 top-0 bg-white/10" style={{ height: barH, transition: 'height 300ms ease-out' }}>
          <div className="relative h-full" style={{ width: `${pct}%`, background: fill, transition: 'width 320ms linear, background-color 300ms' }}>
            {!paused && (
              <span
                aria-hidden="true"
                className={`absolute right-0 top-1/2 rounded-full ${urgent ? 'rope-ember-hot' : ''}`}
                style={{
                  width: urgent ? 16 : 10,
                  height: urgent ? 16 : 10,
                  transform: 'translate(50%,-50%)',
                  background: urgent ? 'radial-gradient(circle,#fff3d6 0%,#fb923c 55%,#ea580c 100%)' : 'radial-gradient(circle,#fff8e7 0%,#f5c76a 60%,#d9922b 100%)',
                  boxShadow: urgent ? '0 2px 10px 3px rgba(249,115,22,0.75)' : '0 1px 7px 2px rgba(245,199,106,0.65)',
                }}
              />
            )}
          </div>
        </div>
        {peek && !paused && (
          <span
            data-testid="rope-seconds"
            className="absolute left-1/2 top-[16px] -translate-x-1/2 rounded-full bg-[#161922] border border-[#3a4157] px-3 py-0.5 text-sm font-mono font-bold tabular-nums text-[#f4f0e8] pointer-events-none"
          >
            {secs >= 60 ? formatClock(left) : `${secs}s`}
          </span>
        )}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
};
