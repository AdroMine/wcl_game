// Round 1: The Shattered Tablet. Each phone holds one piece (me.slice) of the tablet.
import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { CheckCircle2, Lightbulb, Lock, Maximize2, Minimize2, RotateCw, Sparkles } from 'lucide-react';
import { formatClock } from '../../game/clock';
import { useGame } from '../../game/useGame';
import { useTick } from '../../game/useNow';
import { BTN_GOLD, CARD, ErrorNote, LABEL, useRoles } from '../ui';

/** The server may send "#" for the block glyph on very small crews (me.sliceFmt === 'hash'). */
function sliceLines(slice: string[], fmt: string | undefined): string[] {
  return fmt === 'hash' ? slice.map(l => l.replace(/#/g, '█')) : slice;
}

const CHAR_W = 10;
const ROW_H = 22;

function TabletSvg({ lines, fill, color }: { lines: string[]; fill: boolean; color: string }) {
  const cols = Math.max(1, ...lines.map(l => l.length));
  const w = cols * CHAR_W;
  const h = lines.length * ROW_H + 8;
  return (
    <svg
      data-testid="tablet-svg"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio={fill ? 'none' : 'xMidYMid meet'}
      style={{ width: '100%', height: fill ? '100%' : 'auto', display: 'block', background: '#0f1118' }}
      role="img"
      aria-label="Your piece of the tablet"
    >
      <rect x="0" y="0" width={w} height={h} fill="#0f1118" />
      {lines.map((line, i) => (
        <text
          key={i}
          x="0"
          y={ROW_H * (i + 1) - 3}
          textLength={Math.max(1, line.length) * CHAR_W}
          lengthAdjust="spacingAndGlyphs"
          xmlSpace="preserve"
          style={{ whiteSpace: 'pre', fontFamily: "'JetBrains Mono','Courier New',monospace", fontWeight: 700, fontSize: 18 }}
          fill={color}
        >
          {line}
        </text>
      ))}
    </svg>
  );
}

export const AsciiSplitterRound: React.FC = () => {
  const { view, send, serverNow } = useGame();
  const { byId } = useRoles();
  useTick(500);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState<number | null>(null);
  const [hintMsg, setHintMsg] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const wasSolved = useRef(view?.r1?.solved ?? false);

  const r1 = view?.r1;
  const me = view?.me;
  const team = view?.team;
  const solved = !!r1?.solved;
  const phase = view?.phase.name;
  const role = me ? byId(me.role) : undefined;
  const color = role?.color ?? '#c4a45a';

  useEffect(() => {
    if (solved && !wasSolved.current) {
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#c084fc', '#34d399'] });
    }
    wasSolved.current = solved;
  }, [solved]);

  useEffect(() => {
    if (!full) return;
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [full]);

  if (!r1 || !team) {
    return (
      <div className={`${CARD} text-center space-y-2`}>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">You are not in a crew</h3>
        <p className="text-sm text-[#a9b4c7]">Round 1 is played in crews. Ask the host to place you in one, then watch this screen.</p>
      </div>
    );
  }

  const active = phase === 'R1_ACTIVE';
  const lines = me?.slice ? sliceLines(me.slice, me.sliceFmt) : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await send('R1_SUBMIT', { answer: answer.trim() });
    setBusy(false);
    if (!r.ok) setMsg(r.message ?? 'Not the codeword.');
    else setAnswer('');
  };

  const takeHint = async (index: number) => {
    setHintBusy(index);
    setHintMsg(null);
    const r = await send('R1_HINT', { hint: index as 1 | 2 | 3 });
    setHintBusy(null);
    if (!r.ok) setHintMsg(r.message ?? 'Could not take that hint.');
  };

  // ---------------------------------------------------------------- fullscreen table alignment
  if (full && lines.length) {
    const sideways = rotation === 90 || rotation === 270;
    return (
      <div className="fixed inset-0 z-[99999] bg-black overflow-hidden select-none" data-testid="tablet-full">
        <div className="absolute top-2 right-2 z-10 flex items-center space-x-2 bg-[#10121a]/95 border border-[#3a4157] p-1.5 rounded-full">
          <button
            onClick={() => setRotation(r => (r + 90) % 360)}
            aria-label="Rotate"
            className="w-14 h-14 flex items-center justify-center rounded-full bg-[#161922] border border-[#3a4157] text-[#e5cb87]"
          >
            <RotateCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setFull(false)}
            aria-label="Exit table alignment"
            className="w-14 h-14 flex items-center justify-center rounded-full bg-red-950/80 border border-red-500/50 text-red-200"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: sideways ? dims.h : dims.w,
            height: sideways ? dims.w : dims.h,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        >
          <TabletSvg lines={lines} fill color={color} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {active && (
        <div className={`${CARD} space-y-4`}>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className={LABEL}>The Shattered Tablet • Round 1</span>
              <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Assemble the Chiseled Codeword</h3>
              <p className="text-sm text-[#cbd5e1] leading-relaxed">
                Put your crew&apos;s phones next to each other and read the 2-word codeword across them.
              </p>
            </div>
          </div>
          <div className="bg-[#08090c] border border-[#3a4157] rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#2a2e3d] text-[11px] font-mono text-[#a9b4c7]">
              <span className="font-bold text-[#f4f0e8]">YOUR TABLET PIECE</span>
              <span data-testid="slot-count">
                Piece {(me?.slot ?? 0) + 1} of {me?.slotCount ?? team.members.length}
              </span>
            </div>
            {lines.length ? <TabletSvg lines={lines} fill={false} color={color} /> : <p className="text-sm text-[#a9b4c7]">Waiting for your piece...</p>}
          </div>
          <button
            data-testid="tablet-fullscreen"
            onClick={() => {
              setRotation(window.innerHeight > window.innerWidth ? 90 : 0);
              setFull(true);
            }}
            className="w-full min-h-[56px] px-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#242b3b] to-[#161922] border border-[#3a4157] text-[#f4f0e8] font-mono font-bold text-sm flex items-center justify-center space-x-2.5"
          >
            <Maximize2 className="w-4 h-4 text-[#e5cb87]" />
            <span>Fullscreen for table alignment</span>
          </button>
        </div>
      )}

      <div className={`${CARD} space-y-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#e5cb87]" />
            <h4 className="text-base font-serif font-bold text-[#f4f0e8]">Submit Codeword</h4>
          </div>
          <span className="text-[11px] font-mono text-[#e5cb87] font-semibold">Any crew member can submit</span>
        </div>

        {solved ? (
          <div data-testid="r1-solved" className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-center space-y-2">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-900/60 text-emerald-300">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h5 className="text-lg font-serif font-black text-emerald-200">Gate Unsealed!</h5>
            <div className="inline-block mt-1 px-3 py-1 bg-emerald-900/60 border border-emerald-500/40 rounded-full text-sm font-mono font-bold text-emerald-300">
              +{r1.points} PTS for {team.name}
            </div>
          </div>
        ) : r1.closed || !active ? (
          <div data-testid="r1-closed" className="p-4 rounded-xl bg-red-950/30 border border-red-500/40 text-center space-y-1">
            <h5 className="text-lg font-serif font-black text-red-200">The gate stayed sealed</h5>
            <p className="text-sm text-red-300/90">Time ran out. Your crew scores 0 for Round 1.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              data-testid="r1-answer"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder="Type the two words"
              maxLength={64}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Codeword"
              className="w-full min-h-[56px] bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] rounded-xl px-4 text-lg text-[#f4f0e8] outline-none font-mono tracking-widest uppercase"
            />
            <ErrorNote text={msg} />
            <button data-testid="r1-submit" type="submit" disabled={busy || !answer.trim()} className={BTN_GOLD}>
              {busy ? 'Checking...' : 'Submit Codeword'}
            </button>
          </form>
        )}
      </div>

      {active && !solved && !r1.closed && (
        <div className={`${CARD} space-y-3`}>
          <div className="flex items-center space-x-2">
            <Lightbulb className="w-4 h-4 text-[#e5cb87]" />
            <h4 className="text-base font-serif font-bold text-[#f4f0e8]">Hints</h4>
            <span className="text-[11px] font-mono text-[#a9b4c7]">each costs 30 pts</span>
          </div>
          {r1.hints.map(h => {
            const left = h.unlocksAt - serverNow();
            const open = left <= 0;
            return (
              <div key={h.index} data-testid={`hint-${h.index}`} className="rounded-xl border border-[#3a4157] bg-[#161922] p-3 space-y-2">
                {h.taken ? (
                  <>
                    <div className="text-[11px] font-mono uppercase text-[#e5cb87] font-bold">Hint {h.index}</div>
                    <p className="text-base text-[#f4f0e8]">{h.text ?? '...'}</p>
                  </>
                ) : (
                  <button
                    disabled={!open || hintBusy === h.index}
                    onClick={() => takeHint(h.index)}
                    className="w-full min-h-[56px] rounded-lg bg-[#10121a] border border-[#3a4157] disabled:opacity-60 text-sm font-mono font-bold text-[#f4f0e8] flex items-center justify-center space-x-2"
                  >
                    {open ? (
                      <span>{hintBusy === h.index ? 'Taking...' : `Take hint ${h.index} (-30 pts)`}</span>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>
                          Hint {h.index} unlocks in {formatClock(left)}
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
          <ErrorNote text={hintMsg} />
        </div>
      )}
    </div>
  );
};
