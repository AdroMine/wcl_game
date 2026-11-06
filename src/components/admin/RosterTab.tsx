// Tab 2: "Crews & roster". Crew cards (compact, expandable), the unassigned pool and "Add offline player".
// No rename or score editing: the admin only moves people and disbands crews in the lobby.
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Users } from 'lucide-react';
import type { AdminPlayer, AdminTeam, AdminViewData } from '../../game/admin';
import { BOX, BTN, BTN_PRIMARY, BTN_RED, CARD, H, INPUT, MAX_CREW, MUTED, membersOf, trunc } from './kit';
import type { Ask, Run } from './kit';

interface Props {
  view: AdminViewData;
  run: Run;
  busy: boolean;
  ask: Ask;
}

const Dot: React.FC<{ on: boolean }> = ({ on }) => (
  <span aria-label={on ? 'connected' : 'offline'} className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${on ? 'bg-emerald-400' : 'bg-[#3a4157]'}`} />
);

export const RosterTab: React.FC<Props> = ({ view, run, busy, ask }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [name, setName] = useState('');
  const needle = q.trim().toLowerCase();
  const unassigned = view.players.filter(p => p.teamId === null);
  const matches = (t: AdminTeam) =>
    !needle ||
    t.name.toLowerCase().includes(needle) ||
    t.emojiCode.toLowerCase().includes(needle) ||
    membersOf(view, t.id).some(p => p.name.toLowerCase().includes(needle));
  const teams = view.teams.filter(matches);
  const visibleUnassigned = unassigned.filter(p => !needle || p.name.toLowerCase().includes(needle));
  const lobby = view.phase.name === 'LOBBY';
  const setAll = (v: boolean) => setOpen(Object.fromEntries(view.teams.map(t => [t.id, v])));
  const showCodeword = view.phase.name === 'R1_ACTIVE';

  return (
    <div className="space-y-3" data-testid="tab-roster-body">
      <div className={BOX}>
        <div className={H}>Crews ({view.teams.length})</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search crew, crew code or player" aria-label="Search roster" className={`${INPUT} w-full`} />
        <div className="grid grid-cols-2 gap-2">
          <button className={BTN} onClick={() => setAll(true)}>
            Expand all
          </button>
          <button className={BTN} onClick={() => setAll(false)}>
            Collapse all
          </button>
        </div>
        {lobby && (
          <button className={`${BTN_PRIMARY} w-full`} disabled={busy || unassigned.length === 0} onClick={() => void run('Auto-group', 'ADMIN_AUTO_GROUP')}>
            <Users className="w-4 h-4" />
            Auto-group {unassigned.length} unassigned
          </button>
        )}
        <div className="space-y-2">
          {teams.map(t => (
            <CrewCard key={t.id} t={t} view={view} open={!!open[t.id]} toggle={() => setOpen(o => ({ ...o, [t.id]: !o[t.id] }))} run={run} busy={busy} ask={ask} unassigned={unassigned} lobby={lobby} showCodeword={showCodeword} />
          ))}
          {teams.length === 0 && <div className={MUTED}>No crew matches.</div>}
        </div>
      </div>

      <div className={BOX} data-testid="unassigned-pool">
        <div className={H}>Unassigned ({unassigned.length})</div>
        <div className="space-y-2">
          {visibleUnassigned.map(p => (
            <div key={p.id} data-testid="unassigned-player" className={CARD}>
              <div className="flex items-center gap-2 min-w-0">
                <Dot on={p.connected} />
                <span className="font-bold break-words min-w-0">{p.name}</span>
                {!p.canLogin && <span className="text-[10px] font-mono text-[#8e95a5]">offline player</span>}
              </div>
              <div className="flex gap-2">
                <select
                  aria-label={`Put ${p.name} in a crew`}
                  value=""
                  disabled={busy}
                  onChange={e => e.target.value && void run(`Put ${p.name} in a crew`, 'ADMIN_MOVE_PLAYER', { playerId: p.id, teamId: e.target.value })}
                  className={`${INPUT} flex-1 truncate`}
                >
                  <option value="">Put in crew…</option>
                  {view.teams.map(t => {
                    const full = t.playerIds.length >= MAX_CREW;
                    return (
                      <option key={t.id} value={t.id} disabled={full}>
                        {trunc(t.name, 22)} ({t.emojiCode}) {t.playerIds.length}/{view.crewSize}
                        {full ? ' full' : ''}
                      </option>
                    );
                  })}
                </select>
                <RemoveButton p={p} run={run} busy={busy} ask={ask} />
              </div>
            </div>
          ))}
          {unassigned.length === 0 && <div className={MUTED}>Everyone is in a crew.</div>}
        </div>
        <form
          className={`${CARD}`}
          onSubmit={e => {
            e.preventDefault();
            if (name.trim()) void run('Add offline player', 'ADMIN_ADD_PLAYER', { name: name.trim() }, () => setName(''));
          }}
        >
          <div className={H}>Add offline player</div>
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="Name" aria-label="Offline player name" data-testid="offline-name" className={`${INPUT} flex-1`} />
            <button type="submit" data-testid="offline-add" className={BTN} disabled={busy || !name.trim()}>
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const RemoveButton: React.FC<{ p: AdminPlayer; run: Run; busy: boolean; ask: Ask }> = ({ p, run, busy, ask }) => (
  <button
    aria-label={`Remove ${p.name}`}
    className={`${BTN_RED} shrink-0`}
    disabled={busy}
    onClick={() => ask({ title: `Remove ${p.name}?`, body: 'They leave the game entirely. A phone that is still open will have to join again.', confirmLabel: 'Remove', onConfirm: () => void run(`Remove ${p.name}`, 'ADMIN_REMOVE_PLAYER', { playerId: p.id }) })}
  >
    <Trash2 className="w-4 h-4" />
    <span className="hidden sm:inline">Remove</span>
  </button>
);

const CrewCard: React.FC<{
  t: AdminTeam;
  view: AdminViewData;
  open: boolean;
  toggle: () => void;
  run: Run;
  busy: boolean;
  ask: Ask;
  unassigned: AdminPlayer[];
  lobby: boolean;
  showCodeword: boolean;
}> = ({ t, view, open, toggle, run, busy, ask, unassigned, lobby, showCodeword }) => {
  const members = membersOf(view, t.id);
  const full = members.length >= view.crewSize;
  const atCap = members.length >= MAX_CREW;
  return (
    <div data-testid="admin-team" className={CARD}>
      <button onClick={toggle} aria-expanded={open} className="w-full min-h-[44px] text-left flex items-start gap-2">
        {open ? <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-[#8e95a5]" /> : <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-[#8e95a5]" />}
        <span className="min-w-0 flex-1">
          <span className="block break-words font-serif font-black text-[#f4f0e8]">
            {t.name} <span className="text-[11px] font-mono font-bold text-[#c4a45a]">[{t.emojiCode}]</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="text-base leading-none">{t.emojiCode}</span>
            <span className="font-mono font-bold text-[#e5cb87]">{t.score} pts</span>
            <span data-testid="crew-members" data-full={full} className={`font-mono font-bold ${full ? 'text-emerald-300' : 'text-[#a9b4c7]'}`}>
              {members.length}/{view.crewSize} members
            </span>
            {showCodeword && t.r1 && <span className="font-mono text-[#a9b4c7] break-all">codeword {t.r1.codeword}</span>}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 pt-1 border-t border-[#2a2e3d]">
          {members.length === 0 && <div className={MUTED}>No members.</div>}
          {members.map(p => (
            <div key={p.id} data-testid="crew-member" className="rounded-lg bg-[#10121a] border border-[#2a2e3d] p-2 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <Dot on={p.connected} />
                <span className="font-bold break-words min-w-0">{p.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className={BTN} disabled={busy} onClick={() => void run(`Move ${p.name} to the lobby`, 'ADMIN_MOVE_PLAYER', { playerId: p.id, teamId: null })}>
                  Move to lobby
                </button>
                <RemoveButton p={p} run={run} busy={busy} ask={ask} />
              </div>
            </div>
          ))}
          <select
            aria-label={`Fill seat in ${t.name}`}
            value=""
            disabled={busy || atCap || unassigned.length === 0}
            onChange={e => e.target.value && void run('Fill seat', 'ADMIN_MOVE_PLAYER', { playerId: e.target.value, teamId: t.id })}
            className={`${INPUT} w-full truncate`}
          >
            <option value="">{atCap ? `Crew is full (${MAX_CREW} at most)` : unassigned.length === 0 ? 'Fill seat (nobody unassigned)' : 'Fill seat…'}</option>
            {unassigned.map(p => (
              <option key={p.id} value={p.id}>
                {trunc(p.name, 28)}
              </option>
            ))}
          </select>
          {lobby && (
            <button
              className={`${BTN_RED} w-full`}
              disabled={busy}
              onClick={() => ask({ title: `Disband "${trunc(t.name, 30)}"?`, body: 'The crew is deleted and its players become unassigned.', confirmLabel: 'Disband', onConfirm: () => void run(`Disband ${t.name}`, 'ADMIN_DELETE_TEAM', { teamId: t.id }) })}
            >
              <Trash2 className="w-4 h-4" />
              Disband crew
            </button>
          )}
        </div>
      )}
    </div>
  );
};
