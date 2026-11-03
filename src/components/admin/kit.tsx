// Shared bits of the admin panel: class strings, modal shell, badges, selects and small helpers.
// Everything is sized for a phone first (360 to 400 px wide, 44 px touch targets).
import React from 'react';
import { X } from 'lucide-react';
import type { AdminR3Team, AdminTeam, AdminViewData } from '../../game/admin';
import type { MoralStatus } from '../../../shared/protocol';

export const BTN =
  'min-h-[44px] px-3 rounded-lg border border-[#3a4157] bg-[#161922] hover:bg-[#202533] hover:border-[#c4a45a] text-[#f4f0e8] text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition';
export const BTN_PRIMARY =
  'min-h-[48px] px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50 shadow-gold-glow';
export const BTN_RED =
  'min-h-[44px] px-3 rounded-lg border border-red-500/50 bg-red-950/40 hover:bg-red-900/60 text-red-200 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40';
export const BOX = 'bg-[#10121a] border border-[#3a4157] rounded-2xl p-3 sm:p-4 space-y-3';
export const CARD = 'rounded-xl border border-[#2a2e3d] bg-[#161922] p-3 space-y-2 min-w-0';
export const H = 'text-[11px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold';
export const INPUT = 'min-h-[44px] bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] rounded-lg px-3 text-sm text-[#f4f0e8] outline-none min-w-0';
export const MUTED = 'text-xs text-[#8e95a5]';

/** Hard cap on a crew (organizer ruling Nov 2). */
export const MAX_CREW = 6;
/** Round 3 portal distance in metres. */
export const TARGET_DISTANCE = 1000;

export type Run = (label: string, type: string, payload?: unknown, ok?: () => void) => Promise<{ ok: boolean; error?: string }>;
export interface AskOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: () => void;
}
export type Ask = (o: AskOptions) => void;

const ERROR_TEXT: Record<string, string> = {
  TEAM_FULL: 'That crew is full (6 shades at most).',
  UNKNOWN_TEAM: 'That crew no longer exists.',
  UNKNOWN_PLAYER: 'That player no longer exists.',
  WRONG_PHASE: 'Not possible in this phase.',
  STALE: 'The phase just changed; try again.',
  NOT_TIMED: 'This step has no timer.',
  NETWORK: 'Network problem; the server did not answer.',
};
export function friendlyError(e: string | undefined, status?: number): string {
  if (!e) return status ? `HTTP ${status}` : 'failed';
  return ERROR_TEXT[e] ?? e;
}

export function trunc(s: string, n = 24): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function teamLabel(t: AdminTeam, n = 24): string {
  return `${trunc(t.name, n)} (${t.battleCode})`;
}

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; danger?: boolean; testId?: string }> = ({ title, onClose, children, danger, testId }) => (
  <div data-testid={testId} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
    <div
      className={`bg-[#10121a] border ${danger ? 'border-red-500/60' : 'border-[#c4a45a]/60'} rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl overflow-hidden`}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#2a2e3d] bg-[#161922]">
        <h3 className={`text-sm font-serif font-black uppercase break-words min-w-0 ${danger ? 'text-red-300' : 'text-[#f4f0e8]'}`}>{title}</h3>
        <button aria-label="Close" onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-[#8e95a5] hover:text-[#f4f0e8] hover:bg-[#202533]">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 overflow-y-auto space-y-3 min-w-0">{children}</div>
    </div>
  </div>
);

/** The four Q7 statuses, with the Halloween panel's colours and labels. */
export const MoralBadge: React.FC<{ status: MoralStatus | undefined }> = ({ status }) => {
  const look: Record<string, [string, string]> = {
    HONOURABLE: ['🕊️ Honourable +75m', 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300'],
    BETRAYED: ['🩸 Betrayed (Cerberus)', 'bg-rose-950/80 border-rose-500/80 text-rose-300'],
    AGGRESSOR: ['🗡️ Aggressor (Hunted)', 'bg-amber-950/80 border-amber-500/80 text-amber-300'],
    BLOOD_FEUD: ['⚔️ Blood Feud', 'bg-purple-950/80 border-purple-500/80 text-purple-300'],
  };
  const l = status ? look[status] : undefined;
  if (!l) return null;
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold whitespace-nowrap ${l[1]}`}>{l[0]}</span>;
};

export const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  const cls =
    rank === 1 ? 'bg-[#c4a45a] text-[#08090c]' : rank === 2 ? 'bg-slate-300 text-[#08090c]' : rank === 3 ? 'bg-amber-800 text-amber-100' : 'bg-[#10121a] text-[#8e95a5] border border-[#2a2e3d]';
  return <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${cls}`}>#{rank}</span>;
};

export function medal(rank: number | null | undefined): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank ? `#${rank}` : '';
}

export const CrewName: React.FC<{ t: AdminTeam }> = ({ t }) => (
  <span className="min-w-0 break-words font-serif font-black text-[#f4f0e8]">
    {t.name} <span className="text-[11px] font-mono font-bold text-[#c4a45a]">[{t.battleCode}]</span>
  </span>
);

export const TeamSelect: React.FC<{ teams: AdminTeam[]; value: string; onChange: (v: string) => void; label: string; only?: string[]; testId?: string }> = ({ teams, value, onChange, label, only, testId }) => (
  <select data-testid={testId} aria-label={label} value={value} onChange={e => onChange(e.target.value)} className={`${INPUT} w-full sm:w-auto sm:min-w-[170px] truncate`}>
    <option value="">{label}</option>
    {teams
      .filter(t => !only || only.includes(t.id))
      .map(t => (
        <option key={t.id} value={t.id}>
          {teamLabel(t)}
        </option>
      ))}
  </select>
);

export function membersOf(view: AdminViewData, teamId: string) {
  return view.players.filter(p => p.teamId === teamId);
}

/** Crews sorted by points (ties by name), with R3 info where present. */
export function standings(view: AdminViewData): { team: AdminTeam; r3?: AdminR3Team }[] {
  return [...view.teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(team => ({ team, r3: view.r3?.teams[team.id] }));
}

export function mss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export function solveClock(seconds: number | null): string {
  if (seconds == null) return '?';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
