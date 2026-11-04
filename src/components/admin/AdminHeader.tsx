// Header (phase, countdown, venue, status light), the always-visible flow bar and the tool buttons.
// The sticky block is kept short for a phone: phase line, status line and the main flow row.
import React, { useState } from 'react';
import { Pause, Play, QrCode, RefreshCw, RotateCcw, Shield, SkipForward, Trophy, LogOut, ChevronDown, ChevronUp } from 'lucide-react';
import type { AdminViewData, Health, ServerLight } from '../../game/admin';
import { formatClock } from '../../game/clock';
import { BOX, BTN, BTN_PRIMARY, BTN_RED, mss } from './kit';
import { ExportCard } from './ExportCard';
import type { Ask, Run } from './kit';

const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'Lobby',
  R1_ACTIVE: 'Round 1',
  R1_RESULTS: 'Round 1 results',
  R2_PAIRING: 'Round 2 · Pairing',
  R2_RESULTS: 'Round 2 results',
  R3_RESULTS: 'Round 3 results',
  FINISHED: 'Finished',
};
const STEP_LABEL: Record<string, string> = {
  HUDDLE: 'Huddle',
  PARLEY: 'Dialogue',
  VOTE: 'Vote',
  DEBRIEF: 'Reveal',
  BLUFF: 'Bluff',
  REVEAL: 'Reveal',
  SUDDEN_DEATH: 'Sudden Death',
};

export function phaseBase(p: AdminViewData['phase']): string {
  if (p.name === 'R2_CLASH') return `Round 2 · Clash ${p.clash}`;
  if (p.name === 'R3_ACTIVE') return `Round 3 · Wave ${p.wave}`;
  return PHASE_LABEL[p.name] ?? p.name;
}
export function stepLabel(step: string | null): string {
  return step ? (step === 'BRIEFING' ? 'Briefing' : STEP_LABEL[step] ?? step) : '';
}

const NEXT: Record<string, { type: string; label: string; body: string }> = {
  LOBBY: { type: 'ADMIN_START_GAME', label: 'Start Round 1', body: 'Round 1 starts with a short briefing on every phone. Unassigned players sit it out.' },
  R1_RESULTS: { type: 'ADMIN_START_R2', label: 'Start Round 2 pairing', body: 'Crews will be asked to type their rival crew code.' },
  R2_PAIRING: { type: 'ADMIN_R2_FORCE_START', label: 'Force-start clashes', body: 'Starts the clashes now. Crews that are still unpaired get the Truce points for every clash and count as Honourable.' },
  R2_RESULTS: { type: 'ADMIN_START_R3', label: 'Start Round 3', body: 'Round 3 starts with a short briefing on every phone.' },
  R3_ACTIVE: { type: 'ADMIN_END_R3', label: 'End Round 3', body: 'Ends the voyage now. Crews that have not escaped stay where they are.' },
  R3_RESULTS: { type: 'ADMIN_FINISH', label: 'Finish game', body: 'Shows the final standings on every screen.' },
};

const ADJUST: { label: string; seconds: number }[] = [
  { label: '−30 s', seconds: -30 },
  { label: '−15 s', seconds: -15 },
  { label: '+15 s', seconds: 15 },
  { label: '+30 s', seconds: 30 },
  { label: '+1 min', seconds: 60 },
];

const LIGHT_STYLE: Record<string, string> = {
  ok: 'bg-emerald-400',
  slow: 'bg-amber-400',
  down: 'bg-red-500',
};
const LIGHT_TEXT: Record<string, string> = {
  ok: 'text-emerald-300',
  slow: 'text-amber-300',
  down: 'text-red-300',
};

interface Props {
  view: AdminViewData | null;
  health: Health | null;
  light: ServerLight;
  leftMs: number | null;
  busy: boolean;
  run: Run;
  ask: Ask;
  onQr: () => void;
  onStandings: () => void;
  onReset: () => void;
  onSignOut: () => void;
  onResync: () => void;
  log: string;
}

