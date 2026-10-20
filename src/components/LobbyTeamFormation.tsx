import React, { useState } from 'react';
import { useGameSession } from '../context/GameContext';
import { Copy, Check, Users, Sparkles, Compass, Eye, Book, Flame, Shield, Plus, Edit2, AlertCircle, Dices } from 'lucide-react';

const ROLE_ICONS: Record<string, React.ReactNode> = {
  compass: <Compass className="w-5 h-5" />,
  eye: <Eye className="w-5 h-5" />,
  book: <Book className="w-5 h-5" />,
  flame: <Flame className="w-5 h-5" />,
  shield: <Shield className="w-5 h-5" />,
};

export const LobbyTeamFormation: React.FC = () => {
  const { player, role, team, payload, formTeam, renameTeam, switchPlayer, rerollRole } = useGameSession();
  const [copied, setCopied] = useState(false);
  const [showAssembleModal, setShowAssembleModal] = useState(false);
  const [joinCodeInputs, setJoinCodeInputs] = useState<string[]>(['', '', '', '']);
  const [customCrewName, setCustomCrewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reroll fate state
  const [isRerolling, setIsRerolling] = useState(false);
  const [rerollMsg, setRerollMsg] = useState<string | null>(null);

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

  // Rename team state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameInput, setEditNameInput] = useState(team?.name || '');

  if (!player || !role) return null;

  const roles = payload?.config.roles || [];
  const teamSize = payload?.config.team_size || 5;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(player.join_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCodeInputChange = (index: number, val: string) => {
    const updated = [...joinCodeInputs];
    updated[index] = val.toUpperCase().slice(0, 3);
    setJoinCodeInputs(updated);
  };

  const handleFormTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const filledCodes = joinCodeInputs.map(c => c.trim().toUpperCase()).filter(Boolean);
    if (filledCodes.length === 0) {
      setFormError('Please enter at least one teammate\'s 3-character beacon code.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await formTeam(filledCodes, customCrewName);
      if (!res.success) {
        setFormError(res.error || 'Failed to form crew');
      } else {
        setShowAssembleModal(false);
      }
    } catch (err: any) {
      setFormError(err.message || 'Error forming crew');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editNameInput.trim()) return;
    await renameTeam(editNameInput.trim());
    setIsEditingName(false);
  };

  // If player is already in a team, show the crew lobby
  if (team) {
    return (
      <div className="space-y-5 py-4">
        {/* Crew Header Card */}
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
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
                  <button type="button" onClick={() => setIsEditingName(false)} className="text-xs text-[#8e95a5]">
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center space-x-2 mt-1">
                  <h2 className="text-lg font-serif font-black text-[#f4f0e8]">{team.name}</h2>
                  <button
                    onClick={() => {
                      setEditNameInput(team.name);
                      setIsEditingName(true);
                    }}
                    className="text-[#8e95a5] hover:text-[#c4a45a] transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="text-right">
              <span className="text-[10px] font-mono text-[#8e95a5]">CREW SCORE</span>
              <p className="text-xl font-mono font-bold text-[#c4a45a]">{team.score} PTS</p>
            </div>
          </div>

          {/* Members Roster */}
          <div className="mt-5 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#8e95a5]">
              Crew Roster ({team.player_ids.length} of {teamSize} Shades)
            </p>
            <div className="space-y-1.5">
              {team.player_ids.map((pid, idx) => {
                const isYou = pid === player.id;
                // Find matching player info
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
                        : 'bg-[#161922]/50 border-[#2a2e3d]'
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
                          style={{ color: memberRole?.color || '#8e95a5' }}
                        >
                          {memberRole?.name || 'Underworld Traveler'}
                        </span>
                      </div>
                    </div>
                    {isYou ? (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        You (Active)
                      </span>
                    ) : (
                      <button
                        onClick={() => switchPlayer(pid)}
                        className="text-[10px] font-mono text-[#c4a45a] hover:bg-[#c4a45a]/20 border border-[#c4a45a]/40 px-2 py-0.5 rounded-full transition-colors"
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

          {/* Waiting for Round 1 Banner */}
          <div className="mt-5 p-4 rounded-xl bg-gradient-to-b from-[#161922] to-[#08090c] border border-[#c4a45a]/30 text-center space-y-2">
            <div className="inline-flex items-center space-x-1.5 text-xs font-mono text-[#c4a45a]">
              <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />
              <span>THE DESCENT IS APPROACHING</span>
            </div>
            <p className="text-xs text-[#8e95a5] leading-relaxed">
              Stand together at your pub table. Keep this screen active — Round 1 will materialize synchronously across all devices.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // If player has NO team yet, show Role Beacon & Assembly view
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
              className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg border"
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
              {/* Re-roll Fate Action (Random Role Assignment) */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleRerollRole}
                  disabled={isRerolling}
                  className="px-2.5 py-1 rounded-lg bg-[#08090c] hover:bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a]/60 text-[11px] font-mono text-[#8e95a5] hover:text-[#c4a45a] flex items-center space-x-1.5 transition-all shadow-sm disabled:opacity-50"
                  title="Roll for another under-represented role if multiple people at your table have duplicates"
                >
                  <Dices className={`w-3.5 h-3.5 ${isRerolling ? 'animate-spin' : ''}`} />
                  <span>{isRerolling ? 'Consulting the Oracle...' : '🎲 Re-roll Fate (Random Role)'}</span>
                </button>
                {rerollMsg && (
                  <p className="text-[10px] font-mono text-[#c4a45a] mt-1 animate-fade-in">{rerollMsg}</p>
                )}
              </div>
            </div>
          </div>

          {/* 3-Character Beacon Join Code */}
          <div className="pt-2">
            <span className="block text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] mb-1">
              Your 3-Character Beacon Code
            </span>
            <div
              onClick={handleCopyCode}
              className="cursor-pointer bg-[#08090c] border border-[#2a2e3d] hover:border-[#c4a45a] p-3 rounded-xl flex items-center justify-between transition-all group"
            >
              <div>
                <span className="text-3xl font-mono font-black tracking-widest text-[#f4f0e8]">
                  {player.join_code}
                </span>
                <span className="block text-[9px] font-mono text-[#8e95a5] mt-0.5">
                  Tap to copy code
                </span>
              </div>
              <div className="p-2 rounded-lg bg-[#161922] text-[#8e95a5] group-hover:text-[#c4a45a] transition-colors">
                {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              </div>
            </div>
          </div>

          {/* Physical Pub Instruction */}
          <div className="bg-[#161922]/80 border border-[#2a2e3d] p-3.5 rounded-xl space-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#f4f0e8]">
              <Users className="w-4 h-4 text-[#c4a45a]" />
              <span>Physical Social Objective:</span>
            </div>
            <p className="text-xs text-[#8e95a5] leading-relaxed">
              Walk around the pub or look at neighboring tables. Find 4 other shades holding the other roles:
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

          {/* Form Crew Button */}
          <button
            onClick={() => setShowAssembleModal(true)}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-bold text-sm tracking-wide flex items-center justify-center space-x-2 shadow-gold-glow transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Assemble Crew (Enter Beacon Codes)</span>
          </button>
        </div>
      </div>

      {/* Assemble Crew Modal */}
      {showAssembleModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
              <div>
                <h3 className="text-base font-serif font-bold text-[#f4f0e8]">Assemble Underworld Crew</h3>
                <p className="text-[11px] text-[#8e95a5]">Enter the 3-char codes from your teammates' screens</p>
              </div>
              <button
                onClick={() => setShowAssembleModal(false)}
                className="text-[#8e95a5] hover:text-[#f4f0e8] text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormTeamSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] mb-2 font-semibold">
                  Teammate Beacon Codes
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {joinCodeInputs.map((code, idx) => (
                    <div key={idx} className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#8e95a5]">
                        #{idx + 2}
                      </span>
                      <input
                        type="text"
                        value={code}
                        onChange={(e) => handleCodeInputChange(idx, e.target.value)}
                        placeholder="e.g. K9P"
                        maxLength={3}
                        className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-lg pl-8 pr-3 py-2 text-center text-sm font-mono font-bold text-[#f4f0e8] uppercase outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] mb-1 font-semibold">
                  Name Your Crew (Optional)
                </label>
                <input
                  type="text"
                  value={customCrewName}
                  onChange={(e) => setCustomCrewName(e.target.value)}
                  placeholder="e.g. The Stygian Rowers"
                  maxLength={30}
                  className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-lg px-3 py-2 text-xs text-[#f4f0e8] placeholder-[#8e95a5]/50 outline-none"
                />
              </div>

              {formError && (
                <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/50 text-red-300 text-xs flex items-center space-x-1.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAssembleModal(false)}
                  className="flex-1 py-2.5 rounded-lg border border-[#2a2e3d] text-xs font-semibold text-[#8e95a5] hover:bg-[#161922]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] text-xs font-bold font-serif disabled:opacity-50"
                >
                  {isSubmitting ? 'Binding Crew...' : 'Lock In Crew'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
