import React, { useEffect, useState } from 'react';
import { Users, Plus, Edit2, Check, X } from 'lucide-react';
import { useGame } from '../game/useGame';
import type { TeamPreview } from '../game/useGame';
import { ART } from '../../games/underworld/art.ts';
import { ArtImage, BTN_DARK, BTN_GOLD, ErrorNote } from './ui';
import { EmojiKeypad } from './EmojiKeypad';

export const LobbyTeamFormation: React.FC = () => {
  const { view, meta, send, previewTeam } = useGame();
  const me = view?.me;
  const team = view?.team;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showJoin, setShowJoin] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const pool = meta?.emojiPool ?? [];
  const size = meta?.teamSize ?? { min: 3, target: 5, max: 6 };
  // Live crew size (admin-settable in the lobby); fall back to the meta default.
  const crewSize = view?.lobby?.crewSize ?? size.target;

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
    const seated = team.members.slice(0, crewSize);
    const extras = team.members.slice(crewSize);
    const openSeats = Math.max(0, crewSize - count);
    const isMe = (m: { name: string }) => m.name === me.name;
    const isSolo = count <= 1;

    return (
      <div className="space-y-6 py-4">
        <section className="space-y-3">
          {editing ? (
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!nameInput.trim()) return;
                void run(
                  'rename',
                  () => send('RENAME_TEAM', { name: nameInput.trim() }),
                  () => setEditing(false),
                );
              }}
              className="flex items-center space-x-2"
            >
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={32}
                autoFocus
                aria-label="Crew name"
                className="min-h-[48px] min-w-0 flex-1 bg-[#161922] border border-[#c4a45a] rounded-lg px-2.5 text-base text-[#f4f0e8] outline-none"
              />
              <button type="submit" className="min-h-[48px] text-base bg-[#c4a45a] text-[#08090c] font-bold px-4 rounded-lg">
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="min-h-[48px] text-base text-[#a9b4c7] px-2">
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center gap-1">
              <h2 data-testid="team-name" className="min-w-0 text-2xl font-serif font-black text-[#f4f0e8] text-center text-balance [overflow-wrap:anywhere]">
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

          <div className="flex flex-wrap justify-center gap-2" aria-label="Your crew">
            {seated.map((member, mi) => (
              <span
                key={`m${mi}`}
                data-testid="seat-filled"
                className={`inline-flex items-center gap-1.5 min-h-[40px] py-1.5 px-3 rounded-2xl border bg-[#c4a45a]/10 text-base ${isMe(member) ? 'border-[#c4a45a] font-bold text-[#f4f0e8]' : 'border-[#3a4157] text-[#cbd5e1]'}`}
              >
                <span className="min-w-0 text-left leading-tight [overflow-wrap:anywhere]">{isMe(member) ? `${member.name} (you)` : member.name}</span>
              </span>
            ))}
            {Array.from({ length: openSeats }, (_v, oi) => (
              <span
                key={`o${oi}`}
                data-testid="seat-open"
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-full border border-dashed border-[#5b6377] text-base text-[#a9b4c7]"
              >
                <Users className="w-4 h-4" />
                <span>Open seat</span>
              </span>
            ))}
            {extras.map((m, i) => (
              <span
                key={`x${i}`}
                className="inline-flex items-center min-h-[40px] py-1.5 px-3 rounded-2xl border border-[#3a4157] text-base text-[#cbd5e1] [overflow-wrap:anywhere]"
              >
                {isMe(m) ? `${m.name} (you)` : m.name}
              </span>
            ))}
          </div>
          <p data-testid="size-hint" className="text-center text-sm text-[#a9b4c7]">
            {count} of {crewSize}
          </p>
        </section>

        <section className="text-center space-y-1 py-4 rounded-2xl border border-[#c4a45a]/50 bg-[#10121a]">
          <span className="text-base text-[#a9b4c7]">Join code</span>
          <div data-testid="team-code" className="text-5xl tracking-widest font-black py-1">
            {team.emojiCode}
          </div>
        </section>

        <ArtImage src={ART.lobby} className="aspect-[780/449] w-full rounded-2xl overflow-hidden" imgClassName="object-cover" />

        <ErrorNote text={error} />

        <p className="text-center text-lg font-serif font-bold text-[#e5cb87]">Waiting for the host</p>

        <div className="text-center">
          <button
            data-testid="leave-team"
            disabled={busy === 'leave'}
            onClick={() => {
              if (!confirm(isSolo ? 'Disband this team and return to the lobby?' : 'Leave this crew and return to the lobby?')) return;
              void run('leave', () => send('LEAVE_TEAM', {}));
            }}
            className="min-h-[44px] px-3 text-sm text-[#a9b4c7] underline underline-offset-4 hover:text-[#f4f0e8] disabled:opacity-50"
          >
            {busy === 'leave' ? 'Leaving…' : 'Need to switch groups?'}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- no team yet
  const confirmJoin = () => {
    if (!preview) return;
    void run(
      'join',
      () => send('JOIN_TEAM', { code: preview.emojiCode }),
      () => {
        setShowJoin(false);
        setPicked([]);
        setPreview(null);
      },
    );
  };

  return (
    // Centred a little above the middle of the space under the navbar, where a thumb lands.
    <div className="min-h-[calc(100dvh-8rem)] flex flex-col justify-center pb-16">
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <h2 className="text-3xl font-serif font-black text-[#f4f0e8]">Find your crew</h2>
          <p className="text-lg text-[#cbd5e1]">Team up with {crewSize - 1} friends.</p>
        </div>

        <div className="space-y-3">
          <button data-testid="create-team" onClick={() => run('create', () => send('CREATE_TEAM', {}))} disabled={busy === 'create'} className={BTN_GOLD}>
            <Plus className="w-4 h-4" />
            <span>{busy === 'create' ? 'Creating…' : 'Create a crew'}</span>
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
            <span>Join with 3 emojis</span>
          </button>
        </div>
        {!showJoin && <ErrorNote text={error} />}
      </div>

      {showJoin && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Join a crew"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-start sm:items-center justify-center p-4 overflow-y-auto"
        >
          <div className="my-auto bg-[#10121a] border border-[#3a4157] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3">
              <div>
                <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Join a crew</h3>
                <p className="text-base text-[#a9b4c7]">Tap your crewmate’s 3 emojis</p>
              </div>
              <button
                onClick={() => setShowJoin(false)}
                aria-label="Close"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border border-[#3a4157] text-[#a9b4c7] hover:text-[#f4f0e8]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {preview ? (
              <div className="space-y-3" data-testid="team-preview">
                <div className="p-4 rounded-xl bg-[#161922] border border-[#c4a45a]/60 space-y-1.5">
                  <div className="text-lg font-serif font-black text-[#f4f0e8] [overflow-wrap:anywhere]">{preview.name}</div>
                  <div className="text-sm text-[#a9b4c7]">
                    {preview.memberCount} of {preview.maxMembers} members • led by {preview.leaderName}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {preview.members.map((m, i) => (
                      <span key={i} className="text-sm px-2 py-1 rounded-md border border-[#3a4157] text-[#cbd5e1] [overflow-wrap:anywhere]">
                        {m.name}
                      </span>
                    ))}
                  </div>
                  {preview.isFull && <p className="text-sm text-red-300">This team is full.</p>}
                </div>
                <ErrorNote text={error} />
                <button
                  type="button"
                  data-testid="join-change"
                  onClick={() => setPicked([])}
                  className="w-full min-h-[44px] text-base text-[#a9b4c7] underline underline-offset-4"
                >
                  Try another code
                </button>
                <button data-testid="confirm-join" onClick={confirmJoin} disabled={busy === 'join' || preview.isFull} className={BTN_GOLD}>
                  <Check className="w-4 h-4" />
                  <span>{busy === 'join' ? 'Joining…' : `Join ${preview.name}`}</span>
                </button>
              </div>
            ) : (
              <>
                {previewLoading && <p className="text-center text-base text-[#e5cb87]">Looking for that crew…</p>}
                <ErrorNote text={error} />
                <EmojiKeypad pool={pool} value={picked} onChange={setPicked} slotsTestId="join-code-display" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
