import React, { useState, useEffect } from 'react';
import { useGameSession } from '../context/GameContext';
import {
  getAllAsciiSlices,
} from '../lib/asciiEngine';
import {
  ROUND1_HINTS,
  generateHintText,
  calculateRound1Score,
} from '../lib/round1Engine';
import type { PlayerSlotInfo } from '../lib/round1Engine';
import {
  adminSetState,
  adminAdjustTimer,
  adminSpawnDemoCrew,
  adminRound2AdjustTimer,
  adminRound2SkipPhase,
  adminRound2AutoPair,
  round2CastVoteApi,
} from '../lib/api';
import {
  Smartphone,
  Layers,
  RotateCw,
  ZoomIn,
  ZoomOut,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Play,
  Swords,
  Sparkles,
  Lightbulb,
  Check,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Crown,
  Handshake,
} from 'lucide-react';
import confetti from 'canvas-confetti';

type AlignmentAnchor = 'top' | 'center' | 'bottom';

export const SoloTesterWorkbench: React.FC = () => {
  const {
    payload,
    team,
    currentRound,
    round2Match,
    submitAnswer,
    requestHint,
    switchPlayer,
    refresh,
  } = useGameSession();

  // Mode: 'table' (stacked pub table) | 'rack' (5 device frames) | 'round2' (Prisoner's Dilemma tester)
  const [viewMode, setViewMode] = useState<'table' | 'rack' | 'round2'>('table');

  // Word selection for testing
  const codewordsPool = (payload?.config?.rounds?.[0]?.data as any)?.codewords || [
    'ORACLE',
    'CERBERUS',
    'CHARON',
    'HERMES',
    'MINOTAUR',
    'HYDRA',
    'TARTARUS',
  ];
  const [selectedWord, setSelectedWord] = useState<string>('ORACLE');

  // Global & Per-Slot adjustments
  const [globalZoom, setGlobalZoom] = useState<number>(1.0);
  const [slotZooms, setSlotZooms] = useState<Record<number, number>>({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 });
  const [slotAnchors, setSlotAnchors] = useState<Record<number, AlignmentAnchor>>({
    0: 'center',
    1: 'center',
    2: 'center',
    3: 'center',
    4: 'center',
  });
  const [slotRotations, setSlotRotations] = useState<Record<number, number>>({ 0: 90, 1: 90, 2: 90, 3: 90, 4: 90 });

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
  const hintsTaken = team?.hints_taken || [];
  const scoreBreakdown = calculateRound1Score(elapsedSeconds, hintsTaken.length);

  // Build slot info
  const slotMembers: PlayerSlotInfo[] = Array.from({ length: teamSize }).map((_, idx) => {
    const memberObj = team?.player_ids?.[idx]
      ? payload?.teams_leaderboard?.flatMap(t => t.members).find(m => m.id === team.player_ids[idx])
      : undefined;
    const roleCfg = payload?.config?.roles?.[idx];
    return {
      slotIndex: idx,
      playerName: memberObj?.name || `Test Player #${idx + 1}`,
      roleName: roleCfg?.name || `Role #${idx + 1}`,
      roleColor: roleCfg?.color || '#c4a45a',
    };
  });

  // Slices for selectedWord
  const slices = getAllAsciiSlices(selectedWord, teamSize, 'HORIZONTAL');
  const colCount = Math.max(1, slices[0]?.[0]?.length || 36);

  // Spawn test crew
  const handleSpawnDemoCrew = async () => {
    try {
      setIsSpawning(true);
      await adminSpawnDemoCrew(adminPass);
      await refresh();
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

  // Force unlock hint (for testing)
  const handleForceUnlockHint = async (hintIndex: number) => {
    if (!team) {
      await handleSpawnDemoCrew();
    }
    await requestHint(hintIndex);
    await refresh();
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

  // Render SVG Totem Slice for a specific slot
  const renderSlotTotem = (slotIdx: number, widthPx: number, heightPx: number) => {
    const slice = slices[slotIdx] || [];
    const roleCfg = payload?.config?.roles?.[slotIdx] || { color: '#c4a45a' };
    const zoom = (slotZooms[slotIdx] || 1.0) * globalZoom;
    const anchor = slotAnchors[slotIdx] || 'center';

    const getVerticalAlign = () => {
      if (anchor === 'top') return 'justify-start';
      if (anchor === 'bottom') return 'justify-end';
      return 'justify-center';
    };

    return (
      <div
        className={`w-full h-full flex flex-col items-center overflow-hidden select-none transition-all duration-150 ${getVerticalAlign()}`}
        style={{ height: `${heightPx}px` }}
      >
        <svg
          viewBox={`0 0 ${colCount * 10} ${slice.length * 14}`}
          preserveAspectRatio="none"
          style={{
            width: `${Math.round(widthPx * zoom)}px`,
            maxWidth: '100%',
            height: `${heightPx}px`,
            display: 'block',
            filter: `drop-shadow(0 0 8px ${roleCfg.color}80)`,
          }}
        >
          {slice.map((line, rIdx) => {
            return line.split('').map((char, cIdx) => {
              if (char === '█') {
                return (
                  <rect
                    key={`${rIdx}-${cIdx}`}
                    x={cIdx * 10}
                    y={rIdx * 14}
                    width={10}
                    height={14}
                    fill={roleCfg.color}
                  />
                );
              }
              return null;
            });
          })}
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
                Solo Tester Multi-Screen Workbench
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#c4a45a]/20 text-[#c4a45a] font-bold border border-[#c4a45a]/40">
                /solotester
              </span>
            </div>
            <p className="text-xs text-[#8e95a5]">
              Simulate all 5 phone screens simultaneously • Test edge-to-edge table alignment & hints
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

          {/* Start Round 2 */}
          <button
            onClick={() => handleLaunchState('ROUND_ACTIVE', 1)}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-cyan-500/40 hover:bg-cyan-950/60 text-cyan-300 font-mono font-bold text-xs flex items-center justify-center space-x-1.5 transition-all"
          >
            <Swords className="w-3.5 h-3.5" />
            <span>Start Round 2</span>
          </button>

          {/* +1 Min Timer */}
          <button
            onClick={() => handleAdjustTimer(60)}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/60 text-emerald-300 font-mono font-bold text-xs flex items-center justify-center space-x-1"
          >
            <span>+1 Min Time</span>
          </button>

          {/* -1 Min Timer */}
          <button
            onClick={() => handleAdjustTimer(-60)}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-red-500/40 hover:bg-red-950/60 text-red-300 font-mono font-bold text-xs flex items-center justify-center space-x-1"
          >
            <span>-1 Min Time</span>
          </button>

          {/* Lobby */}
          <button
            onClick={() => handleLaunchState('LOBBY_TEAM_FORMATION')}
            className="py-2 px-3 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-[#8e95a5] hover:text-[#f4f0e8] font-mono text-xs flex items-center justify-center space-x-1"
          >
            <span>Reset to Lobby</span>
          </button>
        </div>

        {/* Codeword Switcher Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[10px] font-mono uppercase text-[#8e95a5] mr-1">Test Codeword:</span>
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
          <span>Pub Table Stack (5 Phones)</span>
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
      {/* MODE 1: PUB TABLE STACKED MODE (SIMULATES 5 PHONES ON A PUB TABLE)   */}
      {/* ===================================================================== */}
      {viewMode === 'table' && (
        <div className="space-y-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase block">
                Pub Table Top-Down View: Assembled Codeword "{selectedWord}"
              </span>
              <p className="text-[10px] text-[#8e95a5]">
                Simulates 5 phones placed horizontally stacked on a pub table. Edge snapping aligns the fragments across the bezels!
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

          {/* The 5 Stacked Mobile Devices on the Pub Table */}
          <div className="max-w-2xl mx-auto space-y-2 p-4 bg-[#050608] border-2 border-dashed border-[#2a2e3d] rounded-3xl shadow-2xl">
            {Array.from({ length: teamSize }).map((_, slotIdx) => {
              const roleCfg = payload?.config?.roles?.[slotIdx] || { name: `Role #${slotIdx + 1}`, color: '#c4a45a' };
              const memberInfo = slotMembers[slotIdx];

              return (
                <div
                  key={slotIdx}
                  className="bg-black border-2 rounded-2xl overflow-hidden shadow-xl transition-all relative"
                  style={{ borderColor: `${roleCfg.color}60` }}
                >
                  {/* Phone Header / Bezel Label */}
                  <div className="px-3 py-1 bg-[#10121a]/90 border-b border-[#2a2e3d]/60 flex items-center justify-between text-[10px] font-mono">
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: roleCfg.color }} />
                      <span className="font-bold text-[#f4f0e8]">PHONE #{slotIdx + 1}: {memberInfo.playerName}</span>
                      <span style={{ color: roleCfg.color }}>({roleCfg.name})</span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <span className="text-[#8e95a5]">
                        {slotIdx === 0 ? 'TOP LAYER' : slotIdx === teamSize - 1 ? 'BOTTOM LAYER' : `MIDDLE #${slotIdx + 1}`}
                      </span>
                      {team?.player_ids?.[slotIdx] && (
                        <button
                          onClick={() => switchPlayer(team.player_ids[slotIdx])}
                          className="px-1.5 py-0.5 rounded bg-[#c4a45a]/20 text-[#c4a45a] hover:bg-[#c4a45a] hover:text-[#08090c] text-[9px] font-bold"
                        >
                          Play as
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Screen Content: Vector SVG Totem */}
                  <div className="p-2 bg-black flex items-center justify-center">
                    {renderSlotTotem(slotIdx, 580, 52)}
                  </div>
                </div>
              );
            })}
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
                Adjust independent zoom, rotation, and edge snapping on each simulated phone.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: teamSize }).map((_, slotIdx) => {
              const roleCfg = payload?.config?.roles?.[slotIdx] || { name: `Role #${slotIdx + 1}`, color: '#c4a45a' };
              const memberInfo = slotMembers[slotIdx];
              const rotation = slotRotations[slotIdx] || 90;
              const anchor = slotAnchors[slotIdx] || 'center';
              const zoom = slotZooms[slotIdx] || 1.0;

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
                        {slotIdx === 0 ? 'Top' : slotIdx === teamSize - 1 ? 'Bottom' : 'Middle'}
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
                  <div className="w-full bg-black border border-[#2a2e3d] rounded-xl p-2 h-44 flex items-center justify-center overflow-hidden relative">
                    <div
                      style={{
                        transform: `rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        width: rotation === 90 || rotation === 270 ? '160px' : '100%',
                      }}
                    >
                      {renderSlotTotem(slotIdx, 160, 40)}
                    </div>
                  </div>

                  {/* Phone Controls */}
                  <div className="space-y-1.5 pt-1 border-t border-[#2a2e3d]/60">
                    {/* Snap Buttons */}
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-[#8e95a5]">Snap:</span>
                      <div className="flex items-center bg-[#161922] rounded-lg p-0.5 border border-[#2a2e3d]">
                        <button
                          onClick={() => setSlotAnchors({ ...slotAnchors, [slotIdx]: 'top' })}
                          className={`p-1 rounded ${anchor === 'top' ? 'bg-[#c4a45a] text-[#08090c]' : 'text-[#8e95a5]'}`}
                          title="Flush Top"
                        >
                          <AlignVerticalJustifyStart className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setSlotAnchors({ ...slotAnchors, [slotIdx]: 'center' })}
                          className={`p-1 rounded ${anchor === 'center' ? 'bg-[#c4a45a] text-[#08090c]' : 'text-[#8e95a5]'}`}
                          title="Center"
                        >
                          <AlignVerticalJustifyCenter className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setSlotAnchors({ ...slotAnchors, [slotIdx]: 'bottom' })}
                          className={`p-1 rounded ${anchor === 'bottom' ? 'bg-[#c4a45a] text-[#08090c]' : 'text-[#8e95a5]'}`}
                          title="Flush Bottom"
                        >
                          <AlignVerticalJustifyEnd className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Zoom & Rotate */}
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => setSlotZooms({ ...slotZooms, [slotIdx]: Math.max(0.6, Math.round((zoom - 0.1) * 10) / 10) })}
                          className="px-1 py-0.5 rounded bg-[#161922] border border-[#2a2e3d] text-[#8e95a5]"
                        >
                          -
                        </button>
                        <span className="text-[#c4a45a] font-bold">{Math.round(zoom * 100)}%</span>
                        <button
                          onClick={() => setSlotZooms({ ...slotZooms, [slotIdx]: Math.min(2.0, Math.round((zoom + 0.1) * 10) / 10) })}
                          className="px-1 py-0.5 rounded bg-[#161922] border border-[#2a2e3d] text-[#8e95a5]"
                        >
                          +
                        </button>
                      </div>

                      <button
                        onClick={() => setSlotRotations({ ...slotRotations, [slotIdx]: ((rotation + 90) % 360) })}
                        className="px-1.5 py-0.5 rounded bg-[#161922] border border-[#2a2e3d] text-[#c4a45a] flex items-center space-x-0.5"
                      >
                        <RotateCw className="w-3 h-3" />
                        <span>{rotation}°</span>
                      </button>
                    </div>

                    {team?.player_ids?.[slotIdx] && (
                      <button
                        onClick={() => switchPlayer(team.player_ids[slotIdx])}
                        className="w-full py-1 rounded bg-[#c4a45a]/10 hover:bg-[#c4a45a] text-[#c4a45a] hover:text-[#08090c] text-[10px] font-mono font-bold transition-colors"
                      >
                        🎮 Play as {memberInfo.playerName}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODE 3: ROUND 2 DILEMMA ARENA TESTER                                  */}
      {/* ===================================================================== */}
      {viewMode === 'round2' && (
        <div className="space-y-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase block">
                  Round 2: Shades in the Mist Simulator
                </span>
                <p className="text-[10px] text-[#8e95a5]">
                  Test 3-clash Prisoner's Dilemma voting scenarios with 1 tap.
                </p>
              </div>

              <button
                onClick={() => adminRound2SkipPhase(adminPass)}
                className="px-3 py-1.5 rounded-xl bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c] text-xs font-mono font-bold shadow-gold-glow"
              >
                Skip Current Phase ⏭️
              </button>
            </div>

            {/* Quick 1-tap Scenarios */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
              <button
                onClick={() => handleR2CastPresetVotes('TRUCE', 'TRUCE')}
                className="p-2.5 rounded-xl bg-[#161922] border border-emerald-500/50 hover:bg-emerald-950/40 text-emerald-300 font-mono text-xs flex flex-col items-center justify-center space-y-0.5"
              >
                <Handshake className="w-4 h-4 text-emerald-400" />
                <span className="font-bold">Both Truce (+75/+75)</span>
                <span className="text-[9px] text-[#8e95a5]">Peaceful cooperation</span>
              </button>

              <button
                onClick={() => handleR2CastPresetVotes('AMBUSH', 'TRUCE')}
                className="p-2.5 rounded-xl bg-[#161922] border border-amber-500/50 hover:bg-amber-950/40 text-amber-300 font-mono text-xs flex flex-col items-center justify-center space-y-0.5"
              >
                <Crown className="w-4 h-4 text-amber-400" />
                <span className="font-bold">Alpha Betrays (+150/+0)</span>
                <span className="text-[9px] text-[#8e95a5]">Alpha steals Beta supplies</span>
              </button>

              <button
                onClick={() => handleR2CastPresetVotes('TRUCE', 'AMBUSH')}
                className="p-2.5 rounded-xl bg-[#161922] border border-purple-500/50 hover:bg-purple-950/40 text-purple-300 font-mono text-xs flex flex-col items-center justify-center space-y-0.5"
              >
                <Crown className="w-4 h-4 text-purple-400" />
                <span className="font-bold">Beta Betrays (+0/+150)</span>
                <span className="text-[9px] text-[#8e95a5]">Beta steals Alpha supplies</span>
              </button>

              <button
                onClick={() => handleR2CastPresetVotes('AMBUSH', 'AMBUSH')}
                className="p-2.5 rounded-xl bg-[#161922] border border-rose-500/50 hover:bg-rose-950/40 text-rose-300 font-mono text-xs flex flex-col items-center justify-center space-y-0.5"
              >
                <Swords className="w-4 h-4 text-rose-400" />
                <span className="font-bold">Both Ambush (+15/+15)</span>
                <span className="text-[9px] text-[#8e95a5]">Bloodied stalemate</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TESTING ROUND 1 SUBMISSION & HINTS VERIFICATION PANEL                 */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hints Verification Card */}
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-2">
            <div className="flex items-center space-x-2">
              <Lightbulb className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                Hints & Oracle Whispers Simulator
              </span>
            </div>
            <span className="text-[10px] font-mono text-amber-400">
              Elapsed: {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
            </span>
          </div>

          <div className="space-y-2">
            {ROUND1_HINTS.map((hint) => {
              const isUnlocked = hintsTaken.includes(hint.hintIndex);
              const hintText = generateHintText(hint.hintIndex, teamSize, slotMembers);

              return (
                <div
                  key={hint.hintIndex}
                  className={`p-3 rounded-xl border space-y-1.5 ${
                    isUnlocked
                      ? 'bg-emerald-950/30 border-emerald-500/50'
                      : 'bg-[#161922] border-[#2a2e3d]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-[#f4f0e8] flex items-center space-x-1">
                      {isUnlocked ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clock className="w-3.5 h-3.5 text-[#8e95a5]" />}
                      <span>Hint #{hint.hintIndex}: {hint.title} (Available at {Math.floor(hint.availableAfterSeconds / 60)}m)</span>
                    </span>

                    <button
                      onClick={() => handleForceUnlockHint(hint.hintIndex)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                        isUnlocked
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#c4a45a] text-[#08090c] hover:bg-[#d8b86e]'
                      }`}
                    >
                      {isUnlocked ? '✓ Unlocked' : 'Force Unlock'}
                    </button>
                  </div>

                  <p className="text-[11px] font-mono text-[#8e95a5]">
                    {hintText}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Codeword Submission Verification Card */}
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-2">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[#c4a45a]" />
              <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                Codeword Submission & Dynamic Scoring
              </span>
            </div>
            <button
              onClick={() => setTestInput(selectedWord)}
              className="text-[10px] font-mono text-[#c4a45a] hover:underline"
            >
              Auto-fill: {selectedWord}
            </button>
          </div>

          {/* Live Score Projection */}
          <div className="p-2.5 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-[#8e95a5]">Potential Points:</span>
              <span className="text-emerald-400 font-bold ml-1.5">+{scoreBreakdown.finalPoints} PTS</span>
              <span className="text-[10px] text-[#8e95a5] block">
                {scoreBreakdown.speedTier} (Base: {scoreBreakdown.basePoints} • Hints Penalty: -{scoreBreakdown.hintPenalty})
              </span>
            </div>
          </div>

          <form onSubmit={handleCodewordSubmit} className="space-y-2">
            <input
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value.toUpperCase())}
              placeholder={`ENTER CODEWORD (e.g. ${selectedWord})...`}
              className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-xl px-4 py-2.5 text-center text-sm font-mono font-bold tracking-widest text-[#f4f0e8] outline-none uppercase"
            />

            {testResult && (
              <div
                className={`p-2.5 rounded-xl border text-xs flex items-center space-x-2 ${
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

            <button
              type="submit"
              disabled={submitting || !testInput.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] text-[#08090c] font-serif font-bold text-xs tracking-wider shadow-gold-glow transition-all disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : `Submit Codeword to Active Crew`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
