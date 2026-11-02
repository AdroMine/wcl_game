// /admin: the host's control panel. Polls the full snapshot every 2 s and sends ADMIN_* commands.
// Nothing here is shown to players; the token is typed by the host and kept in sessionStorage.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, Eye, Pause, Play, RefreshCw, RotateCcw, Shield, SkipForward, Trash2, Users, Megaphone, Timer,
} from 'lucide-react';
import {
  adminCommand, adminPost, fetchAdminView, fetchHealth, getAdminToken, setAdminToken,
} from '../game/admin';
import type { AdminViewData, Health } from '../game/admin';
import { rand } from '../game/backoff';
import { formatClock } from '../game/clock';
import { apiUrl, loadRuntimeConfig } from '../game/config';
import { useTick } from '../game/useNow';

const BTN = 'min-h-[44px] px-3 rounded-lg border border-[#3a4157] bg-[#161922] hover:bg-[#202533] hover:border-[#c4a45a] text-[#f4f0e8] text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition';
const BTN_PRIMARY = 'min-h-[48px] px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50 shadow-gold-glow';
const BTN_RED = 'min-h-[44px] px-3 rounded-lg border border-red-500/50 bg-red-950/40 hover:bg-red-900/60 text-red-200 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40';
const BOX = 'bg-[#10121a] border border-[#3a4157] rounded-2xl p-4 space-y-3';
const H = 'text-[11px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold';
const INPUT = 'min-h-[44px] bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] rounded-lg px-3 text-sm text-[#f4f0e8] outline-none';

type Tab = 'game' | 'teams' | 'players' | 'round2' | 'settings';

const NEXT_ACTION: Record<string, { type: string; label: string }> = {
  LOBBY: { type: 'ADMIN_START_GAME', label: 'Start Round 1' },
  R1_RESULTS: { type: 'ADMIN_START_R2', label: 'Start Round 2 (pairing)' },
  R2_PAIRING: { type: 'ADMIN_R2_FORCE_START', label: 'Force-start Round 2 clashes' },
  R2_RESULTS: { type: 'ADMIN_START_R3', label: 'Start Round 3' },
  R3_RESULTS: { type: 'ADMIN_FINISH', label: 'Finish game (final standings)' },
};

