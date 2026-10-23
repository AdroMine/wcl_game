import React, { useState, useEffect } from 'react';
import { useGameSession } from '../context/GameContext';
import {
  verifyAdminPasscode,
  adminSetState,
  adminAdjustTimer,
  adminChangeRole,
  adminMovePlayerTeam,
  adminRemovePlayer,
  adminAddPlayer,
  adminMarkRound1Solved,
  adminUpdateConfig,
  adminResetGame,
  adminDeleteTeam,
  renameTeamApi,
  adminAutoGroup,
  adminRebalanceUnassignedRoles,
  fetchServerInfo,
  adminRound2AutoPair,
  adminRound2ManualPair,
  adminRound2AdjustTimer,
  adminRound2SkipPhase,
  adminRound2ResetMatches,
  adminRound3AdjustTimer,
  adminRound3NextPhase,
  adminRound3ForceNextWave,
  adminRound3AdjustDistance,
  adminRound3TriggerSuddenDeath,
  adminRound3ResetSession,
} from '../lib/api';
import { evaluateTeamRound2MoralStatus } from '../lib/round3Engine';
import type { SyncPayload, TeamMoralReport } from '../types';
import {
  ShieldAlert,
  Play,
  Pause,
  Clock,
  Users,
  QrCode,
  UserX,
  Lock,
  Trash2,
  RotateCcw,
  Swords,
  FastForward,
  RefreshCw,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Search,
  Trophy,
  X,
  Copy,
  UserCheck,
  Edit2,
  Check,
  Compass,
  AlertTriangle,
} from 'lucide-react';

interface AdminProps {
  payload: SyncPayload | null;
  onClose?: () => void;
}

function renderMoralBadge(report: TeamMoralReport, isHonourableOverride?: boolean) {
  const isHonourable = isHonourableOverride || report.status === 'HONOURABLE';
  if (isHonourable) {
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 bg-emerald-950/80 border border-emerald-500/80 text-emerald-300"
        title="🕊️ Winds of Olympus (+75m)"
      >
        🕊️ +75m Winds
      </span>
    );
  }
  if (report.status === 'BETRAYED') {
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 bg-rose-950/80 border border-rose-500/80 text-rose-300"
        title={report.label}
      >
        🩸 Betrayed (Cerberus)
      </span>
    );
  }
  if (report.status === 'AGGRESSOR') {
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 bg-amber-950/80 border border-amber-500/80 text-amber-300"
        title={report.label}
      >
        🗡️ Aggressor (Hunted)
      </span>
    );
  }
  if (report.status === 'MUTUAL_BRAWL') {
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 bg-purple-950/80 border border-purple-500/80 text-purple-300"
        title={report.label}
      >
        ⚔️ Blood Feud
      </span>
    );
  }
  return null;
}

