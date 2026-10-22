import React, { useState, useEffect, useRef } from 'react';
import { useGameSession } from '../../context/GameContext';
import {
  parseTabletCodeword,
  TABLET_CONFIG,
  getSlotPositionLabel,
  getTabletTextMetrics,
} from '../../lib/tabletEngine';
import {
  Maximize2,
  Minimize2,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import confetti from 'canvas-confetti';

export const AsciiSplitterRound: React.FC = () => {
  const { player, team, role, currentRound, submitAnswer, payload } = useGameSession();

  // Fullscreen & WakeLock states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Rotation state (Default to 0deg portrait for natural pub table placement)
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [showHud, setShowHud] = useState(true);
  const hudTimeoutRef = useRef<number | null>(null);

  // Screen orientation & dimensions tracking
  const [windowDimensions, setWindowDimensions] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 400,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        w: window.innerWidth,
        h: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Codeword submission state
  const [codewordInput, setCodewordInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; points?: number } | null>(null);

  // Calculate player slot index
  const teamMembers = team?.player_ids || [];
  const teamSize = Math.max(teamMembers.length, payload?.config?.team_size || 5);
  const playerSlotIndex = player ? teamMembers.indexOf(player.id) : 0;
  const activeSlot = playerSlotIndex >= 0 ? playerSlotIndex : 0;

  // Active word assigned to team or fallback
  const assignedWord = team?.assignedCodeword || 'CRIMSON SHADOW';
  const { line1, line2 } = parseTabletCodeword(assignedWord);

  // Role for current active slot
  const currentSlotRole = payload?.config?.roles?.[activeSlot] || role || {
    name: `Slot ${activeSlot + 1}`,
    color: '#c4a45a',
  };

  // Screen Wake Lock API for pub table placement
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
        wakeLockRef.current = null;
      } catch (err) {
        console.warn('Wake lock release error:', err);
      }
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      setShowHud(true);
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
      } catch (e) {
        // ignore
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
    } catch (err) {
      // ignore
    }
  };

  // Back button handling in fullscreen
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

  useEffect(() => {
    return () => {
      releaseWakeLock();
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, []);

  const resetHudTimeout = () => {
    setShowHud(true);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = window.setTimeout(() => {
      setShowHud(false);
    }, 4000);
  };

  const handleRotate = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetHudTimeout();
    setRotation(prev => {
      if (prev === 0) return 90;
      if (prev === 90) return 180;
      if (prev === 180) return 270;
      return 0;
    });
  };

  const handleCodewordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codewordInput.trim()) return;

    try {
      setSubmitting(true);
      setSubmitResult(null);
      const res = await submitAnswer(codewordInput.trim());
      setSubmitResult(res);

      if (res.success && res.isCorrect) {
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.6 },
          colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#c084fc', '#34d399'],
        });
      }
    } catch (err: any) {
      setSubmitResult({ success: false, message: err.message || 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  // Dimensions & Geometry
  const isPortrait = windowDimensions.h > windowDimensions.w;
  const isSideways = rotation === 90 || rotation === 270;
  const canvasWidth = isSideways && isPortrait ? windowDimensions.h : windowDimensions.w;
  const canvasHeight = isSideways && isPortrait ? windowDimensions.w : windowDimensions.h;

  // Tablet Math
  const { totalWidth, totalHeight, line1Y, horizonY, line2Y } = TABLET_CONFIG;
  const slotWidth = totalWidth / Math.max(1, teamSize);
  const viewBoxX = activeSlot * slotWidth;
  const line1Metrics = getTabletTextMetrics(line1);
  const line2Metrics = getTabletTextMetrics(line2);

  // Interlocking Notch Seam Positions (between all slots)
  const seamPositions: number[] = [];
  for (let i = 1; i < teamSize; i++) {
    seamPositions.push(i * slotWidth);
  }

  // Render the SVG Vector Ancient Shattered Tablet
  const renderTabletSlice = (isFullscreenMode: boolean) => {
    return (
      <div
        className="flex items-center justify-center select-none relative overflow-hidden mx-auto rounded-lg shadow-xl"
        style={{
          width: isFullscreenMode ? '100%' : '140px',
          height: isFullscreenMode ? '100%' : '240px',
        }}
      >
        <svg
          viewBox={`${viewBoxX} 0 ${slotWidth} ${totalHeight}`}
          preserveAspectRatio={isFullscreenMode ? 'none' : 'xMidYMid meet'}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        >
          <defs>
            {/* Gold Leaf Gradient */}
            <linearGradient id="goldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8e7" />
              <stop offset="35%" stopColor="#e5cb87" />
              <stop offset="70%" stopColor="#c4a45a" />
              <stop offset="100%" stopColor="#8c6d28" />
            </linearGradient>

            {/* Glowing Rune Horizon Filter */}
            <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Ambient Role Color Glow */}
            <radialGradient id="roleAmbientGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={currentSlotRole?.color || '#c4a45a'} stopOpacity="0.25" />
              <stop offset="100%" stopColor="#08090c" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* 1. Dark Chiseled Granite Slab Background */}
          <rect x="0" y="0" width={totalWidth} height={totalHeight} fill="#08090c" />
          <rect x="0" y="0" width={totalWidth} height={totalHeight} fill="url(#roleAmbientGlow)" />

          {/* 2. Outer Tablet Chisel Frame */}
          <rect
            x="6"
            y="6"
            width={totalWidth - 12}
            height={totalHeight - 12}
            rx="10"
            fill="#0f1118"
            stroke="#2a2e3d"
            strokeWidth="3"
          />

          {/* 3. Orientation Anchor: TOP CREST MARKER */}
          <rect x="16" y="16" width={totalWidth - 32} height="52" fill="#161924" rx="6" />
          <line x1="20" y1="72" x2={totalWidth - 20} y2="72" stroke="#c4a45a" strokeWidth="2" opacity="0.6" />
          <text
            x={totalWidth / 2}
            y="48"
            textAnchor="middle"
            fontFamily="monospace"
            fontSize="18"
            fontWeight="bold"
            fill="#c4a45a"
            letterSpacing="8"
          >
            ▲ TABLET CREST (TOP) ▲
          </text>

          {/* 4. LINE 1: WORD 1 (CHISELED GOLD RUNE) */}
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

          {/* 5. CENTRAL GLOWING HORIZON / FRACTURE SEAM */}
          {/* Ambient Glow Horizon */}
          <line
            x1="0"
            y1={horizonY}
            x2={totalWidth}
            y2={horizonY}
            stroke="#c4a45a"
            strokeWidth="6"
            opacity="0.5"
            filter="url(#goldGlow)"
          />
          {/* Core Horizon Line */}
          <line
            x1="0"
            y1={horizonY}
            x2={totalWidth}
            y2={horizonY}
            stroke="#ffffff"
            strokeWidth="2"
            opacity="0.9"
          />

          {/* 6. INTERLOCKING SEAM NOTCHES (GLOWING DIAMONDS AT SCREEN BORDERS) */}
          {seamPositions.map((seamX, idx) => (
            <g key={idx}>
              {/* Outer Glow Diamond */}
              <polygon
                points={`${seamX},${horizonY - 26} ${seamX + 18},${horizonY} ${seamX},${horizonY + 26} ${seamX - 18},${horizonY}`}
                fill="#c4a45a"
                opacity="0.9"
                filter="url(#goldGlow)"
              />
              {/* Inner Core Notch */}
              <polygon
                points={`${seamX},${horizonY - 14} ${seamX + 10},${horizonY} ${seamX},${horizonY + 14} ${seamX - 10},${horizonY}`}
                fill="#ffffff"
              />
              {/* Vertical Guide Tic */}
              <line
                x1={seamX}
                y1={horizonY - 38}
                x2={seamX}
                y2={horizonY + 38}
                stroke="#c4a45a"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
            </g>
          ))}

          {/* 7. LINE 2: WORD 2 (CHISELED GOLD RUNE) */}
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

          {/* 8. Orientation Anchor: BOTTOM BASE MARKER */}
          <line x1="20" y1="528" x2={totalWidth - 20} y2="528" stroke="#c4a45a" strokeWidth="2" opacity="0.6" />
          <rect x="16" y="532" width={totalWidth - 32} height="52" fill="#161924" rx="6" />
          <text
            x={totalWidth / 2}
            y="564"
            textAnchor="middle"
            fontFamily="monospace"
            fontSize="18"
            fontWeight="bold"
            fill="#c4a45a"
            letterSpacing="8"
          >
            ▼ TABLET BASE (BOTTOM) ▼
          </text>
        </svg>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // RENDER: FULLSCREEN / TABLE ALIGNMENT MODE
  // --------------------------------------------------------------------------
  if (isFullscreen) {
    return (
      <div
        ref={containerRef}
        onClick={resetHudTimeout}
        className="fixed inset-0 w-screen h-screen bg-black z-[99999] overflow-hidden select-none flex items-center justify-center"
      >
        {/* Floating Auto-Fading HUD */}
        <div
          className={`absolute top-0 left-0 right-0 p-2 sm:p-3 z-50 transition-opacity duration-300 flex flex-wrap items-center justify-between gap-2 pointer-events-auto ${
            showHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Slot Badge */}
          <div className="bg-[#10121a]/95 backdrop-blur border border-[#c4a45a]/60 px-3 py-1.5 rounded-full flex items-center space-x-2 text-xs font-mono text-[#f4f0e8] shadow-2xl shrink-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: currentSlotRole?.color || '#c4a45a' }}
            />
            <span className="font-bold">SLOT #{activeSlot + 1} OF {teamSize}</span>
            <span className="text-[#8e95a5]">({getSlotPositionLabel(activeSlot, teamSize)})</span>
          </div>

          {/* Controls Bar - Minimal, focused on table placement */}
          <div className="flex items-center space-x-2 bg-[#10121a]/95 backdrop-blur border border-[#3a4157] p-1.5 rounded-full shadow-2xl shrink-0">
            {/* Rotate */}
            <button
              onClick={handleRotate}
              title={`Rotate Screen (${rotation}°)`}
              className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-[#161922] border border-[#3a4157] text-[#e5cb87] hover:bg-[#c4a45a] hover:text-[#08090c] transition-colors"
            >
              <RotateCw className="w-5 h-5" />
            </button>

            {/* Exit Fullscreen */}
            <button
              onClick={exitFullscreenCleanly}
              title="Exit Table Alignment Mode"
              className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-red-950/80 border border-red-500/50 text-red-200 hover:bg-red-900 transition-colors"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Canvas */}
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

  // --------------------------------------------------------------------------
  // RENDER: NORMAL CARD VIEW
  // --------------------------------------------------------------------------
  const roundCompleted = !!team?.round_submissions?.[currentRound?.id || 'round-1']?.completed;
  const completedSubmission = team?.round_submissions?.[currentRound?.id || 'round-1'];

  return (
    <div className="space-y-4">
      {/* Ancient Tablet Intro Banner */}
      <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl relative overflow-hidden space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold">
                The Shattered Tablet • Round 1
              </span>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold"
                style={{
                  backgroundColor: `${currentSlotRole?.color || '#c4a45a'}25`,
                  color: currentSlotRole?.color || '#c4a45a',
                  border: `1px solid ${currentSlotRole?.color || '#c4a45a'}50`,
                }}
              >
                Slot #{activeSlot + 1} of {teamSize}
              </span>
            </div>
            <h3 className="text-lg font-serif font-black text-[#f4f0e8]">
              Assemble the Chiseled Codeword
            </h3>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              Place your phones side-by-side on your pub table in order (Slot 1 to {teamSize}) to align the golden chisel runes and reveal the 2-word codeword.
            </p>
          </div>
        </div>

        {/* Vector Slice Preview Box */}
        <div className="bg-[#08090c] border border-[#3a4157] rounded-xl p-3 overflow-hidden relative shadow-inner space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-[#2a2e3d] text-[10px] font-mono text-[#a9b4c7]">
            <span className="font-bold text-[#f4f0e8]">YOUR TABLET PIECE</span>
            <span style={{ color: currentSlotRole?.color || '#c4a45a' }} className="font-bold">
              Position: {getSlotPositionLabel(activeSlot, teamSize)}
            </span>
          </div>

          {/* Crisp Vector Slice */}
          <div className="py-1">
            {renderTabletSlice(false)}
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-[#2a2e3d] text-[10px] font-mono text-[#a9b4c7]">
            <span>Left-to-Right tablet slice • Interlocking rune seams • 100% vector fit</span>
          </div>
        </div>

        {/* Enter Fullscreen Table Alignment Button */}
        <div>
          <button
            onClick={toggleFullscreen}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#242b3b] to-[#161922] hover:border-[#c4a45a] border border-[#3a4157] text-[#f4f0e8] font-mono font-bold text-xs flex items-center justify-center space-x-2.5 transition-all shadow-md group"
          >
            <Maximize2 className="w-4 h-4 text-[#e5cb87] group-hover:scale-110 transition-transform" />
            <span className="tracking-wide">Launch Fullscreen For Table Alignment</span>
          </button>
        </div>
      </div>

      {/* CODEWORD SUBMISSION CARD */}
      <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#e5cb87]" />
            <h4 className="text-sm font-serif font-bold text-[#f4f0e8]">
              Submit Deciphered Codeword
            </h4>
          </div>
          <span className="text-[10px] font-mono text-[#e5cb87] font-semibold">
            Any crew member can submit
          </span>
        </div>

        {roundCompleted ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-center space-y-2">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-900/60 text-emerald-300">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h5 className="text-base font-serif font-black text-emerald-200">
              Round Complete!
            </h5>
            <p className="text-xs text-emerald-300/90 font-mono">
              Codeword Accepted: <strong className="text-white tracking-widest">{completedSubmission?.answerSubmitted}</strong>
            </p>
            <div className="inline-block mt-2 px-3 py-1 bg-emerald-900/60 border border-emerald-500/40 rounded-full text-xs font-mono font-bold text-emerald-300">
              +{completedSubmission?.pointsAwarded || 150} PTS Awarded to {team?.name}
            </div>
          </div>
        ) : (
          <form onSubmit={handleCodewordSubmit} className="space-y-3">
            <div>
              <input
                type="text"
                value={codewordInput}
                onChange={(e) => setCodewordInput(e.target.value.toUpperCase())}
                placeholder="ENTER 2-WORD CODEWORD (E.G. CRIMSON SHADOW)..."
                maxLength={30}
                className="w-full bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] focus:ring-1 focus:ring-[#c4a45a] rounded-xl px-4 py-3 text-center text-sm sm:text-base font-mono font-black tracking-widest text-[#f4f0e8] placeholder-[#a9b4c7]/40 outline-none uppercase"
              />
            </div>

            {submitResult && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                  submitResult.success
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                    : 'bg-red-950/60 border-red-500/60 text-red-200'
                }`}
              >
                {submitResult.success ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
                )}
                <span>{submitResult.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !codewordInput.trim()}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-black text-sm tracking-wider shadow-gold-glow transition-all disabled:opacity-50"
            >
              {submitting ? 'Verifying Codeword...' : 'Submit Deciphered Word'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
