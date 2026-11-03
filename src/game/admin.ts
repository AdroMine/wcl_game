// Admin API helpers for /admin. The token lives in sessionStorage and is sent as Authorization: Bearer.
import type { MoralStatus, PhaseName, StepName, Vessel } from '../../shared/protocol.ts';
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
  score: number;
  r1: { codeword: string; solved: boolean; points: number; solveSeconds: number | null; hintsTaken: number[] } | null;
}
export interface AdminPlayer {
  id: string;
  name: string;
  role: string;
  teamId: string | null;
  connected: boolean;
  canLogin: boolean;
}
export interface AdminClash {
  clash: number;
  resolved: boolean;
  stanceA: string | null;
  stanceB: string | null;
  ptsA: number;
  ptsB: number;
  votedA: number;
  votedB: number;
}
export interface AdminMatch {
  id: string;
  teamA: string;
  teamB: string;
  cancelled: boolean;
  clashes: AdminClash[];
}
export interface AdminMoral {
  status: MoralStatus;
  rivalTeamId: string | null;
  nemesisTeamId: string | null;
  mutualTruce: number;
  myAmbush: number;
  rivalAmbush: number;
  mutualAmbush: number;
}
export interface AdminR3Team {
  distance: number;
  startDistance: number;
  honourBonus: boolean;
  leashHolder: boolean;
  nemesis: string | null;
  leashUsed: boolean;
  escaped: boolean;
  escapeRank: number | null;
  escapedInWave: number | null;
}
export interface AdminWaveOutcome {
  vessel: Vessel;
  unanimity: number;
  baseMeters: number;
  leashDelta: number;
  gained: number;
  newDistance: number;
  escaped: boolean;
  escapeRank: number | null;
}
export interface AdminWaveReport {
  wave: number;
  activeCrews: number;
  sailboatCapacity: number;
  sailboatCapsized: boolean;
  ghostCollided: boolean;
  ghostSoloTeamId: string | null;
  outcomes: Record<string, AdminWaveOutcome>;
}
export interface AdminSuddenDeath {
  teamA: string;
  teamB: string;
  votesA: number;
  votesB: number;
  stanceA: string | null;
  stanceB: string | null;
  resolved: boolean;
  winnerTeamId: string | null;
  text: string | null;
}
export interface AdminR3 {
  teams: Record<string, AdminR3Team>;
  escapeOrder: string[];
  /** Armed Stygian Leash this wave: holder crew id -> target crew id. */
  leashArmed: Record<string, string>;
  /** Phones that have voted this wave, per crew. */
  votedThisWave: Record<string, number>;
  waves: number;
  lastReport: AdminWaveReport | null;
  sd: AdminSuddenDeath | null;
}
export interface AdminViewData {
  serverNow: number;
  sid: string;
  v: number;
  phase: { name: PhaseName; step: StepName | null; clash: number; wave: number; phaseSeq: number; endsAt: number | null; paused: boolean; pausedAt?: number | null; startedAt?: number };
  config: Durations;
  /** Maximum crew size N (3..6). */
  crewSize: number;
  notice: string | null;
  counts: { players: number; teams: number; connected: number };
  players: AdminPlayer[];
  teams: AdminTeam[];
  matches: AdminMatch[];
  unpairedTeamIds: string[];
  moral: Record<string, AdminMoral>;
  r3: AdminR3 | null;
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

const POLL_TIMEOUT_MS = 6000;

/** Outcome of one poll request. `fail` carries a short, human-readable reason such as "429" or "timeout". */
export type PollResult<T> = { kind: 'ok'; value: T } | { kind: 'same' } | { kind: 'unauthorized' } | { kind: 'fail'; reason: string };

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POLL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : 'error';
  if (name === 'AbortError') return 'timeout';
  if (name === 'TypeError') return 'network error';
  return name;
}

export async function fetchHealth(): Promise<PollResult<Health>> {
  let res: Response;
  try {
    res = await timedFetch(apiUrl('/health'), { cache: 'no-store' });
  } catch (e) {
    return { kind: 'fail', reason: describeError(e) };
  }
  if (res.status === 304) return { kind: 'same' };
  if (!res.ok) return { kind: 'fail', reason: String(res.status) };
  try {
    return { kind: 'ok', value: (await res.json()) as Health };
  } catch (e) {
    return { kind: 'fail', reason: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'bad JSON' };
  }
}

/** One admin view poll. 304 is success ('same'); a bad token is 'unauthorized'; anything else is a described failure. */
export async function fetchAdminView(etag: string | null): Promise<PollResult<{ data: AdminViewData; etag: string | null }>> {
  let res: Response;
  try {
    const headers = authHeaders(etag ? { 'If-None-Match': etag } : {});
    res = await timedFetch(apiUrl('/api/admin/view'), { headers, cache: 'no-store' });
  } catch (e) {
    return { kind: 'fail', reason: describeError(e) };
  }
  if (res.status === 304) return { kind: 'same' };
  if (res.status === 401 || res.status === 503) return { kind: 'unauthorized' };
  if (!res.ok) return { kind: 'fail', reason: String(res.status) };
  try {
    return { kind: 'ok', value: { data: (await res.json()) as AdminViewData, etag: res.headers.get('ETag') } };
  } catch (e) {
    return { kind: 'fail', reason: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'bad JSON' };
  }
}

export type LightLevel = 'ok' | 'slow' | 'down';
export interface ServerLight {
  level: LightLevel;
  /** Short text for the status line. */
  label: string;
}

export interface LightInput {
  hasView: boolean;
  health: Health | null;
  /** Consecutive failed polls, per request, with the latest reason. */
  viewFails: number;
  viewReason: string | null;
  healthFails: number;
  healthReason: string | null;
  /** Seconds since this panel last saw the game state change (null: no change seen since it opened). */
  sinceChangeSec: number | null;
}

/** One light for the whole server. "Not reachable" only after 3 failed admin-view polls in a row. */
export function computeServerLight(i: LightInput): ServerLight {
  if (i.viewFails >= 3) {
    const parts = [`admin view: ${i.viewReason ?? 'failed'}`];
    if (i.healthFails >= 1) parts.push(`health: ${i.healthReason ?? 'failed'}`);
    return { level: 'down', label: `Not reachable (${parts.join('; ')})` };
  }
  if (!i.hasView && i.healthFails >= 3) return { level: 'down', label: `Not reachable (health: ${i.healthReason ?? 'failed'})` };
  const h = i.health;
  const slow: string[] = [];
  if (h) {
    if (h.eventLoopLagMs > 200) slow.push(`lag ${Math.round(h.eventLoopLagMs)} ms`);
    if (!h.lastSnapshotOk) slow.push('snapshot failing');
    // The snapshot age is time since the last write, which grows while nothing changes. It is only a problem
    // when the game changed and the newest snapshot is older than that change by 30 s or more.
    else if (h.snapshotAgeSec != null && i.sinceChangeSec != null && i.sinceChangeSec > 30 && h.snapshotAgeSec > i.sinceChangeSec) {
      slow.push(`snapshot ${Math.round(h.snapshotAgeSec)} s old`);
    }
  }
  if (slow.length > 0) return { level: 'slow', label: `Slow (${slow.join(', ')})` };
  if (i.healthFails >= 2) return { level: 'ok', label: `OK (health check failing: ${i.healthReason ?? 'failed'})` };
  return { level: 'ok', label: 'OK' };
}