export const AdminControlPanel: React.FC<AdminProps> = ({ payload, onClose }) => {
  const { refresh } = useGameSession();
  const [passcode, setPasscode] = useState(() => localStorage.getItem('underworld_admin_pass') || 'underworld');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // 2 Primary Tabs: 'cockpit' (Live Operation) | 'roster' (People & Crews)
  const [activeTab, setActiveTab] = useState<'cockpit' | 'roster'>('cockpit');

  // Server Info & QR Modal
  const [serverInfo, setServerInfo] = useState<{ localIp: string; joinUrl: string; qrDataUrl: string | null } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Private Admin-Only Live Leaderboard modal state
  const [showAdminLeaderboard, setShowAdminLeaderboard] = useState(false);

  // Reset Game Safety Modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Roster Search & Crew Directory
  const [crewSearch, setCrewSearch] = useState('');
  const [expandedCrewIds, setExpandedCrewIds] = useState<Set<string>>(new Set());
  const [editingCrewId, setEditingCrewId] = useState<string | null>(null);
  const [editingCrewName, setEditingCrewName] = useState('');

  // Round 1 filter & status message
  const [r1Search, setR1Search] = useState('');
  const [r1Msg, setR1Msg] = useState<string | null>(null);

  // Add offline player form
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerRoleId, setNewPlayerRoleId] = useState('navigator');

  // Round 2 state
  const [manualTeamA, setManualTeamA] = useState('');
  const [manualTeamB, setManualTeamB] = useState('');
  const [showManualPairing, setShowManualPairing] = useState(false);
  const [r2Msg, setR2Msg] = useState<string | null>(null);

  // Round 3 state
  const [sdTeamA, setSdTeamA] = useState('');
  const [sdTeamB, setSdTeamB] = useState('');
  const [r3Msg, setR3Msg] = useState<string | null>(null);

  // Initial auth check
  useEffect(() => {
    if (passcode) {
      verifyAdminPasscode(passcode).then(ok => {
        setIsAuthenticated(ok);
        if (ok) {
          localStorage.setItem('underworld_admin_pass', passcode);
          fetchServerInfo().then(setServerInfo).catch(console.warn);
        }
      });
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const ok = await verifyAdminPasscode(passcode);
    if (ok) {
      setIsAuthenticated(true);
      localStorage.setItem('underworld_admin_pass', passcode);
      fetchServerInfo().then(setServerInfo).catch(console.warn);
    } else {
      setAuthError('Invalid Game Master passcode.');
    }
  };

  // Universal Time Adjust (Adjusts global round timer AND active Round 2 & Round 3 timers)
  const handleUniversalTimeAdjust = async (deltaSeconds: number) => {
    await Promise.all([
      adminAdjustTimer(passcode, 'adjust', deltaSeconds),
      adminRound2AdjustTimer(passcode, deltaSeconds),
      adminRound3AdjustTimer(passcode, deltaSeconds),
    ]);
    await refresh();
  };

  const handleTimePause = async () => {
    await adminAdjustTimer(passcode, 'pause');
    await refresh();
  };

  const handleStateChange = async (state: any, roundIndex?: number) => {
    await adminSetState(passcode, state, roundIndex);
    await refresh();
  };

  const handleMarkRound1Solved = async (teamId: string, teamName: string) => {
    if (confirm(`Mark Round 1 as SOLVED for "${teamName}"? This calculates legitimate points based on elapsed time.`)) {
      const res = await adminMarkRound1Solved(passcode, teamId);
      if (res?.success) {
        setR1Msg(`✓ Awarded +${res.points || 0} PTS to ${teamName}!`);
      } else {
        setR1Msg(`⚠️ ${res?.message || 'Could not mark solved'}`);
      }
      setTimeout(() => setR1Msg(null), 4000);
      await refresh();
    }
  };

  const handleTargetCrewSizeChange = async (newSize: number) => {
    if (!payload?.config || newSize < 2 || newSize > 10) return;
    const updated = { ...payload.config, team_size: newSize };
    await adminUpdateConfig(passcode, updated);
    await refresh();
  };

  const handleRoleChange = async (playerId: string, roleId: string) => {
    await adminChangeRole(passcode, playerId, roleId);
    await refresh();
  };

  const handleMovePlayer = async (playerId: string, targetTeamId: string | null) => {
    await adminMovePlayerTeam(passcode, playerId, targetTeamId);
    await refresh();
  };

  const handleRemovePlayer = async (playerId: string) => {
    if (confirm('Permanently remove this player from the session?')) {
      await adminRemovePlayer(passcode, playerId);
      await refresh();
    }
  };

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    await adminAddPlayer(passcode, newPlayerName.trim(), newPlayerRoleId);
    setNewPlayerName('');
    await refresh();
  };

  const handleAutoGroup = async () => {
    await adminAutoGroup(passcode);
    await refresh();
  };

  const handleRebalanceRoles = async () => {
    await adminRebalanceUnassignedRoles(passcode);
    await refresh();
  };

  const handleRenameTeam = async (teamId: string) => {
    if (!editingCrewName.trim()) return;
    try {
      await renameTeamApi(teamId, editingCrewName.trim());
      setEditingCrewId(null);
      setEditingCrewName('');
      await refresh();
    } catch (e: any) {
      alert(`Failed to rename crew: ${e.message || e}`);
    }
  };

  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    if (confirm(`Disband "${teamName}"? All crew members will be moved back to the unassigned lobby.`)) {
      const res = await adminDeleteTeam(passcode, teamId);
      if (res && !res.success && res.error) {
        alert(`Failed to delete team: ${res.error}`);
      }
      await refresh();
    }
  };

  const handleResetGame = async () => {
    setIsResetting(true);
    try {
      await adminResetGame(passcode);
      await refresh();
      setShowResetModal(false);
    } catch (e: any) {
      alert(`Reset failed: ${e?.message || e}`);
    } finally {
      setIsResetting(false);
    }
  };

  // Round 2 Handlers
  const handleR2SkipPhase = async (matchId?: string) => {
    await adminRound2SkipPhase(passcode, matchId);
    await refresh();
  };

  const handleR2AutoPair = async () => {
    const res = await adminRound2AutoPair(passcode);
    if (res.error) {
      setR2Msg(`Auto-pair notice: ${res.error}`);
    } else {
      setR2Msg(`Successfully paired ${res.pairedCount} matches!`);
    }
    setTimeout(() => setR2Msg(null), 4000);
    await refresh();
  };

  const handleR2ManualPair = async () => {
    if (!manualTeamA || !manualTeamB) {
      setR2Msg('Select both squads to pair.');
      return;
    }
    const res = await adminRound2ManualPair(passcode, manualTeamA, manualTeamB);
    if (res.error) {
      setR2Msg(res.error);
    } else {
      setR2Msg('Crews paired successfully!');
      setManualTeamA('');
      setManualTeamB('');
      setShowManualPairing(false);
    }
    setTimeout(() => setR2Msg(null), 4000);
    await refresh();
  };

  const handleR2ResetMatches = async () => {
    if (confirm('Reset all Round 2 matches, clash records, and pairings?')) {
      await adminRound2ResetMatches(passcode);
      await refresh();
    }
  };

  // Round 3 Handlers
  const handleR3AdjustTimer = async (delta: number) => {
    await adminRound3AdjustTimer(passcode, delta);
    await refresh();
    setR3Msg(`Adjusted wave timer by +${delta}s`);
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3NextPhase = async () => {
    await adminRound3NextPhase(passcode);
    await refresh();
    setR3Msg('Advanced wave to next phase');
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3ForceWave = async () => {
    await adminRound3ForceNextWave(passcode);
    await refresh();
    setR3Msg('Forced next wave');
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3AdjustDistance = async (teamId: string, deltaMeters: number) => {
    await adminRound3AdjustDistance(passcode, teamId, deltaMeters);
    await refresh();
  };

  const handleR3TriggerSuddenDeath = async () => {
    if (!sdTeamA || !sdTeamB) return;
    const res = await adminRound3TriggerSuddenDeath(passcode, sdTeamA, sdTeamB);
    if (res.error) {
      setR3Msg(`Sudden Death error: ${res.error}`);
    } else {
      setR3Msg('⚡ Sudden Death Standoff initiated!');
      setSdTeamA('');
      setSdTeamB('');
    }
    setTimeout(() => setR3Msg(null), 4000);
    await refresh();
  };

  const handleR3ResetSession = async () => {
    if (confirm('Reset all Round 3 wave records, distance states, and podium spots?')) {
      await adminRound3ResetSession(passcode);
      await refresh();
    }
  };

  const handleCopyJoinLink = () => {
    const url = serverInfo?.joinUrl || window.location.origin + '/join';
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Toggle crew expand
  const toggleCrewExpand = (teamId: string) => {
    setExpandedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // Auth Screen
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center p-6 min-h-[60vh]">
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 rounded-xl bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center mx-auto text-[#c4a45a]">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-serif font-bold text-[#f4f0e8]">
              Game Master Access
            </h2>
            <p className="text-xs text-[#8e95a5]">
              Enter the master passcode to open the orchestrator console.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Admin Passcode..."
                className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-xl px-4 py-3 text-sm text-[#f4f0e8] outline-none text-center font-mono"
              />
            </div>

            {authError && (
              <p className="text-xs text-red-400 text-center">{authError}</p>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-bold text-sm tracking-wide shadow-gold-glow transition-all"
            >
              Authenticate Game Master
            </button>
          </form>

          {onClose && (
            <button
              onClick={onClose}
              className="w-full py-2 text-xs text-[#8e95a5] hover:text-[#f4f0e8] transition-colors"
            >
              ← Back to Player View
            </button>
          )}
        </div>
      </div>
    );
  }

  // Derive state collections
  const roles = payload?.config.roles || [];
  const teams = payload?.teams_leaderboard || [];
  const unassigned = payload?.unassigned_players || [];
  const round2Matches = payload?.round2_all_matches || [];
  const targetCrewSize = payload?.config?.team_size || 5;

  const totalAttendees = teams.reduce((acc, t) => acc + t.members.length, 0) + unassigned.length;

  const pairedTeamIds = new Set<string>();
  round2Matches.forEach(m => {
    if (!m.completed) {
      pairedTeamIds.add(m.team_a_id);
      pairedTeamIds.add(m.team_b_id);
    }
  });
  const unpairedTeams = teams.filter(t => !pairedTeamIds.has(t.id));

  // Determine Game State Step Index for the Progress Rail
  const currentRoundIdx = payload?.current_round_index ?? 0;
  const isLobby = payload?.state === 'LOBBY_TEAM_FORMATION';
  const isRoundLeaderboard = payload?.state === 'ROUND_LEADERBOARD';
  const isRoundActive = payload?.state === 'ROUND_ACTIVE';

  const currentStep = isLobby
    ? 0
    : isRoundActive && currentRoundIdx === 0
    ? 1
    : isRoundActive && currentRoundIdx === 1
    ? 2
    : isRoundActive && currentRoundIdx === 2
    ? 3
    : 4;

  const timeLeftSeconds = payload?.round_ends_at
    ? Math.max(0, Math.floor((payload.round_ends_at - (payload.server_now || Date.now())) / 1000))
    : 0;

  return (
    <div className="space-y-4 py-3 max-w-5xl mx-auto">
      {/* ===================================================================== */}
      {/* HEADER: STATUS, QUICK ACTIONS & MODAL TRIGGERS                         */}
      {/* ===================================================================== */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center text-[#c4a45a] shadow-gold-glow">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-serif font-black text-[#f4f0e8] uppercase tracking-wide">
                Game Master Cockpit
              </h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                isLobby
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                  : isRoundActive
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                  : 'bg-purple-950/80 text-purple-300 border border-purple-500/40'
              }`}>
                {isLobby
                  ? '● LOBBY: CREW FORMATION'
                  : isRoundActive
                  ? `● ACTIVE: R${currentRoundIdx + 1} (${timeLeftSeconds}s left)`
                  : '● LEADERBOARD & INTERMISSION'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-[#8e95a5]">
              {totalAttendees} Shades in Venue • {teams.length} Crews • Target Size: {targetCrewSize}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Join QR Button */}
          <button
            onClick={() => setShowQrModal(true)}
            className="px-3 py-1.5 rounded-xl border border-[#c4a45a]/60 bg-[#161922] hover:bg-[#c4a45a] hover:text-[#08090c] text-xs font-mono font-bold text-[#c4a45a] flex items-center space-x-1.5 transition-all shadow-sm"
            title="Display large scannable QR code for players"
          >
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Join QR</span>
          </button>

          {/* Live Standings Button */}
          <button
            onClick={() => setShowAdminLeaderboard(true)}
            className="px-3 py-1.5 rounded-xl border border-[#2a2e3d] bg-[#161922] hover:border-[#c4a45a] text-xs font-mono font-bold text-[#f4f0e8] flex items-center space-x-1.5 transition-all"
            title="Inspect current standings privately"
          >
            <Trophy className="w-4 h-4 text-[#c4a45a]" />
            <span className="hidden sm:inline">Standings</span>
          </button>

          {/* Reset Game Button */}
          <button
            onClick={() => setShowResetModal(true)}
            className="px-2.5 py-1.5 rounded-xl border border-red-500/40 bg-red-950/30 hover:bg-red-900/50 text-red-300 text-xs font-mono transition-all"
            title="Reset game to lobby"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Exit Admin */}
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl border border-[#2a2e3d] bg-[#161922] text-xs font-mono text-[#8e95a5] hover:text-[#f4f0e8] transition-colors"
            >
              Exit
            </button>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* UNIVERSAL LIVE TIME & PACING CONTROLS (ALWAYS AVAILABLE)               */}
      {/* ===================================================================== */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-3 shadow-lg flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-[#c4a45a]" />
          <span className="text-[#8e95a5]">Pacing Controls:</span>
          <button
            onClick={handleTimePause}
            disabled={!isRoundActive}
            className="px-2.5 py-1 rounded-lg border border-[#2a2e3d] bg-[#161922] hover:border-[#c4a45a] text-[#f4f0e8] flex items-center space-x-1 disabled:opacity-40 transition-all font-bold"
          >
            {payload?.round_is_paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
            <span>{payload?.round_is_paused ? 'Resume' : 'Pause'}</span>
          </button>
        </div>

        <div className="flex items-center space-x-1.5 flex-wrap">
          <button
            onClick={() => handleUniversalTimeAdjust(-30)}
            className="px-2.5 py-1 rounded-lg bg-[#161922] border border-red-500/30 hover:border-red-400 text-red-300 font-bold"
          >
            -30s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(-15)}
            className="px-2.5 py-1 rounded-lg bg-[#161922] border border-red-500/30 hover:border-red-400 text-red-300 font-bold"
          >
            -15s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(15)}
            className="px-2.5 py-1 rounded-lg bg-[#161922] border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 font-bold"
          >
            +15s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(30)}
            className="px-2.5 py-1 rounded-lg bg-[#161922] border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 font-bold"
          >
            +30s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(60)}
            className="px-2.5 py-1 rounded-lg bg-[#161922] border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 font-bold"
          >
            +1m
          </button>

          {/* Contextual Skip Phase Shortcut */}
          {isRoundActive && currentRoundIdx === 1 && (
            <button
              onClick={() => handleR2SkipPhase()}
              className="px-3 py-1 rounded-lg bg-purple-900/60 border border-purple-500/50 hover:bg-purple-800 text-purple-200 font-bold flex items-center space-x-1 ml-1"
              title="Force skip clash phase for all Round 2 tables"
            >
              <FastForward className="w-3.5 h-3.5 text-purple-300" />
              <span>Skip Clash</span>
            </button>
          )}

          {isRoundActive && currentRoundIdx === 2 && (
            <button
              onClick={handleR3NextPhase}
              className="px-3 py-1 rounded-lg bg-amber-900/60 border border-amber-500/50 hover:bg-amber-800 text-amber-200 font-bold flex items-center space-x-1 ml-1"
              title="Advance Round 3 wave to next phase"
            >
              <FastForward className="w-3.5 h-3.5 text-amber-300" />
              <span>Next Phase</span>
            </button>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2 PRIMARY TABS: LIVE COCKPIT vs CREWS & ROSTER                        */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-2 gap-2 bg-[#10121a] border border-[#2a2e3d] p-1.5 rounded-2xl max-w-lg mx-auto">
        <button
          onClick={() => setActiveTab('cockpit')}
          className={`py-2 px-4 rounded-xl text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all ${
            activeTab === 'cockpit'
              ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>🎮 Live Game Cockpit</span>
        </button>

        <button
          onClick={() => setActiveTab('roster')}
          className={`py-2 px-4 rounded-xl text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all ${
            activeTab === 'roster'
              ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>👥 Crews & Roster ({teams.length})</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: LIVE GAME COCKPIT                                              */}
      {/* ===================================================================== */}
      {activeTab === 'cockpit' && (
        <div className="space-y-4">
          {/* Status Message Banners */}
          {r2Msg && (
            <div className="p-3 rounded-xl bg-purple-950/60 border border-purple-500/50 text-purple-200 text-xs font-mono flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <span>{r2Msg}</span>
            </div>
          )}
          {r3Msg && (
            <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/50 text-amber-200 text-xs font-mono flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>{r3Msg}</span>
            </div>
          )}

          {/* STAGE TIMELINE RAIL */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#8e95a5] block mb-2">
              Stage Progression Rail (Tap to switch stage)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: '1. Lobby Formation', state: 'LOBBY_TEAM_FORMATION', roundIdx: undefined, step: 0 },
                { label: '2. Round 1: Words', state: 'ROUND_ACTIVE', roundIdx: 0, step: 1 },
                { label: '3. Round 2: Mist', state: 'ROUND_ACTIVE', roundIdx: 1, step: 2 },
                { label: '4. Round 3: Escape', state: 'ROUND_ACTIVE', roundIdx: 2, step: 3 },
                { label: '5. Grand Finale', state: 'ROUND_LEADERBOARD', roundIdx: 2, step: 4 },
              ].map((item) => {
                const isCurrent = currentStep === item.step;
                const isPassed = currentStep > item.step;
                return (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (confirm(`Advance game to "${item.label}"?`)) {
                        handleStateChange(item.state, item.roundIdx);
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all relative overflow-hidden ${
                      isCurrent
                        ? 'bg-gradient-to-r from-[#c4a45a]/20 to-[#161922] border-[#c4a45a] text-[#f4f0e8] shadow-gold-glow'
                        : isPassed
                        ? 'bg-[#161922]/40 border-emerald-500/30 text-emerald-300'
                        : 'bg-[#161922]/20 border-[#2a2e3d] text-[#8e95a5] hover:border-[#8e95a5]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono font-bold mb-1">
                      <span>{isPassed ? '✓ DONE' : isCurrent ? '● ACTIVE' : 'PENDING'}</span>
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-[#c4a45a] animate-ping" />}
                    </div>
                    <span className="text-xs font-serif font-bold block truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* DYNAMIC CONTEXT-AWARE STAGE CARD */}

          {/* CONTEXT 1: LOBBY & CREW FORMATION */}
          {isLobby && (
            <div className="bg-[#10121a] border border-amber-500/40 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase text-amber-400 font-bold tracking-wider">
                    Stage 1 Active: Pub Gathering & Crew Formation
                  </span>
                  <h3 className="text-base font-serif font-black text-[#f4f0e8]">
                    Pre-Game Lobby Orchestration
                  </h3>
                </div>
                <div className="flex items-center space-x-2 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] text-amber-300">
                    {unassigned.length} Unassigned Shades
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] text-[#c4a45a]">
                    {teams.length} Crews Formed
                  </span>
                </div>
              </div>

              {/* Target Crew Size Stepper */}
              <div className="p-3.5 rounded-xl bg-[#161922] border border-[#2a2e3d] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-serif font-bold text-[#f4f0e8] block">
                    Target Crew Size
                  </span>
                  <p className="text-[10px] text-[#8e95a5]">
                    Attendees auto-group into teams of this size.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="flex items-center bg-[#10121a] border border-[#2a2e3d] rounded-xl p-1">
                    <button
                      onClick={() => handleTargetCrewSizeChange(targetCrewSize - 1)}
                      disabled={targetCrewSize <= 2}
                      className="w-7 h-7 rounded-lg bg-[#161922] text-[#f4f0e8] hover:bg-[#c4a45a] hover:text-[#08090c] font-mono font-bold flex items-center justify-center disabled:opacity-30 transition-all"
                    >
                      -
                    </button>
                    <span className="px-3 font-mono font-bold text-xs text-[#c4a45a]">
                      {targetCrewSize} Shades
                    </span>
                    <button
                      onClick={() => handleTargetCrewSizeChange(targetCrewSize + 1)}
                      disabled={targetCrewSize >= 8}
                      className="w-7 h-7 rounded-lg bg-[#161922] text-[#f4f0e8] hover:bg-[#c4a45a] hover:text-[#08090c] font-mono font-bold flex items-center justify-center disabled:opacity-30 transition-all"
                    >
                      +
                    </button>
                  </div>

                  <div className="hidden sm:flex items-center space-x-1 text-[10px] font-mono">
                    {[3, 4, 5, 6].map(num => (
                      <button
                        key={num}
                        onClick={() => handleTargetCrewSizeChange(num)}
                        className={`w-6 h-6 rounded-lg transition-all ${
                          targetCrewSize === num
                            ? 'bg-[#c4a45a] text-[#08090c] font-bold shadow-gold-glow'
                            : 'bg-[#10121a] border border-[#2a2e3d] text-[#8e95a5] hover:text-[#f4f0e8]'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Lobby Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleAutoGroup}
                  disabled={unassigned.length === 0}
                  className="py-3 px-4 rounded-xl bg-gradient-to-r from-[#161922] to-[#202533] border border-[#c4a45a]/60 hover:border-[#c4a45a] text-xs font-mono font-bold text-[#f4f0e8] flex items-center justify-center space-x-2 transition-all disabled:opacity-40 shadow-sm"
                >
                  <Users className="w-4 h-4 text-[#c4a45a]" />
                  <span>⚡ Auto-Group Unassigned ({unassigned.length})</span>
                </button>

                <button
                  onClick={handleRebalanceRoles}
                  disabled={unassigned.length === 0}
                  className="py-3 px-4 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-xs font-mono font-bold text-[#8e95a5] hover:text-[#f4f0e8] flex items-center justify-center space-x-2 transition-all disabled:opacity-40"
                >
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>⚖️ Auto-Balance Roles</span>
                </button>
              </div>

              {/* Launch Round 1 CTA */}
              <button
                onClick={() => {
                  if (confirm('Launch Round 1: ASCII Splitter for all crews?')) {
                    handleStateChange('ROUND_ACTIVE', 0);
                  }
                }}
                disabled={teams.length === 0}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-black text-sm tracking-wide shadow-gold-glow flex items-center justify-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
              >
                <span>🚀 Launch Round 1: ASCII Splitter ➔</span>
              </button>
            </div>
          )}

          {/* CONTEXT 2: ROUND 1 (ASCII SPLITTER) */}
          {isRoundActive && currentRoundIdx === 0 && (
            <div className="bg-[#10121a] border border-cyan-500/40 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase text-cyan-400 font-bold tracking-wider">
                    Round 1 Active: The Shattered Tablet
                  </span>
                  <h3 className="text-base font-serif font-black text-[#f4f0e8]">
                    Asymmetric Codeword Coordination
                  </h3>
                </div>
                <div className="text-right">
                  <span className="text-lg font-mono font-black text-[#c4a45a]">
                    {Math.floor(timeLeftSeconds / 60)}:{(timeLeftSeconds % 60).toString().padStart(2, '0')}
                  </span>
                  <span className="text-[10px] font-mono text-[#8e95a5] block">Time Remaining</span>
                </div>
              </div>

              {/* Status Notice */}
              {r1Msg && (
                <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/50 text-cyan-200 text-xs font-mono flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span>{r1Msg}</span>
                </div>
              )}

              {/* Active Codewords by Crew */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#8e95a5] uppercase tracking-wider block">
                    Active Crew Codewords & Submission Status
                  </span>
                  <span className="text-[10px] font-mono text-cyan-400">
                    {teams.filter(t => (t.score || 0) > 0).length} of {teams.length} Solved
                  </span>
                </div>

                {/* Instant Search Filter for Multi-Admin Pub Walkarounds */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#8e95a5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={r1Search}
                    onChange={(e) => setR1Search(e.target.value)}
                    placeholder="Search crew by name or battle code to resolve network lag..."
                    className="w-full bg-[#161922] border border-[#2a2e3d] rounded-xl pl-9 pr-8 py-2 text-xs text-[#f4f0e8] placeholder-[#8e95a5]/60 outline-none font-mono focus:border-cyan-500"
                  />
                  {r1Search && (
                    <button
                      onClick={() => setR1Search('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8e95a5] hover:text-[#f4f0e8]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {teams
                    .filter(t => {
                      if (!r1Search.trim()) return true;
                      const q = r1Search.toLowerCase().trim();
                      return t.name.toLowerCase().includes(q) || (t.battle_code || '').toLowerCase().includes(q);
                    })
                    .map(t => {
                      const hasSubmitted = (t.score || 0) > 0;
                      return (
                        <div
                          key={t.id}
                          className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between text-xs font-mono gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-[#f4f0e8] flex items-center space-x-1.5 truncate">
                              <span className="truncate">{t.name}</span>
                              {t.battle_code && (
                                <span className="text-[10px] text-[#c4a45a] shrink-0">[{t.battle_code}]</span>
                              )}
                            </div>
                            <span className="text-[10px] text-[#8e95a5] block truncate">
                              Word: <strong className="text-cyan-300">{t.assignedCodeword || 'CRIMSON SHADOW'}</strong>
                            </span>
                          </div>

                          <div className="shrink-0">
                            {hasSubmitted ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold">
                                ✓ Solved (+{t.score} PTS)
                              </span>
                            ) : (
                              <div className="flex items-center space-x-1.5">
                                <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[10px]">
                                  Solving...
                                </span>
                                <button
                                  onClick={() => handleMarkRound1Solved(t.id, t.name)}
                                  className="px-2 py-0.5 rounded-lg bg-emerald-950/80 border border-emerald-500/50 hover:bg-emerald-900 text-emerald-300 text-[10px] font-mono font-bold flex items-center space-x-1 shadow-sm transition-all"
                                  title="Manually mark solved if team's phone connection timed out on submit"
                                >
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>Mark Solved</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Advance to Round 2 */}
              <button
                onClick={() => {
                  if (confirm('Conclude Round 1 and advance to Round 2 (Shades in the Mist)?')) {
                    handleStateChange('ROUND_ACTIVE', 1);
                  }
                }}
                className="w-full py-3 rounded-xl bg-[#161922] border border-cyan-500/60 hover:bg-cyan-950/40 text-cyan-200 font-serif font-bold text-xs flex items-center justify-center space-x-2 transition-all"
              >
                <span>Advance to Round 2: Shades in the Mist ➔</span>
              </button>
            </div>
          )}

          {/* CONTEXT 3: ROUND 2 (SHADES IN THE MIST) */}
          {isRoundActive && currentRoundIdx === 1 && (
            <div className="bg-[#10121a] border border-purple-500/40 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase text-purple-400 font-bold tracking-wider">
                    Round 2 Active: Prisoner&apos;s Dilemma
                  </span>
                  <h3 className="text-base font-serif font-black text-[#f4f0e8]">
                    Clash Arena Matchmaking & Orchestration
                  </h3>
                </div>
                <div className="flex items-center space-x-2 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] text-purple-300">
                    {round2Matches.length} Matches Paired
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] text-amber-300">
                    {unpairedTeams.length} Unlinked
                  </span>
                </div>
              </div>

              {/* Auto-Pair Unlinked Teams Button */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleR2AutoPair}
                  disabled={unpairedTeams.length < 2}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-900 to-indigo-900 hover:from-purple-800 hover:to-indigo-800 border border-purple-500/50 text-[#f4f0e8] font-serif font-bold text-xs rounded-xl shadow-md flex items-center justify-center space-x-2 transition-all disabled:opacity-40 cursor-pointer"
                >
                  <Swords className="w-4 h-4 text-purple-300" />
                  <span>⚡ Auto-Pair All Unlinked Crews ({unpairedTeams.length})</span>
                </button>
                <button
                  onClick={handleR2ResetMatches}
                  className="px-3 py-3 rounded-xl bg-red-950/40 border border-red-500/30 hover:bg-red-900/60 text-red-300 font-mono text-xs transition-colors flex items-center space-x-1"
                  title="Reset all matches"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Manual Pairing Drawer */}
              <div className="border border-[#2a2e3d] rounded-xl overflow-hidden bg-[#161922]">
                <button
                  type="button"
                  onClick={() => setShowManualPairing(!showManualPairing)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-[#1a1e29] transition-colors"
                >
                  <span className="text-[10px] font-mono text-[#8e95a5] uppercase">
                    Manual Table Pairing Override {showManualPairing ? '' : '(Click to open)'}
                  </span>
                  {showManualPairing ? (
                    <ChevronUp className="w-3.5 h-3.5 text-[#c4a45a]" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-[#8e95a5]" />
                  )}
                </button>

                {showManualPairing && (
                  <div className="p-3.5 pt-1 space-y-2 border-t border-[#2a2e3d]/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-mono text-[#8e95a5] block mb-0.5">Squad Alpha:</label>
                        <select
                          value={manualTeamA}
                          onChange={(e) => setManualTeamA(e.target.value)}
                          className="w-full bg-[#10121a] border border-[#2a2e3d] rounded-lg p-2 text-xs text-[#f4f0e8] outline-none"
                        >
                          <option value="">-- Choose Squad Alpha --</option>
                          {teams.map(t => (
                            <option key={t.id} value={t.id} disabled={t.id === manualTeamB}>
                              {t.name} [{t.battle_code || '--'}] {pairedTeamIds.has(t.id) ? '(Already Paired)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-mono text-[#8e95a5] block mb-0.5">Squad Beta (Opponent):</label>
                        <select
                          value={manualTeamB}
                          onChange={(e) => setManualTeamB(e.target.value)}
                          className="w-full bg-[#10121a] border border-[#2a2e3d] rounded-lg p-2 text-xs text-[#f4f0e8] outline-none"
                        >
                          <option value="">-- Choose Squad Beta --</option>
                          {teams.map(t => (
                            <option key={t.id} value={t.id} disabled={t.id === manualTeamA}>
                              {t.name} [{t.battle_code || '--'}] {pairedTeamIds.has(t.id) ? '(Already Paired)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={handleR2ManualPair}
                      disabled={!manualTeamA || !manualTeamB || manualTeamA === manualTeamB}
                      className="w-full py-2 bg-[#161922] border border-purple-500/60 hover:bg-purple-900 text-purple-200 text-xs font-mono font-bold rounded-lg transition-all disabled:opacity-40"
                    >
                      Link Selected Squads
                    </button>
                  </div>
                )}
              </div>

              {/* Active Matches Summary */}
              {round2Matches.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-mono text-[#8e95a5] uppercase tracking-wider block">
                    Live Paired Matches Monitor
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {round2Matches.map((m, idx) => {
                      const tA = teams.find(t => t.id === m.team_a_id);
                      const tB = teams.find(t => t.id === m.team_b_id);
                      const isCompleted = m.completed || (m.clash_data && m.clash_data.length >= 3);
                      const moralA = evaluateTeamRound2MoralStatus(m.team_a_id, round2Matches, teams);
                      const moralB = evaluateTeamRound2MoralStatus(m.team_b_id, round2Matches, teams);

                      return (
                        <div
                          key={m.id || idx}
                          className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] text-xs font-mono space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#f4f0e8]">
                              {tA?.name || 'Squad A'} <span className="text-[#8e95a5]">vs</span> {tB?.name || 'Squad B'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-950 border border-purple-500/40 text-purple-300 font-bold">
                              {isCompleted ? 'Match Concluded' : `Clash ${m.current_clash} • ${m.current_phase}`}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-[#8e95a5]">
                            <span>Battle Codes: [{tA?.battle_code || '--'}] vs [{tB?.battle_code || '--'}]</span>
                            {!isCompleted && (
                              <button
                                onClick={() => handleR2SkipPhase(m.id)}
                                className="text-purple-300 hover:underline"
                              >
                                Skip Phase ⏭️
                              </button>
                            )}
                          </div>
                          {isCompleted && (
                            <div className="pt-2 border-t border-[#2a2e3d]/60 flex flex-wrap items-center justify-between gap-1 text-[10px]">
                              <div className="flex items-center space-x-1.5">
                                <span className="text-[#8e95a5]">{tA?.name || 'Squad A'}:</span>
                                {renderMoralBadge(moralA)}
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <span className="text-[#8e95a5]">{tB?.name || 'Squad B'}:</span>
                                {renderMoralBadge(moralB)}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Advance to Round 3 */}
              <button
                onClick={() => {
                  if (confirm('Conclude Round 2 and advance to Round 3 (Escape Royale)?')) {
                    handleStateChange('ROUND_ACTIVE', 2);
                  }
                }}
                className="w-full py-3 rounded-xl bg-[#161922] border border-purple-500/60 hover:bg-purple-950/40 text-purple-200 font-serif font-bold text-xs flex items-center justify-center space-x-2 transition-all"
              >
                <span>Advance to Round 3: Escape from Tartarus ➔</span>
              </button>
            </div>
          )}

          {/* CONTEXT 4: ROUND 3 (THE ODYSSEY ESCAPE ROYALE) */}
          {isRoundActive && currentRoundIdx === 2 && (
            <div className="bg-[#10121a] border border-amber-500/40 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase text-amber-400 font-bold tracking-wider">
                    Round 3 Active: The Final Escape
                  </span>
                  <h3 className="text-base font-serif font-black text-[#f4f0e8]">
                    Escape from Tartarus (Escape Royale)
                  </h3>
                </div>
                <div className="flex items-center space-x-2 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] text-[#8e95a5]">
                    Wave: <strong className="text-[#f4f0e8]">{payload?.round3_session?.current_wave || 1}</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-950/80 border border-amber-500/40 text-amber-300 font-bold">
                    {payload?.round3_session?.current_phase || 'BLUFF'}
                  </span>
                  <button
                    onClick={handleR3ResetSession}
                    className="p-1 rounded bg-[#161922] border border-red-500/30 text-red-300 hover:bg-red-900/40 text-[10px]"
                    title="Reset Round 3 Waves"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Round 3 Wave Pacing Controls */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => handleR3AdjustTimer(15)}
                  className="p-2.5 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-xs font-mono font-bold text-[#f4f0e8] flex items-center justify-center space-x-1"
                >
                  <span>+15s Wave</span>
                </button>
                <button
                  onClick={() => handleR3AdjustTimer(30)}
                  className="p-2.5 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-xs font-mono font-bold text-[#f4f0e8] flex items-center justify-center space-x-1"
                >
                  <span>+30s Wave</span>
                </button>
                <button
                  onClick={handleR3NextPhase}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-xs font-mono font-bold text-[#08090c] shadow-md flex items-center justify-center space-x-1"
                >
                  <FastForward className="w-3.5 h-3.5 text-[#08090c]" />
                  <span>Next Phase ⏭️</span>
                </button>
                <button
                  onClick={handleR3ForceWave}
                  className="p-2.5 rounded-xl bg-[#161922] border border-sky-500/50 hover:bg-sky-950/60 text-xs font-mono font-bold text-sky-300 flex items-center justify-center space-x-1"
                >
                  <span>Force Wave 🌊</span>
                </button>
              </div>

              {/* Fleet Progress Toward 1,000m London Portal */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#8e95a5]">
                  <span>Fleet Escape Distance (Target: {payload?.config?.round3?.target_distance_meters || 1000}m)</span>
                  <span>Overrides (+/- 50m)</span>
                </div>

                <div className="space-y-2">
                  {teams.map((t) => {
                    const state = payload?.round3_session?.team_states?.[t.id];
                    const dist = state?.current_distance_meters || 0;
                    const escaped = state?.has_escaped;
                    const targetDist = payload?.config?.round3?.target_distance_meters || 1000;
                    const pct = Math.min(100, Math.max(0, Math.round((dist / targetDist) * 100)));
                    const moral = evaluateTeamRound2MoralStatus(t.id, round2Matches, teams);

                    return (
                      <div
                        key={t.id}
                        className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between gap-3 text-xs font-mono"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-serif font-bold text-[#f4f0e8] truncate">{t.name}</span>
                            {escaped && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#c4a45a] text-[#08090c]">
                                {state?.escape_rank === 1 ? '🥇 GOLD' : state?.escape_rank === 2 ? '🥈 SILVER' : '🥉 BRONZE'}
                              </span>
                            )}
                            {renderMoralBadge(moral, state?.honor_bonus_granted)}
                            <span className="text-[10px] text-[#c4a45a] ml-auto">
                              {dist}m / {targetDist}m ({pct}%)
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-[#10121a] rounded-full overflow-hidden border border-[#2a2e3d]">
                            <div
                              className={`h-full transition-all duration-500 ${
                                escaped ? 'bg-gradient-to-r from-emerald-500 to-[#c4a45a]' : 'bg-[#c4a45a]'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            onClick={() => handleR3AdjustDistance(t.id, -50)}
                            className="px-2 py-1 rounded bg-[#10121a] border border-[#2a2e3d] hover:border-red-400 text-[10px] text-red-300 font-bold"
                          >
                            -50m
                          </button>
                          <button
                            onClick={() => handleR3AdjustDistance(t.id, 50)}
                            className="px-2 py-1 rounded bg-[#10121a] border border-[#2a2e3d] hover:border-emerald-400 text-[10px] text-emerald-300 font-bold"
                          >
                            +50m
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sudden Death Duel Launcher */}
              <div className="p-3.5 rounded-xl bg-[#161922] border border-red-500/30 space-y-2">
                <div className="flex items-center space-x-2 text-red-400 text-xs font-serif font-bold">
                  <Swords className="w-4 h-4" />
                  <span>Narrow Gate Sudden Death Standoff</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                  <select
                    value={sdTeamA}
                    onChange={(e) => setSdTeamA(e.target.value)}
                    className="w-full bg-[#10121a] border border-[#2a2e3d] rounded-lg p-2 text-[#f4f0e8] outline-none"
                  >
                    <option value="">-- Contender Crew A --</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id} disabled={t.id === sdTeamB}>{t.name}</option>
                    ))}
                  </select>
                  <select
                    value={sdTeamB}
                    onChange={(e) => setSdTeamB(e.target.value)}
                    className="w-full bg-[#10121a] border border-[#2a2e3d] rounded-lg p-2 text-[#f4f0e8] outline-none"
                  >
                    <option value="">-- Contender Crew B --</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id} disabled={t.id === sdTeamA}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleR3TriggerSuddenDeath}
                  disabled={!sdTeamA || !sdTeamB || sdTeamA === sdTeamB}
                  className="w-full py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-mono font-bold text-xs rounded-lg transition-all disabled:opacity-40"
                >
                  ⚡ Trigger Sudden Death Standoff
                </button>
              </div>

              {/* Conclude to Ceremony */}
              <button
                onClick={() => {
                  if (confirm('Conclude Round 3 and prepare Final Ceremony?')) {
                    handleStateChange('ROUND_LEADERBOARD', 2);
                  }
                }}
                className="w-full py-3 rounded-xl bg-[#161922] border border-amber-500/60 hover:bg-amber-950/40 text-amber-200 font-serif font-bold text-xs flex items-center justify-center space-x-2 transition-all"
              >
                <span>Conclude Round 3 & Prepare Ceremony ➔</span>
              </button>
            </div>
          )}

          {/* CONTEXT 5: FINAL LEADERBOARD & CEREMONY */}
          {isRoundLeaderboard && (
            <div className="bg-gradient-to-r from-[#161922] via-[#202533] to-[#161922] border border-[#c4a45a] rounded-2xl p-6 shadow-2xl space-y-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center mx-auto text-[#c4a45a] shadow-gold-glow">
                <Trophy className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-serif font-black text-[#f4f0e8] uppercase">
                  Grand Final Underworld Ceremony
                </h3>
                <p className="text-xs text-[#8e95a5] max-w-md mx-auto mt-1">
                  All rounds have concluded. All player phones are ready to receive the synchronized celebration and final podium standings.
                </p>
              </div>

              <button
                onClick={() => {
                  handleStateChange('ROUND_LEADERBOARD', 2);
                  alert('Final Leaderboard broadcast active on all screens!');
                }}
                className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#edd99e] hover:from-[#d8b86e] hover:to-[#f5e4b3] text-[#08090c] font-serif font-black text-sm shadow-gold-glow transition-all"
              >
                🏆 Broadcast Final Ceremony to Pub Phones
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: CREWS & ROSTER (PEOPLE & ATTENDEE MANAGEMENT)                  */}
      {/* ===================================================================== */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Target Crew Size Stepper at Top of Roster */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-serif font-bold text-[#f4f0e8] block">
                Target Crew Size Setting
              </span>
              <p className="text-[10px] text-[#8e95a5]">
                Determines how many seats are allocated per squad.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <div className="flex items-center bg-[#161922] border border-[#2a2e3d] rounded-xl p-1">
                <button
                  onClick={() => handleTargetCrewSizeChange(targetCrewSize - 1)}
                  disabled={targetCrewSize <= 2}
                  className="w-7 h-7 rounded-lg bg-[#10121a] text-[#f4f0e8] hover:bg-[#c4a45a] hover:text-[#08090c] font-mono font-bold flex items-center justify-center disabled:opacity-30 transition-all"
                >
                  -
                </button>
                <span className="px-3 font-mono font-bold text-xs text-[#c4a45a]">
                  {targetCrewSize} Shades
                </span>
                <button
                  onClick={() => handleTargetCrewSizeChange(targetCrewSize + 1)}
                  disabled={targetCrewSize >= 8}
                  className="w-7 h-7 rounded-lg bg-[#10121a] text-[#f4f0e8] hover:bg-[#c4a45a] hover:text-[#08090c] font-mono font-bold flex items-center justify-center disabled:opacity-30 transition-all"
                >
                  +
                </button>
              </div>

              <div className="flex items-center space-x-1 text-[10px] font-mono">
                {[3, 4, 5, 6].map(num => (
                  <button
                    key={num}
                    onClick={() => handleTargetCrewSizeChange(num)}
                    className={`w-6 h-6 rounded-lg transition-all ${
                      targetCrewSize === num
                        ? 'bg-[#c4a45a] text-[#08090c] font-bold shadow-gold-glow'
                        : 'bg-[#161922] border border-[#2a2e3d] text-[#8e95a5] hover:text-[#f4f0e8]'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Formed Crews Directory */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase text-[#c4a45a] font-bold tracking-wider">
                  Squads Directory
                </span>
                <h3 className="text-base font-serif font-black text-[#f4f0e8]">
                  Formed Crews & Slot Management ({teams.length})
                </h3>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setExpandedCrewIds(new Set(teams.map(t => t.id)))}
                  className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] hover:border-[#8e95a5] text-[10px] font-mono text-[#8e95a5]"
                >
                  Expand All
                </button>
                <button
                  onClick={() => setExpandedCrewIds(new Set())}
                  className="px-2.5 py-1 rounded-lg bg-[#161922] border border-[#2a2e3d] hover:border-[#8e95a5] text-[10px] font-mono text-[#8e95a5]"
                >
                  Collapse All
                </button>
              </div>
            </div>

            {/* Fast Crew Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 text-[#8e95a5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={crewSearch}
                onChange={(e) => setCrewSearch(e.target.value)}
                placeholder="Search crews by name, battle code (e.g. 49), or player name..."
                className="w-full bg-[#161922] border border-[#2a2e3d] rounded-xl pl-9 pr-8 py-2.5 text-xs text-[#f4f0e8] placeholder-[#8e95a5]/60 outline-none focus:border-[#c4a45a] font-mono"
              />
              {crewSearch && (
                <button
                  onClick={() => setCrewSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8e95a5] hover:text-[#f4f0e8]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Crew Cards */}
            <div className="space-y-3">
              {teams
                .filter(t => {
                  if (!crewSearch.trim()) return true;
                  const q = crewSearch.toLowerCase().trim();
                  return (
                    t.name.toLowerCase().includes(q) ||
                    (t.battle_code || '').toLowerCase().includes(q) ||
                    t.members.some(m => m.name.toLowerCase().includes(q) || m.roleName.toLowerCase().includes(q))
                  );
                })
                .map((t) => {
                  const isExpanded = expandedCrewIds.has(t.id);
                  const isFull = t.members.length >= targetCrewSize;
                  const moral = evaluateTeamRound2MoralStatus(t.id, round2Matches, teams);

                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-[#2a2e3d] bg-[#161922] overflow-hidden transition-all"
                    >
                      {/* Crew Header */}
                      <div className="p-3 flex items-center justify-between gap-2 hover:bg-[#1f2330] transition-colors">
                        <div
                          onClick={() => toggleCrewExpand(t.id)}
                          className="flex items-center space-x-2.5 flex-1 min-w-0 cursor-pointer"
                        >
                          <span className="font-mono font-bold text-xs text-[#c4a45a]">
                            [{t.battle_code || '--'}]
                          </span>

                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#10121a] text-[#c4a45a] border border-[#2a2e3d]">
                            {t.score || 0} pts
                          </span>

                          {renderMoralBadge(moral)}

                          {editingCrewId === t.id ? (
                            <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editingCrewName}
                                onChange={(e) => setEditingCrewName(e.target.value)}
                                className="bg-[#10121a] border border-[#c4a45a] rounded px-2 py-0.5 text-xs text-[#f4f0e8] font-serif font-bold outline-none"
                              />
                              <button
                                onClick={() => handleRenameTeam(t.id)}
                                className="p-1 rounded bg-[#c4a45a] text-[#08090c]"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setEditingCrewId(null)}
                                className="p-1 rounded bg-[#10121a] text-[#8e95a5]"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <h4 className="text-xs font-serif font-bold text-[#f4f0e8] truncate">
                              {t.name}
                            </h4>
                          )}

                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            isFull
                              ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                              : 'bg-amber-950/60 border border-amber-500/40 text-amber-300'
                          }`}>
                            {t.members.length}/{targetCrewSize} Seats
                          </span>
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          <button
                            onClick={() => {
                              setEditingCrewId(t.id);
                              setEditingCrewName(t.name);
                            }}
                            className="p-1 rounded bg-[#10121a] border border-[#2a2e3d] hover:border-[#c4a45a] text-[#8e95a5] hover:text-[#f4f0e8]"
                            title="Rename crew"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>

                          <button
                            onClick={() => handleDeleteTeam(t.id, t.name)}
                            className="p-1 rounded bg-red-950/30 border border-red-500/30 hover:bg-red-900/60 text-red-300"
                            title="Disband crew and move members to lobby"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>

                          <button
                            onClick={() => toggleCrewExpand(t.id)}
                            className="p-1 text-[#8e95a5]"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded Member List & Slot Filling */}
                      {isExpanded && (
                        <div className="p-3 pt-0 border-t border-[#2a2e3d]/60 space-y-2 bg-[#12151e]">
                          <span className="text-[10px] font-mono text-[#8e95a5] block pt-2">
                            Assigned Members ({t.members.length}):
                          </span>

                          <div className="space-y-1.5">
                            {t.members.map((m, mIdx) => {
                              const mRoleId = roles.find(r => r.name.toLowerCase() === (m.roleName || '').toLowerCase())?.id || '';
                              return (
                                <div
                                  key={m.id || mIdx}
                                  className="p-2 rounded-lg bg-[#161922] border border-[#2a2e3d] flex items-center justify-between text-xs font-mono"
                                >
                                  <div className="flex items-center space-x-2">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: m.roleColor || '#c4a45a' }}
                                    />
                                    <span className="text-[#f4f0e8] font-bold">{m.name}</span>
                                    <span className="text-[10px] text-[#8e95a5]">({m.roleName || 'No Role'})</span>
                                  </div>

                                  <div className="flex items-center space-x-1.5">
                                    {m.id && (
                                      <>
                                        {/* Role Switcher */}
                                        <select
                                          value={mRoleId}
                                          onChange={(e) => handleRoleChange(m.id!, e.target.value)}
                                          className="bg-[#10121a] border border-[#2a2e3d] text-[10px] text-[#8e95a5] rounded px-1.5 py-0.5 outline-none"
                                        >
                                          {roles.map(r => (
                                            <option key={r.id} value={r.id}>{r.name}</option>
                                          ))}
                                        </select>

                                        {/* Eject from Crew (Frees slot!) */}
                                        <button
                                          onClick={() => handleMovePlayer(m.id!, null)}
                                          className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/40 hover:bg-amber-900 text-amber-200 text-[10px] font-bold transition-all"
                                          title="Eject player back to unassigned lobby (frees their seat)"
                                        >
                                          ⏏️ Eject
                                        </button>

                                        {/* Remove Player Permanently */}
                                        <button
                                          onClick={() => handleRemovePlayer(m.id!)}
                                          className="p-1 rounded bg-red-950/40 border border-red-500/30 hover:bg-red-900 text-red-300"
                                          title="Permanently remove player from game"
                                        >
                                          <UserX className="w-3 h-3" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Empty Slot Dropdown (Add unassigned player directly into this crew!) */}
                          {unassigned.length > 0 && (
                            <div className="pt-2 border-t border-[#2a2e3d]/40 flex items-center space-x-2">
                              <span className="text-[10px] font-mono text-[#c4a45a] font-bold shrink-0">
                                + Fill Seat:
                              </span>
                              <select
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleMovePlayer(e.target.value, t.id);
                                    e.target.value = '';
                                  }
                                }}
                                defaultValue=""
                                className="flex-1 bg-[#10121a] border border-[#c4a45a]/50 text-xs text-[#f4f0e8] rounded-lg px-2 py-1 outline-none font-mono"
                              >
                                <option value="" disabled>-- Select an unassigned shade to seat here --</option>
                                {unassigned.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.roleName || 'No Role'})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Unassigned Shades Lobby Pool */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d] pb-2">
              <div>
                <span className="text-[10px] font-mono uppercase text-[#c4a45a] font-bold tracking-wider">
                  Unassigned Shades Pool
                </span>
                <h4 className="text-xs font-serif font-bold text-[#f4f0e8]">
                  Players in Lobby Waiting for Teams ({unassigned.length})
                </h4>
              </div>

              {unassigned.length > 0 && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleAutoGroup}
                    className="px-2.5 py-1 bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] rounded-lg text-[10px] font-mono font-bold shadow-sm"
                  >
                    ⚡ Auto-Group into Crews
                  </button>
                  <button
                    onClick={handleRebalanceRoles}
                    className="px-2.5 py-1 bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-[#8e95a5] hover:text-[#f4f0e8] rounded-lg text-[10px] font-mono"
                  >
                    ⚖️ Auto-Balance Roles
                  </button>
                </div>
              )}
            </div>

            {unassigned.length === 0 ? (
              <div className="p-6 text-center text-xs font-mono text-[#8e95a5]">
                ✓ All attendees are currently seated in active crews!
              </div>
            ) : (
              <div className="space-y-1.5">
                {unassigned.map(p => (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-xl bg-[#161922] border border-[#2a2e3d] flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: p.roleColor || '#c4a45a' }}
                      />
                      <span className="text-[#f4f0e8] font-bold">{p.name}</span>
                      <span className="text-[10px] text-[#8e95a5]">({p.roleName || 'No Role'})</span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {/* Place into crew dropdown */}
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            handleMovePlayer(p.id, e.target.value);
                          }
                        }}
                        defaultValue=""
                        className="bg-[#10121a] border border-[#2a2e3d] text-[10px] text-[#f4f0e8] rounded-lg px-2 py-1 outline-none"
                      >
                        <option value="" disabled>Seat in Crew...</option>
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.members.length}/{targetCrewSize})
                          </option>
                        ))}
                      </select>

                      {/* Change role */}
                      <select
                        value={p.roleId || ''}
                        onChange={(e) => handleRoleChange(p.id, e.target.value)}
                        className="bg-[#10121a] border border-[#2a2e3d] text-[10px] text-[#8e95a5] rounded-lg px-2 py-1 outline-none"
                      >
                        {roles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>

                      {/* Delete */}
                      <button
                        onClick={() => handleRemovePlayer(p.id)}
                        className="p-1 rounded bg-red-950/40 border border-red-500/30 hover:bg-red-900 text-red-300"
                        title="Remove player"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Offline Player Form */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Add Offline Player Manually
            </span>
            <form onSubmit={handleAddPlayer} className="flex items-center space-x-2">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Walk-in player name..."
                className="flex-1 bg-[#161922] border border-[#2a2e3d] rounded-xl px-3 py-2 text-xs text-[#f4f0e8] outline-none font-mono"
              />
              <select
                value={newPlayerRoleId}
                onChange={(e) => setNewPlayerRoleId(e.target.value)}
                className="bg-[#161922] border border-[#2a2e3d] rounded-xl px-2 py-2 text-xs text-[#f4f0e8] outline-none font-mono"
              >
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button
                type="submit"
                className="px-4 py-2 bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c] font-bold text-xs rounded-xl font-serif shadow-gold-glow transition-all"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: LARGE JOIN QR CODE FOR THE PUB ROOM                           */}
      {/* ===================================================================== */}
      {showQrModal && (
        <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#c4a45a] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-center relative">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-[#8e95a5] hover:text-[#f4f0e8] hover:bg-[#161922]"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-base font-serif font-black text-[#f4f0e8] uppercase">
                Scan to Enter Tartarus
              </h3>
              <p className="text-xs text-[#8e95a5]">
                Hold this up or display it to the room to let players join on their phones.
              </p>
            </div>

            {/* QR Image */}
            <div className="bg-white p-4 rounded-2xl inline-block shadow-gold-glow">
              {serverInfo?.qrDataUrl ? (
                <img
                  src={serverInfo.qrDataUrl}
                  alt="Join QR"
                  className="w-64 h-64 object-contain mx-auto"
                />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center text-black font-mono text-xs">
                  Generating QR Code...
                </div>
              )}
            </div>

            {/* URL Display & Copy */}
            <div className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between text-xs font-mono">
              <span className="text-[#c4a45a] truncate mr-2">
                {serverInfo?.joinUrl || window.location.origin + '/join'}
              </span>
              <button
                onClick={handleCopyJoinLink}
                className="px-3 py-1.5 rounded-lg bg-[#c4a45a] text-[#08090c] font-bold text-xs flex items-center space-x-1 shrink-0"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: PRIVATE ADMIN-ONLY STANDINGS PREVIEW                         */}
      {/* ===================================================================== */}
      {showAdminLeaderboard && (
        <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#c4a45a]/50 rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#2a2e3d] flex items-center justify-between bg-[#161922]">
              <div className="flex items-center space-x-2">
                <Trophy className="w-5 h-5 text-[#c4a45a]" />
                <div>
                  <h3 className="text-sm font-serif font-black text-[#f4f0e8] uppercase">
                    Live Standings (Admin Private Preview)
                  </h3>
                  <span className="text-[10px] font-mono text-[#8e95a5]">
                    Private view only • Zero effect on player screens
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowAdminLeaderboard(false)}
                className="p-1.5 rounded-lg hover:bg-[#202533] text-[#8e95a5] hover:text-[#f4f0e8]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {teams.length > 0 ? (
                teams.map((t, idx) => (
                  <div
                    key={t.id}
                    className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                        idx === 0
                          ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
                          : idx === 1
                          ? 'bg-slate-300 text-[#08090c]'
                          : idx === 2
                          ? 'bg-amber-800 text-amber-200'
                          : 'bg-[#10121a] text-[#8e95a5] border border-[#2a2e3d]'
                      }`}>
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="text-xs font-serif font-bold text-[#f4f0e8] flex items-center space-x-1.5">
                          <span>{t.name}</span>
                          {t.battle_code && (
                            <span className="text-[10px] font-mono text-[#c4a45a]">[{t.battle_code}]</span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#8e95a5]">
                          {t.members.length} shades • {t.members.map(m => m.name).join(', ')}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-mono font-bold text-[#c4a45a] block">
                        {t.score} PTS
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs font-mono text-[#8e95a5]">
                  No teams registered yet.
                </div>
              )}
            </div>

            <div className="p-3 border-t border-[#2a2e3d] bg-[#161922] flex justify-end">
              <button
                onClick={() => setShowAdminLeaderboard(false)}
                className="px-4 py-1.5 rounded-lg bg-[#c4a45a] text-[#08090c] text-xs font-mono font-bold hover:bg-[#d8b86e] transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: HARD RESET GAME SAFETY CONFIRMATION                           */}
      {/* ===================================================================== */}
      {showResetModal && (
        <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-red-500/60 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-red-950/60 border border-red-500/50 flex items-center justify-center mx-auto text-red-400">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-serif font-black text-red-300 uppercase">
                Reset Entire Session?
              </h3>
              <p className="text-xs text-[#8e95a5] leading-relaxed">
                This will clear all formed crews, match pairings, player votes, and reset all team scores back to 0. All connected phones return to the lobby.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => setShowResetModal(false)}
                className="py-2.5 rounded-xl bg-[#161922] border border-[#2a2e3d] text-xs font-mono text-[#8e95a5] hover:text-[#f4f0e8]"
              >
                Cancel
              </button>
              <button
                onClick={handleResetGame}
                disabled={isResetting}
                className="py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-xs shadow-md transition-all flex items-center justify-center space-x-1"
              >
                {isResetting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isResetting ? 'Resetting...' : 'Yes, Reset All'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
