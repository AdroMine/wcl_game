import React, { useEffect, useState } from 'react';
import { Users, Sparkles, Plus, Edit2, Dices, LogOut, Delete, Check, ArrowRight, AlertTriangle } from 'lucide-react';
import { useGame } from '../game/useGame';
import type { TeamPreview } from '../game/useGame';
import { BTN_DARK, BTN_DANGER, BTN_GOLD, CARD, ErrorNote, LABEL, RoleIcon, useRoles } from './ui';

const EMOJI_LABELS: Record<string, string> = { '🔥': 'Fire', '💀': 'Skull', '⚡': 'Bolt', '🌊': 'Wave', '🛡️': 'Shield' };
const labelsOf = (emojis: string[]) => emojis.map(e => EMOJI_LABELS[e] ?? '').filter(Boolean).join(' • ');

export const LobbyTeamFormation: React.FC = () => {
  const { view, meta, send, previewTeam } = useGame();
  const { list: roles, byId } = useRoles();
  const me = view?.me;
  const team = view?.team;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [showJoin, setShowJoin] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const pool = meta?.emojiPool ?? [];
  const size = meta?.teamSize ?? { min: 3, target: 5, max: 6 };

  useEffect(() => {
    if (picked.length !== 3) {
      setPreview(null);
      return;
    }
    let live = true;
    setPreviewLoading(true);
    setError(null);
    previewTeam(picked.join('')).then(r => {
      if (!live) return;
      setPreviewLoading(false);
      if (r.ok) setPreview(r.team);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [picked, previewTeam]);

  if (!me) return null;
  const role = byId(me.role);

  const run = async (key: string, fn: () => ReturnType<typeof send>, onOk?: () => void) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.message ?? 'Something went wrong.');
    else onOk?.();
  };

  // ---------------------------------------------------------------- in a team
  if (team) {
    const count = team.members.length;
    // One card per role: filled with the first member holding it, otherwise Missing Role.
    const used = new Set<number>();
    const cards = roles.map(r => {
      const idx = team.members.findIndex((m, i) => m.role === r.id && !used.has(i));
      if (idx >= 0) used.add(idx);
      return { role: r, member: idx >= 0 ? team.members[idx] : null };
    });
    const extras = team.members.filter((_m, i) => !used.has(i));
    const isMe = (m: { name: string; role: string }) => m.name === me.name && m.role === me.role;
    const isSolo = count <= 1;
    const enough = count >= size.min;

    return (
      <div className="space-y-5 py-4">
        <div className={`${CARD} relative overflow-hidden space-y-4`}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-2">
              <span className={LABEL}>Your Formed Crew</span>
              {editing ? (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    if (!nameInput.trim()) return;
                    void run('rename', () => send('RENAME_TEAM', { name: nameInput.trim() }), () => setEditing(false));
                  }}
                  className="flex items-center space-x-2 mt-1"
                >
                  <input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    maxLength={32}
                    autoFocus
                    aria-label="Crew name"
                    className="min-h-[48px] min-w-0 flex-1 bg-[#161922] border border-[#c4a45a] rounded-lg px-2.5 text-base text-[#f4f0e8] outline-none"
                  />
                  <button type="submit" className="min-h-[48px] text-sm bg-[#c4a45a] text-[#08090c] font-bold px-3 rounded">
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="min-h-[48px] text-sm text-[#a9b4c7] px-1">
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center space-x-2 mt-1">
                  <h2 data-testid="team-name" className="text-xl font-serif font-black text-[#f4f0e8] truncate">
                    {team.name}
                  </h2>
                  <button
                    onClick={() => {
                      setNameInput(team.name);
                      setEditing(true);
                    }}
                    aria-label="Rename crew"
                    className="w-11 h-11 flex items-center justify-center text-[#a9b4c7] hover:text-[#e5cb87] transition-colors shrink-0"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] font-mono text-[#a9b4c7]">CREW SCORE</span>
              <p className="text-xl font-mono font-bold text-[#e5cb87]">{team.score} PTS</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#12151e] to-[#161922] border border-[#c4a45a]/60 text-center space-y-1.5 shadow-gold-glow">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#a9b4c7] font-bold block">TEAM JOIN CODE</span>
            <div data-testid="team-code" className="text-5xl tracking-widest font-black py-1">
              {team.emojiCode}
            </div>
            <div className="text-xs font-mono font-bold text-[#e5cb87] uppercase tracking-wider">
              {labelsOf(splitEmojis(team.emojiCode, pool))}
            </div>
            <p className="text-sm text-[#8e95a5] italic font-serif">Tell teammates to tap these 3 emojis on their phone</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#a9b4c7]">
                Crew Roster ({count} of {size.target} Shades)
              </p>
              <span data-testid="size-hint" className={`text-[11px] font-mono ${enough ? 'text-emerald-400' : 'text-amber-400'}`}>
                {enough ? `Ready: ${size.min} to ${size.max} allowed` : `Need at least ${size.min}, aim for ${size.target}`}
              </span>
            </div>

            <div className="space-y-2">
              {cards.map(({ role: r, member }) =>
                member ? (
                  <div
                    key={r.id}
                    data-testid="role-card-filled"
                    className={`flex items-center justify-between p-3 min-h-[56px] rounded-xl border transition-all ${
                      isMe(member) ? 'bg-[#161922] border-[#c4a45a]/50 shadow-sm' : 'bg-[#161922]/60 border-[#3a4157]'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${r.color}25`, color: r.color, border: `1px solid ${r.color}50` }}
                      >
                        <RoleIcon icon={r.icon} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#f4f0e8] truncate">{isMe(member) ? `${member.name} (You)` : member.name}</div>
                        <span className="text-[11px] font-medium" style={{ color: r.color }}>
                          {r.name}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                      {isMe(member) ? 'You' : 'Ready'}
                    </span>
                  </div>
                ) : (
                  <div
                    key={r.id}
                    data-testid="role-card-missing"
                    className="flex items-center justify-between p-3 min-h-[56px] rounded-xl border border-dashed border-amber-500/50 bg-amber-950/10"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border border-dashed border-[#3a4157] text-[#5b6377]">
                        <RoleIcon icon={r.icon} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#8e95a5]">{r.name}</div>
                        <span className="text-[11px] text-[#5b6377]">Nobody yet</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/60 border border-amber-500/50 px-2 py-1 rounded-full uppercase tracking-wide">
                      Missing Role
                    </span>
                  </div>
                ),
              )}
              {extras.map((m, i) => {
                const r = byId(m.role);
                return (
                  <div key={`x${i}`} className="flex items-center justify-between p-3 min-h-[56px] rounded-xl border border-[#3a4157] bg-[#161922]/40">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#f4f0e8] truncate">{isMe(m) ? `${m.name} (You)` : m.name}</div>
                      <span className="text-[11px] text-[#8e95a5]">Extra crewmate • {r?.name ?? m.role}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <ErrorNote text={error} />

          <div className="pt-2 border-t border-[#2a2e3d]/80 flex items-center justify-between gap-3">
            <span className="text-xs text-[#8e95a5]">{isSolo ? 'Wrong group? Disband with 1 tap.' : 'Need to switch groups?'}</span>
            <button
              data-testid="leave-team"
              disabled={busy === 'leave'}
              onClick={() => {
                if (!confirm(isSolo ? 'Disband this team and return to the lobby?' : 'Leave this crew and return to the lobby?')) return;
                void run('leave', () => send('LEAVE_TEAM', {}));
              }}
              className={BTN_DANGER}
            >
              <LogOut className="w-4 h-4" />
              <span>{busy === 'leave' ? 'Leaving...' : isSolo ? 'Disband Team' : 'Leave Team'}</span>
            </button>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-b from-[#161922] to-[#08090c] border border-[#c4a45a]/40 text-center space-y-2">
            <div className="inline-flex items-center space-x-1.5 text-xs font-mono text-[#e5cb87] font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>THE DESCENT IS APPROACHING</span>
            </div>
            <p className="text-sm text-[#cbd5e1] leading-relaxed">
              Stand together at your pub table. Keep this screen open: when the host starts the descent, a short story and the rules will guide your crew into Round 1.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- no team yet
  const confirmJoin = () => {
    if (!preview) return;
    void run('join', () => send('JOIN_TEAM', { code: preview.emojiCode }), () => {
      setShowJoin(false);
      setPicked([]);
      setPreview(null);
    });
  };

  return (
    <div className="space-y-5 py-4">
      {role && (
        <div
          className="rounded-2xl p-6 border shadow-beacon relative overflow-hidden transition-all"
          style={{ borderColor: role.color, backgroundColor: '#10121a', '--beacon-glow': `${role.color}55` } as React.CSSProperties}
        >
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ backgroundColor: role.color }} />
          <div className="relative z-10 space-y-4">
            <span
              className="text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${role.color}20`, color: role.color, border: `1px solid ${role.color}40` }}
            >
              Assigned Underworld Role
            </span>
            <div className="flex items-center space-x-3.5">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg border shrink-0"
                style={{ backgroundColor: `${role.color}15`, borderColor: `${role.color}60`, color: role.color }}
              >
                <RoleIcon icon={role.icon} className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h2 data-testid="my-role" className="text-2xl font-serif font-black tracking-wide text-[#f4f0e8]">
                  {role.name}
                </h2>
                <p className="text-sm text-[#8e95a5] mt-0.5 leading-snug">{role.description}</p>
              </div>
            </div>
            <button
              type="button"
              data-testid="reroll"
              onClick={() => run('reroll', () => send('REROLL_ROLE', {}), () => {
                setNote('Fate re-cast! A new role was assigned.');
                setTimeout(() => setNote(null), 3500);
              })}
              disabled={busy === 'reroll'}
              className="min-h-[56px] w-full rounded-xl bg-[#08090c] hover:bg-[#161922] border border-[#2a2e3d] hover:border-[#c4a45a]/60 text-sm font-mono text-[#8e95a5] hover:text-[#c4a45a] flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
            >
              <Dices className={`w-4 h-4 ${busy === 'reroll' ? 'animate-spin' : ''}`} />
              <span>{busy === 'reroll' ? 'Consulting Oracle...' : 'Re-roll Fate (Random Role)'}</span>
            </button>
            {note && <p className="text-xs font-mono text-[#c4a45a]">{note}</p>}

            <div className="bg-[#161922]/80 border border-[#2a2e3d] p-3.5 rounded-xl space-y-1.5">
              <div className="flex items-center space-x-1.5 text-sm font-semibold text-[#f4f0e8]">
                <Users className="w-4 h-4 text-[#c4a45a]" />
                <span>Physical Social Objective:</span>
              </div>
              <p className="text-sm text-[#8e95a5] leading-relaxed">
                Mingle with other players in the room. Find {size.target - 1} other shades holding different roles to complete your escape crew ({size.min} to {size.max} players per crew):
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {roles.map(r => (
                  <span
                    key={r.id}
                    className={`text-[11px] px-2 py-1 rounded-md font-medium border ${
                      r.id === role.id ? 'border-[#c4a45a] bg-[#c4a45a]/20 text-[#f4f0e8] font-bold' : 'border-[#2a2e3d] bg-[#10121a] text-[#8e95a5]'
                    }`}
                  >
                    {r.id === role.id ? '✓ ' : ''}
                    {r.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <button data-testid="create-team" onClick={() => run('create', () => send('CREATE_TEAM', {}))} disabled={busy === 'create'} className={BTN_GOLD}>
                <Plus className="w-4 h-4" />
                <span>{busy === 'create' ? 'Creating Crew...' : 'Create a Team'}</span>
              </button>
              <button
                data-testid="join-team"
                onClick={() => {
                  setShowJoin(true);
                  setPicked([]);
                  setPreview(null);
                  setError(null);
                }}
                className={BTN_DARK}
              >
                <span>Join a Team (Enter 3 Emojis)</span>
              </button>
            </div>
            {!showJoin && <ErrorNote text={error} />}
          </div>
        </div>
      )}

      {showJoin && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
              <div>
                <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Join a Team</h3>
                <p className="text-xs text-[#8e95a5]">Tap the 3 emojis from your teammate&apos;s screen</p>
              </div>
              <button onClick={() => setShowJoin(false)} aria-label="Close" className="w-11 h-11 text-[#8e95a5] hover:text-[#f4f0e8] text-lg">
                ✕
              </button>
            </div>

            <div className="flex items-center justify-center space-x-3 py-1">
              {[0, 1, 2].map(i => {
                const e = picked[i];
                const current = i === picked.length;
                return (
                  <div
                    key={i}
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 transition-all ${
                      e ? 'bg-[#161922] border-[#c4a45a] shadow-gold-glow' : current ? 'bg-[#161922] border-[#c4a45a]/70 border-dashed' : 'bg-[#161922]/50 border-[#2a2e3d] border-dashed'
                    }`}
                  >
                    {e && <span className="text-3xl">{e}</span>}
                  </div>
                );
              })}
            </div>

            {preview ? (
              <div className="space-y-3" data-testid="team-preview">
                <div className="p-4 rounded-xl bg-[#161922] border border-[#c4a45a]/60 space-y-1.5">
                  <div className="text-base font-serif font-black text-[#f4f0e8]">{preview.name}</div>
                  <div className="text-xs font-mono text-[#a9b4c7]">
                    {preview.memberCount} of {preview.maxMembers} members • led by {preview.leaderName}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {preview.members.map((m, i) => (
                      <span key={i} className="text-[11px] px-2 py-1 rounded-md border border-[#3a4157] text-[#cbd5e1]">
                        {m.name} • {byId(m.role)?.name ?? m.role}
                      </span>
                    ))}
                  </div>
                  {preview.isFull && <p className="text-sm text-red-300">This team is full.</p>}
                  {preview.hasRoleConflict && !preview.isFull && (
                    <p className="text-sm text-amber-300 flex items-start gap-1.5">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        They already have a {byId(preview.conflictingRole ?? '')?.name ?? 'player'}. Re-roll your role first, or join another team.
                      </span>
                    </p>
                  )}
                </div>
                <ErrorNote text={error} />
                <button data-testid="confirm-join" onClick={confirmJoin} disabled={busy === 'join' || preview.isFull} className={BTN_GOLD}>
                  <Check className="w-4 h-4" />
                  <span>{busy === 'join' ? 'Joining...' : `Join ${preview.name}`}</span>
                </button>
              </div>
            ) : (
              <>
                {previewLoading && <p className="text-center text-sm font-mono text-[#e5cb87]">Looking for that crew...</p>}
                <ErrorNote text={error} />
                <div className="grid grid-cols-5 gap-2">
                  {pool.map(e => (
                    <button
                      key={e}
                      data-testid={`emoji-${e}`}
                      onClick={() => picked.length < 3 && setPicked([...picked, e])}
                      aria-label={EMOJI_LABELS[e] ?? e}
                      className="min-h-[56px] rounded-xl bg-[#161922] hover:bg-[#202533] border border-[#3a4157] hover:border-[#c4a45a] text-3xl flex items-center justify-center active:scale-95 transition"
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPicked(picked.slice(0, -1))} disabled={!picked.length} className={`${BTN_DARK} flex-1`}>
                    <Delete className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                  <button onClick={() => setPicked([])} disabled={!picked.length} className={`${BTN_DARK} flex-1`}>
                    <ArrowRight className="w-4 h-4 rotate-180" />
                    <span>Clear</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Split "🔥💀⚡" into its pool emojis (some are two code points). */
function splitEmojis(code: string, pool: string[]): string[] {
  const out: string[] = [];
  let rest = code;
  while (rest.length) {
    const hit = [...pool].sort((a, b) => b.length - a.length).find(e => rest.startsWith(e));
    if (!hit) break;
    out.push(hit);
    rest = rest.slice(hit.length);
  }
  return out;
}
