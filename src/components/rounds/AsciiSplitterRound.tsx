// Round 1: The Shattered Tablet. A vector tablet is cut into one vertical slice per crew member (me.slot of me.slotCount).
import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AlertCircle, CheckCircle2, Maximize2, Minimize2, RotateCw, Sparkles } from 'lucide-react';
import { useGame } from '../../game/useGame';
import { getSliceViewBox, getTabletTextMetrics, TABLET_CONFIG } from '../../lib/tabletEngine';
import { BTN_GOLD, CARD, LABEL, useRoles } from '../ui';

type Rotation = 0 | 90 | 180 | 270;

export const AsciiSplitterRound: React.FC = () => {
  const { view, send } = useGame();
  const { byId } = useRoles();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [showHud, setShowHud] = useState(true);
  const hudTimeoutRef = useRef<number | null>(null);
  const [windowDimensions, setWindowDimensions] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 400,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const [codewordInput, setCodewordInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);
  const lastAnswer = useRef('');

  const r1 = view?.r1;
  const me = view?.me;
  const team = view?.team;
  const solved = !!r1?.solved;
  const wasSolved = useRef(solved);
  const phase = view?.phase.name;
  const role = me ? byId(me.role) : undefined;
  const roleColor = role?.color ?? '#c4a45a';

  useEffect(() => {
    const handleResize = () => setWindowDimensions({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  useEffect(() => {
    if (solved && !wasSolved.current) {
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#c084fc', '#34d399'],
      });
    }
    wasSolved.current = solved;
  }, [solved]);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake Lock request error:', err);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch (err) {
        console.warn('Wake lock release error:', err);
      }
      wakeLockRef.current = null;
    }
  };

  const resetHudTimeout = () => {
    setShowHud(true);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = window.setTimeout(() => setShowHud(false), 4000);
  };

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      resetHudTimeout();
      await requestWakeLock();
      try {
        if (containerRef.current && containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if ((containerRef.current as any)?.webkitRequestFullscreen) {
          await (containerRef.current as any).webkitRequestFullscreen();
        }
      } catch (err) {
        console.warn('Standard fullscreen API rejected; fallback container active:', err);
      }
      try {
        window.history.pushState({ fullscreenMode: true }, '');
      } catch {
        /* ignore */
      }
    } else {
      exitFullscreenCleanly();
    }
  };

  const exitFullscreenCleanly = () => {
    setIsFullscreen(false);
    releaseWakeLock();
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitFullscreenElement) {
        (document as any).webkitExitFullscreen();
      }
    } catch {
      /* ignore */
    }
  };

  // Back button leaves table alignment mode instead of leaving the game.
  useEffect(() => {
    const handlePopState = () => {
      if (isFullscreen) {
        setIsFullscreen(false);
        releaseWakeLock();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isFullscreen]);

  // Leaving native fullscreen (Esc / swipe) also leaves alignment mode.
  useEffect(() => {
    const onFsChange = () => {
      if (isFullscreen && !document.fullscreenElement && !(document as any).webkitFullscreenElement && wasNativeFs.current) {
        setIsFullscreen(false);
        releaseWakeLock();
      }
      wasNativeFs.current = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [isFullscreen]);
  const wasNativeFs = useRef(false);

  useEffect(() => {
    return () => {
      releaseWakeLock();
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, []);

  const handleRotate = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetHudTimeout();
    setRotation(prev => (prev === 0 ? 90 : prev === 90 ? 180 : prev === 180 ? 270 : 0));
  };

  if (!r1 || !team) {
    return (
      <div className={`${CARD} text-center space-y-2`}>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">You are not in a crew</h3>
        <p className="text-sm text-[#a9b4c7]">Round 1 is played in crews. Ask the host to place you in one, then watch this screen.</p>
      </div>
    );
  }

  const active = phase === 'R1_ACTIVE';
  const tablet = r1.tablet;
  const line1 = tablet?.line1 ?? '';
  const line2 = tablet?.line2 ?? '';
  const slotCount = Math.max(1, me?.slotCount ?? team.members.length);
  const activeSlot = me?.slot ?? 0;

  const handleCodewordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const answer = codewordInput.trim();
    if (!answer || submitting) return;
    setSubmitting(true);
    setSubmitResult(null);
    const r = await send('R1_SUBMIT', { answer });
    setSubmitting(false);
    if (r.ok) {
      lastAnswer.current = answer;
      setCodewordInput('');
      setSubmitResult({ success: true, message: 'Codeword accepted!' });
    } else {
      setSubmitResult({ success: false, message: r.message ?? 'Not the codeword.' });
    }
  };

  // Geometry
  const isPortrait = windowDimensions.h > windowDimensions.w;
  const isSideways = rotation === 90 || rotation === 270;
  const canvasWidth = isSideways && isPortrait ? windowDimensions.h : windowDimensions.w;
  const canvasHeight = isSideways && isPortrait ? windowDimensions.w : windowDimensions.h;

  const { totalWidth, totalHeight, line1Y, horizonY, line2Y } = TABLET_CONFIG;
  const vb = getSliceViewBox(activeSlot, slotCount);
  const line1Metrics = getTabletTextMetrics(line1);
  const line2Metrics = getTabletTextMetrics(line2);
  const seamPositions: number[] = [];
  for (let i = 1; i < slotCount; i++) seamPositions.push((i * totalWidth) / slotCount);

  const renderTabletSlice = (isFullscreenMode: boolean) => (
    <div
      className="flex items-center justify-center select-none relative overflow-hidden mx-auto rounded-lg shadow-xl"
      style={{
        width: isFullscreenMode ? '100%' : '160px',
        height: isFullscreenMode ? '100%' : '270px',
      }}
    >
      <svg
        data-testid="tablet-svg"
        viewBox={`${vb.x} 0 ${vb.width} ${totalHeight}`}
        preserveAspectRatio={isFullscreenMode ? 'none' : 'xMidYMid meet'}
        style={{ width: '100%', height: '100%', display: 'block' }}
        role="img"
        aria-label="Your piece of the tablet"
      >
        <defs>
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fff8e7" />
            <stop offset="35%" stopColor="#e5cb87" />
            <stop offset="70%" stopColor="#c4a45a" />
            <stop offset="100%" stopColor="#8c6d28" />
          </linearGradient>
          <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <radialGradient id="roleAmbientGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={roleColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor="#08090c" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Granite slab */}
        <rect x="0" y="0" width={totalWidth} height={totalHeight} fill="#08090c" />
        <rect x="0" y="0" width={totalWidth} height={totalHeight} fill="url(#roleAmbientGlow)" />
        <rect x="6" y="6" width={totalWidth - 12} height={totalHeight - 12} rx="10" fill="#0f1118" stroke="#2a2e3d" strokeWidth="3" />

        {/* Crest marker (top) */}
        <rect x="16" y="16" width={totalWidth - 32} height="52" fill="#161924" rx="6" />
        <line x1="20" y1="72" x2={totalWidth - 20} y2="72" stroke="#c4a45a" strokeWidth="2" opacity="0.6" />
        <text x={totalWidth / 2} y="48" textAnchor="middle" fontFamily="monospace" fontSize="18" fontWeight="bold" fill="#c4a45a" letterSpacing="8">
          ▲ TABLET CREST (TOP) ▲
        </text>

        {/* Line 1 */}
        <text
          x={totalWidth / 2}
          y={line1Y}
          textAnchor="middle"
          textLength={line1Metrics.textLength}
          lengthAdjust="spacing"
          fontFamily="Cinzel, Georgia, serif"
          fontWeight="900"
          fontSize={line1Metrics.fontSize}
          fill="url(#goldGradient)"
          stroke="#08090c"
          strokeWidth="4"
          filter="url(#goldGlow)"
        >
          {line1}
        </text>

        {/* Horizon / fracture seam */}
        <line x1="0" y1={horizonY} x2={totalWidth} y2={horizonY} stroke="#c4a45a" strokeWidth="6" opacity="0.5" filter="url(#goldGlow)" />
        <line x1="0" y1={horizonY} x2={totalWidth} y2={horizonY} stroke="#ffffff" strokeWidth="2" opacity="0.9" />

        {/* Seam notches between slices */}
        {seamPositions.map((seamX, idx) => (
          <g key={idx}>
            <polygon
              points={`${seamX},${horizonY - 26} ${seamX + 18},${horizonY} ${seamX},${horizonY + 26} ${seamX - 18},${horizonY}`}
              fill="#c4a45a"
              opacity="0.9"
              filter="url(#goldGlow)"
            />
            <polygon points={`${seamX},${horizonY - 14} ${seamX + 10},${horizonY} ${seamX},${horizonY + 14} ${seamX - 10},${horizonY}`} fill="#ffffff" />
            <line x1={seamX} y1={horizonY - 38} x2={seamX} y2={horizonY + 38} stroke="#c4a45a" strokeWidth="1.5" strokeDasharray="4 3" />
          </g>
        ))}

        {/* Line 2 */}
        <text
          x={totalWidth / 2}
          y={line2Y}
          textAnchor="middle"
          textLength={line2Metrics.textLength}
          lengthAdjust="spacing"
          fontFamily="Cinzel, Georgia, serif"
          fontWeight="900"
          fontSize={line2Metrics.fontSize}
          fill="url(#goldGradient)"
          stroke="#08090c"
          strokeWidth="4"
          filter="url(#goldGlow)"
        >
          {line2}
        </text>

        {/* Base marker (bottom) */}
        <line x1="20" y1="528" x2={totalWidth - 20} y2="528" stroke="#c4a45a" strokeWidth="2" opacity="0.6" />
        <rect x="16" y="532" width={totalWidth - 32} height="52" fill="#161924" rx="6" />
        <text x={totalWidth / 2} y="564" textAnchor="middle" fontFamily="monospace" fontSize="18" fontWeight="bold" fill="#c4a45a" letterSpacing="8">
          ▼ TABLET BASE (BOTTOM) ▼
        </text>
      </svg>
    </div>
  );

  // ---------------------------------------------------------------- fullscreen table alignment
  if (isFullscreen && tablet) {
    return (
      <div
        ref={containerRef}
        data-testid="tablet-full"
        onClick={resetHudTimeout}
        className="fixed inset-0 w-screen h-screen bg-black z-[99999] overflow-hidden select-none flex items-center justify-center"
      >
        <div
          className={`absolute top-0 left-0 right-0 p-2 sm:p-3 z-50 transition-opacity duration-300 flex flex-wrap items-center justify-between gap-2 pointer-events-auto ${
            showHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="bg-[#10121a]/95 backdrop-blur border border-[#c4a45a]/60 px-4 py-2 rounded-full flex items-center space-x-2 text-sm font-mono text-[#f4f0e8] shadow-2xl shrink-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: roleColor }} />
            <span className="font-bold">TABLET PIECE</span>
          </div>

          <div className="flex items-center space-x-2 bg-[#10121a]/95 backdrop-blur border border-[#3a4157] p-1.5 rounded-full shadow-2xl shrink-0">
            <button
              onClick={handleRotate}
              aria-label={`Rotate screen (${rotation} degrees)`}
              title={`Rotate Screen (${rotation}°)`}
              className="w-14 h-14 flex items-center justify-center rounded-full bg-[#161922] border border-[#3a4157] text-[#e5cb87] hover:bg-[#c4a45a] hover:text-[#08090c] transition-colors"
            >
              <RotateCw className="w-6 h-6" />
            </button>
            <button
              onClick={exitFullscreenCleanly}
              aria-label="Exit table alignment"
              title="Exit Table Alignment Mode"
              className="w-14 h-14 flex items-center justify-center rounded-full bg-red-950/80 border border-red-500/50 text-red-200 hover:bg-red-900 transition-colors"
            >
              <Minimize2 className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div
          style={{
            width: `${canvasWidth}px`,
            height: `${canvasHeight}px`,
            transform: `rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingLeft: 'max(16px, env(safe-area-inset-left))',
            paddingRight: 'max(16px, env(safe-area-inset-right))',
            boxSizing: 'border-box',
            justifyContent: 'center',
          }}
          className="bg-black select-none overflow-hidden transition-all duration-150"
        >
          {renderTabletSlice(true)}
        </div>
      </div>
    );
  }

  const completedAnswer = lastAnswer.current || (tablet ? `${tablet.line1} ${tablet.line2}` : '');

  return (
    <div className="space-y-4">
      {tablet && (
        <div className={`${CARD} space-y-4 relative overflow-hidden`}>
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className={LABEL}>The Shattered Tablet • Round 1</span>
              <span
                className="text-[11px] font-mono px-2 py-0.5 rounded-full font-bold"
                style={{ backgroundColor: `${roleColor}25`, color: roleColor, border: `1px solid ${roleColor}50` }}
              >
                Tablet Piece
              </span>
            </div>
            <h3 className="text-xl font-serif font-black text-[#f4f0e8]">Assemble the Chiseled Codeword</h3>
            <p className="text-sm text-[#cbd5e1] leading-relaxed">
              Re-arrange the tablet pieces to align the golden chisel runes and reveal the 2-word codeword.
            </p>
          </div>

          <div className="bg-[#08090c] border border-[#3a4157] rounded-xl p-3 overflow-hidden relative shadow-inner space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#2a2e3d] text-xs font-mono text-[#a9b4c7]">
              <span className="font-bold text-[#f4f0e8]">YOUR TABLET PIECE</span>
              <span>Align with your crew</span>
            </div>
            <div className="py-1">{renderTabletSlice(false)}</div>
            <div className="flex items-center justify-between pt-1 border-t border-[#2a2e3d] text-xs font-mono text-[#a9b4c7]">
              <span>Interlocking rune seams • 100% vector fit</span>
            </div>
          </div>

          <button
            data-testid="tablet-fullscreen"
            onClick={toggleFullscreen}
            className="w-full min-h-[56px] px-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#242b3b] to-[#161922] hover:border-[#c4a45a] border border-[#3a4157] text-[#f4f0e8] font-mono font-bold text-sm flex items-center justify-center space-x-2.5 transition-all shadow-md group"
          >
            <Maximize2 className="w-5 h-5 text-[#e5cb87] group-hover:scale-110 transition-transform" />
            <span className="tracking-wide">Launch Fullscreen For Table Alignment</span>
          </button>
        </div>
      )}

      <div className={`${CARD} space-y-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-[#e5cb87]" />
            <h4 className="text-base font-serif font-bold text-[#f4f0e8]">Submit Deciphered Codeword</h4>
          </div>
          <span className="text-[11px] font-mono text-[#e5cb87] font-semibold">Any crew member can submit</span>
        </div>

        {solved ? (
          <div data-testid="r1-solved" className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-900/60 text-emerald-300">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h5 className="text-xl font-serif font-black text-emerald-200">Round Complete!</h5>
            {completedAnswer && (
              <p className="text-sm text-emerald-300/90 font-mono">
                Codeword Accepted: <strong className="text-white tracking-widest">{completedAnswer}</strong>
              </p>
            )}
            <div className="inline-block mt-2 px-3 py-1.5 bg-emerald-900/60 border border-emerald-500/40 rounded-full text-sm font-mono font-bold text-emerald-300">
              +{r1.points} PTS Awarded to {team.name}
            </div>
          </div>
        ) : r1.closed || !active ? (
          <div data-testid="r1-closed" className="p-4 rounded-xl bg-red-950/30 border border-red-500/40 text-center space-y-1">
            <h5 className="text-lg font-serif font-black text-red-200">The gate stayed sealed</h5>
            <p className="text-sm text-red-300/90">Time ran out. Your crew scores 0 for Round 1.</p>
          </div>
        ) : (
          <form onSubmit={handleCodewordSubmit} className="space-y-3">
            <input
              data-testid="r1-answer"
              type="text"
              value={codewordInput}
              onChange={e => setCodewordInput(e.target.value.toUpperCase())}
              placeholder="ENTER 2-WORD CODEWORD..."
              maxLength={64}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Codeword"
              className="w-full min-h-[56px] bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] focus:ring-1 focus:ring-[#c4a45a] rounded-xl px-4 py-3 text-center text-lg font-mono font-black tracking-widest text-[#f4f0e8] placeholder-[#a9b4c7]/40 outline-none uppercase"
            />

            {submitResult && (
              <div
                className={`p-3 rounded-xl border text-sm flex items-center space-x-2 ${
                  submitResult.success
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                    : 'bg-red-950/60 border-red-500/60 text-red-200'
                }`}
              >
                {submitResult.success ? (
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
                )}
                <span>{submitResult.message}</span>
              </div>
            )}

            <button data-testid="r1-submit" type="submit" disabled={submitting || !codewordInput.trim()} className={BTN_GOLD}>
              {submitting ? 'Verifying Codeword...' : 'Submit Deciphered Word'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
