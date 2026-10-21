import React, { useState, useEffect } from 'react';
import { useGameSession } from '../context/GameContext';
import {
  calculateRound1Score,
} from '../lib/round1Engine';
import type { PlayerSlotInfo } from '../lib/round1Engine';
import {
  parseTabletCodeword,
  TABLET_CONFIG,
  getSlotPositionLabel,
  DEFAULT_ROUND1_CODEWORDS,
  getTabletTextMetrics,
} from '../lib/tabletEngine';
import {
  adminSetState,
  adminAdjustTimer,
  adminSpawnDemoCrew,
  adminRound2AdjustTimer,
  adminRound2AutoPair,
  round2CastVoteApi,
} from '../lib/api';
import {
  Smartphone,
  Layers,
  ZoomIn,
  ZoomOut,
  Play,
  Swords,
  Sparkles,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Crown,
  Handshake,
} from 'lucide-react';
import confetti from 'canvas-confetti';


export const SoloTesterWorkbench: React.FC = () => {
  const {
    payload,
    team,
    currentRound,
    round2Match,
    submitAnswer,
    switchPlayer,
    refresh,
  } = useGameSession();

  // Mode: 'table' (side-by-side pub table) | 'rack' (5 device frames) | 'round2' (Prisoner's Dilemma tester)
  const [viewMode, setViewMode] = useState<'table' | 'rack' | 'round2'>('table');

  // Word selection for testing (2-word phrases)
  const codewordsPool = (payload?.config?.rounds?.[0]?.data as any)?.codewords || DEFAULT_ROUND1_CODEWORDS;
  const [selectedWord, setSelectedWord] = useState<string>('CRIMSON SHADOW');

  // Global & Per-Slot adjustments
  const [globalZoom, setGlobalZoom] = useState<number>(1.0);
  const [slotZooms, setSlotZooms] = useState<Record<number, number>>({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 });

  // Codeword submission test
  const [testInput, setTestInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; points?: number } | null>(null);

  // Spawning demo crew
  const [isSpawning, setIsSpawning] = useState(false);

  // Sync selectedWord with team's assigned codeword if available
  useEffect(() => {
    if (team?.assignedCodeword) {
      setSelectedWord(team.assignedCodeword);
    }
  }, [team?.assignedCodeword]);

  const teamSize = payload?.config?.team_size || 5;
  const adminPass = localStorage.getItem('underworld_admin_pass') || 'underworld';

  // Live timer tick for calculating hints availability and points decay
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTimerTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const roundStartedAt = payload?.round_started_at
    ? Number(payload.round_started_at)
    : (payload?.round_ends_at ? Math.max(0, Number(payload.round_ends_at) - (currentRound?.durationSeconds || 300) * 1000) : Date.now() - 60000);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - roundStartedAt) / 1000));
  const scoreBreakdown = calculateRound1Score(elapsedSeconds);

  const [spawnNotice, setSpawnNotice] = useState<string | null>(null);

  // Build slot info (falls back to newest registered team if tester is not logged in)
  const effectiveTeam = team;
  const leaderTeam = payload?.teams_leaderboard?.[0];
  const slotMembers: PlayerSlotInfo[] = Array.from({ length: teamSize }).map((_, idx) => {
    const memberObj = effectiveTeam?.player_ids?.[idx]
      ? payload?.teams_leaderboard?.flatMap(t => t.members).find(m => m.id === effectiveTeam.player_ids[idx])
      : leaderTeam?.members?.[idx];
    const roleCfg = payload?.config?.roles?.[idx];
    return {
      slotIndex: idx,
      playerName: memberObj?.name || `Test Player #${idx + 1}`,
      roleName: memberObj?.roleName || roleCfg?.name || `Role #${idx + 1}`,
      roleColor: memberObj?.roleColor || roleCfg?.color || '#c4a45a',
    };
  });

  // Spawn test crew
  const handleSpawnDemoCrew = async () => {
    try {
      setIsSpawning(true);
      const res = await adminSpawnDemoCrew(adminPass);
      if (res?.success && res.players?.[0]?.id) {
        localStorage.setItem('underworld_player_id', res.players[0].id);
        if (res.team?.assignedCodeword) {
          setSelectedWord(res.team.assignedCodeword);
        }
        setSpawnNotice(`✓ Spawned "${res.team?.name || 'Demo Crew'}" with 5 shades!`);
      } else if (res?.error) {
        setSpawnNotice(`⚠️ ${res.error}`);
      } else {
        setSpawnNotice(`✓ 5-shade demo crew summoned!`);
      }
      setTimeout(() => setSpawnNotice(null), 4000);
      await refresh();
    } catch (e: any) {
      setSpawnNotice(`⚠️ Spawn failed: ${e?.message || e}`);
      setTimeout(() => setSpawnNotice(null), 4000);
    } finally {
      setIsSpawning(false);
    }
  };

  // State switcher
  const handleLaunchState = async (state: any, roundIndex?: number) => {
    await adminSetState(adminPass, state, roundIndex);
    await refresh();
  };

  // Time adjust
  const handleAdjustTimer = async (deltaSeconds: number) => {
    await Promise.all([
      adminAdjustTimer(adminPass, 'adjust', deltaSeconds),
      adminRound2AdjustTimer(adminPass, deltaSeconds),
    ]);
    await refresh();
  };

  // Codeword submit
  const handleCodewordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const wordToSubmit = testInput.trim() || selectedWord;
    try {
      setSubmitting(true);
      setTestResult(null);
      const res = await submitAnswer(wordToSubmit);
      setTestResult(res);
      if (res.success && res.isCorrect) {
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.5 },
          colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#c084fc', '#34d399'],
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  // Round 2 Quick Scenario Testing
  const handleR2CastPresetVotes = async (alphaVote: 'TRUCE' | 'AMBUSH', betaVote: 'TRUCE' | 'AMBUSH') => {
    if (!round2Match) {
      await adminRound2AutoPair(adminPass);
      await refresh();
    }
    const currentM = payload?.round2_all_matches?.[0] || round2Match;
    if (!currentM) return;

    const teamA = payload?.teams_leaderboard?.find(t => t.id === currentM.team_a_id);
    const teamB = payload?.teams_leaderboard?.find(t => t.id === currentM.team_b_id);

    if (teamA) {
      for (const m of teamA.members) {
        if (m.id) await round2CastVoteApi(currentM.id, m.id, teamA.id, alphaVote);
      }
    }
    if (teamB) {
      for (const m of teamB.members) {
        if (m.id) await round2CastVoteApi(currentM.id, m.id, teamB.id, betaVote);
      }
    }
    await refresh();
  };

  // Render SVG Vector Ancient Shattered Tablet Slice for a specific slot
  const renderSlotTabletSlice = (slotIdx: number, widthPx: number, heightPx: number) => {
    const { line1, line2 } = parseTabletCodeword(selectedWord);
    const { totalWidth, totalHeight, line1Y, horizonY, line2Y } = TABLET_CONFIG;
    const slotWidth = totalWidth / Math.max(1, teamSize);
    const viewBoxX = slotIdx * slotWidth;
    const roleCfg = payload?.config?.roles?.[slotIdx] || { color: '#c4a45a' };
    const zoom = (slotZooms[slotIdx] || 1.0) * globalZoom;
    const line1Metrics = getTabletTextMetrics(line1);
    const line2Metrics = getTabletTextMetrics(line2);

    const seamPositions: number[] = [];
    for (let i = 1; i < teamSize; i++) {
      seamPositions.push(i * slotWidth);
    }

    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center overflow-hidden select-none transition-all duration-150 relative bg-[#08090c]"
        style={{ height: `${heightPx}px` }}
      >
        <svg
          viewBox={`${viewBoxX} 0 ${slotWidth} ${totalHeight}`}
          preserveAspectRatio="none"
          style={{
            width: `${Math.round(widthPx * zoom)}px`,
            maxWidth: '100%',
            height: `${heightPx}px`,
            display: 'block',
          }}
        >
          <defs>
            <linearGradient id={`goldGrad-${slotIdx}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8e7" />
              <stop offset="35%" stopColor="#e5cb87" />
              <stop offset="70%" stopColor="#c4a45a" />
              <stop offset="100%" stopColor="#8c6d28" />
            </linearGradient>
            <filter id={`glow-${slotIdx}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <radialGradient id={`ambient-${slotIdx}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={roleCfg.color || '#c4a45a'} stopOpacity="0.25" />
              <stop offset="100%" stopColor="#08090c" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Slab background */}
          <rect x="0" y="0" width={totalWidth} height={totalHeight} fill="#08090c" />
          <rect x="0" y="0" width={totalWidth} height={totalHeight} fill={`url(#ambient-${slotIdx})`} />
          <rect x="6" y="6" width={totalWidth - 12} height={totalHeight - 12} rx="10" fill="#0f1118" stroke="#2a2e3d" strokeWidth="3" />

          {/* Top Crest */}
          <rect x="16" y="16" width={totalWidth - 32} height="52" fill="#161924" rx="6" />
          <line x1="20" y1="72" x2={totalWidth - 20} y2="72" stroke="#c4a45a" strokeWidth="2" opacity="0.6" />
          <text x={totalWidth / 2} y="48" textAnchor="middle" fontFamily="monospace" fontSize="18" fontWeight="bold" fill="#c4a45a" letterSpacing="8">
            ▲ TABLET CREST (TOP) ▲
          </text>

          {/* Line 1 (Word 1) */}
          <text
            x={totalWidth / 2}
            y={line1Y}
            textAnchor="middle"
            textLength={line1Metrics.textLength}
            lengthAdjust="spacing"
            fontFamily="Cinzel, Georgia, serif"
            fontWeight="900"
            fontSize={line1Metrics.fontSize}
            fill={`url(#goldGrad-${slotIdx})`}
            stroke="#08090c"
            strokeWidth="4"
            filter={`url(#glow-${slotIdx})`}
          >
            {line1}
          </text>

          {/* Horizon Line */}
          <line x1="0" y1={horizonY} x2={totalWidth} y2={horizonY} stroke="#c4a45a" strokeWidth="6" opacity="0.5" filter={`url(#glow-${slotIdx})`} />
          <line x1="0" y1={horizonY} x2={totalWidth} y2={horizonY} stroke="#ffffff" strokeWidth="2" opacity="0.9" />

          {/* Interlocking Seam Notches */}
          {seamPositions.map((seamX, idx) => (
            <g key={idx}>
              <polygon
                points={`${seamX},${horizonY - 26} ${seamX + 18},${horizonY} ${seamX},${horizonY + 26} ${seamX - 18},${horizonY}`}
                fill="#c4a45a"
                opacity="0.9"
                filter={`url(#glow-${slotIdx})`}
              />
              <polygon points={`${seamX},${horizonY - 14} ${seamX + 10},${horizonY} ${seamX},${horizonY + 14} ${seamX - 10},${horizonY}`} fill="#ffffff" />
              <line x1={seamX} y1={horizonY - 38} x2={seamX} y2={horizonY + 38} stroke="#c4a45a" strokeWidth="1.5" strokeDasharray="4 3" />
            </g>
          ))}

          {/* Line 2 (Word 2) */}
          <text
            x={totalWidth / 2}
            y={line2Y}
            textAnchor="middle"
            textLength={line2Metrics.textLength}
            lengthAdjust="spacing"
            fontFamily="Cinzel, Georgia, serif"
            fontWeight="900"
            fontSize={line2Metrics.fontSize}
            fill={`url(#goldGrad-${slotIdx})`}
            stroke="#08090c"
            strokeWidth="4"
            filter={`url(#glow-${slotIdx})`}
          >
            {line2}
          </text>

          {/* Bottom Base */}
          <line x1="20" y1="528" x2={totalWidth - 20} y2="528" stroke="#c4a45a" strokeWidth="2" opacity="0.6" />
          <rect x="16" y="532" width={totalWidth - 32} height="52" fill="#161924" rx="6" />
          <text x={totalWidth / 2} y="564" textAnchor="middle" fontFamily="monospace" fontSize="18" fontWeight="bold" fill="#c4a45a" letterSpacing="8">
            ▼ TABLET BASE (BOTTOM) ▼
          </text>
        </svg>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh p-4 sm:p-6 space-y-6">
      {/* Top Header & Navigation */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-2xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center text-[#c4a45a]">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-serif font-black text-[#f4f0e8] uppercase">
                Solo Tester Simulation Workbench
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#c4a45a]/20 text-[#c4a45a] font-bold">
                Dev Tool
              </span>
            </div>
            <p className="text-[11px] text-[#8e95a5]">
              Simulate 5 phone screens placed side-by-side on a pub table to reconstruct the ancient shattered tablet.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => { window.location.href = '/'; }}
            className="px-3 py-1.5 rounded-lg bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c] text-xs font-mono font-bold"
          >
            Player Screen
          </button>
        </div>
      </div>

      {/* Quick Testing Command Center */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-2.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
            Live Quick Action Controls
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono text-[#8e95a5]">
              State: <strong className="text-[#f4f0e8]">{payload?.state}</strong>
            </span>
            <button
              onClick={() => refresh()}
              className="p-1 rounded bg-[#161922] border border-[#2a2e3d] text-[#8e95a5] hover:text-[#f4f0e8]"
              title="Refresh State"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {spawnNotice && (
          <div className="p-2.5 rounded-xl bg-amber-950/60 border border-[#c4a45a]/50 text-[#f4f0e8] text-xs font-mono flex items-center justify-between animate-fade-in">
            <span>{spawnNotice}</span>
            <button onClick={() => setSpawnNotice(null)} className="text-[#8e95a5] hover:text-[#f4f0e8] text-xs">✕</button>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {/* Spawn Crew */}
          <button
            onClick={handleSpawnDemoCrew}
            disabled={isSpawning}
            className="py-2 px-3 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-bold text-xs shadow-gold-glow flex items-center justify-center space-x-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isSpawning ? 'Spawning...' : '⚡ Spawn 5 Crew'}</span>
          </button>

          {/* Start Round 1 */}
          <button
            onClick={() => handleLaunchState('ROUND_ACTIVE', 0)}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-[#c4a45a]/60 hover:bg-[#c4a45a] hover:text-[#08090c] text-[#c4a45a] font-mono font-bold text-xs flex items-center justify-center space-x-1.5 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Start Round 1</span>
          </button>

          {/* Add 1 Minute */}
          <button
            onClick={() => handleAdjustTimer(60)}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-[#8e95a5] hover:text-[#f4f0e8] font-mono text-xs flex items-center justify-center space-x-1"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>+60s</span>
          </button>

          {/* Subtract 30s */}
          <button
            onClick={() => handleAdjustTimer(-30)}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-red-500/50 text-[#8e95a5] hover:text-red-300 font-mono text-xs flex items-center justify-center space-x-1"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>-30s</span>
          </button>

          {/* Reset to Lobby */}
          <button
            onClick={() => handleLaunchState('LOBBY_TEAM_FORMATION')}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-[#8e95a5] hover:text-[#f4f0e8] font-mono text-xs flex items-center justify-center space-x-1"
          >
            <span>Reset to Lobby</span>
          </button>
        </div>

        {/* Codeword Switcher Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[10px] font-mono uppercase text-[#8e95a5] mr-1">Test 2-Word Codeword:</span>
          {codewordsPool.map((word: string) => (
            <button
              key={word}
              onClick={() => setSelectedWord(word)}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                selectedWord === word
                  ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
                  : 'bg-[#161922] border border-[#2a2e3d] text-[#8e95a5] hover:text-[#f4f0e8]'
              }`}
            >
              {word}
            </button>
          ))}
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="grid grid-cols-3 gap-2 bg-[#10121a] border border-[#2a2e3d] p-1.5 rounded-2xl max-w-xl mx-auto">
        <button
          onClick={() => setViewMode('table')}
          className={`py-2 px-3 rounded-xl text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all ${
            viewMode === 'table'
              ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Side-by-Side Table View</span>
        </button>

        <button
          onClick={() => setViewMode('rack')}
          className={`py-2 px-3 rounded-xl text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all ${
            viewMode === 'rack'
              ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          <span>5-Phone Device Rack</span>
        </button>

        <button
          onClick={() => setViewMode('round2')}
          className={`py-2 px-3 rounded-xl text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all ${
            viewMode === 'round2'
              ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Swords className="w-4 h-4" />
          <span>Round 2 Dilemma Arena</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* MODE 1: PUB TABLE SIDE-BY-SIDE MODE (5 PHONES ACROSS THE TABLE)        */}
      {/* ===================================================================== */}
      {viewMode === 'table' && (
        <div className="space-y-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase block">
                Pub Table View: Shattered Tablet Reconstructed ("{selectedWord}")
              </span>
              <p className="text-[10px] text-[#8e95a5]">
                Simulates 5 phones placed side-by-side across a pub table (Left to Right). The central horizon line and seam notches connect seamlessly!
              </p>
            </div>

            {/* Global Zoom controls */}
            <div className="flex items-center space-x-1.5 bg-[#161922] border border-[#2a2e3d] px-2 py-1 rounded-xl">
              <span className="text-[10px] font-mono text-[#8e95a5]">Table Zoom:</span>
              <button
                onClick={() => setGlobalZoom(z => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
                className="p-1 text-[#8e95a5] hover:text-[#f4f0e8]"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setGlobalZoom(1.0)}
                className="text-[11px] font-mono font-bold text-[#c4a45a] px-1 hover:underline"
              >
                {Math.round(globalZoom * 100)}%
              </button>
              <button
                onClick={() => setGlobalZoom(z => Math.min(2.0, Math.round((z + 0.1) * 10) / 10))}
                className="p-1 text-[#8e95a5] hover:text-[#f4f0e8]"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 5 Side-by-Side Mobile Devices on the Pub Table */}
          <div className="max-w-5xl mx-auto p-4 bg-[#050608] border-2 border-dashed border-[#2a2e3d] rounded-3xl shadow-2xl">
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
              {Array.from({ length: teamSize }).map((_, slotIdx) => {
                const roleCfg = payload?.config?.roles?.[slotIdx] || { name: `Role #${slotIdx + 1}`, color: '#c4a45a' };
                const memberInfo = slotMembers[slotIdx];

                return (
                  <div
                    key={slotIdx}
                    className="bg-black border-2 rounded-2xl overflow-hidden shadow-xl transition-all relative flex flex-col justify-between"
                    style={{ borderColor: `${roleCfg.color}80` }}
                  >
                    {/* Phone Header / Bezel Label */}
                    <div className="px-2 py-1.5 bg-[#10121a]/95 border-b border-[#2a2e3d]/80 flex flex-col text-[10px] font-mono text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: roleCfg.color }} />
                        <span className="font-bold text-[#f4f0e8] text-[11px]">#{slotIdx + 1}</span>
                      </div>
                      <span className="text-[9px] text-[#8e95a5] truncate">
                        {getSlotPositionLabel(slotIdx, teamSize)}
                      </span>
                      <span className="text-[9px] font-bold truncate" style={{ color: roleCfg.color }}>
                        {memberInfo.playerName}
                      </span>

                      {team?.player_ids?.[slotIdx] && (
                        <button
                          onClick={() => switchPlayer(team.player_ids[slotIdx])}
                          className="mt-1 px-1.5 py-0.5 rounded bg-[#c4a45a]/20 text-[#c4a45a] hover:bg-[#c4a45a] hover:text-[#08090c] text-[8px] font-bold"
                        >
                          Play as
                        </button>
                      )}
                    </div>

                    {/* Screen Content: Vector SVG Tablet Slice */}
                    <div className="p-1 bg-black flex items-center justify-center h-48 sm:h-64">
                      {renderSlotTabletSlice(slotIdx, 180, 240)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 2: 5-PHONE DEVICE RACK VIEW                                     */}
      {/* ===================================================================== */}
      {viewMode === 'rack' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase block">
                5-Phone Multi-Device Rack View
              </span>
              <p className="text-[10px] text-[#8e95a5]">
                Inspect each simulated phone fragment independently with custom per-phone zoom.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: teamSize }).map((_, slotIdx) => {
              const roleCfg = payload?.config?.roles?.[slotIdx] || { name: `Role #${slotIdx + 1}`, color: '#c4a45a' };
              const memberInfo = slotMembers[slotIdx];

              return (
                <div
                  key={slotIdx}
                  className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-3 shadow-xl space-y-2.5 flex flex-col justify-between"
                  style={{ borderTop: `3px solid ${roleCfg.color}` }}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold" style={{ color: roleCfg.color }}>
                        SLOT #{slotIdx + 1}
                      </span>
                      <span className="text-[9px] font-mono text-[#8e95a5]">
                        {getSlotPositionLabel(slotIdx, teamSize)}
                      </span>
                    </div>
                    <div className="text-xs font-serif font-bold text-[#f4f0e8] truncate">
                      {memberInfo.playerName}
                    </div>
                    <span className="text-[10px] text-[#8e95a5] block truncate">
                      {roleCfg.name}
                    </span>
                  </div>

                  {/* Simulated Phone Screen */}
                  <div className="w-full bg-black border border-[#2a2e3d] rounded-xl p-2 h-52 flex items-center justify-center overflow-hidden relative">
                    {renderSlotTabletSlice(slotIdx, 160, 200)}
                  </div>

                  {/* Individual Controls */}
                  <div className="space-y-2 pt-2 border-t border-[#2a2e3d]">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-[#8e95a5]">Zoom:</span>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => setSlotZooms(prev => ({ ...prev, [slotIdx]: Math.max(0.6, (prev[slotIdx] || 1) - 0.1) }))}
                          className="px-1.5 py-0.5 rounded bg-[#161922] text-[#8e95a5] hover:text-[#f4f0e8]"
                        >
                          -
                        </button>
                        <span className="text-[#c4a45a] font-bold px-1">{Math.round((slotZooms[slotIdx] || 1) * 100)}%</span>
                        <button
                          onClick={() => setSlotZooms(prev => ({ ...prev, [slotIdx]: Math.min(2.0, (prev[slotIdx] || 1) + 0.1) }))}
                          className="px-1.5 py-0.5 rounded bg-[#161922] text-[#8e95a5] hover:text-[#f4f0e8]"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 3: ROUND 2 PRISONER'S DILEMMA TEST ARENA                        */}
      {/* ===================================================================== */}
      {viewMode === 'round2' && (
        <div className="space-y-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase block">
                Round 2: Shades in the Mist Simulator
              </span>
              <p className="text-[10px] text-[#8e95a5]">
                Simulate face-to-face 3-clash matches, test voting stances, tie-breakers, and escalating scores.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleLaunchState('ROUND_ACTIVE', 1)}
                className="py-1.5 px-3 rounded-xl bg-purple-900/60 border border-purple-500/50 hover:bg-purple-800 text-purple-200 text-xs font-mono font-bold flex items-center space-x-1"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Launch Round 2 Active</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              onClick={() => handleR2CastPresetVotes('TRUCE', 'TRUCE')}
              className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/60 to-[#10121a] border border-emerald-500/50 text-left hover:border-emerald-400 transition-all space-y-1.5"
            >
              <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs font-serif">
                <Handshake className="w-4 h-4" />
                <span>Simulate: Both Truce</span>
              </div>
              <p className="text-[10px] text-[#8e95a5] leading-relaxed">
                Both crews cooperate honorably (+75 / +150 / +225 PTS each).
              </p>
            </button>

            <button
              onClick={() => handleR2CastPresetVotes('AMBUSH', 'TRUCE')}
              className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-950/60 to-[#10121a] border border-amber-500/50 text-left hover:border-amber-400 transition-all space-y-1.5"
            >
              <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs font-serif">
                <Crown className="w-4 h-4" />
                <span>Simulate: Team A Ambush Wins</span>
              </div>
              <p className="text-[10px] text-[#8e95a5] leading-relaxed">
                Team A backstabs (+150 / +300 / +450 PTS), Team B gets 0.
              </p>
            </button>

            <button
              onClick={() => handleR2CastPresetVotes('TRUCE', 'AMBUSH')}
              className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-950/60 to-[#10121a] border border-rose-500/50 text-left hover:border-rose-400 transition-all space-y-1.5"
            >
              <div className="flex items-center space-x-2 text-rose-400 font-bold text-xs font-serif">
                <AlertCircle className="w-4 h-4" />
                <span>Simulate: Team B Ambush Wins</span>
              </div>
              <p className="text-[10px] text-[#8e95a5] leading-relaxed">
                Team B backstabs (+150 / +300 / +450 PTS), Team A gets 0.
              </p>
            </button>

            <button
              onClick={() => handleR2CastPresetVotes('AMBUSH', 'AMBUSH')}
              className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/60 to-[#10121a] border border-purple-500/50 text-left hover:border-purple-400 transition-all space-y-1.5"
            >
              <div className="flex items-center space-x-2 text-purple-400 font-bold text-xs font-serif">
                <Swords className="w-4 h-4" />
                <span>Simulate: Mutual Betrayal</span>
              </div>
              <p className="text-[10px] text-[#8e95a5] leading-relaxed">
                Both crews betray (+15 / +30 / +45 PTS each).
              </p>
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VERIFICATION & SUBMISSION TEST PANEL                                  */}
      {/* ===================================================================== */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#c4a45a]" />
            <h3 className="text-sm font-serif font-bold text-[#f4f0e8] uppercase">
              Codeword Verification & Escalating Scoring Test
            </h3>
          </div>
          <button
            onClick={() => setTestInput(selectedWord)}
            className="text-[10px] font-mono text-[#c4a45a] hover:underline"
          >
            Auto-fill: {selectedWord}
          </button>
        </div>

        <form onSubmit={handleCodewordSubmit} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value.toUpperCase())}
              placeholder={`ENTER 2-WORD CODEWORD (e.g. ${selectedWord})...`}
              className="flex-1 bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-xl px-4 py-2.5 text-sm font-mono tracking-widest text-[#f4f0e8] uppercase outline-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="py-2.5 px-6 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-bold text-xs shadow-gold-glow transition-all"
            >
              {submitting ? 'Verifying...' : 'Submit & Test Score'}
            </button>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                testResult.success
                  ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/60 text-red-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </form>

        {/* Dynamic Scoring Metrics Breakdown */}
        <div className="p-3.5 rounded-xl bg-[#08090c] border border-[#2a2e3d] grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
          <div>
            <span className="text-[#8e95a5] block text-[10px]">Elapsed Time</span>
            <span className="text-[#f4f0e8] font-bold">
              {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
            </span>
          </div>
          <div>
            <span className="text-[#8e95a5] block text-[10px]">Speed Tier</span>
            <span className="text-[#c4a45a] font-bold">{scoreBreakdown.speedTier}</span>
          </div>
          <div>
            <span className="text-[#8e95a5] block text-[10px]">Est. Points Awarded</span>
            <span className="text-emerald-400 font-bold text-sm">+{scoreBreakdown.finalPoints} PTS</span>
          </div>
        </div>
      </div>
    </div>
  );
};
