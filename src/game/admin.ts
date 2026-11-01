// Admin API helpers for /admin. The token lives in sessionStorage and is sent as Authorization: Bearer.
import type { MoralStatus, PhaseName, StepName } from '../../shared/protocol.ts';
import { rand, sleep } from './backoff.ts';
import { apiUrl } from './config.ts';
import { newCommandId } from './commands.ts';

const TOKEN_KEY = 'uw.adminToken';

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setAdminToken(t: string): void {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface Durations {
  r1Seconds: number;
  r2: { HUDDLE: number; PARLEY: number; VOTE: number; DEBRIEF: number };
  r3: { BLUFF: number; VOTE: number; REVEAL: number };
  sdSeconds: number;
}

export interface AdminTeam {
  id: string;
  name: string;
  emojiCode: string;
  battleCode: string;
  playerIds: string[];
  r1Points: number;
  r2Points: number;
  adminAdjust: number;
  score: number;
  r1: { codeword: string; solved: boolean; points: number; solveSeconds: number | null; hintsTaken: number[]; markedByAdmin: boolean } | null;
}
export interface AdminPlayer {
  id: string;
  name: string;
  role: string;
  teamId: string | null;
  connected: boolean;
  canLogin: boolean;
}
export interface AdminMatch {
  id: string;
  teamA: string;
  teamB: string;
  cancelled: boolean;
  clashes: { clash: number; resolved: boolean; stanceA: string | null; stanceB: string | null; ptsA: number; ptsB: number; votedA: number; votedB: number }[];
}
export interface AdminR3Team {
  distance: number;
  honourBonus: boolean;
  escaped: boolean;
  escapeRank: number | null;
  leashHolder: boolean;
  leashUsed: boolean;
}
export interface AdminViewData {
  serverNow: number;
  sid: string;
  v: number;
  phase: { name: PhaseName; step: StepName | null; clash: number; wave: number; phaseSeq: number; endsAt: number | null; paused: boolean; pausedAt?: number | null };
  config: Durations;
  notice: string | null;
  counts: { players: number; teams: number; connected: number };
  players: AdminPlayer[];
  teams: AdminTeam[];
  matches: AdminMatch[];
  unpairedTeamIds: string[];
  moral: Record<string, { status: MoralStatus }>;
  r3: { teams: Record<string, AdminR3Team>; escapeOrder: string[]; waves: number; sd: unknown } | null;
}

export interface Health {
  ok: boolean;
  version: number;
  phase: string;
  paused: boolean;
  players: number;
  teams: number;
  clients: number;
  connectedPlayers?: number;
  commandsPerSec: number;
  eventLoopLagMs: number;
  heapUsedMB: number;
  rssMB: number;
  snapshotAgeSec: number | null;
  lastSnapshotOk: boolean;
  uptimeSec: number;
}

export interface AdminResult {
  ok: boolean;
  error?: string;
  status: number;
  body?: Record<string, unknown>;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${getAdminToken()}`, ...extra };
}

export async function adminCommand(type: string, payload: unknown = {}): Promise<AdminResult> {
  const commandId = newCommandId();
  let last: AdminResult = { ok: false, status: 0, error: 'NETWORK' };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(apiUrl('/api/admin/command'), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type, payload, commandId }),
      });
      let body: Record<string, unknown> = {};
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        /* empty */
      }
      if (res.status < 500 && res.status !== 429) {
        return { ok: res.ok && body.ok === true, status: res.status, error: typeof body.error === 'string' ? body.error : res.ok ? undefined : `HTTP ${res.status}`, body };
      }
      last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch {
      last = { ok: false, status: 0, error: 'NETWORK' };
    }
    await sleep(400 * 2 ** attempt * rand(0.7, 1.3));
  }
  return last;
}

export async function adminPost(path: string, body: unknown): Promise<AdminResult> {
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    let j: Record<string, unknown> = {};
    try {
      j = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty */
    }
    return { ok: res.ok && j.ok !== false, status: res.status, error: typeof j.error === 'string' ? j.error : typeof j.message === 'string' ? (j.message as string) : undefined, body: j };
  } catch {
    return { ok: false, status: 0, error: 'NETWORK' };
  }
}

export async function downloadBackup(): Promise<AdminResult> {
  try {
    const res = await fetch(apiUrl('/api/admin/backup'), { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `underworld-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return { ok: true, status: 200 };
  } catch {
    return { ok: false, status: 0, error: 'NETWORK' };
  }
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch(apiUrl('/health'), { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

/** One admin view poll. Returns 'same' for 304, 'unauthorized' for a bad token, null on network trouble. */
export async function fetchAdminView(etag: string | null): Promise<{ data: AdminViewData; etag: string | null } | 'same' | 'unauthorized' | null> {
  try {
    const headers = authHeaders(etag ? { 'If-None-Match': etag } : {});
    const res = await fetch(apiUrl('/api/admin/view'), { headers, cache: 'no-store' });
    if (res.status === 304) return 'same';
    if (res.status === 401 || res.status === 503) return 'unauthorized';
    if (!res.ok) return null;
    return { data: (await res.json()) as AdminViewData, etag: res.headers.get('ETag') };
  } catch {
    return null;
  }
}
