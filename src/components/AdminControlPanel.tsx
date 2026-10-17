import React, { useState, useEffect } from 'react';
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
  adminAutoGroup,
  adminSpawnDemoCrew,
  fetchServerInfo,
} from '../lib/api';
import type { SyncPayload, GameConfig } from '../types';
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
} from 'lucide-react';

interface AdminProps {
  payload: SyncPayload | null;
  onClose?: () => void;
}

export const AdminControlPanel: React.FC<AdminProps> = ({ payload, onClose }) => {
  const [passcode, setPasscode] = useState(() => localStorage.getItem('underworld_admin_pass') || 'underworld');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'controller' | 'roster' | 'config' | 'qr'>('controller');

  // Server info & QR
  const [serverInfo, setServerInfo] = useState<{ localIp: string; joinUrl: string; qrDataUrl: string | null } | null>(null);

  // Add player form
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerRoleId, setNewPlayerRoleId] = useState('navigator');

  // Config editor state
  const [editableConfig, setEditableConfig] = useState<GameConfig | null>(null);
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    if (payload?.config) {
      setEditableConfig(JSON.parse(JSON.stringify(payload.config)));
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

  // Timer controls
  const handleTimeAdjust = async (deltaSeconds: number) => {
    await adminAdjustTimer(passcode, 'adjust', deltaSeconds);
  };

  const handleTimePause = async () => {
    await adminAdjustTimer(passcode, 'pause');
  };

  // State changes
  const handleStateChange = async (state: any, roundIndex?: number) => {
    await adminSetState(passcode, state, roundIndex);
  };

  // Score adjust
  const handleScoreChange = async (teamId: string, delta: number) => {
    await adminAdjustTeamScore(passcode, teamId, delta);
  };

  // Player role change
  const handleRoleChange = async (playerId: string, roleId: string) => {
    await adminChangeRole(passcode, playerId, roleId);
  };

  // Move player team
  const handleTeamChange = async (playerId: string, targetTeamId: string | null) => {
    await adminMovePlayerTeam(passcode, playerId, targetTeamId);
  };

  // Remove player
  const handleRemovePlayer = async (playerId: string) => {
    if (confirm('Are you sure you want to remove this player from the game?')) {
      await adminRemovePlayer(passcode, playerId);
    }
  };

  // Add player
  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    await adminAddPlayer(passcode, newPlayerName.trim(), newPlayerRoleId);
    setNewPlayerName('');
  };

  // Save config
  const handleSaveConfig = async () => {
    if (!editableConfig) return;
    await adminUpdateConfig(passcode, editableConfig);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  };

  // Reset Game
  const handleResetGame = async () => {
    if (confirm('CRITICAL ACTION: Reset all players, teams, and scores? This cannot be undone.')) {
      await adminResetGame(passcode);
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

        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-[#2a2e3d] bg-[#161922] text-xs font-mono text-[#8e95a5] hover:text-[#f4f0e8]"
          >
            Exit Admin
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 bg-[#10121a] border border-[#2a2e3d] p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('controller')}
          className={`py-2 text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'controller'
              ? 'bg-[#c4a45a] text-[#08090c] font-bold'
              : 'text-[#8e95a5] hover:text-[#f4f0e8]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Round</span>
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
          <span className="hidden xs:inline">Config</span>
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
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleStateChange('LOBBY_TEAM_FORMATION')}
                className={`p-3 rounded-xl border text-xs font-mono font-bold transition-all ${
                  payload?.state === 'LOBBY_TEAM_FORMATION'
                    ? 'bg-[#c4a45a] text-[#08090c] border-[#c4a45a] shadow-gold-glow'
                    : 'bg-[#161922] text-[#8e95a5] border-[#2a2e3d] hover:text-[#f4f0e8]'
                }`}
              >
                1. Team Lobby
              </button>
              <button
                onClick={() => handleStateChange('ROUND_LEADERBOARD')}
                className={`p-3 rounded-xl border text-xs font-mono font-bold transition-all ${
                  payload?.state === 'ROUND_LEADERBOARD'
                    ? 'bg-[#c4a45a] text-[#08090c] border-[#c4a45a] shadow-gold-glow'
                    : 'bg-[#161922] text-[#8e95a5] border-[#2a2e3d] hover:text-[#f4f0e8]'
                }`}
              >
                Leaderboard Stage
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
              </div>
            </div>
          </div>

          {/* Dynamic Time Extension Controls */}
          {payload?.state === 'ROUND_ACTIVE' && (
            <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                    Live Timer Control & Broadcast
                  </span>
                  <div className="text-xs text-[#8e95a5]">
                    Changes push instantaneously to all players' screens
                  </div>
                </div>
                <button
                  onClick={handleTimePause}
                  className="px-3 py-1.5 rounded-lg border border-[#2a2e3d] bg-[#161922] text-xs font-mono text-[#f4f0e8] hover:border-[#c4a45a] flex items-center space-x-1"
                >
                  {payload.round_is_paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                  <span>{payload.round_is_paused ? 'Resume' : 'Pause'}</span>
                </button>
              </div>

              {/* Dynamic Instant Extension Buttons */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                <button
                  onClick={() => handleTimeAdjust(60)}
                  className="py-2.5 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
                >
                  +1 Min
                </button>
                <button
                  onClick={() => handleTimeAdjust(120)}
                  className="py-2.5 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
                >
                  +2 Min
                </button>
                <button
                  onClick={() => handleTimeAdjust(300)}
                  className="py-2.5 rounded-xl bg-[#161922] border border-emerald-500/40 hover:bg-emerald-950/40 text-emerald-300 font-mono font-bold text-xs shadow-sm transition-all"
                >
                  +5 Min
                </button>
                <button
                  onClick={() => handleTimeAdjust(-60)}
                  className="py-2.5 rounded-xl bg-[#161922] border border-red-500/40 hover:bg-red-950/40 text-red-300 font-mono font-bold text-xs shadow-sm transition-all"
                >
                  -1 Min
                </button>
              </div>
            </div>
          )}

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
        </div>
      )}

      {/* TAB 2: ROSTER & TEAM OVERRIDE MANAGER */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Instant Demo Crew Spawn (For Solo Testing) */}
          <div className="bg-gradient-to-r from-[#161922] via-[#202533] to-[#161922] border border-[#c4a45a]/60 rounded-2xl p-4 shadow-xl flex items-center justify-between">
            <div>
              <h4 className="text-xs font-serif font-bold text-[#f4f0e8]">Solo Testing Simulator</h4>
              <p className="text-[10px] text-[#8e95a5]">Spawn 5 test shades with all roles & form a ready crew instantly</p>
            </div>
            <button
              onClick={() => adminSpawnDemoCrew(passcode)}
              className="px-3 py-2 bg-[#c4a45a] hover:bg-[#d8b86e] text-[#08090c] rounded-xl text-xs font-bold font-serif shadow-gold-glow flex items-center space-x-1.5 transition-all"
            >
              <span>⚡ Spawn 5-Shade Crew</span>
            </button>
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

          {/* Formed Teams Overview & Friend Grouping / Override */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Formed Crews ({teams.length})
            </span>
            {teams.map((t) => (
              <div key={t.id} className="p-3.5 rounded-xl bg-[#161922] border border-[#2a2e3d] space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-serif font-bold text-[#f4f0e8]">{t.name}</h4>
                  <span className="text-[10px] font-mono text-[#c4a45a] font-bold">{t.score} PTS</span>
                </div>

                <div className="space-y-1">
                  {t.members.map((m, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs p-1.5 rounded bg-[#10121a] border border-[#2a2e3d]/60"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.roleColor }} />
                        <span className="text-[#f4f0e8] font-medium">{m.name}</span>
                        <span className="text-[10px] text-[#8e95a5]">({m.roleName})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Unassigned / Solo Players */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                Unassigned Shades ({unassigned.length})
              </span>
              {unassigned.length > 0 && (
                <button
                  onClick={() => adminAutoGroup(passcode)}
                  className="px-2.5 py-1 bg-[#c4a45a]/20 border border-[#c4a45a] hover:bg-[#c4a45a] hover:text-[#08090c] text-[#c4a45a] rounded text-[10px] font-mono font-bold transition-all"
                >
                  ⚡ Auto-Group Into Crews
                </button>
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

      {/* TAB 3: GAME CONFIGURATOR */}
      {activeTab === 'config' && editableConfig && (
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Event & Rules Configuration
            </span>
            <button
              onClick={handleSaveConfig}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold"
            >
              {configSaved ? '✓ Saved!' : 'Save Config'}
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">Target Team Size:</label>
            <input
              type="number"
              value={editableConfig.team_size}
              onChange={(e) => setEditableConfig({ ...editableConfig, team_size: parseInt(e.target.value, 10) || 5 })}
              className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-24 outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">Admin Passcode:</label>
            <input
              type="text"
              value={editableConfig.admin_passcode}
              onChange={(e) => setEditableConfig({ ...editableConfig, admin_passcode: e.target.value })}
              className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-full outline-none font-mono"
            />
          </div>

          {/* ASCII Splitter Codewords */}
          <div>
            <label className="block text-[11px] font-mono text-[#8e95a5] mb-1">
              Round 1 Codewords Pool (Comma Separated):
            </label>
            <input
              type="text"
              defaultValue={(editableConfig.rounds[0]?.data as any)?.codewords?.join(', ') || ''}
              onChange={(e) => {
                const words = e.target.value.split(',').map(w => w.trim().toUpperCase()).filter(Boolean);
                const updated = { ...editableConfig };
                (updated.rounds[0].data as any).codewords = words;
                setEditableConfig(updated);
              }}
              className="bg-[#161922] border border-[#2a2e3d] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] w-full outline-none font-mono"
            />
            <p className="text-[10px] text-[#8e95a5] mt-1">
              Full A-Z supported! Any custom word up to 8 letters will render seamlessly into totem fragments.
            </p>
          </div>

          {/* Emergency Reset */}
          <div className="pt-4 border-t border-red-900/40">
            <button
              onClick={handleResetGame}
              className="w-full py-2.5 rounded-xl bg-red-950/80 border border-red-500/50 hover:bg-red-900 text-red-200 font-mono text-xs font-bold transition-colors"
            >
              ⚠ Emergency Reset Entire Game
            </button>
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