export const AdminHeader: React.FC<Props> = ({ view, health, light, leftMs, busy, run, ask, onQr, onStandings, onReset, onSignOut, onResync, log }) => {
  const [details, setDetails] = useState(false);
  const phase = view?.phase;
  const next = phase ? NEXT[phase.name] : undefined;
  const briefing = phase?.step === 'BRIEFING';
  const timed = phase?.endsAt != null;

  return (
    <div>
      {/* Sticky: phase, status, main flow row */}
      <div className="sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 pt-2 pb-2 bg-[#08090c]/95 backdrop-blur border-b border-[#2a2e3d] space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div
              data-testid="admin-phase"
              data-phase={phase?.name ?? ''}
              data-step={phase?.step ?? ''}
              className="text-lg sm:text-2xl font-serif font-black leading-tight break-words"
            >
              {phase ? (
                <>
                  {phaseBase(phase)}
                  {phase.step && !briefing ? ` · ${stepLabel(phase.step)}` : ''}
                  {briefing ? ' · Briefing' : ''}
                  {leftMs !== null && (
                    <>
                      {' · '}
                      <span data-testid="admin-countdown" className={`font-mono tabular-nums ${phase.paused ? 'text-amber-300' : 'text-[#e5cb87]'}`}>
                        {briefing ? mss(leftMs) : formatClock(leftMs)}
                      </span>
                    </>
                  )}
                </>
              ) : (
                'Loading…'
              )}
            </div>
            {view && (
              <div data-testid="admin-venue" className="text-xs text-[#a9b4c7]">
                {view.counts.players} shades · {view.counts.teams} crews · crew size {view.crewSize}
              </div>
            )}
          </div>
          {phase?.paused && (
            <span data-testid="admin-paused" className="shrink-0 px-2 py-1 rounded-md bg-amber-500/20 border border-amber-400/60 text-amber-200 text-xs font-mono font-bold">
              Paused
            </span>
          )}
        </div>

        <div data-testid="admin-status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
          <span data-testid="admin-light" data-level={light.level} className={`flex items-center gap-1.5 min-w-0 ${LIGHT_TEXT[light.level]}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${LIGHT_STYLE[light.level]}`} />
            <span data-testid="admin-online" className="break-words min-w-0">
              {light.label}
            </span>
          </span>
          <span className="text-[#a9b4c7]">{view ? `${view.counts.connected} / ${view.counts.players} phones connected` : '- phones connected'}</span>
          <button
            data-testid="admin-details-toggle"
            onClick={() => setDetails(d => !d)}
            aria-expanded={details}
            className="ml-auto min-h-[44px] px-2 flex items-center gap-1 text-[#8e95a5] hover:text-[#f4f0e8]"
          >
            Server details
            {details ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Main flow row */}
        {phase && (
          <div data-testid="admin-flow" className="flex gap-2">
            {next ? (
              <button
                data-testid="admin-next"
                disabled={busy}
                className={`${BTN_PRIMARY} flex-1 min-w-0`}
                onClick={() => ask({ title: next.label, body: next.body, confirmLabel: next.label, onConfirm: () => void run(next.label, next.type) })}
              >
                <Play className="w-4 h-4 shrink-0" />
                <span className="truncate">{next.label}</span>
              </button>
            ) : (
              <div className="flex-1 min-w-0 self-center text-xs text-[#8e95a5]">{phase.name === 'R2_CLASH' ? 'Clashes run on their own.' : phase.name === 'R1_ACTIVE' ? 'Round 1 closes on its own.' : 'The game is over.'}</div>
            )}
            {timed && (
              <button data-testid="admin-skip" disabled={busy} className={BTN} onClick={() => void run('Skip step', 'ADMIN_SKIP_STEP', { phaseSeq: phase.phaseSeq })}>
                <SkipForward className="w-4 h-4" />
                Skip
              </button>
            )}
            {phase.paused ? (
              <button data-testid="admin-resume" disabled={busy} className={`${BTN} !border-amber-400/70`} onClick={() => void run('Resume', 'ADMIN_RESUME')}>
                <Play className="w-4 h-4" />
                Resume
              </button>
            ) : (
              <button data-testid="admin-pause" disabled={busy} className={BTN} onClick={() => void run('Pause', 'ADMIN_PAUSE')}>
                <Pause className="w-4 h-4" />
                Pause
              </button>
            )}
          </div>
        )}
      </div>

      {details && (
        <div data-testid="admin-details" className={`${BOX} mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm`}>
          <Stat label="Event-loop lag" value={health ? `${health.eventLoopLagMs.toFixed(1)} ms` : '-'} warn={!!health && health.eventLoopLagMs > 200} />
          <Stat label="Memory" value={health ? `${health.rssMB} MB (heap ${health.heapUsedMB})` : '-'} />
          <Stat label="Snapshot age" value={health ? (health.snapshotAgeSec == null ? 'none yet' : `${health.snapshotAgeSec.toFixed(0)} s${health.lastSnapshotOk ? '' : ' FAILING'}`) : '-'} warn={!!health && !health.lastSnapshotOk} />
          <Stat label="Cmds per s" value={health ? health.commandsPerSec.toFixed(1) : '-'} />
          <Stat label="Uptime" value={health ? `${Math.floor(health.uptimeSec / 60)} min` : '-'} />
          <Stat label="State version" value={view ? String(view.v) : '-'} />
          <Stat label="Open streams" value={health ? String(health.clients) : '-'} />
          <Stat label="Players / crews" value={view ? `${view.counts.players} / ${view.counts.teams}` : '-'} />
          <div className="col-span-2 sm:col-span-4 border-t border-[#2a2e3d] pt-3">
            <ExportCard />
          </div>
        </div>
      )}

      {/* Timer adjust and resync */}
      {phase && (
        <div className="mt-2 space-y-2">
          {timed && (
            <div data-testid="admin-adjust" className="grid grid-cols-5 gap-1.5">
              {ADJUST.map(a => (
                <button
                  key={a.seconds}
                  disabled={busy}
                  className={`${BTN} !px-1 text-xs ${a.seconds < 0 ? '!border-red-500/70 !bg-red-950/60 !text-red-200' : '!border-emerald-500/70 !bg-emerald-950/60 !text-emerald-200'}`}
                  onClick={() => void run(a.label, 'ADMIN_ADJUST_DEADLINE', { seconds: a.seconds })}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            <ToolButton testId="admin-qr" icon={<QrCode className="w-4 h-4" />} label="Join QR" onClick={onQr} />
            <ToolButton testId="admin-standings" icon={<Trophy className="w-4 h-4" />} label="Standings" onClick={onStandings} />
            <ToolButton testId="admin-resync" icon={<RefreshCw className="w-4 h-4" />} label="Resync" onClick={onResync} disabled={busy} />
            <ToolButton testId="admin-signout" icon={<LogOut className="w-4 h-4" />} label="Sign out" onClick={onSignOut} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-mono text-[#8e95a5] break-words min-w-0" data-testid="admin-log">
              {log || 'No actions yet.'}
            </div>
            <button data-testid="admin-reset" className={`${BTN_RED} !min-h-[44px] shrink-0 text-xs`} onClick={onReset}>
              <RotateCcw className="w-3.5 h-3.5" />
              Reset game
            </button>
          </div>
        </div>
      )}
      {!phase && (
        <div className="mt-2 flex items-center gap-2 text-[#c4a45a]">
          <Shield className="w-4 h-4" />
          <span className="text-xs font-mono text-[#8e95a5]">Loading the game state…</span>
        </div>
      )}
    </div>
  );
};

const ToolButton: React.FC<{ testId: string; icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }> = ({ testId, icon, label, onClick, disabled }) => (
  <button data-testid={testId} disabled={disabled} onClick={onClick} className="min-h-[52px] px-1 rounded-lg border border-[#3a4157] bg-[#161922] hover:bg-[#202533] hover:border-[#c4a45a] text-[#f4f0e8] text-[11px] font-semibold flex flex-col items-center justify-center gap-0.5 disabled:opacity-40">
    {icon}
    <span className="truncate max-w-full">{label}</span>
  </button>
);

const Stat: React.FC<{ label: string; value: string; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-mono uppercase text-[#8e95a5]">{label}</div>
    <div className={`font-mono font-bold break-words ${warn ? 'text-amber-300' : 'text-[#f4f0e8]'}`}>{value}</div>
  </div>
);
