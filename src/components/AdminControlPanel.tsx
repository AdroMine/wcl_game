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
  adminAdjustTeamScore,
  adminUpdateConfig,
  adminResetGame,
  adminDeleteTeam,
  adminAutoGroup,
  adminSpawnDemoCrew,
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
  adminRound3SaveConfig,
  adminRound3ResetSession,
} from '../lib/api';
import type { SyncPayload, GameConfig, Round3Config } from '../types';
import {
  ShieldAlert,
  Play,
  Pause,
  Clock,
  Users,
  Sliders,
  QrCode,
  UserX,
  Lock,
  Trash2,
  RotateCcw,
  Swords,
  FastForward,
  Save,
  RefreshCw,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Flame,
  Search,
  Trophy,
  Sparkles,
  X,
  Anchor,
} from 'lucide-react';
import { parseTabletCodeword, TABLET_CONFIG, getSlotPositionLabel, getTabletTextMetrics } from '../lib/tabletEngine';

interface AdminProps {
  payload: SyncPayload | null;
  onClose?: () => void;
}

export const AdminControlPanel: React.FC<AdminProps> = ({ payload, onClose }) => {
  const { refresh, switchPlayer } = useGameSession();
  const [passcode, setPasscode] = useState(() => localStorage.getItem('underworld_admin_pass') || 'underworld');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'controller' | 'round2' | 'round3' | 'roster' | 'config' | 'qr'>('controller');

  // Server info & QR
  const [serverInfo, setServerInfo] = useState<{ localIp: string; joinUrl: string; qrDataUrl: string | null } | null>(null);

  // Add player form
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerRoleId, setNewPlayerRoleId] = useState('navigator');

  // Config editor state
  const [editableConfig, setEditableConfig] = useState<GameConfig | null>(null);
  const [configSaved, setConfigSaved] = useState(false);

  // Round 2 manual pairing state
  const [manualTeamA, setManualTeamA] = useState('');
  const [manualTeamB, setManualTeamB] = useState('');
  const [r2Msg, setR2Msg] = useState<string | null>(null);

  const [showManualPairing, setShowManualPairing] = useState(false);

  // Round 3 state
  const [r3Msg, setR3Msg] = useState<string | null>(null);
  const [sdTeamA, setSdTeamA] = useState('');
  const [sdTeamB, setSdTeamB] = useState('');
  const [editableR3Config, setEditableR3Config] = useState<Round3Config | null>(null);

  // Private Admin-Only Live Leaderboard modal state
  const [showAdminLeaderboard, setShowAdminLeaderboard] = useState(false);

  // Tab 3: Roster search and collapsible crew directory
  const [isFormedCrewsOpen, setIsFormedCrewsOpen] = useState(true);
  const [crewSearch, setCrewSearch] = useState('');
  const [expandedCrewIds, setExpandedCrewIds] = useState<Set<string>>(new Set());

  const toggleCrewExpand = (teamId: string) => {
    setExpandedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // Collapsible config accordion sections (All round configs in one tab)
  const [openSections, setOpenSections] = useState({
    session: false,
    round1: true,
    round2: false,
    round3: false,
    danger: false,
  });

  const toggleSection = (key: 'session' | 'round1' | 'round2' | 'round3' | 'danger') => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Round 1 interactive previewer state
  const [previewWord, setPreviewWord] = useState('CRIMSON SHADOW');

  // Universal Time Adjust (Adjusts global round timer AND active Round 2 matches simultaneously)
  const handleUniversalTimeAdjust = async (deltaSeconds: number) => {
    await Promise.all([
      adminAdjustTimer(passcode, 'adjust', deltaSeconds),
      adminRound2AdjustTimer(passcode, deltaSeconds),
      adminRound3AdjustTimer(passcode, deltaSeconds),
    ]);
    await refresh();
  };

  useEffect(() => {
    if (payload?.config) {
      setEditableConfig(JSON.parse(JSON.stringify(payload.config)));
      if (payload.config.round3) {
        setEditableR3Config(JSON.parse(JSON.stringify(payload.config.round3)));
      }
    }
  }, [payload?.config]);

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
      setAuthError('Invalid Admin Passcode. Default is "underworld".');
    }
  };

  const handleTimePause = async () => {
    await adminAdjustTimer(passcode, 'pause');
    await refresh();
  };

  // State changes
  const handleStateChange = async (state: any, roundIndex?: number) => {
    await adminSetState(passcode, state, roundIndex);
    await refresh();
  };

  // Score adjust
  const handleScoreChange = async (teamId: string, delta: number) => {
    await adminAdjustTeamScore(passcode, teamId, delta);
    await refresh();
  };

  // Player role change
  const handleRoleChange = async (playerId: string, roleId: string) => {
    await adminChangeRole(passcode, playerId, roleId);
    await refresh();
  };

  // Move player team
  const handleTeamChange = async (playerId: string, targetTeamId: string | null) => {
    await adminMovePlayerTeam(passcode, playerId, targetTeamId);
    await refresh();
  };

  // Remove player
  const handleRemovePlayer = async (playerId: string) => {
    if (confirm('Are you sure you want to remove this player from the game?')) {
      await adminRemovePlayer(passcode, playerId);
      await refresh();
    }
  };

  // Add player
  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    await adminAddPlayer(passcode, newPlayerName.trim(), newPlayerRoleId);
    setNewPlayerName('');
    await refresh();
  };

  // Save config
  const handleSaveConfig = async () => {
    if (!editableConfig) return;
    await adminUpdateConfig(passcode, editableConfig);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
    await refresh();
  };

  const [isResetting, setIsResetting] = useState(false);
  const handleResetGame = async () => {
    if (confirm('CRITICAL ACTION: Reset all players, teams, and scores? This will completely clear the game and reset to the Lobby.')) {
      try {
        setIsResetting(true);
        const res = await adminResetGame(passcode);
        if (res && !res.success && res.error) {
          alert(`Reset failed: ${res.error}\n\nTip: Run the Supabase SQL script to ensure DELETE permissions are enabled.`);
        }
        await refresh();
      } finally {
        setIsResetting(false);
      }
    }
  };

  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    if (confirm(`Disband "${teamName}"? All crew members will be moved back to the unassigned lobby.`)) {
      const res = await adminDeleteTeam(passcode, teamId);
      if (res && !res.success && res.error) {
        alert(`Failed to delete team: ${res.error}\n\nTip: Run the Supabase SQL script to enable DELETE permissions on teams.`);
      }
      await refresh();
    }
  };

  const [isSpawningDemo, setIsSpawningDemo] = useState(false);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const handleSpawnDemoCrew = async () => {
    try {
      setIsSpawningDemo(true);
      const res = await adminSpawnDemoCrew(passcode);
      if (res?.success) {
        setDemoNotice(`✓ Summoned ${res.team?.name || 'new 5-shade crew'}!`);
      } else if (res?.error) {
        setDemoNotice(`⚠️ ${res.error}`);
      } else {
        setDemoNotice('✓ 5-shade crew created!');
      }
      setTimeout(() => setDemoNotice(null), 4000);
      await refresh();
    } catch (e: any) {
      setDemoNotice(`⚠️ Spawn failed: ${e?.message || e}`);
      setTimeout(() => setDemoNotice(null), 4000);
    } finally {
      setIsSpawningDemo(false);
    }
  };

  const [isRebalancing, setIsRebalancing] = useState(false);
  const handleRebalanceRoles = async () => {
    try {
      setIsRebalancing(true);
      const res = await adminRebalanceUnassignedRoles(passcode);
      if (res?.success) {
        setDemoNotice(`✓ Rebalanced roles across ${res.count} unassigned shades!`);
        setTimeout(() => setDemoNotice(null), 4000);
      }
      await refresh();
    } finally {
      setIsRebalancing(false);
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
    }
    setTimeout(() => setR2Msg(null), 4000);
    await refresh();
  };

  const handleR2ResetMatches = async () => {
    if (confirm('Reset all Round 2 matches, clash records, and nemesis markings?')) {
      await adminRound2ResetMatches(passcode);
      await refresh();
    }
  };

  // Round 3 Handlers
  const handleR3AdjustTimer = async (delta: number) => {
    await adminRound3AdjustTimer(passcode, delta);
    await refresh();
    setR3Msg(`Adjusted Round 3 wave timer by +${delta}s`);
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3NextPhase = async () => {
    await adminRound3NextPhase(passcode);
    await refresh();
    setR3Msg('Advanced Round 3 to next phase');
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3ForceWave = async () => {
    await adminRound3ForceNextWave(passcode);
    await refresh();
    setR3Msg('Forced Round 3 to next wave');
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3AdjustDistance = async (teamId: string, deltaMeters: number) => {
    await adminRound3AdjustDistance(passcode, teamId, deltaMeters);
    await refresh();
    setR3Msg(`Adjusted team distance by ${deltaMeters >= 0 ? `+${deltaMeters}` : deltaMeters}m`);
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3TriggerSuddenDeath = async () => {
    if (!sdTeamA || !sdTeamB) return;
    const res = await adminRound3TriggerSuddenDeath(passcode, sdTeamA, sdTeamB);
    if (res.error) {
      setR3Msg(`Sudden death error: ${res.error}`);
    } else {
      setR3Msg('⚡ Sudden Death Standoff activated between contenders!');
    }
    setTimeout(() => setR3Msg(null), 4000);
    await refresh();
  };

  const handleR3SaveConfig = async () => {
    if (!editableR3Config) return;
    await adminRound3SaveConfig(passcode, editableR3Config);
    await refresh();
    setR3Msg('Round 3 Congestion settings saved');
    setTimeout(() => setR3Msg(null), 4000);
  };

  const handleR3ResetSession = async () => {
    if (confirm('Reset Round 3 Escape Royale session and all fleet records?')) {
      await adminRound3ResetSession(passcode);
      await refresh();
      setR3Msg('Round 3 session reset');
      setTimeout(() => setR3Msg(null), 4000);
    }
  };

  // Passcode Gate View
  if (!isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-6 shadow-2xl space-y-5">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-amber-950/60 border border-[#c4a45a]/50 text-[#c4a45a] flex items-center justify-center mx-auto shadow-gold-glow">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-serif font-black text-[#f4f0e8] uppercase">
              Underworld Game Master Panel
            </h2>
            <p className="text-xs text-[#8e95a5]">
              Enter the administrator passcode to access game controls.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode (default: underworld)"
                className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-xl px-4 py-3 text-sm text-[#f4f0e8] outline-none text-center font-mono"
              />
            </div>

            {authError && (
              <p className="text-xs text-red-400 text-center">{authError}</p>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-bold text-sm tracking-wide shadow-gold-glow"
            >
              Authenticate Game Master
            </button>
          </form>

          {onClose && (
            <button
              onClick={onClose}
              className="w-full py-2 text-xs text-[#8e95a5] hover:text-[#f4f0e8]"
            >
              ← Back to Player View
            </button>
          )}
        </div>
      </div>
    );
  }

  const rounds = payload?.config.rounds || [];
  const roles = payload?.config.roles || [];
  const teams = payload?.teams_leaderboard || [];
  const unassigned = payload?.unassigned_players || [];
  const round2Matches = payload?.round2_all_matches || [];

  const getTeamName = (teamId: string) => {
    const t = teams.find(team => team.id === teamId);
    return t ? t.name : teamId;
  };

  const getTeamBattleCode = (teamId: string) => {
    const t = teams.find(team => team.id === teamId);
    return t?.battle_code || '--';
  };

  const pairedTeamIds = new Set<string>();
  round2Matches.forEach(m => {
    if (!m.completed) {
      pairedTeamIds.add(m.team_a_id);
      pairedTeamIds.add(m.team_b_id);
    }
  });
  const unpairedTeams = teams.filter(t => !pairedTeamIds.has(t.id));

  return (
    <div className="space-y-5 py-4">
      {/* Admin Header */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center text-[#c4a45a]">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-serif font-black text-[#f4f0e8] uppercase">
              Game Master Control Panel
            </h2>
            <span className="text-[10px] font-mono text-emerald-400">
              ● Connected • State: {payload?.state}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowAdminLeaderboard(true)}
            className="px-3 py-1.5 rounded-lg border border-[#c4a45a]/50 bg-[#c4a45a]/10 hover:bg-[#c4a45a] hover:text-[#08090c] text-xs font-mono font-bold text-[#c4a45a] flex items-center space-x-1.5 transition-all shadow-sm"
            title="Inspect current team standings privately (does not affect player screens)"
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>📊 Live Standings</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-[#2a2e3d] bg-[#161922] text-xs font-mono text-[#8e95a5] hover:text-[#f4f0e8]"
            >
              Exit Admin
            </button>
          )}
        </div>
      </div>

      {/* Private Admin-Only Live Leaderboard Drawer / Modal */}
      {showAdminLeaderboard && (
        <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#c4a45a]/50 rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#2a2e3d] flex items-center justify-between bg-[#161922]">
              <div className="flex items-center space-x-2">
                <Trophy className="w-5 h-5 text-[#c4a45a]" />
                <div>
                  <h3 className="text-sm font-serif font-black text-[#f4f0e8] uppercase">
                    Live Leaderboard (Admin Private Preview)
                  </h3>
                  <span className="text-[10px] font-mono text-[#8e95a5]">
                    Private view only • Zero effect on player screens
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowAdminLeaderboard(false)}
                className="p-1.5 rounded-lg hover:bg-[#202533] text-[#8e95a5] hover:text-[#f4f0e8] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {payload?.teams_leaderboard && payload.teams_leaderboard.length > 0 ? (
                payload.teams_leaderboard.map((t, idx) => (
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

      {/* Universal Live Timer Controls (Applies to all active rounds & clash phases across all tabs) */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e3d]/60 pb-2.5">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-[#c4a45a]" />
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                Universal Live Timer Control
              </span>
              <div className="text-xs font-mono text-[#f4f0e8] flex items-center space-x-2">
                <span>
                  {payload?.state === 'ROUND_ACTIVE' ? (
                    <>
                      <span className="text-emerald-400 font-bold">● ACTIVE:</span>{' '}
                      {rounds[payload.current_round_index]?.title || `Round ${payload.current_round_index + 1}`}
                      {payload.round_ends_at && (
                        <span className="ml-1 text-[#c4a45a] font-bold">
                          ({Math.max(0, Math.floor((payload.round_ends_at - (payload.server_now || Date.now())) / 1000))}s left)
                        </span>
                      )}
                    </>
                  ) : payload?.state === 'LOBBY_TEAM_FORMATION' ? (
                    <span className="text-[#8e95a5]">Lobby: Team Formation</span>
                  ) : payload?.state === 'ROUND_LEADERBOARD' ? (
                    <span className="text-amber-400">Round Leaderboard & Intermission</span>
                  ) : (
                    <span className="text-[#8e95a5]">Awaiting Round</span>
                  )}
                </span>
                {round2Matches.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950/60 border border-rose-500/40 text-rose-300">
                    {round2Matches.filter(m => !m.completed).length} R2 Clash Matches Active
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={handleTimePause}
              disabled={payload?.state !== 'ROUND_ACTIVE'}
              className="px-3 py-1.5 rounded-lg border border-[#2a2e3d] bg-[#161922] text-xs font-mono text-[#f4f0e8] hover:border-[#c4a45a] flex items-center space-x-1 disabled:opacity-40 transition-all"
            >
              {payload?.round_is_paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
              <span>{payload?.round_is_paused ? 'Resume Timer' : 'Pause Timer'}</span>
            </button>

            {round2Matches.some(m => !m.completed) && (
              <button
                onClick={() => handleR2SkipPhase()}
                className="px-2.5 py-1.5 rounded-lg bg-[#c4a45a]/20 border border-[#c4a45a] text-[#c4a45a] text-xs font-mono font-bold hover:bg-[#c4a45a] hover:text-[#08090c] flex items-center space-x-1 transition-all"
                title="Skip current clash phase on all active Round 2 matches"
              >
                <FastForward className="w-3.5 h-3.5" />
                <span>Skip Phase</span>
              </button>
            )}
          </div>
        </div>

        {/* Instant Universal Time Shift Buttons */}
        <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
          <button
            onClick={() => handleUniversalTimeAdjust(15)}
            className="py-2 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
          >
            +15s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(30)}
            className="py-2 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
          >
            +30s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(60)}
            className="py-2 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
          >
            +1 Min
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(120)}
            className="py-2 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
          >
            +2 Min
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(-15)}
            className="py-2 rounded-xl bg-[#161922] border border-red-500/40 hover:bg-red-950/40 text-red-300 font-mono font-bold text-xs shadow-sm transition-all"
          >
            -15s
          </button>
          <button
            onClick={() => handleUniversalTimeAdjust(-60)}
            className="py-2 rounded-xl bg-[#161922] border border-red-500/40 hover:bg-red-950/40 text-red-300 font-mono font-bold text-xs shadow-sm transition-all"
          >
            -1 Min
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-6 gap-1 bg-[#10121a] border border-[#2a2e3d] p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('controller')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'controller'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Main</span>
        </button>
        <button
          onClick={() => setActiveTab('round2')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'round2'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Clash Arena</span>
        </button>
        <button
          onClick={() => setActiveTab('round3')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'round3'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Anchor className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Escape Royale</span>
        </button>
        <button
          onClick={() => setActiveTab('roster')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'roster'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Roster</span>
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'config'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Game Config</span>
        </button>
        <button
          onClick={() => setActiveTab('qr')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'qr'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Join QR</span>
        </button>
      </div>

      {/* TAB 1: ROUND & TIMER CONTROLLER */}
      {activeTab === 'controller' && (
        <div className="space-y-4">
          {/* Round State Selector */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Global Game State Switcher
            </span>
            <div>
              <button
                onClick={() => handleStateChange('LOBBY_TEAM_FORMATION')}
                className={`w-full p-3 rounded-xl border text-xs font-mono font-bold transition-all ${
                  payload?.state === 'LOBBY_TEAM_FORMATION'
                    ? 'bg-[#c4a45a] text-[#08090c] border-[#c4a45a] shadow-gold-glow'
                    : 'bg-[#161922] text-[#8e95a5] border-[#2a2e3d] hover:text-[#f4f0e8]'
                }`}
              >
                1. Team Formation Lobby
              </button>
            </div>

            <div className="pt-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] mb-2 block">
                Start Specific Round
              </span>
              <div className="space-y-2">
                {rounds.map((r, idx) => {
                  const isActiveRound = payload?.state === 'ROUND_ACTIVE' && payload.current_round_index === idx;
                  return (
                    <div
                      key={r.id}
                      className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        isActiveRound
                          ? 'bg-[#161922] border-[#c4a45a] shadow-beacon'
                          : 'bg-[#161922]/50 border-[#2a2e3d]'
                      }`}
                      style={isActiveRound ? ({ '--beacon-glow': 'rgba(196, 164, 90, 0.3)' } as React.CSSProperties) : undefined}
                    >
                      <div>
                        <div className="text-xs font-serif font-bold text-[#f4f0e8]">{r.title}</div>
                        <span className="text-[10px] font-mono text-[#8e95a5]">
                          Type: {r.type} • {r.durationSeconds}s
                        </span>
                      </div>
                      <button
                        onClick={() => handleStateChange('ROUND_ACTIVE', idx)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold ${
                          isActiveRound
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c]'
                        }`}
                      >
                        {isActiveRound ? 'Active' : 'Launch Round'}
                      </button>
                    </div>
                  );
                })}

                {/* Broadcast Final Pub Leaderboard (Only unlocks once all rounds finish) */}
                {(() => {
                  const lastRoundIdx = rounds.length - 1;
                  const isLastRound = (payload?.current_round_index ?? 0) >= lastRoundIdx;
                  const isTimerExpired = payload?.round_ends_at ? Date.now() >= payload.round_ends_at : false;
                  const isRoundLeaderboard = payload?.state === 'ROUND_LEADERBOARD';
                  const allRoundsFinished = isLastRound && (isTimerExpired || isRoundLeaderboard || payload?.state !== 'ROUND_ACTIVE');

                  return (
                    <div className={`p-3.5 rounded-xl border transition-all mt-3 ${
                      isRoundLeaderboard
                        ? 'bg-purple-950/40 border-purple-500/60 shadow-xl'
                        : allRoundsFinished
                        ? 'bg-[#161922] border-[#c4a45a] shadow-gold-glow'
                        : 'bg-[#161922]/30 border-[#2a2e3d] opacity-50'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <Trophy className="w-4 h-4 text-[#c4a45a]" />
                            <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                              Final Pub Leaderboard & Ceremony
                            </span>
                          </div>
                          <p className="text-[10px] text-[#8e95a5] mt-0.5">
                            {allRoundsFinished
                              ? 'All 3 rounds concluded. Ready to broadcast final ceremony to all player phones.'
                              : `Locked • Unlocks automatically once Round ${rounds.length} (final round) concludes.`}
                          </p>
                        </div>

                        <button
                          disabled={!allRoundsFinished}
                          onClick={() => {
                            if (confirm('Broadcast the Final Leaderboard to ALL player screens in the pub?')) {
                              handleStateChange('ROUND_LEADERBOARD');
                            }
                          }}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center space-x-1.5 ${
                            isRoundLeaderboard
                              ? 'bg-purple-600 text-white shadow-sm'
                              : allRoundsFinished
                              ? 'bg-gradient-to-r from-[#c4a45a] to-[#edd99e] hover:from-[#d8b86e] hover:to-[#f5e4b3] text-[#08090c] shadow-gold-glow cursor-pointer'
                              : 'bg-[#10121a] border border-[#2a2e3d] text-[#8e95a5] cursor-not-allowed'
                          }`}
                        >
                          {allRoundsFinished ? <Sparkles className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          <span>{isRoundLeaderboard ? '🏆 Pub Ceremony Active' : allRoundsFinished ? '🏆 Broadcast to Pub' : '🔒 Locked'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Quick Manual Score Adjuster per Team */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Team Score Adjustment
            </span>
            <div className="space-y-2">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between"
                >
                  <div>
                    <h5 className="text-xs font-serif font-bold text-[#f4f0e8]">{t.name}</h5>
                    <span className="text-[10px] font-mono text-[#c4a45a]">{t.score} PTS</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleScoreChange(t.id, -25)}
                      className="px-2 py-1 rounded bg-[#10121a] border border-[#2a2e3d] hover:border-red-500 text-xs font-mono text-red-300"
                    >
                      -25
                    </button>
                    <button
                      onClick={() => handleScoreChange(t.id, 25)}
                      className="px-2 py-1 rounded bg-[#10121a] border border-[#2a2e3d] hover:border-emerald-500 text-xs font-mono text-emerald-300"
                    >
                      +25
                    </button>
                    <button
                      onClick={() => handleScoreChange(t.id, 100)}
                      className="px-2 py-1 rounded bg-[#c4a45a]/20 border border-[#c4a45a] hover:bg-[#c4a45a] hover:text-[#08090c] text-xs font-mono text-[#c4a45a] font-bold"
                    >
                      +100
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Reset Game */}
          <div className="pt-2">
            <button
              onClick={handleResetGame}
              disabled={isResetting}
              className="w-full py-2.5 rounded-xl bg-red-950/60 border border-red-500/40 hover:bg-red-900/80 text-red-200 font-mono text-xs font-bold transition-all flex items-center justify-center space-x-2"
            >
              <RotateCcw className={`w-3.5 h-3.5 text-red-400 ${isResetting ? 'animate-spin' : ''}`} />
              <span>{isResetting ? 'Resetting All Data...' : '⚠ Reset Entire Game to Lobby'}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: ROUND 2 (SHADES IN THE MIST) */}
      {activeTab === 'round2' && (
        <div className="space-y-4">
          {/* Status Alert Banner */}
          {r2Msg && (
            <div className="p-3 rounded-xl bg-[#c4a45a]/10 border border-[#c4a45a] flex items-center space-x-2 text-xs font-mono text-[#c4a45a]">
              <CheckCircle2 className="w-4 h-4 text-[#c4a45a] flex-shrink-0" />
              <span>{r2Msg}</span>
            </div>
          )}



          {/* 1. Matchmaking & Table Pairing Fallbacks */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                  Matchmaking & Table Pairing
                </span>
                <p className="text-xs text-[#8e95a5]">
                  Teams pair via their 2-digit battle codes, or you can auto/manually pair them here.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#161922] border border-[#2a2e3d] text-[#8e95a5]">
                  {round2Matches.length} matches • {unpairedTeams.length} unlinked
                </span>
              </div>
            </div>

            {/* Auto Pair Button */}
            <div className="flex items-center space-x-2">
              <button
                onClick={handleR2AutoPair}
                disabled={teams.length < 2}
                className="flex-1 py-2.5 bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#edd99e] text-[#08090c] font-serif font-bold text-xs rounded-xl shadow-gold-glow flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
              >
                <Swords className="w-4 h-4" />
                <span>⚡ Auto-Pair All Unlinked Teams ({unpairedTeams.length})</span>
              </button>
              <button
                onClick={handleR2ResetMatches}
                className="px-3 py-2.5 rounded-xl bg-red-950/40 border border-red-500/30 hover:bg-red-900/60 text-red-300 font-mono text-xs transition-colors flex items-center space-x-1"
                title="Reset all matches and pairing"
              >
                <RotateCcw className="w-3.5 h-3.5 text-red-400" />
                <span>Reset</span>
              </button>
            </div>

            {/* Collapsible Manual Dropdown Pairing */}
            <div className="border border-[#2a2e3d] rounded-xl overflow-hidden bg-[#161922]">
              <button
                type="button"
                onClick={() => setShowManualPairing(!showManualPairing)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-[#1f2330] transition-colors"
              >
                <span className="text-[10px] font-mono text-[#8e95a5] uppercase">
                  Manual Squad Dropdown Pairing {showManualPairing ? '' : '(Click to open)'}
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
                    className="w-full py-2 bg-[#161922] border border-[#c4a45a]/60 hover:bg-[#c4a45a] hover:text-[#08090c] text-[#c4a45a] text-xs font-mono font-bold rounded-lg transition-all disabled:opacity-40"
                  >
                    Link These Two Squads into Match
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 3. Live Matches Monitor */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                Live Matches ({round2Matches.length})
              </span>
              <button
                onClick={() => refresh()}
                className="text-[10px] font-mono text-[#8e95a5] hover:text-[#f4f0e8] flex items-center space-x-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>

            {round2Matches.length === 0 ? (
              <div className="p-6 text-center text-xs font-mono text-[#8e95a5] border border-dashed border-[#2a2e3d] rounded-xl">
                No active Round 2 matches. Use Auto-Pair above or have squads enter each other's 2-digit battle codes.
              </div>
            ) : (
              <div className="space-y-2.5">
                {round2Matches.map((m) => {
                  const now = payload?.server_now || Date.now();
                  const remainingSec = Math.max(0, Math.floor((m.phase_ends_at - now) / 1000));
                  const nameA = getTeamName(m.team_a_id);
                  const nameB = getTeamName(m.team_b_id);
                  const codeA = getTeamBattleCode(m.team_a_id);
                  const codeB = getTeamBattleCode(m.team_b_id);

                  return (
                    <div
                      key={m.id}
                      className="p-3.5 rounded-xl bg-[#161922] border border-[#2a2e3d] space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-serif font-bold text-[#f4f0e8]">
                            {nameA} <span className="font-mono text-[#c4a45a]">[{codeA}]</span>
                          </span>
                          <span className="text-xs font-mono text-rose-400 font-bold">VS</span>
                          <span className="text-xs font-serif font-bold text-[#f4f0e8]">
                            {nameB} <span className="font-mono text-[#c4a45a]">[{codeB}]</span>
                          </span>
                        </div>
                        {m.completed ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950/60 border border-purple-500/40 text-purple-300 font-bold">
                            MATCH COMPLETE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#c4a45a]/20 border border-[#c4a45a]/40 text-[#c4a45a] font-bold">
                            CLASH {m.current_clash} OF 3
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs font-mono bg-[#10121a] p-2 rounded-lg border border-[#2a2e3d]/60">
                        <div className="flex items-center space-x-2">
                          <span className="text-[#8e95a5]">Phase:</span>
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            m.current_phase === 'HUDDLE'
                              ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                              : m.current_phase === 'PARLEY'
                              ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/40'
                              : m.current_phase === 'VOTE'
                              ? 'bg-red-950/60 text-red-300 border border-red-500/40'
                              : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                          }`}>
                            {m.current_phase}
                          </span>
                          {!m.completed && (
                            <span className="text-[#8e95a5]">
                              Ends in: <span className="text-[#f4f0e8] font-bold">{remainingSec}s</span>
                            </span>
                          )}
                        </div>

                        {!m.completed && (
                          <button
                            onClick={() => handleR2SkipPhase(m.id)}
                            className="px-2.5 py-1 rounded bg-[#c4a45a]/10 border border-[#c4a45a]/40 hover:bg-[#c4a45a] hover:text-[#08090c] text-[#c4a45a] text-[10px] font-bold transition-all flex items-center space-x-1"
                          >
                            <FastForward className="w-3 h-3" />
                            <span>Skip Phase</span>
                          </button>
                        )}
                      </div>

                      {/* Clash Data History */}
                      {m.clash_data && m.clash_data.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[9px] font-mono text-[#8e95a5] uppercase">
                            Clash History:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            {m.clash_data.map((c) => (
                              <div
                                key={c.clash}
                                className="p-1.5 rounded bg-[#10121a] border border-[#2a2e3d] text-[10px] font-mono space-y-0.5"
                              >
                                <div className="text-[#8e95a5]">Clash {c.clash}:</div>
                                <div className="text-xs">
                                  <span className={c.team_a_stance === 'AMBUSH' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                                    {c.team_a_stance} (+{c.team_a_pts})
                                  </span>
                                  {' vs '}
                                  <span className={c.team_b_stance === 'AMBUSH' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                                    {c.team_b_stance} (+{c.team_b_pts})
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: ROUND 3 (THE ODYSSEY ESCAPE ROYALE) */}
      {activeTab === 'round3' && (
        <div className="space-y-4">
          {/* Status Alert Banner */}
          {r3Msg && (
            <div className="p-3 rounded-xl bg-[#c4a45a]/10 border border-[#c4a45a] flex items-center space-x-2 text-xs font-mono text-[#c4a45a]">
              <CheckCircle2 className="w-4 h-4 text-[#c4a45a] flex-shrink-0" />
              <span>{r3Msg}</span>
            </div>
          )}

          {/* Section 1: Live Wave Pacing Controls */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                  Round 3 Controls
                </span>
                <h3 className="text-sm font-serif font-black text-[#f4f0e8]">
                  Live Wave Pacing & Phase Controls
                </h3>
              </div>
              <div className="flex items-center space-x-2 text-xs font-mono">
                <span className="text-[#8e95a5]">
                  Wave: <strong className="text-[#f4f0e8]">{payload?.round3_session?.current_wave || 1}</strong>
                </span>
                <span className="px-2 py-0.5 rounded bg-[#161922] border border-[#2a2e3d] text-amber-400 font-bold">
                  {payload?.round3_session?.current_phase || 'BLUFF'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => handleR3AdjustTimer(15)}
                className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-xs font-mono font-bold text-[#f4f0e8] flex items-center justify-center space-x-1"
              >
                <span>+15s Wave</span>
              </button>
              <button
                onClick={() => handleR3AdjustTimer(30)}
                className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-xs font-mono font-bold text-[#f4f0e8] flex items-center justify-center space-x-1"
              >
                <span>+30s Wave</span>
              </button>
              <button
                onClick={handleR3NextPhase}
                className="p-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-xs font-mono font-bold text-[#08090c] shadow-md flex items-center justify-center space-x-1"
              >
                <FastForward className="w-3.5 h-3.5 text-[#08090c]" />
                <span>Next Phase ⏭️</span>
              </button>
              <button
                onClick={handleR3ForceWave}
                className="p-3 rounded-xl bg-[#161922] border border-sky-500/50 hover:bg-sky-950/60 text-xs font-mono font-bold text-sky-300 flex items-center justify-center space-x-1"
              >
                <span>Force Wave 🌊</span>
              </button>
            </div>
          </div>

          {/* Section 2: Fleet Distance & Escape Status Tracker */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                  Fleet Tracker
                </span>
                <h4 className="text-xs font-serif font-black text-[#f4f0e8]">
                  Live Distances & Manual Overrides
                </h4>
              </div>
              <span className="text-[10px] font-mono text-[#8e95a5]">
                Target: {payload?.config?.round3?.target_distance_meters || 1000}m
              </span>
            </div>

            <div className="space-y-2">
              {payload?.teams_leaderboard?.map((t) => {
                const state = payload?.round3_session?.team_states?.[t.id];
                const dist = state?.current_distance_meters || 0;
                const escaped = state?.has_escaped;

                return (
                  <div
                    key={t.id}
                    className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between text-xs font-mono"
                  >
                    <div>
                      <div className="font-bold text-[#f4f0e8] flex items-center space-x-1.5">
                        <span>{t.name}</span>
                        {escaped && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-400 text-[10px]">
                            {state?.escape_rank === 1 ? '🥇 GOLD' : state?.escape_rank === 2 ? '🥈 SILVER' : state?.escape_rank === 3 ? '🥉 BRONZE' : 'ESCAPED'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#8e95a5]">
                        Distance: <strong className="text-[#c4a45a]">{dist}m</strong> | Score: {t.score} pts
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
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

          {/* Section 3: Sudden Death Standoff Engine */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-red-400 font-bold">
                  Sudden Death Standoff
                </span>
                <h4 className="text-xs font-serif font-black text-[#f4f0e8]">
                  Head-to-Head Narrow Gate Duel
                </h4>
              </div>
              <span className="text-[10px] font-mono text-[#8e95a5]">
                Shields • Ram • Sails
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-mono text-[#8e95a5] block mb-1">Contender Crew A:</label>
                <select
                  value={sdTeamA}
                  onChange={(e) => setSdTeamA(e.target.value)}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-xl px-3 py-2 text-xs font-mono text-[#f4f0e8] outline-none"
                >
                  <option value="">Select Team A</option>
                  {payload?.teams_leaderboard?.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-[#8e95a5] block mb-1">Contender Crew B:</label>
                <select
                  value={sdTeamB}
                  onChange={(e) => setSdTeamB(e.target.value)}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-xl px-3 py-2 text-xs font-mono text-[#f4f0e8] outline-none"
                >
                  <option value="">Select Team B</option>
                  {payload?.teams_leaderboard?.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleR3TriggerSuddenDeath}
              disabled={!sdTeamA || !sdTeamB || sdTeamA === sdTeamB}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-mono font-bold text-xs disabled:opacity-50 transition-all flex items-center justify-center space-x-1.5"
            >
              <Swords className="w-3.5 h-3.5" />
              <span>⚡ Trigger Sudden Death Standoff</span>
            </button>
          </div>

          {/* Section 4: Dynamic Round 3 Settings Form */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-2">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                  Congestion Settings
                </span>
                <h4 className="text-xs font-serif font-black text-[#f4f0e8]">
                  Distances, Divisors & Vessel Velocities
                </h4>
              </div>
              <button
                onClick={handleR3SaveConfig}
                className="px-3 py-1.5 rounded-xl bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c] font-mono font-bold text-xs flex items-center space-x-1 transition-all"
              >
                <Save className="w-3 h-3" />
                <span>Save Settings</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Target Distance (m)</label>
                <input
                  type="number"
                  value={editableR3Config?.target_distance_meters || 1000}
                  onChange={(e) => setEditableR3Config(prev => prev ? ({ ...prev, target_distance_meters: Number(e.target.value) }) : prev)}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Headstart Divisor</label>
                <input
                  type="number"
                  value={editableR3Config?.headstart_point_divisor || 5}
                  onChange={(e) => setEditableR3Config(prev => prev ? ({ ...prev, headstart_point_divisor: Number(e.target.value) }) : prev)}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Rowboat Speed (m)</label>
                <input
                  type="number"
                  value={editableR3Config?.vessels?.ROWBOAT?.distance_success || 150}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditableR3Config(prev => prev ? ({
                      ...prev,
                      vessels: { ...prev.vessels, ROWBOAT: { ...prev.vessels.ROWBOAT, distance_success: val, distance_fail: val } }
                    }) : prev);
                  }}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Sailboat Speed (m)</label>
                <input
                  type="number"
                  value={editableR3Config?.vessels?.SAILBOAT?.distance_success || 300}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditableR3Config(prev => prev ? ({
                      ...prev,
                      vessels: { ...prev.vessels, SAILBOAT: { ...prev.vessels.SAILBOAT, distance_success: val } }
                    }) : prev);
                  }}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Sailboat Cap Ratio</label>
                <input
                  type="number"
                  step="0.05"
                  value={editableR3Config?.vessels?.SAILBOAT?.capacity_percent || 0.30}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditableR3Config(prev => prev ? ({
                      ...prev,
                      vessels: { ...prev.vessels, SAILBOAT: { ...prev.vessels.SAILBOAT, capacity_percent: val } }
                    }) : prev);
                  }}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Ghost Ship Speed (m)</label>
                <input
                  type="number"
                  value={editableR3Config?.vessels?.GHOST_SHIP?.distance_success || 450}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditableR3Config(prev => prev ? ({
                      ...prev,
                      vessels: { ...prev.vessels, GHOST_SHIP: { ...prev.vessels.GHOST_SHIP, distance_success: val } }
                    }) : prev);
                  }}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Cerberus Bonus (m)</label>
                <input
                  type="number"
                  value={editableR3Config?.vengeance?.cerberus_bonus_meters || 150}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditableR3Config(prev => prev ? ({
                      ...prev,
                      vengeance: { ...prev.vengeance, cerberus_bonus_meters: val }
                    }) : prev);
                  }}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8e95a5] block mb-1">Cerberus Penalty (m)</label>
                <input
                  type="number"
                  value={editableR3Config?.vengeance?.cerberus_penalty_meters || -150}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEditableR3Config(prev => prev ? ({
                      ...prev,
                      vengeance: { ...prev.vengeance, cerberus_penalty_meters: val }
                    }) : prev);
                  }}
                  className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Reset Session */}
          <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/30 flex items-center justify-between">
            <div>
              <h5 className="text-xs font-serif font-bold text-red-200">Reset Round 3 Odyssey</h5>
              <p className="text-[10px] text-[#8e95a5]">Clear all wave records, distance states, and podium spots</p>
            </div>
            <button
              onClick={handleR3ResetSession}
              className="px-3 py-1.5 rounded-xl bg-red-950 border border-red-500/50 hover:bg-red-900 text-red-300 font-mono text-xs font-bold transition-all"
            >
              Reset Session
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: ROSTER & TEAM OVERRIDE MANAGER */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Instant Demo Crew Spawn (For Solo Testing) */}
          <div className="bg-gradient-to-r from-[#161922] via-[#202533] to-[#161922] border border-[#c4a45a]/60 rounded-2xl p-4 shadow-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-serif font-bold text-[#f4f0e8]">Solo Testing Simulator</h4>
                <p className="text-[10px] text-[#8e95a5]">Spawn 5 test shades with all roles & form a ready crew instantly</p>
              </div>
              <button
                onClick={handleSpawnDemoCrew}
                disabled={isSpawningDemo}
                className={`px-3 py-2 bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c] rounded-xl text-xs font-bold font-serif shadow-gold-glow flex items-center space-x-1.5 transition-all ${
                  isSpawningDemo ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <span>{isSpawningDemo ? '⚡ Summoning...' : '⚡ Spawn 5-Shade Crew'}</span>
              </button>
            </div>
            {demoNotice && (
              <div className="p-2 rounded-lg bg-[#08090c] border border-[#c4a45a]/40 text-[#f4f0e8] text-[11px] font-mono flex items-center justify-between">
                <span>{demoNotice}</span>
                <button onClick={() => setDemoNotice(null)} className="text-[#8e95a5] hover:text-[#f4f0e8]">✕</button>
              </div>
            )}
          </div>

          {/* Add Offline Player Form */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Add Player Manually
            </span>
            <form onSubmit={handleAddPlayer} className="flex items-center space-x-2">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Player name..."
                className="flex-1 bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] outline-none"
              />
              <select
                value={newPlayerRoleId}
                onChange={(e) => setNewPlayerRoleId(e.target.value)}
                className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-2 py-2 text-xs text-[#f4f0e8] outline-none"
              >
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-2 bg-[#c4a45a] text-[#08090c] font-bold text-xs rounded-lg font-serif"
              >
                Add
              </button>
            </form>
          </div>

          {/* Formed Teams Overview & Friend Grouping / Override (Collapsible & Searchable for 30-40 teams) */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl overflow-hidden shadow-xl">
            <button
              type="button"
              onClick={() => setIsFormedCrewsOpen(!isFormedCrewsOpen)}
              className="w-full p-4 flex items-center justify-between bg-[#161922] hover:bg-[#1a1e29] border-b border-[#2a2e3d] text-left transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#c4a45a]" />
                <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                  Formed Crews Directory ({teams.length} Squads • {teams.reduce((acc, t) => acc + t.members.length, 0)} Shades)
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-[#8e95a5]">
                  {teams.length} Crews Registered
                </span>
                {isFormedCrewsOpen ? (
                  <ChevronUp className="w-4 h-4 text-[#c4a45a]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#8e95a5]" />
                )}
              </div>
            </button>

            {isFormedCrewsOpen && (
              <div className="p-4 space-y-3">
                {/* Search & Bulk Expand Controls */}
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#8e95a5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={crewSearch}
                      onChange={(e) => setCrewSearch(e.target.value)}
                      placeholder="Search crews by name, battle code (e.g. 49), or player name..."
                      className="w-full bg-[#161922] border border-[#2a2e3d] rounded-xl pl-9 pr-8 py-2 text-xs text-[#f4f0e8] placeholder-[#8e95a5]/60 outline-none focus:border-[#c4a45a] font-mono"
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

                  <div className="flex items-center justify-between text-[10px] font-mono text-[#8e95a5] px-1">
                    <span>
                      Showing {
                        teams.filter(t => {
                          if (!crewSearch.trim()) return true;
                          const q = crewSearch.toLowerCase().trim();
                          return (
                            t.name.toLowerCase().includes(q) ||
                            (t.battle_code || '').toLowerCase().includes(q) ||
                            t.members.some(m => m.name.toLowerCase().includes(q) || m.roleName.toLowerCase().includes(q))
                          );
                        }).length
                      } of {teams.length} crews
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setExpandedCrewIds(new Set(teams.map(t => t.id)))}
                        className="hover:text-[#c4a45a] transition-colors"
                      >
                        Expand All
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => setExpandedCrewIds(new Set())}
                        className="hover:text-[#c4a45a] transition-colors"
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filtered Teams List */}
                {(() => {
                  const filtered = teams.filter(t => {
                    if (!crewSearch.trim()) return true;
                    const q = crewSearch.toLowerCase().trim();
                    return (
                      t.name.toLowerCase().includes(q) ||
                      (t.battle_code || '').toLowerCase().includes(q) ||
                      t.members.some(m => m.name.toLowerCase().includes(q) || m.roleName.toLowerCase().includes(q))
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="p-6 text-center text-xs font-mono text-[#8e95a5] border border-dashed border-[#2a2e3d] rounded-xl">
                        No crews match &quot;{crewSearch}&quot;.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {filtered.map((t) => {
                        const isExpanded = expandedCrewIds.has(t.id);
                        return (
                          <div
                            key={t.id}
                            className="rounded-xl bg-[#161922] border border-[#2a2e3d] overflow-hidden transition-all"
                          >
                            {/* Compact Clickable Header */}
                            <div
                              onClick={() => toggleCrewExpand(t.id)}
                              className="p-3 flex items-center justify-between cursor-pointer hover:bg-[#1a1e2a] transition-colors"
                            >
                              <div className="flex items-center space-x-2.5">
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-[#c4a45a]" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-[#8e95a5]" />
                                )}
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <h4 className="text-xs font-serif font-bold text-[#f4f0e8]">{t.name}</h4>
                                    {t.battle_code && (
                                      <span className="text-[10px] font-mono text-[#c4a45a] font-bold">[{t.battle_code}]</span>
                                    )}
                                  </div>
                                  <span className="text-[10px] font-mono text-[#8e95a5]">
                                    {t.members.length} members • {t.assignedCodeword ? `Codeword: ${t.assignedCodeword}` : 'No codeword'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center space-x-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#c4a45a]/10 border border-[#c4a45a]/40 text-[#c4a45a] font-bold">
                                  {t.score} PTS
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTeam(t.id, t.name);
                                  }}
                                  className="p-1 rounded border border-red-500/30 bg-red-950/30 hover:bg-red-900/60 text-red-300 transition-colors"
                                  title="Disband this crew"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Expanded Member Details */}
                            {isExpanded && (
                              <div className="p-3 pt-0 border-t border-[#2a2e3d]/60 space-y-1 mt-1">
                                <div className="text-[9px] font-mono text-[#8e95a5] uppercase tracking-wider mb-1 pt-1">
                                  Crew Members ({t.members.length}):
                                </div>
                                {t.members.map((m, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs p-1.5 rounded bg-[#10121a] border border-[#2a2e3d]/60"
                                  >
                                    <div className="flex items-center space-x-2">
                                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.roleColor }} />
                                      <span className="text-[#f4f0e8] font-medium">{m.name}</span>
                                      <span className="text-[10px] text-[#8e95a5]">({m.roleName})</span>
                                    </div>
                                    {m.id && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          switchPlayer(m.id!);
                                          if (onClose) onClose();
                                        }}
                                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#c4a45a]/20 border border-[#c4a45a]/40 text-[#c4a45a] hover:bg-[#c4a45a] hover:text-[#08090c] transition-colors flex items-center space-x-1"
                                        title={`Switch view to play as ${m.name}`}
                                      >
                                        <span>🎮 Play as</span>
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Unassigned / Solo Players */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                Unassigned Shades ({unassigned.length})
              </span>
              {unassigned.length > 0 && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleRebalanceRoles}
                    disabled={isRebalancing}
                    className="px-2.5 py-1 bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a] text-[#8e95a5] hover:text-[#f4f0e8] rounded text-[10px] font-mono transition-all"
                  >
                    <span>{isRebalancing ? 'Balancing...' : '⚖️ Auto-Balance Roles'}</span>
                  </button>
                  <button
                    onClick={() => adminAutoGroup(passcode)}
                    className="px-2.5 py-1 bg-[#c4a45a]/20 border border-[#c4a45a] hover:bg-[#c4a45a] hover:text-[#08090c] text-[#c4a45a] rounded text-[10px] font-mono font-bold transition-all"
                  >
                    ⚡ Auto-Group Into Crews
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {unassigned.map((p) => (
                <div
                  key={p.id}
                  className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[#f4f0e8]">{p.name}</span>
                      <span className="text-[10px] font-mono text-[#c4a45a] ml-2">[{p.join_code}]</span>
                    </div>
                    <button
                      onClick={() => handleRemovePlayer(p.id)}
                      title="Kick Player"
                      className="text-[#8e95a5] hover:text-red-400 p-1"
                    >
                      <UserX className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* 1-Tap Role Switcher Dropdown */}
                    <div className="flex-1">
                      <label className="text-[9px] font-mono text-[#8e95a5] block mb-0.5">Role Balance:</label>
                      <select
                        value={p.roleId}
                        onChange={(e) => handleRoleChange(p.id, e.target.value)}
                        className="w-full bg-[#10121a] border border-[#2a2e3d] rounded p-1 text-[11px] text-[#f4f0e8] outline-none"
                      >
                        {roles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Friend Grouping / Override Team Assignment */}
                    <div className="flex-1">
                      <label className="text-[9px] font-mono text-[#8e95a5] block mb-0.5">Move to Crew:</label>
                      <select
                        onChange={(e) => handleTeamChange(p.id, e.target.value || null)}
                        defaultValue=""
                        className="w-full bg-[#10121a] border border-[#2a2e3d] rounded p-1 text-[11px] text-[#f4f0e8] outline-none"
                      >
                        <option value="">(None / Solo)</option>
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: UNIFIED GAME CONFIGURATOR (COLLAPSIBLE ACCORDION SECTIONS) */}
      {activeTab === 'config' && editableConfig && (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-[#c4a45a]" />
              <div>
                <h3 className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                  Game & Round Configurations
                </h3>
                <p className="text-[10px] text-[#8e95a5]">
                  All round configurations, durations, pools, and scoring matrices grouped in one place.
                </p>
              </div>
            </div>
            <button
              onClick={handleSaveConfig}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 shadow-sm transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{configSaved ? '✓ Saved!' : 'Save Config'}</span>
            </button>
          </div>

          {/* Section 1: Session & Event Rules */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl overflow-hidden shadow-xl transition-all">
            <button
              type="button"
              onClick={() => toggleSection('session')}
              className="w-full p-4 flex items-center justify-between bg-[#161922] hover:bg-[#1a1e29] border-b border-[#2a2e3d] text-left transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#c4a45a]" />
                <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                  1. Session & Role Rules
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-[#8e95a5]">
                  Crew Size: {editableConfig.team_size} • Admin Pass: {editableConfig.admin_passcode}
                </span>
                {openSections.session ? (
                  <ChevronUp className="w-4 h-4 text-[#c4a45a]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#8e95a5]" />
                )}
              </div>
            </button>

            {openSections.session && (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
                      Target Crew Size (Default: 5):
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="10"
                      value={editableConfig.team_size}
                      onChange={(e) => setEditableConfig({ ...editableConfig, team_size: parseInt(e.target.value, 10) || 5 })}
                      className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-full outline-none font-mono"
                    />
                    <p className="text-[9px] text-[#8e95a5] mt-1">
                      Auto-grouping and slot assignments divide attendees by this size.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
                      Admin Master Passcode:
                    </label>
                    <input
                      type="text"
                      value={editableConfig.admin_passcode}
                      onChange={(e) => setEditableConfig({ ...editableConfig, admin_passcode: e.target.value })}
                      className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-full outline-none font-mono"
                    />
                    <p className="text-[9px] text-[#8e95a5] mt-1">
                      Passcode required to open and command this Game Master control panel.
                    </p>
                  </div>
                </div>

                <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] block mb-1.5">
                      Active Codewords in Pool (Click to inspect tablet fragments below):
                    </span>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {((editableConfig.rounds[0]?.data as any)?.codewords || ['CRIMSON SHADOW', 'MIDNIGHT BELL', 'OBSIDIAN GATE', 'SILENT SPECTER']).map((w: string) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setPreviewWord(w)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                            previewWord === w
                              ? 'bg-[#c4a45a] text-[#08090c] shadow-gold-glow'
                              : 'bg-[#161922] border border-[#2a2e3d] text-[#8e95a5] hover:text-[#f4f0e8] hover:border-[#c4a45a]/60'
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Tablet Inspector */}
                <div className="p-4 rounded-xl bg-[#08090c] border border-[#c4a45a]/40 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-[#c4a45a]" />
                    <span className="text-xs font-mono font-bold text-[#c4a45a] uppercase">
                      Shattered Tablet 5-Screen Inspector: {previewWord}
                    </span>
                  </div>

                  <p className="text-[10px] text-[#8e95a5]">
                    Below is how the 2-line ancient tablet is divided across all 5 phone screens placed side-by-side with interlocking glowing seam notches and orientation crests.
                  </p>

                  {/* Rendered Side-by-Side Slices */}
                  <div className="p-3 bg-[#10121a] rounded-lg border border-[#2a2e3d]">
                    <div className="grid grid-cols-5 gap-1.5">
                      {Array.from({ length: editableConfig.team_size || 5 }).map((_, idx) => {
                        const { line1, line2 } = parseTabletCodeword(previewWord);
                        const { totalWidth, totalHeight, line1Y, horizonY, line2Y } = TABLET_CONFIG;
                        const tSize = editableConfig.team_size || 5;
                        const slotW = totalWidth / tSize;
                        const vX = idx * slotW;
                        const roleColors = ['#e5cb87', '#38bdf8', '#fb7185', '#34d399', '#c084fc'];
                        const roleCol = roleColors[idx % roleColors.length];
                        const line1Metrics = getTabletTextMetrics(line1);
                        const line2Metrics = getTabletTextMetrics(line2);

                        return (
                          <div key={idx} className="bg-black border border-[#2a2e3d] rounded-xl overflow-hidden p-1 flex flex-col items-center">
                            <span className="text-[9px] font-mono font-bold mb-1 truncate max-w-full" style={{ color: roleCol }}>
                              #{idx + 1} ({getSlotPositionLabel(idx, tSize)})
                            </span>
                            <div className="w-full h-32 bg-[#08090c] rounded overflow-hidden">
                              <svg viewBox={`${vX} 0 ${slotW} ${totalHeight}`} preserveAspectRatio="none" className="w-full h-full">
                                <rect x="0" y="0" width={totalWidth} height={totalHeight} fill="#08090c" />
                                <rect x="6" y="6" width={totalWidth - 12} height={totalHeight - 12} rx="10" fill="#0f1118" stroke="#2a2e3d" strokeWidth="3" />
                                <text x={totalWidth / 2} y="48" textAnchor="middle" fontFamily="monospace" fontSize="18" fontWeight="bold" fill="#c4a45a" letterSpacing="8">
                                  ▲ CREST (TOP) ▲
                                </text>
                                <text x={totalWidth / 2} y={line1Y} textAnchor="middle" textLength={line1Metrics.textLength} lengthAdjust="spacing" fontFamily="Cinzel, Georgia, serif" fontWeight="900" fontSize={line1Metrics.fontSize} fill="#e5cb87" stroke="#08090c" strokeWidth="4">
                                  {line1}
                                </text>
                                <line x1="0" y1={horizonY} x2={totalWidth} y2={horizonY} stroke="#c4a45a" strokeWidth="6" opacity="0.8" />
                                {Array.from({ length: tSize - 1 }).map((_, sIdx) => {
                                  const sX = (sIdx + 1) * slotW;
                                  return (
                                    <polygon key={sIdx} points={`${sX},${horizonY - 24} ${sX + 16},${horizonY} ${sX},${horizonY + 24} ${sX - 16},${horizonY}`} fill="#c4a45a" />
                                  );
                                })}
                                <text x={totalWidth / 2} y={line2Y} textAnchor="middle" textLength={line2Metrics.textLength} lengthAdjust="spacing" fontFamily="Cinzel, Georgia, serif" fontWeight="900" fontSize={line2Metrics.fontSize} fill="#e5cb87" stroke="#08090c" strokeWidth="4">
                                  {line2}
                                </text>
                                <text x={totalWidth / 2} y="564" textAnchor="middle" fontFamily="monospace" fontSize="18" fontWeight="bold" fill="#c4a45a" letterSpacing="8">
                                  ▼ BASE (BOTTOM) ▼
                                </text>
                              </svg>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveConfig}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{configSaved ? '✓ Saved Round 1 Config' : 'Save Round 1 Config'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Round 2 (Shades in the Mist) */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl overflow-hidden shadow-xl transition-all">
            <button
              type="button"
              onClick={() => toggleSection('round2')}
              className="w-full p-4 flex items-center justify-between bg-[#161922] hover:bg-[#1a1e29] border-b border-[#2a2e3d] text-left transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Swords className="w-4 h-4 text-[#c4a45a]" />
                <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                  3. Round 2: Shades in the Mist Config
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-[#8e95a5]">
                  4 Phases • 3 Clash Stakes
                </span>
                {openSections.round2 ? (
                  <ChevronUp className="w-4 h-4 text-[#c4a45a]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#8e95a5]" />
                )}
              </div>
            </button>

            {openSections.round2 && (
              <div className="p-5 space-y-5">
                {/* Phase Durations */}
                {/* Standard Phase Sequence & Timings */}
                <div className="p-4 rounded-xl bg-[#08090c] border border-[#2a2e3d] space-y-2.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold block">
                    Clash Phase Sequence & Timings (Configured Game Rules)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d]">
                      <span className="text-[#8e95a5] block text-[10px]">1. PRIVATE HUDDLE</span>
                      <span className="text-[#f4f0e8] font-bold">50s</span>
                    </div>
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d]">
                      <span className="text-[#8e95a5] block text-[10px]">2. THE PARLEY</span>
                      <span className="text-[#f4f0e8] font-bold">40s</span>
                    </div>
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d]">
                      <span className="text-[#8e95a5] block text-[10px]">3. SECRET VOTE</span>
                      <span className="text-[#f4f0e8] font-bold">25s</span>
                    </div>
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d]">
                      <span className="text-[#8e95a5] block text-[10px]">4. REVEAL & DEBRIEF</span>
                      <span className="text-[#f4f0e8] font-bold">40s</span>
                    </div>
                  </div>
                </div>

                {/* Standard Rules Preview (Fixed Game Mechanics) */}
                <div className="p-4 rounded-xl bg-[#08090c] border border-[#2a2e3d] space-y-2.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold block">
                    Fixed Scoring Stakes (Standard Game Rules)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d] space-y-1">
                      <span className="text-amber-400 font-bold block">Clash 1 Stakes</span>
                      <div className="text-[11px] text-[#8e95a5]">Both Truce: <span className="text-emerald-400 font-bold">+75</span></div>
                      <div className="text-[11px] text-[#8e95a5]">Ambush Win: <span className="text-rose-400 font-bold">+150</span> / 0</div>
                      <div className="text-[11px] text-[#8e95a5]">Both Ambush: <span className="text-purple-400 font-bold">+15</span></div>
                    </div>
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d] space-y-1">
                      <span className="text-amber-400 font-bold block">Clash 2 Stakes</span>
                      <div className="text-[11px] text-[#8e95a5]">Both Truce: <span className="text-emerald-400 font-bold">+150</span></div>
                      <div className="text-[11px] text-[#8e95a5]">Ambush Win: <span className="text-rose-400 font-bold">+300</span> / 0</div>
                      <div className="text-[11px] text-[#8e95a5]">Both Ambush: <span className="text-purple-400 font-bold">+30</span></div>
                    </div>
                    <div className="p-2.5 rounded bg-[#10121a] border border-[#2a2e3d] space-y-1">
                      <span className="text-amber-400 font-bold block">Clash 3 Stakes</span>
                      <div className="text-[11px] text-[#8e95a5]">Both Truce: <span className="text-emerald-400 font-bold">+225</span></div>
                      <div className="text-[11px] text-[#8e95a5]">Ambush Win: <span className="text-rose-400 font-bold">+450</span> / 0</div>
                      <div className="text-[11px] text-[#8e95a5]">Both Ambush: <span className="text-purple-400 font-bold">+45</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Round 3 (Charon's Physical Trial) */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl overflow-hidden shadow-xl transition-all">
            <button
              type="button"
              onClick={() => toggleSection('round3')}
              className="w-full p-4 flex items-center justify-between bg-[#161922] hover:bg-[#1a1e29] border-b border-[#2a2e3d] text-left transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Flame className="w-4 h-4 text-[#c4a45a]" />
                <span className="text-xs font-serif font-bold text-[#f4f0e8] uppercase">
                  4. Round 3: Charon's Physical Trial Config
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-[#8e95a5]">
                  Verification: {(editableConfig.rounds[2]?.data as any)?.verificationCode || 'OBOLUS'} • {(editableConfig.rounds[2]?.data as any)?.points || 250} PTS
                </span>
                {openSections.round3 ? (
                  <ChevronUp className="w-4 h-4 text-[#c4a45a]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#8e95a5]" />
                )}
              </div>
            </button>

            {openSections.round3 && (
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
                    Round 3 Duration (Seconds):
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="30"
                      max="1200"
                      value={editableConfig.rounds[2]?.durationSeconds || 240}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 240;
                        const updated = { ...editableConfig };
                        if (updated.rounds[2]) {
                          updated.rounds[2].durationSeconds = val;
                          setEditableConfig(updated);
                        }
                      }}
                      className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-32 outline-none font-mono"
                    />
                    <span className="text-xs font-mono text-[#8e95a5]">
                      seconds ({Math.floor((editableConfig.rounds[2]?.durationSeconds || 240) / 60)}m {(editableConfig.rounds[2]?.durationSeconds || 240) % 60}s)
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
                    Physical Challenge Prompt:
                  </label>
                  <textarea
                    rows={2}
                    value={(editableConfig.rounds[2]?.data as any)?.prompt || ''}
                    onChange={(e) => {
                      const updated = { ...editableConfig };
                      if (updated.rounds[2]) {
                        (updated.rounds[2].data as any).prompt = e.target.value;
                        setEditableConfig(updated);
                      }
                    }}
                    className="w-full bg-[#161922] border border-[#2a2e3d] rounded-lg p-2.5 text-xs text-[#f4f0e8] font-mono outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
                      Secret Verification Code (Announced by Game Master):
                    </label>
                    <input
                      type="text"
                      value={(editableConfig.rounds[2]?.data as any)?.verificationCode || ''}
                      onChange={(e) => {
                        const updated = { ...editableConfig };
                        if (updated.rounds[2]) {
                          (updated.rounds[2].data as any).verificationCode = e.target.value.toUpperCase();
                          setEditableConfig(updated);
                        }
                      }}
                      className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-full outline-none font-mono uppercase font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
                      Points Awarded on Completion:
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      value={(editableConfig.rounds[2]?.data as any)?.points ?? 250}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        const updated = { ...editableConfig };
                        if (updated.rounds[2]) {
                          (updated.rounds[2].data as any).points = val;
                          setEditableConfig(updated);
                        }
                      }}
                      className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-full outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveConfig}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{configSaved ? '✓ Saved Round 3 Config' : 'Save Round 3 Config'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 5: Emergency Reset & Danger Zone */}
          <div className="bg-[#10121a] border border-red-950/80 rounded-2xl overflow-hidden shadow-xl transition-all">
            <button
              type="button"
              onClick={() => toggleSection('danger')}
              className="w-full p-4 flex items-center justify-between bg-red-950/20 hover:bg-red-950/40 border-b border-red-900/40 text-left transition-colors"
            >
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-4 h-4 text-red-400" />
                <span className="text-xs font-serif font-bold text-red-300 uppercase">
                  5. Danger Zone & Emergency Reset
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-red-400/80">
                  Game-Wide Reset
                </span>
                {openSections.danger ? (
                  <ChevronUp className="w-4 h-4 text-red-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-red-400/60" />
                )}
              </div>
            </button>

            {openSections.danger && (
              <div className="p-5 space-y-3">
                <p className="text-xs text-[#8e95a5]">
                  Clears all formed crews, match pairing records, player votes, and resets total team scores back to zero. Returns all connected devices to the team formation lobby.
                </p>
                <button
                  onClick={handleResetGame}
                  disabled={isResetting}
                  className="w-full py-2.5 rounded-xl bg-red-950/80 border border-red-500/50 hover:bg-red-900 text-red-200 font-mono text-xs font-bold transition-colors flex items-center justify-center space-x-2"
                >
                  <RotateCcw className={`w-3.5 h-3.5 text-red-400 ${isResetting ? 'animate-spin' : ''}`} />
                  <span>{isResetting ? 'Resetting All Records...' : '⚠ Emergency Reset Entire Game to Lobby'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: QR CODE & MOBILE JOIN DISPLAY */}
      {activeTab === 'qr' && (
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-serif font-black text-[#f4f0e8]">
              Scan to Join Underworld
            </h3>
            <p className="text-xs text-[#8e95a5]">
              Show this QR code to pub attendees or display on a venue monitor.
            </p>
          </div>

          {serverInfo?.qrDataUrl ? (
            <div className="p-4 bg-[#f4f0e8] rounded-2xl inline-block shadow-2xl mx-auto border-4 border-[#c4a45a]">
              <img
                src={serverInfo.qrDataUrl}
                alt="Game Join QR Code"
                className="w-56 h-56 mx-auto object-contain"
              />
            </div>
          ) : (
            <div className="p-8 text-xs text-[#8e95a5] font-mono">
              Loading Join QR Code...
            </div>
          )}

          <div className="bg-[#161922] border border-[#2a2e3d] p-3 rounded-xl">
            <span className="text-[10px] font-mono text-[#8e95a5] block mb-1">Direct Network URL:</span>
            <code className="text-xs font-mono font-bold text-[#c4a45a] select-all">
              {serverInfo?.joinUrl || `http://${window.location.hostname}:5173/`}
            </code>
          </div>
        </div>
      )}
    </div>
  );
};