export const AdminControlPanel: React.FC = () => {
  const [token, setToken] = useState(getAdminToken());
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [view, setView] = useState<AdminViewData | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(true);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<Tab>('game');
  const [log, setLog] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const etag = useRef<string | null>(null);
  const offsetRef = useRef(0);
  useTick(500);

  // ---- polling: admin snapshot (ETag) + /health, every 2 s with jitter.
  // The two requests are tracked separately; "not reachable" needs 3 failed polls in a row, and the
  // timer is always rescheduled (finally) so the loop can never stall.
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fails = 0;
    const poll = async () => {
      let rescheduled = true;
      try {
        const [v, h] = await Promise.all([fetchAdminView(etag.current), fetchHealth()]);
        if (stopped) return;
        if (v.kind === 'unauthorized') {
          rescheduled = false;
          setAdminToken('');
          setToken('');
          setAuthError('The admin token was refused.');
          return;
        }
        const problems: string[] = [];
        if (v.kind === 'fail') problems.push(`admin view: ${v.reason}`);
        if (h.kind === 'fail') problems.push(`health: ${h.reason}`);
        if (h.kind === 'ok') setHealth(h.value);
        if (v.kind === 'ok') {
          etag.current = v.value.etag;
          offsetRef.current = v.value.data.serverNow - Date.now();
          setView(v.value.data);
        }
        if (problems.length === 0) {
          fails = 0;
          setOnline(true);
          setProblem('');
        } else {
          fails += 1;
          setProblem(problems.join('; '));
          if (fails >= 3) setOnline(false);
        }
      } catch (e) {
        fails += 1;
        setProblem(`poll error: ${e instanceof Error ? e.name : 'unknown'}`);
        if (fails >= 3) setOnline(false);
      } finally {
        if (!stopped && rescheduled) timer = setTimeout(() => void poll(), rand(1800, 2400));
      }
    };
    void loadRuntimeConfig()
      .catch(() => undefined)
      .then(() => {
        if (!stopped) void poll();
      });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // ---- keep a free Render instance awake while the panel is open (every 3 minutes)
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      void fetchHealth();
    }, 180_000);
    return () => clearInterval(id);
  }, [token]);

  const refreshSoon = () => {
    etag.current = null;
  };

  const run = useCallback(async (label: string, type: string, payload: unknown = {}, ok?: () => void) => {
    setBusy(true);
    const r = await adminCommand(type, payload);
    setBusy(false);
    setLog(`${new Date().toLocaleTimeString()} ${label}: ${r.ok ? 'OK' : `FAILED (${r.error ?? r.status})`}`);
    if (r.ok) {
      etag.current = null;
      ok?.();
    }
    return r;
  }, []);

  if (!token) {
    return (
      <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] flex items-center justify-center p-4">
        <form
          className={`${BOX} w-full max-w-sm`}
          onSubmit={e => {
            e.preventDefault();
            if (!tokenInput.trim()) return;
            setAdminToken(tokenInput.trim());
            setToken(tokenInput.trim());
            setTokenInput('');
            setAuthError(null);
            etag.current = null;
          }}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#c4a45a]" />
            <h1 className="text-lg font-serif font-black">Game master</h1>
          </div>
          <label htmlFor="admin-token" className={H}>
            Admin token
          </label>
          <input id="admin-token" data-testid="admin-token" type="password" autoComplete="off" value={tokenInput} onChange={e => setTokenInput(e.target.value)} className={`${INPUT} w-full`} />
          {authError && <div className="text-sm text-red-300">{authError}</div>}
          <button data-testid="admin-login" type="submit" className={`${BTN_PRIMARY} w-full`}>
            Open control panel
          </button>
        </form>
      </div>
    );
  }

  const phase = view?.phase;
  const nameOf = (id: string | null | undefined) => (id ? view?.teams.find(t => t.id === id)?.name ?? id : '-');
  const left = phase?.endsAt != null ? (phase.paused && phase.pausedAt ? phase.endsAt - phase.pausedAt : phase.endsAt - (Date.now() + offsetRef.current)) : null;
  const next = phase ? NEXT_ACTION[phase.name] : undefined;

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh">
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#c4a45a]" />
            <h1 className="text-xl font-serif font-black">Game master</h1>
          </div>
          <div className="flex items-center gap-2">
            <span data-testid="admin-online" className={`text-xs font-mono ${online ? 'text-emerald-400' : 'text-red-400'}`}>
              {online ? 'CONNECTED' : `SERVER NOT REACHABLE (${problem || 'no detail'})`}
            </span>
            {online && problem && (
              <span data-testid="admin-problem" className="text-xs font-mono text-amber-300">
                retrying: {problem}
              </span>
            )}
            <button
              className={BTN}
              onClick={() => {
                setAdminToken('');
                setToken('');
                setView(null);
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Status strip */}
        <div data-testid="admin-status" className={`${BOX} grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm`}>
          <Stat label="Phones connected" value={health ? String(health.clients) : '-'} />
          <Stat label="Event-loop lag" value={health ? `${health.eventLoopLagMs.toFixed(1)} ms` : '-'} warn={!!health && health.eventLoopLagMs > 100} />
          <Stat label="Memory" value={health ? `${health.rssMB} MB (heap ${health.heapUsedMB})` : '-'} />
          <Stat label="Snapshot age" value={health ? (health.snapshotAgeSec == null ? 'none yet' : `${health.snapshotAgeSec.toFixed(0)} s${health.lastSnapshotOk ? '' : ' FAILING'}`) : '-'} warn={!!health && !health.lastSnapshotOk} />
          <Stat label="State version" value={view ? String(view.v) : '-'} />
          <Stat label="Players / crews" value={view ? `${view.counts.players} / ${view.counts.teams}` : '-'} />
          <Stat label="Cmds per s" value={health ? health.commandsPerSec.toFixed(1) : '-'} />
          <Stat label="Uptime" value={health ? `${Math.floor(health.uptimeSec / 60)} min` : '-'} />
        </div>

        {/* Phase card */}
        {phase && (
          <div className={`${BOX}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className={H}>Current phase</div>
                <div data-testid="admin-phase" className="text-2xl font-serif font-black">
                  {phase.name}
                  {phase.step === 'BRIEFING' ? ' / Briefing (story on phones)' : phase.step ? ` / ${phase.step}` : ''}
                  {phase.name === 'R2_CLASH' ? ` (clash ${phase.clash})` : ''}
                  {phase.name === 'R3_ACTIVE' ? ` (wave ${phase.wave})` : ''}
                </div>
                {phase.paused && <div className="text-amber-300 font-bold text-sm">PAUSED</div>}
              </div>
              {left !== null && (
                <div data-testid="admin-countdown" className={`text-5xl font-mono font-black tabular-nums ${phase.paused ? 'text-amber-300' : ''}`}>
                  {formatClock(left)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {next && (
                <button data-testid="admin-next" disabled={busy} className={BTN_PRIMARY} onClick={() => void run(next.label, next.type)}>
                  <Play className="w-4 h-4" />
                  {next.label}
                </button>
              )}
              {phase.endsAt != null && (
                <button data-testid="admin-skip" disabled={busy} className={BTN} onClick={() => void run('Skip step', 'ADMIN_SKIP_STEP', { phaseSeq: phase.phaseSeq })}>
                  <SkipForward className="w-4 h-4" />
                  Skip step
                </button>
              )}
              {phase.paused ? (
                <button data-testid="admin-resume" disabled={busy} className={BTN} onClick={() => void run('Resume', 'ADMIN_RESUME')}>
                  <Play className="w-4 h-4" />
                  Resume
                </button>
              ) : (
                <button data-testid="admin-pause" disabled={busy} className={BTN} onClick={() => void run('Pause', 'ADMIN_PAUSE')}>
                  <Pause className="w-4 h-4" />
                  Pause
                </button>
              )}
              {phase.endsAt != null && (
                <>
                  <button disabled={busy} className={BTN} onClick={() => void run('+30 s', 'ADMIN_ADJUST_DEADLINE', { seconds: 30 })}>
                    <Timer className="w-4 h-4" />
                    +30 s
                  </button>
                  <button disabled={busy} className={BTN} onClick={() => void run('-30 s', 'ADMIN_ADJUST_DEADLINE', { seconds: -30 })}>
                    <Timer className="w-4 h-4" />
                    -30 s
                  </button>
                </>
              )}
              {phase.name === 'R3_ACTIVE' && (
                <button disabled={busy} className={BTN_RED} onClick={() => confirm('End Round 3 now?') && void run('End Round 3', 'ADMIN_END_R3')}>
                  End Round 3
                </button>
              )}
              <button
                data-testid="admin-resync"
                disabled={busy}
                className={BTN}
                onClick={async () => {
                  const r = await adminPost('/api/admin/resync', {});
                  setLog(`${new Date().toLocaleTimeString()} Resync all clients: ${r.ok ? `OK (${String(r.body?.notified ?? '?')} notified)` : 'FAILED'}`);
                }}
              >
                <RefreshCw className="w-4 h-4" />
                Resync all clients
              </button>
            </div>
            <div className="text-xs font-mono text-[#8e95a5]" data-testid="admin-log">
              {log || 'No actions yet.'}
            </div>
          </div>
        )}

        {/* Tabs */}
        <nav className="flex flex-wrap gap-2">
          {(
            [
              ['game', 'Announcements', Megaphone],
              ['teams', 'Crews', Users],
              ['players', 'Players', Eye],
              ['round2', 'Round 2 pairing', Activity],
              ['settings', 'Settings', RotateCcw],
            ] as [Tab, string, React.ComponentType<{ className?: string }>][]
          ).map(([id, label, Icon]) => (
            <button key={id} data-testid={`tab-${id}`} onClick={() => setTab(id)} className={`${BTN} ${tab === id ? '!border-[#c4a45a] !bg-[#c4a45a]/15' : ''}`}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>

        {view && tab === 'game' && <AnnounceTab view={view} setLog={setLog} refreshSoon={refreshSoon} />}
        {view && tab === 'teams' && <TeamsTab view={view} run={run} busy={busy} />}
        {view && tab === 'players' && <PlayersTab view={view} run={run} busy={busy} nameOf={nameOf} />}
        {view && tab === 'round2' && <PairingTab view={view} run={run} busy={busy} nameOf={nameOf} />}
        {view && tab === 'settings' && <SettingsTab run={run} busy={busy} />}
        {!view && <div className="text-sm text-[#8e95a5] font-mono">Loading the game state…</div>}
      </div>
    </div>
  );
};

type Run = (label: string, type: string, payload?: unknown, ok?: () => void) => Promise<{ ok: boolean }>;

const Stat: React.FC<{ label: string; value: string; warn?: boolean }> = ({ label, value, warn }) => (
  <div>
    <div className="text-[10px] font-mono uppercase text-[#8e95a5]">{label}</div>
    <div className={`font-mono font-bold ${warn ? 'text-red-400' : 'text-[#f4f0e8]'}`}>{value}</div>
  </div>
);

// ------------------------------------------------------------------ announcements
const AnnounceTab: React.FC<{ view: AdminViewData; setLog: (s: string) => void; refreshSoon: () => void }> = ({ view, setLog, refreshSoon }) => {
  const [text, setText] = useState('');
  const send = async (t: string | null) => {
    const r = await adminPost('/api/admin/notice', { text: t });
    setLog(`${new Date().toLocaleTimeString()} Notice: ${r.ok ? 'OK' : 'FAILED'}`);
    refreshSoon();
  };
  return (
    <div className={BOX}>
      <div className={H}>Banner on every phone and the projector</div>
      <div className="text-sm text-[#cbd5e1]">Current: {view.notice ? `"${view.notice}"` : 'none'}</div>
      <div className="flex flex-wrap gap-2">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={140} placeholder="Back in two minutes" aria-label="Notice text" className={`${INPUT} flex-1 min-w-[220px]`} />
        <button className={BTN_PRIMARY} onClick={() => text.trim() && void send(text.trim()).then(() => setText(''))}>
          Show
        </button>
        <button className={BTN} onClick={() => void send(null)}>
          Clear
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ crews
const TeamsTab: React.FC<{ view: AdminViewData; run: Run; busy: boolean }> = ({ view, run, busy }) => {
  const [delta, setDelta] = useState(50);
  const inR1 = view.phase.name === 'R1_ACTIVE';
  return (
    <div className={BOX}>
      <div className="flex items-center justify-between gap-3">
        <div className={H}>Crews ({view.teams.length})</div>
        <label className="flex items-center gap-2 text-xs font-mono text-[#a9b4c7]">
          Adjust amount
          <input type="number" value={delta} onChange={e => setDelta(Number(e.target.value) || 0)} className={`${INPUT} w-24`} aria-label="Adjust amount" />
        </label>
      </div>
      <div className="rounded-xl border border-[#2a2e3d] p-3 space-y-2" data-testid="crew-size">
        <div className="flex flex-wrap items-center gap-2">
          <span className={H}>Crew size</span>
          {[3, 4, 5, 6].map(n => (
            <button
              key={n}
              data-testid={`crew-size-${n}`}
              disabled={busy || view.phase.name !== 'LOBBY'}
              aria-pressed={view.crewSize === n}
              className={`${BTN} min-w-[48px] ${view.crewSize === n ? '!border-[#c4a45a] !bg-[#c4a45a]/20 text-[#e5cb87]' : ''}`}
              onClick={() => void run(`Crew size ${n}`, 'ADMIN_SET_CREW_SIZE', { size: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#8e95a5]">Max crew size. Auto-group builds crews of this size; 1–2 stragglers join existing crews. Lobby only.</p>
      </div>
      {view.phase.name === 'LOBBY' && (
        <button className={BTN} disabled={busy} onClick={() => void run('Auto-group', 'ADMIN_AUTO_GROUP')}>
          <Users className="w-4 h-4" />
          Auto-group players without a crew
        </button>
      )}
      <div className="space-y-2">
        {view.teams.map(t => {
          const members = view.players.filter(p => p.teamId === t.id);
          const r3 = view.r3?.teams[t.id];
          return (
            <div key={t.id} data-testid="admin-team" className="rounded-xl border border-[#2a2e3d] bg-[#161922] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-serif font-black">{t.name}</span> <span className="text-lg">{t.emojiCode}</span>{' '}
                  <span className="text-xs font-mono text-[#8e95a5]">battle code {t.battleCode}</span>
                </div>
                <div className="font-mono font-bold text-[#e5cb87]">
                  {t.score} pts <span className="text-xs text-[#8e95a5]">(R1 {t.r1Points}, R2 {t.r2Points}, adj {t.adminAdjust})</span>
                </div>
              </div>
              <div className="text-xs text-[#a9b4c7]">
                {members.length} members: {members.map(m => `${m.name} (${m.role})`).join(', ') || 'none'}
                {t.r1 ? ` • codeword ${t.r1.codeword}${t.r1.solved ? ' (solved)' : ''}` : ''}
                {r3 ? ` • ${r3.escaped ? `escaped #${r3.escapeRank}` : `${r3.distance} m`}${r3.honourBonus ? ' • honour' : ''}` : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={BTN} disabled={busy} onClick={() => void run(`${t.name} +${delta} pts`, 'ADMIN_ADJUST_SCORE', { teamId: t.id, delta })}>
                  +{delta} pts
                </button>
                <button className={BTN} disabled={busy} onClick={() => void run(`${t.name} -${delta} pts`, 'ADMIN_ADJUST_SCORE', { teamId: t.id, delta: -delta })}>
                  -{delta} pts
                </button>
                {inR1 && !t.r1?.solved && (
                  <button className={BTN} disabled={busy} onClick={() => void run(`Mark ${t.name} solved`, 'ADMIN_MARK_R1_SOLVED', { teamId: t.id })}>
                    Mark R1 solved
                  </button>
                )}
                {r3 && !r3.escaped && (
                  <>
                    <button className={BTN} disabled={busy} onClick={() => void run(`${t.name} +${delta} m`, 'ADMIN_ADJUST_DISTANCE', { teamId: t.id, delta })}>
                      +{delta} m
                    </button>
                    <button className={BTN} disabled={busy} onClick={() => void run(`${t.name} -${delta} m`, 'ADMIN_ADJUST_DISTANCE', { teamId: t.id, delta: -delta })}>
                      -{delta} m
                    </button>
                    <button className={BTN} disabled={busy} onClick={() => void run(`Toggle honour ${t.name}`, 'ADMIN_TOGGLE_HONOUR', { teamId: t.id })}>
                      Toggle honour bonus
                    </button>
                  </>
                )}
                <button
                  className={BTN_RED}
                  disabled={busy}
                  onClick={() => confirm(`Delete crew "${t.name}"? Its players become unassigned.`) && void run(`Delete ${t.name}`, 'ADMIN_DELETE_TEAM', { teamId: t.id })}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {view.phase.name === 'R3_ACTIVE' && <SuddenDeathForm view={view} run={run} busy={busy} />}
    </div>
  );
};

const SuddenDeathForm: React.FC<{ view: AdminViewData; run: Run; busy: boolean }> = ({ view, run, busy }) => {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <div className="rounded-xl border border-red-500/40 p-3 space-y-2">
      <div className={H}>Trigger Sudden Death</div>
      <div className="flex flex-wrap gap-2">
        <TeamSelect view={view} value={a} onChange={setA} label="Crew A" />
        <TeamSelect view={view} value={b} onChange={setB} label="Crew B" />
        <button className={BTN_RED} disabled={busy || !a || !b || a === b} onClick={() => void run('Sudden death', 'ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: a, teamB: b })}>
          Start standoff
        </button>
      </div>
    </div>
  );
};

const TeamSelect: React.FC<{ view: AdminViewData; value: string; onChange: (v: string) => void; label: string; only?: string[] }> = ({ view, value, onChange, label, only }) => (
  <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className={`${INPUT} min-w-[160px]`}>
    <option value="">{label}</option>
    {view.teams
      .filter(t => !only || only.includes(t.id))
      .map(t => (
        <option key={t.id} value={t.id}>
          {t.name} ({t.battleCode})
        </option>
      ))}
  </select>
);

// ------------------------------------------------------------------ players
const PlayersTab: React.FC<{ view: AdminViewData; run: Run; busy: boolean; nameOf: (id: string | null) => string }> = ({ view, run, busy, nameOf }) => {
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [filter, setFilter] = useState('');
  const players = view.players.filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className={BOX}>
      <div className={H}>Players ({view.players.length}, {view.counts.connected} connected)</div>
      <div className="flex flex-wrap gap-2">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter players" className={`${INPUT} flex-1 min-w-[160px]`} />
      </div>
      <div className="flex flex-wrap gap-2 items-center rounded-xl border border-[#2a2e3d] p-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New player name" aria-label="New player name" className={`${INPUT} flex-1 min-w-[160px]`} />
        <TeamSelect view={view} value={teamId} onChange={setTeamId} label="No crew" />
        <button className={BTN} disabled={busy} onClick={() => void run('Add player', 'ADMIN_ADD_PLAYER', { name, ...(teamId ? { teamId } : {}) }, () => setName(''))}>
          Add player
        </button>
      </div>
      <div className="max-h-[480px] overflow-y-auto space-y-1.5">
        {players.map(p => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#161922] border border-[#2a2e3d] px-3 py-2">
            <div className="min-w-0">
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${p.connected ? 'bg-emerald-400' : 'bg-[#3a4157]'}`} />
              <span className="font-bold">{p.name}</span> <span className="text-xs text-[#8e95a5]">{p.role} • {p.teamId ? nameOf(p.teamId) : 'no crew'}</span>
            </div>
            <div className="flex gap-2">
              <select
                aria-label={`Move ${p.name}`}
                value={p.teamId ?? ''}
                onChange={e => void run(`Move ${p.name}`, 'ADMIN_MOVE_PLAYER', { playerId: p.id, teamId: e.target.value || null })}
                className={`${INPUT} max-w-[180px]`}
              >
                <option value="">No crew</option>
                {view.teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button className={BTN_RED} disabled={busy} onClick={() => confirm(`Remove ${p.name} from the game?`) && void run(`Remove ${p.name}`, 'ADMIN_REMOVE_PLAYER', { playerId: p.id })}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ round 2 pairing
const PairingTab: React.FC<{ view: AdminViewData; run: Run; busy: boolean; nameOf: (id: string | null) => string }> = ({ view, run, busy, nameOf }) => {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const canPair = view.phase.name === 'R2_PAIRING';
  return (
    <div className={BOX}>
      <div className={H}>Round 2 pairing</div>
      {!canPair && <div className="text-sm text-[#a9b4c7]">Pairing is available while the game is in R2_PAIRING.</div>}
      <div className="flex flex-wrap gap-2">
        <button className={BTN} disabled={busy || !canPair} onClick={() => void run('Auto-pair', 'ADMIN_R2_AUTO_PAIR')}>
          Auto-pair remaining crews
        </button>
        <button className={BTN_PRIMARY} disabled={busy || !canPair} onClick={() => confirm('Start the clashes now? Unpaired crews sit out Round 2.') && void run('Force-start Round 2', 'ADMIN_R2_FORCE_START')}>
          Force-start clashes
        </button>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <TeamSelect view={view} value={a} onChange={setA} label="Crew A" only={view.unpairedTeamIds} />
        <TeamSelect view={view} value={b} onChange={setB} label="Crew B" only={view.unpairedTeamIds} />
        <button className={BTN} disabled={busy || !canPair || !a || !b || a === b} onClick={() => void run('Pair', 'ADMIN_R2_PAIR', { teamA: a, teamB: b }, () => { setA(''); setB(''); })}>
          Pair these two
        </button>
      </div>
      <div className="text-sm">
        <div className="text-xs font-mono text-[#8e95a5] mb-1">Unpaired ({view.unpairedTeamIds.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {view.unpairedTeamIds.map(id => (
            <span key={id} className="px-2 py-1 rounded border border-amber-500/40 text-amber-200 text-xs">
              {nameOf(id)}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {view.matches.map(m => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#161922] border border-[#2a2e3d] px-3 py-2 text-sm">
            <span>
              {nameOf(m.teamA)} <span className="text-[#8e95a5]">vs</span> {nameOf(m.teamB)}
              {m.cancelled ? ' (cancelled)' : ''}
            </span>
            <span className="text-xs font-mono text-[#a9b4c7]">{m.clashes.filter(c => c.resolved).length} clashes resolved</span>
            {canPair && (
              <button className={BTN} disabled={busy} onClick={() => void run('Unpair', 'ADMIN_R2_UNPAIR', { teamId: m.teamA })}>
                Unpair
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ reset
const SettingsTab: React.FC<{ run: Run; busy: boolean }> = ({ run, busy }) => {
  const [resetText, setResetText] = useState('');
  return (
    <div className="space-y-4">
      <div className={`${BOX} !border-red-500/50`}>
        <div className="text-[11px] font-mono uppercase tracking-wider text-red-300 font-bold">Reset game</div>
        <p className="text-sm text-[#cbd5e1]">Deletes every crew, score and round state and returns to the lobby. Players have to join again.</p>
        <div className="flex flex-wrap gap-2">
          <input value={resetText} onChange={e => setResetText(e.target.value)} placeholder="Type RESET to confirm" aria-label="Type RESET to confirm" data-testid="reset-confirm" className={`${INPUT} min-w-[220px]`} />
          <button
            data-testid="reset-game"
            className={BTN_RED}
            disabled={busy || resetText !== 'RESET'}
            onClick={() => void run('Reset game', 'ADMIN_RESET_GAME', {}, () => setResetText(''))}
          >
            <RotateCcw className="w-4 h-4" />
            Reset game
          </button>
        </div>
      </div>
      <div className="text-[11px] font-mono text-[#5b6377]">API base: {apiUrl('') || window.location.origin}</div>
    </div>
  );
};
