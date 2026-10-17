import React, { useState, useEffect, useRef } from 'react';
import { useGameSession } from '../../context/GameContext';
import { getPlayerAsciiSlice, MYTHIC_DECORATIVE_BORDERS } from '../../lib/asciiEngine';
import { Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut, CheckCircle2, AlertCircle, Sparkles, Move } from 'lucide-react';
import confetti from 'canvas-confetti';

type AlignmentAnchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const AsciiSplitterRound: React.FC = () => {
  const { player, team, role, currentRound, submitAnswer } = useGameSession();

  // Fullscreen & WakeLock states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wakeLockRef = useRef<any>(null);

  // Alignment controls
  const [anchor, setAnchor] = useState<AlignmentAnchor>('center');
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [fontSize, setFontSize] = useState<number>(14);
  const [showHud, setShowHud] = useState(true);
  const hudTimeoutRef = useRef<number | null>(null);

  // Codeword submission state
  const [codewordInput, setCodewordInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; points?: number } | null>(null);

  // Calculate player slice
  const teamMembers = team?.player_ids || [];
  const teamSize = Math.max(teamMembers.length, 1);
  const playerSlotIndex = player ? teamMembers.indexOf(player.id) : 0;
  const safeSlot = playerSlotIndex >= 0 ? playerSlotIndex : 0;

  // Active word assigned to team or fallback
  const assignedWord = team?.assignedCodeword || 'ORACLE';
  const asciiSlice = getPlayerAsciiSlice(assignedWord, safeSlot, teamSize, 'HORIZONTAL');

  const roundCompleted = currentRound && team?.round_submissions[currentRound.id]?.completed;
  const completedSubmission = currentRound ? team?.round_submissions[currentRound.id] : undefined;

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

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (e) {
        // ignore
      }
    }
  };

  // Toggle faux-fullscreen
  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      document.body.classList.add('faux-fullscreen-active');
      await requestWakeLock();
      resetHudTimeout();
    } else {
      setIsFullscreen(false);
      document.body.classList.remove('faux-fullscreen-active');
      await releaseWakeLock();
    }
  };

  // Auto-fading HUD controls (3 seconds inactivity)
  const resetHudTimeout = () => {
    setShowHud(true);
    if (hudTimeoutRef.current) {
      window.clearTimeout(hudTimeoutRef.current);
    }
    hudTimeoutRef.current = window.setTimeout(() => {
      setShowHud(false);
    }, 3500);
  };

  useEffect(() => {
    return () => {
      document.body.classList.remove('faux-fullscreen-active');
      releaseWakeLock();
      if (hudTimeoutRef.current) window.clearTimeout(hudTimeoutRef.current);
    };
  }, []);

  const handleRotate = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetHudTimeout();
    setRotation(prev => ((prev + 90) % 360) as any);
  };

  const handleZoom = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    resetHudTimeout();
    setFontSize(prev => Math.min(32, Math.max(9, prev + delta)));
  };

  const handleAnchorSelect = (e: React.MouseEvent, a: AlignmentAnchor) => {
    e.stopPropagation();
    resetHudTimeout();
    setAnchor(a);
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
          particleCount: 120,
          spread: 80,
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

  // Helper styles for alignment
  const getAnchorClasses = () => {
    switch (anchor) {
      case 'top':
        return 'items-start justify-center pt-0';
      case 'bottom':
        return 'items-end justify-center pb-0';
      case 'left':
        return 'items-center justify-start pl-0';
      case 'right':
        return 'items-center justify-end pr-0';
      case 'top-left':
        return 'items-start justify-start pt-0 pl-0';
      case 'top-right':
        return 'items-start justify-end pt-0 pr-0';
      case 'bottom-left':
        return 'items-end justify-start pb-0 pl-0';
      case 'bottom-right':
        return 'items-end justify-end pb-0 pr-0';
      case 'center':
      default:
        return 'items-center justify-center';
    }
  };

  // Render Faux-Fullscreen Mode
  if (isFullscreen) {
    return (
      <div
        onClick={resetHudTimeout}
        className="fixed inset-0 w-screen h-screen bg-black z-[99999] overflow-hidden select-none flex flex-col"
      >
        {/* Floating Auto-Fading HUD */}
        <div
          className={`absolute top-0 left-0 right-0 p-3 z-50 transition-opacity duration-300 flex items-center justify-between pointer-events-auto ${
            showHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Slot Badge */}
          <div className="bg-[#10121a]/90 backdrop-blur border border-[#c4a45a]/60 px-3 py-1.5 rounded-full flex items-center space-x-2 text-xs font-mono text-[#f4f0e8] shadow-lg">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: role?.color || '#c4a45a' }}
            />
            <span className="font-bold">SLOT #{safeSlot + 1} OF {teamSize}</span>
            <span className="text-[#8e95a5]">({role?.name})</span>
          </div>

          {/* Controls Bar */}
          <div className="flex items-center space-x-1.5 bg-[#10121a]/90 backdrop-blur border border-[#2a2e3d] p-1 rounded-full shadow-lg">
            {/* Font Zoom */}
            <button
              onClick={(e) => handleZoom(e, -1)}
              title="Decrease Font Size"
              className="p-1.5 rounded-full bg-[#161922] text-[#f4f0e8] hover:text-[#c4a45a] text-xs font-mono font-bold"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono text-[#8e95a5] px-1">{fontSize}px</span>
            <button
              onClick={(e) => handleZoom(e, 1)}
              title="Increase Font Size"
              className="p-1.5 rounded-full bg-[#161922] text-[#f4f0e8] hover:text-[#c4a45a] text-xs font-mono font-bold"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            {/* Rotate */}
            <button
              onClick={handleRotate}
              title={`Rotate Screen (${rotation}°)`}
              className="p-1.5 rounded-full bg-[#161922] text-[#f4f0e8] hover:text-[#c4a45a]"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            {/* Exit Fullscreen */}
            <button
              onClick={toggleFullscreen}
              title="Exit Alignment Mode"
              className="p-1.5 rounded-full bg-red-950/80 border border-red-500/50 text-red-200 hover:bg-red-900"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Floating Anchor Snapping Matrix (Bottom HUD) */}
        <div
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-50 transition-opacity duration-300 pointer-events-auto ${
            showHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="bg-[#10121a]/90 backdrop-blur border border-[#2a2e3d] px-3 py-2 rounded-2xl flex items-center space-x-2 text-[10px] font-mono shadow-xl">
            <span className="text-[#8e95a5] flex items-center space-x-1">
              <Move className="w-3 h-3 text-[#c4a45a]" />
              <span className="hidden xs:inline">Snap Edge:</span>
            </span>
            <div className="grid grid-cols-3 gap-1">
              {(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as AlignmentAnchor[]).map((a) => (
                <button
                  key={a}
                  onClick={(e) => handleAnchorSelect(e, a)}
                  className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold border transition-colors ${
                    anchor === a
                      ? 'bg-[#c4a45a] text-[#08090c] border-[#c4a45a]'
                      : 'bg-[#161922] text-[#8e95a5] border-[#2a2e3d] hover:text-[#f4f0e8]'
                  }`}
                >
                  {a.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Fullscreen Canvas with ASCII Totem Slice */}
        <div
          className={`flex-1 w-full h-full flex ${getAnchorClasses()} overflow-hidden bg-black transition-all`}
          style={{
            transform: `rotate(${rotation}deg)`,
          }}
        >
          <div
            className="ascii-totem text-center font-mono font-bold leading-none select-none tracking-tighter"
            style={{
              fontSize: `${fontSize}px`,
              color: role?.color || '#f4f0e8',
              textShadow: '0 0 10px rgba(196, 164, 90, 0.25)',
            }}
          >
            {/* If slot 0, show top mythic cap */}
            {safeSlot === 0 && (
              <div className="text-[#c4a45a] text-[10px] tracking-normal mb-1 opacity-70">
                {MYTHIC_DECORATIVE_BORDERS.topCap.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}

            {/* ASCII Fragment */}
            {asciiSlice.map((row, idx) => (
              <div key={idx} className="whitespace-pre">
                {row}
              </div>
            ))}

            {/* If last slot, show bottom mythic base */}
            {safeSlot === teamSize - 1 && (
              <div className="text-[#c4a45a] text-[10px] tracking-normal mt-1 opacity-70">
                {MYTHIC_DECORATIVE_BORDERS.bottomBase.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Normal Card View (With Codeword Submission & Fullscreen Launch)
  return (
    <div className="space-y-4">
      {/* Flagship Round Intro Banner */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                Multi-Phone Physical Totem
              </span>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold"
                style={{
                  backgroundColor: `${role?.color || '#c4a45a'}25`,
                  color: role?.color || '#c4a45a',
                  border: `1px solid ${role?.color || '#c4a45a'}50`,
                }}
              >
                Slot #{safeSlot + 1} of {teamSize}
              </span>
            </div>
            <h3 className="text-lg font-serif font-black text-[#f4f0e8]">
              Assemble the Severed Codeword
            </h3>
            <p className="text-xs text-[#8e95a5] leading-relaxed">
              Every letter of the secret word is sliced horizontally across all {teamSize} phones. Place your phones edge-to-edge on the pub table to read it!
            </p>
          </div>
        </div>

        {/* ASCII Slice Preview Box */}
        <div className="mt-4 bg-[#08090c] border border-[#2a2e3d] rounded-xl p-3 overflow-x-auto relative">
          <div className="flex items-center justify-between pb-2 border-b border-[#2a2e3d]/80 text-[10px] font-mono text-[#8e95a5]">
            <span>YOUR PHONE'S FRAGMENT</span>
            <span style={{ color: role?.color || '#c4a45a' }}>{role?.name}'s Sector</span>
          </div>

          <div
            className="ascii-totem text-center py-3 font-mono font-bold leading-none select-none tracking-tighter"
            style={{
              fontSize: '11px',
              color: role?.color || '#f4f0e8',
            }}
          >
            {asciiSlice.map((row, idx) => (
              <div key={idx} className="whitespace-pre">
                {row}
              </div>
            ))}
          </div>
        </div>

        {/* Enter Faux-Fullscreen Alignment Button */}
        <div className="mt-4">
          <button
            onClick={toggleFullscreen}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#202533] to-[#161922] hover:border-[#c4a45a] border border-[#2a2e3d] text-[#f4f0e8] font-mono font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md group"
          >
            <Maximize2 className="w-4 h-4 text-[#c4a45a] group-hover:scale-110 transition-transform" />
            <span>Launch Fullscreen Alignment Mode</span>
          </button>
          <p className="text-[10px] text-[#8e95a5]/70 text-center mt-1.5 font-mono">
            Hides address bar, requests screen wake-lock & provides edge-snapping controls
          </p>
        </div>
      </div>

      {/* Codeword Submission Card */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#c4a45a]" />
            <h4 className="text-sm font-serif font-bold text-[#f4f0e8]">
              Submit Deciphered Codeword
            </h4>
          </div>
          <span className="text-[10px] font-mono text-[#c4a45a]">
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
                placeholder="ENTER REVEALED CODEWORD..."
                maxLength={12}
                className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] focus:ring-1 focus:ring-[#c4a45a] rounded-xl px-4 py-3 text-center text-base font-mono font-black tracking-widest text-[#f4f0e8] placeholder-[#8e95a5]/40 outline-none uppercase"
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
