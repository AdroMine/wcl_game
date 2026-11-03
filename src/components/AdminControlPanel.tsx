// /admin: the host's control panel, designed for a phone first. Polls the full snapshot every 2 s and sends ADMIN_* commands.
// Nothing here is shown to players; the token is typed by the host and kept in sessionStorage.
// The admin has game-flow and roster controls only: no score, distance, honour, solved or rename tools (organizer ruling, Nov 3).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, Shield, Swords, Users } from 'lucide-react';
import { adminCommand, adminPost, computeServerLight, fetchAdminView, fetchHealth, getAdminToken, setAdminToken } from '../game/admin';
import type { AdminViewData, Health } from '../game/admin';
import { rand } from '../game/backoff';
import { loadRuntimeConfig } from '../game/config';
import { useTick } from '../game/useNow';
import { AdminHeader } from './admin/AdminHeader';
import { AnnounceTab } from './admin/AnnounceTab';
import { LiveTab } from './admin/LiveTab';
import { ConfirmModal, QrModal, ResetModal, StandingsModal } from './admin/Modals';
import { RosterTab } from './admin/RosterTab';
import { BOX, BTN, BTN_PRIMARY, H, INPUT, friendlyError } from './admin/kit';
import type { AskOptions, Run } from './admin/kit';

type Tab = 'live' | 'roster' | 'announce';
const TABS: [Tab, string, React.ComponentType<{ className?: string }>][] = [
  ['live', 'Live game', Swords],
  ['roster', 'Crews & roster', Users],
  ['announce', 'Announcements', Megaphone],
];

interface PollInfo {
  viewFails: number;
  viewReason: string | null;
  healthFails: number;
  healthReason: string | null;
}

export const AdminControlPanel: React.FC = () => {
  const [token, setToken] = useState(getAdminToken());
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [view, setView] = useState<AdminViewData | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [poll, setPoll] = useState<PollInfo>({ viewFails: 0, viewReason: null, healthFails: 0, healthReason: null });
  const [tab, setTab] = useState<Tab>('live');
  const [log, setLog] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'qr' | 'standings' | 'reset' | null>(null);
  const [asking, setAsking] = useState<AskOptions | null>(null);
  const etag = useRef<string | null>(null);
  const offsetRef = useRef(0);
  const lastV = useRef<number | null>(null);
  const lastChangeAt = useRef<number | null>(null);
  useTick(500);

  // ---- polling: admin snapshot (ETag) + /health, every 2 s with jitter, each with its own timeout.
  // The two requests are tracked separately; "not reachable" needs 3 failed admin-view polls in a row, and the
  // timer is always rescheduled (finally) so the loop can never stall.
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let viewFails = 0;
    let healthFails = 0;
    let viewReason: string | null = null;
    let healthReason: string | null = null;
    const poll1 = async () => {
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
        if (v.kind === 'fail') {
          viewFails += 1;
          viewReason = v.reason;
        } else {
          viewFails = 0;
          viewReason = null;
        }
        if (h.kind === 'fail') {
          healthFails += 1;
          healthReason = h.reason;
        } else {
          healthFails = 0;
          healthReason = null;
        }
        if (h.kind === 'ok') setHealth(h.value);
        if (v.kind === 'ok') {
          etag.current = v.value.etag;
          offsetRef.current = v.value.data.serverNow - Date.now();
          if (lastV.current !== null && lastV.current !== v.value.data.v) lastChangeAt.current = Date.now();
          lastV.current = v.value.data.v;
          setView(v.value.data);
        }
      } catch (e) {
        viewFails += 1;
        viewReason = `poll error: ${e instanceof Error ? e.name : 'unknown'}`;
      } finally {
        if (!stopped) setPoll({ viewFails, viewReason, healthFails, healthReason });
        if (!stopped && rescheduled) timer = setTimeout(() => void poll1(), rand(1800, 2400));
      }
    };
    void loadRuntimeConfig()
      .catch(() => undefined)
      .then(() => {
        if (!stopped) void poll1();
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

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  const refreshSoon = () => {
    etag.current = null;
  };

  const run: Run = useCallback(async (label, type, payload = {}, ok) => {
    setBusy(true);
    const r = await adminCommand(type, payload);
    setBusy(false);
    const text = r.ok ? 'OK' : `FAILED (${friendlyError(r.error, r.status)})`;
    setLog(`${new Date().toLocaleTimeString()} ${label}: ${text}`);
    if (r.ok) {
      etag.current = null;
      ok?.();
    } else {
      setToast(`${label}: ${friendlyError(r.error, r.status)}`);
    }
    return { ok: r.ok, error: r.error };
  }, []);

  const resync = async () => {
    const r = await adminPost('/api/admin/resync', {});
    setLog(`${new Date().toLocaleTimeString()} Resync all clients: ${r.ok ? `OK (${String(r.body?.notified ?? '?')} notified)` : 'FAILED'}`);
  };

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
  const now = Date.now();
  const leftMs = phase?.endsAt != null ? (phase.paused && phase.pausedAt ? phase.endsAt - phase.pausedAt : phase.endsAt - (now + offsetRef.current)) : null;
  const light = computeServerLight({
    hasView: view !== null,
    health,
    ...poll,
    sinceChangeSec: lastChangeAt.current == null ? null : (now - lastChangeAt.current) / 1000,
  });

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh overflow-x-hidden">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 pb-24 space-y-3">
        <AdminHeader
          view={view}
          health={health}
          light={light}
          leftMs={leftMs}
          busy={busy}
          run={run}
          ask={setAsking}
          log={log}
          onQr={() => setModal('qr')}
          onStandings={() => setModal('standings')}
          onReset={() => setModal('reset')}
          onResync={() => void resync()}
          onSignOut={() => {
            setAdminToken('');
            setToken('');
            setView(null);
          }}
        />

        {view && (
          <>
            <nav className="grid grid-cols-3 gap-1.5" role="tablist">
              {TABS.map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  data-testid={`tab-${id}`}
                  onClick={() => setTab(id)}
                  className={`${BTN} !px-1 flex-col !gap-0.5 text-[11px] sm:text-sm sm:flex-row ${tab === id ? '!border-[#c4a45a] !bg-[#c4a45a]/15' : ''}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="leading-tight text-center">{label}</span>
                </button>
              ))}
            </nav>
            {tab === 'live' && <LiveTab view={view} run={run} busy={busy} />}
            {tab === 'roster' && <RosterTab view={view} run={run} busy={busy} ask={setAsking} />}
            {tab === 'announce' && <AnnounceTab view={view} setLog={setLog} refreshSoon={refreshSoon} />}
          </>
        )}
      </div>

      {toast && (
        <div data-testid="admin-toast" role="alert" className="fixed bottom-3 inset-x-3 sm:left-auto sm:right-4 sm:max-w-sm z-[100001] rounded-xl border border-red-500/60 bg-red-950/95 text-red-100 text-sm p-3 shadow-xl break-words" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      {modal === 'qr' && <QrModal onClose={() => setModal(null)} />}
      {modal === 'standings' && view && <StandingsModal view={view} onClose={() => setModal(null)} />}
      {modal === 'reset' && (
        <ResetModal
          busy={busy}
          onClose={() => setModal(null)}
          onReset={() =>
            void run('Reset game', 'ADMIN_RESET_GAME', {}, () => {
              setModal(null);
            })
          }
        />
      )}
      {asking && <ConfirmModal ask={asking} busy={busy} onClose={() => setAsking(null)} />}
    </div>
  );
};
