import React, { useState, useEffect } from 'react';
import { useGameSession } from '../context/GameContext';
import {
  Users,
  Sparkles,
  Compass,
  Eye,
  Book,
  Flame,
  Shield,
  Plus,
  Edit2,
  AlertCircle,
  Dices,
  LogOut,
  Delete,
  Check,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import {
  TEAM_EMOJI_POOL,
  TEAM_EMOJI_LABELS,
  type TeamEmoji,
  type TeamPreviewInfo,
} from '../types';
import {
  formatEmojiCodeLabels,
} from '../lib/teamCodeEngine';

const ROLE_ICONS: Record<string, React.ReactNode> = {
  compass: <Compass className="w-5 h-5" />,
  eye: <Eye className="w-5 h-5" />,
  book: <Book className="w-5 h-5" />,
  flame: <Flame className="w-5 h-5" />,
  shield: <Shield className="w-5 h-5" />,
};

export const LobbyTeamFormation: React.FC = () => {
  const {
    player,
    role,
    team,
    payload,
    createTeam,
    previewTeamByEmoji,
    joinTeamByEmoji,
    leaveTeam,
    renameTeam,
    switchPlayer,
    rerollRole,
  } = useGameSession();

  // Create team state
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Join team modal & dialpad state
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedEmojis, setSelectedEmojis] = useState<TeamEmoji[]>([]);
  const [previewData, setPreviewData] = useState<TeamPreviewInfo | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Leave / Disband state
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Reroll fate state
  const [isRerolling, setIsRerolling] = useState(false);
  const [rerollMsg, setRerollMsg] = useState<string | null>(null);

  // Rename team state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameInput, setEditNameInput] = useState(team?.name || '');

  const roles = payload?.config.roles || [];
  const teamSize = payload?.config.team_size || 5;

  // Whenever 3 emojis are selected, automatically look up team preview
  useEffect(() => {
    if (selectedEmojis.length === 3) {
      const code = selectedEmojis.join('');
      let isMounted = true;
      setIsPreviewLoading(true);
      setJoinError(null);
      setPreviewData(null);

      previewTeamByEmoji(code).then(res => {
        if (!isMounted) return;
        setIsPreviewLoading(false);
        if (!res.success || !res.preview) {
          setJoinError(res.error || 'No active team found with this code.');
        } else {
          setPreviewData(res.preview);
        }
      });

      return () => {
        isMounted = false;
      };
    } else {
      setPreviewData(null);
      setJoinError(null);
    }
  }, [selectedEmojis]);

  if (!player || !role) return null;

  // --- Handlers ---
  const handleRerollRole = async () => {
    try {
      setIsRerolling(true);
      setRerollMsg(null);
      const res = await rerollRole();
      if (!res.success) {
        setRerollMsg(res.error || 'Failed to reroll role');
      } else {
        setRerollMsg('🎲 Fate re-cast! A new role was assigned.');
      }
      setTimeout(() => setRerollMsg(null), 3500);
    } finally {
      setIsRerolling(false);
    }
  };

  const handleCreateTeamSubmit = async () => {
    try {
      setIsCreating(true);
      setCreateError(null);
      const res = await createTeam();
      if (!res.success) {
        setCreateError(res.error || 'Failed to create team');
      }
    } catch (err: any) {
      setCreateError(err.message || 'Error creating team');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEmojiTap = (emoji: TeamEmoji) => {
    if (selectedEmojis.length < 3) {
      setSelectedEmojis([...selectedEmojis, emoji]);
    }
  };

  const handleBackspace = () => {
    if (selectedEmojis.length > 0) {
      setSelectedEmojis(selectedEmojis.slice(0, -1));
      setPreviewData(null);
      setJoinError(null);
    }
  };

  const handleClearEmojis = () => {
    setSelectedEmojis([]);
    setPreviewData(null);
    setJoinError(null);
  };

  const handleConfirmJoin = async () => {
    if (!previewData) return;
    try {
      setIsJoining(true);
      setJoinError(null);
      const res = await joinTeamByEmoji(previewData.emojiCode);
      if (!res.success) {
        setJoinError(res.error || 'Failed to join crew');
      } else {
        setShowJoinModal(false);
        setSelectedEmojis([]);
        setPreviewData(null);
      }
    } catch (err: any) {
      setJoinError(err.message || 'Failed to join crew');
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeaveTeam = async () => {
    const isSolo = (team?.player_ids.length || 0) <= 1;
    const confirmMsg = isSolo
      ? 'Disband this team and return to the lobby?'
      : 'Leave this crew and return to the lobby?';

    if (!confirm(confirmMsg)) return;

    try {
      setIsLeaving(true);
      setLeaveError(null);
      const res = await leaveTeam();
      if (!res.success) {
        setLeaveError(res.error || 'Failed to leave team');
      }
    } catch (err: any) {
      setLeaveError(err.message || 'Error leaving team');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editNameInput.trim()) return;
    await renameTeam(editNameInput.trim());
    setIsEditingName(false);
  };

  // =========================================================================
  // VIEW A: PLAYER IS ALREADY IN A TEAM (CREW HUB)
  // =========================================================================
  if (team) {
    const teamEmojiCode = team.emoji_code || ((team.round_submissions?._emoji_code as unknown) as string) || '';
    const formattedLabels = formatEmojiCodeLabels(teamEmojiCode);
    const isSolo = team.player_ids.length <= 1;

    return (
      <div className="space-y-5 py-4">
        {/* Crew Header Card */}
        <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl relative overflow-hidden space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold">
                Your Formed Crew
              </span>
              {isEditingName ? (
                <form onSubmit={handleRenameSubmit} className="flex items-center space-x-2 mt-1">
                  <input
                    type="text"
                    value={editNameInput}
                    onChange={(e) => setEditNameInput(e.target.value)}
                    className="bg-[#161922] border border-[#c4a45a] rounded-lg px-2.5 py-1 text-sm text-[#f4f0e8] outline-none"
                    autoFocus
                  />
                  <button type="submit" className="text-xs bg-[#c4a45a] text-[#08090c] font-bold px-2 py-1 rounded">
                    Save
                  </button>
                  <button type="button" onClick={() => setIsEditingName(false)} className="text-xs text-[#a9b4c7]">
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center space-x-2 mt-1">
                  <h2 className="text-lg font-serif font-black text-[#f4f0e8] truncate">{team.name}</h2>
                  <button
                    onClick={() => {
                      setEditNameInput(team.name);
                      setIsEditingName(true);
                    }}
                    className="text-[#a9b4c7] hover:text-[#e5cb87] transition-colors shrink-0"
                    title="Rename crew"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] font-mono text-[#a9b4c7]">CREW SCORE</span>
              <p className="text-xl font-mono font-bold text-[#e5cb87]">{team.score} PTS</p>
            </div>
          </div>

          {/* 3-Emoji Team Join Code Callout */}
          {teamEmojiCode && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#12151e] to-[#161922] border border-[#c4a45a]/60 text-center space-y-1.5 shadow-gold-glow">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#a9b4c7] font-bold block">
                TEAM JOIN CODE
              </span>
              <div className="text-3xl sm:text-4xl tracking-widest font-black py-0.5 animate-pulse">
                {teamEmojiCode}
              </div>
              <div className="text-xs font-mono font-bold text-[#e5cb87] uppercase tracking-wider">
                {formattedLabels}
              </div>
              <p className="text-[11px] text-[#8e95a5] italic font-serif">
                Tell teammates to tap these 3 emojis on their phone
              </p>
            </div>
          )}

          {/* Members Roster */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#a9b4c7]">
                Crew Roster ({team.player_ids.length} of {teamSize} Shades)
              </p>
              {team.player_ids.length < teamSize && (
                <span className="text-[10px] font-mono text-amber-400">
                  Waiting for {teamSize - team.player_ids.length} more...
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {team.player_ids.map((pid, idx) => {
                const isYou = pid === player.id;
                const memberData = payload?.teams_leaderboard
                  ?.find(t => t.id === team.id)
                  ?.members[idx];

                const memberRole = roles.find(r => r.name === memberData?.roleName) || (isYou ? role : null);

                return (
                  <div
                    key={pid}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                      isYou
                        ? 'bg-[#161922] border-[#c4a45a]/50 shadow-sm'
                        : 'bg-[#161922]/50 border-[#3a4157]'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs"
                        style={{
                          backgroundColor: `${memberRole?.color || '#c4a45a'}25`,
                          color: memberRole?.color || '#c4a45a',
                          border: `1px solid ${memberRole?.color || '#c4a45a'}50`,
                        }}
                      >
                        {ROLE_ICONS[memberRole?.icon || 'shield']}
                      </div>
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold text-[#f4f0e8]">
                            {isYou ? `${player.name} (You)` : memberData?.name || `Crewmate #${idx + 1}`}
                          </span>
                        </div>
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: memberRole?.color || '#a9b4c7' }}
                        >
                          {memberRole?.name || 'Underworld Traveler'}
                        </span>
                      </div>
                    </div>
                    {isYou ? (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                        You (Active)
                      </span>
                    ) : (
                      <button
                        onClick={() => switchPlayer(pid)}
                        className="text-[10px] font-mono text-[#e5cb87] hover:bg-[#c4a45a]/20 border border-[#c4a45a]/40 px-2 py-0.5 rounded-full transition-colors"
                        title="Solo Testing: Switch your screen to view this teammate"
                      >
                        👁️ Switch View
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leave / Disband Team Action */}
          <div className="pt-2 border-t border-[#2a2e3d]/80 flex items-center justify-between">
            <span className="text-[11px] text-[#8e95a5]">
              {isSolo ? 'Wrong group? Disband with 1 tap.' : 'Need to switch groups?'}
            </span>
            <button
              onClick={handleLeaveTeam}
              disabled={isLeaving}
              className="px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 text-xs font-mono font-bold flex items-center space-x-1.5 transition-all disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isLeaving ? 'Leaving...' : isSolo ? 'Disband Team' : 'Leave Team'}</span>
            </button>
          </div>

          {leaveError && (
            <p className="text-xs text-red-400 font-mono">{leaveError}</p>
          )}

          {/* Waiting for Round 1 Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-b from-[#161922] to-[#08090c] border border-[#c4a45a]/40 text-center space-y-2">
            <div className="inline-flex items-center space-x-1.5 text-xs font-mono text-[#e5cb87] font-bold">
              <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />
              <span>THE DESCENT IS APPROACHING</span>
            </div>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              Stand together at your pub table. Keep this screen active — when the descent begins, a brief story and rules overview will guide your crew into Round 1.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW B: PLAYER HAS NO TEAM (LOBBY ACTIONS: CREATE OR JOIN)
  // =========================================================================
  return (
    <div className="space-y-5 py-4">
      {/* Role Beacon Card */}
      <div
        className="rounded-2xl p-6 border shadow-beacon relative overflow-hidden transition-all"
        style={{
          borderColor: role.color,
          backgroundColor: '#10121a',
          '--beacon-glow': `${role.color}55`,
        } as React.CSSProperties}
      >
        {/* Glow ambient circle */}
        <div
          className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl opacity-30 pointer-events-none"
          style={{ backgroundColor: role.color }}
        />

        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: `${role.color}20`,
                color: role.color,
                border: `1px solid ${role.color}40`,
              }}
            >
              Assigned Underworld Role
            </span>
            <div
              className="w-3 h-3 rounded-full animate-ping"
              style={{ backgroundColor: role.color }}
            />
          </div>

          <div className="flex items-center space-x-3.5">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg border shrink-0"
              style={{
                backgroundColor: `${role.color}15`,
                borderColor: `${role.color}60`,
                color: role.color,
              }}
            >
              {ROLE_ICONS[role.icon] || <Shield className="w-7 h-7" />}
            </div>
            <div>
              <h2 className="text-2xl font-serif font-black tracking-wide text-[#f4f0e8]">
                {role.name}
              </h2>
              <p className="text-xs text-[#8e95a5] mt-0.5 leading-snug">
                {role.description}
              </p>
              {/* Re-roll Fate Action */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleRerollRole}
                  disabled={isRerolling}
                  className="px-2.5 py-1 rounded-lg bg-[#08090c] hover:bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a]/60 text-[11px] font-mono text-[#8e95a5] hover:text-[#c4a45a] flex items-center space-x-1.5 transition-all shadow-sm disabled:opacity-50"
                  title="Roll for another under-represented role if multiple people at your table have duplicates"
                >
                  <Dices className={`w-3.5 h-3.5 ${isRerolling ? 'animate-spin' : ''}`} />
                  <span>{isRerolling ? 'Consulting Oracle...' : '🎲 Re-roll Fate (Random Role)'}</span>
                </button>
                {rerollMsg && (
                  <p className="text-[10px] font-mono text-[#c4a45a] mt-1 animate-fade-in">{rerollMsg}</p>
                )}
              </div>
            </div>
          </div>

          {/* Physical Social Objective */}
          <div className="bg-[#161922]/80 border border-[#2a2e3d] p-3.5 rounded-xl space-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#f4f0e8]">
              <Users className="w-4 h-4 text-[#c4a45a]" />
              <span>Physical Social Objective:</span>
            </div>
            <p className="text-xs text-[#8e95a5] leading-relaxed">
              Mingle with other players in the room. Find 4 other shades holding different roles to complete your escape crew:
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {roles.map(r => (
                <span
                  key={r.id}
                  className={`text-[10px] px-2 py-0.5 rounded-md font-medium border ${
                    r.id === role.id
                      ? 'border-[#c4a45a] bg-[#c4a45a]/20 text-[#f4f0e8] font-bold'
                      : 'border-[#2a2e3d] bg-[#10121a] text-[#8e95a5]'
                  }`}
                >
                  {r.id === role.id ? '✓ ' : ''}{r.name}
                </span>
              ))}
            </div>
          </div>

          {/* TWO PRIMARY ACTIONS: CREATE TEAM OR JOIN TEAM */}
          <div className="space-y-2.5 pt-2">
            <button
              onClick={handleCreateTeamSubmit}
              disabled={isCreating}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-black text-sm tracking-wide flex items-center justify-center space-x-2 shadow-gold-glow transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{isCreating ? 'Creating Crew...' : '+ Create a Team'}</span>
            </button>

            <button
              onClick={() => {
                setShowJoinModal(true);
                setSelectedEmojis([]);
                setPreviewData(null);
                setJoinError(null);
              }}
              className="w-full py-3 px-4 rounded-xl bg-[#161922] hover:bg-[#202533] border border-[#3a4157] hover:border-[#c4a45a] text-[#f4f0e8] font-serif font-bold text-xs tracking-wide flex items-center justify-center space-x-2 transition-all shadow-sm"
            >
              <span>🤝 Join a Team (Enter 3 Emojis)</span>
            </button>
          </div>

          {createError && (
            <div className="p-2.5 rounded-lg bg-red-950/80 border border-red-500/60 text-red-200 text-xs font-medium">
              {createError}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* JOIN TEAM EMOJI DIALPAD & CONFIRMATION MODAL                             */}
      {/* ========================================================================= */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 relative overflow-hidden">
            {/* Top Close Button */}
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
              <div>
                <h3 className="text-base font-serif font-black text-[#f4f0e8]">Join a Team</h3>
                <p className="text-[11px] text-[#8e95a5]">Tap the 3 emojis from your teammate&apos;s screen</p>
              </div>
              <button
                onClick={() => setShowJoinModal(false)}
                className="text-[#8e95a5] hover:text-[#f4f0e8] text-base p-1"
              >
                ✕
              </button>
            </div>

            {/* 3-Slot Indicator */}
            <div className="space-y-1">
              <div className="flex items-center justify-center space-x-3 py-2">
                {[0, 1, 2].map((slotIdx) => {
                  const emoji = selectedEmojis[slotIdx];
                  const isCurrent = slotIdx === selectedEmojis.length;

                  return (
                    <div
                      key={slotIdx}
                      className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center border-2 transition-all ${
                        emoji
                          ? 'bg-[#161922] border-[#c4a45a] shadow-gold-glow scale-105'
                          : isCurrent
                          ? 'bg-[#161922] border-[#c4a45a]/70 border-dashed animate-pulse'
                          : 'bg-[#161922]/50 border-[#2a2e3d] border-dashed'
                      }`}
                    >
                      {emoji ? (
                        <>
                          <span className="text-2xl">{emoji}</span>
                          <span className="text-[9px] font-mono font-bold text-[#c4a45a] uppercase tracking-wider">
                            {TEAM_EMOJI_LABELS[emoji]}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-mono text-[#8e95a5]">#{slotIdx + 1}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Phonetic Subtitle */}
              {selectedEmojis.length > 0 && (
                <p className="text-center text-xs font-mono font-bold text-[#c4a45a] tracking-wider">
                  {selectedEmojis.map(e => TEAM_EMOJI_LABELS[e]).join(' • ')}
                </p>
              )}
            </div>

            {/* The 5 Emojis Dialpad */}
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1.5">
                {TEAM_EMOJI_POOL.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleEmojiTap(emoji)}
                    disabled={selectedEmojis.length >= 3 || isPreviewLoading}
                    className="flex flex-col items-center justify-center py-2.5 px-1 rounded-xl bg-[#161922] hover:bg-[#202533] border border-[#2a2e3d] hover:border-[#c4a45a] active:scale-95 transition-all disabled:opacity-40"
                  >
                    <span className="text-2xl mb-0.5">{emoji}</span>
                    <span className="text-[10px] font-mono font-bold text-[#f4f0e8]">
                      {TEAM_EMOJI_LABELS[emoji]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Dialpad Utility Buttons (Backspace / Clear) */}
              <div className="flex items-center justify-between text-xs font-mono pt-1">
                <button
                  type="button"
                  onClick={handleClearEmojis}
                  disabled={selectedEmojis.length === 0}
                  className="text-[#8e95a5] hover:text-[#f4f0e8] disabled:opacity-30"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={handleBackspace}
                  disabled={selectedEmojis.length === 0}
                  className="flex items-center space-x-1 text-[#e5cb87] hover:text-[#f4f0e8] disabled:opacity-30 font-bold"
                >
                  <Delete className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {/* Loading Indicator */}
            {isPreviewLoading && (
              <div className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-center space-x-2 text-xs font-mono text-[#c4a45a]">
                <RotateCcw className="w-4 h-4 animate-spin" />
                <span>Finding crew...</span>
              </div>
            )}

            {/* Error Message */}
            {joinError && (
              <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/60 text-red-200 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{joinError}</span>
              </div>
            )}

            {/* =============================================================== */}
            {/* PREVIEW & CONFIRMATION CARD (PREVENTS MISCLICKS)                */}
            {/* =============================================================== */}
            {previewData && (
              <div className="p-4 rounded-xl bg-[#161922] border border-[#c4a45a]/70 shadow-gold-glow space-y-3 animate-fade-in">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-[#a9b4c7] block">
                      Found Team
                    </span>
                    <h4 className="text-sm font-serif font-black text-[#f4f0e8]">
                      {previewData.name}
                    </h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#c4a45a] px-2 py-0.5 rounded bg-[#10121a] border border-[#2a2e3d]">
                    {previewData.memberCount}/{previewData.maxMembers} Seats
                  </span>
                </div>

                {/* Existing Members Roster */}
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#8e95a5]">
                    Current Crewmates:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {previewData.members.map((m) => (
                      <span
                        key={m.id}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#10121a] border border-[#2a2e3d] text-[#cbd5e1]"
                      >
                        {m.name} ({m.roleName})
                      </span>
                    ))}
                  </div>
                </div>

                {/* Compatibility Assessment */}
                {previewData.isFull ? (
                  <div className="p-2.5 rounded-lg bg-red-950/70 border border-red-500/50 text-red-200 text-xs">
                    ⚠️ This team is already full ({previewData.maxMembers}/{previewData.maxMembers})!
                  </div>
                ) : previewData.hasRoleConflict ? (
                  <div className="p-2.5 rounded-lg bg-amber-950/70 border border-amber-500/50 text-amber-200 text-xs space-y-1">
                    <p className="font-bold">
                      ⚠️ Role Conflict: {previewData.conflictingRoleName}
                    </p>
                    <p className="text-[11px] leading-tight">
                      This crew already has a {previewData.conflictingRoleName}. Each crew requires unique Underworld roles. Re-roll your role or join another crew.
                    </p>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-500/50 text-emerald-200 text-xs flex items-center space-x-1.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Your role ({role.name}) is open for this crew!</span>
                  </div>
                )}

                {/* Confirmation Action Buttons */}
                <div className="flex space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClearEmojis}
                    className="flex-1 py-2.5 rounded-xl border border-[#2a2e3d] text-xs font-semibold text-[#8e95a5] hover:bg-[#10121a]"
                  >
                    Change Code
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmJoin}
                    disabled={isJoining || previewData.isFull || previewData.hasRoleConflict}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] text-xs font-bold font-serif shadow-gold-glow flex items-center justify-center space-x-1 disabled:opacity-40"
                  >
                    <span>{isJoining ? 'Joining...' : 'Confirm & Join'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
