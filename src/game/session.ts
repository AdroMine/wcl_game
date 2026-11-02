// The player's identity and the cached last view. Both are read synchronously on startup so that a
// refresh renders the last known screen at once (never the Join screen for a known player).
import { randomToken } from '../../shared/protocol.ts';
import type { View } from '../../shared/protocol.ts';

/**
 * Seat mode (/solotester): `/?seat=K` makes this tab an independent player. Every localStorage key that starts with
 * `uw.` (identity, cached view, name, briefing flags, meta, clock offset) is stored as `uw.sK.<rest>`. Without a valid
 * seat nothing changes. The wrapper is installed once, here, because this module is loaded before any key is read.
 */
export function seatFromSearch(search: string): string | null {
  const m = /^[0-9]{1,9}$/.exec(new URLSearchParams(search).get('seat') ?? '');
  return m ? m[0] : null;
}

export const SEAT: string | null = typeof window === 'undefined' ? null : seatFromSearch(window.location.search);

/** The namespaced form of a storage key for a seat (used by the solo tester to reset seats). */
export function seatKeyPrefix(seat: string | number): string {
  return `uw.s${seat}.`;
}

if (SEAT && typeof Storage !== 'undefined') {
  const prefix = seatKeyPrefix(SEAT);
  const map = (k: string) => (k.startsWith('uw.') ? prefix + k.slice(3) : k);
  const proto = Storage.prototype;
  const get = proto.getItem;
  const set = proto.setItem;
  const del = proto.removeItem;
  proto.getItem = function (this: Storage, k: string) {
    return get.call(this, map(k));
  };
  proto.setItem = function (this: Storage, k: string, v: string) {
    set.call(this, map(k), v);
  };
  proto.removeItem = function (this: Storage, k: string) {
    del.call(this, map(k));
  };
}

const KEY_ID = 'uw.playerId';
const KEY_TOKEN = 'uw.token';
const KEY_VIEW = 'uw.lastView';
const KEY_NAME = 'uw.name';

export interface Session {
  playerId: string;
  token: string;
  /** True when the identity was created during this call (first visit on this device). */
  fresh: boolean;
}

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode or full storage: keep going with the in-memory identity */
  }
}
function lsDel(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

function newPlayerId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return randomToken(16);
}

function newToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += b.toString(16).padStart(2, '0');
  return s; // 64 hex characters = 256 bits
}

let memory: Session | null = null;

/** Create the identity on first load and persist it immediately. */
export function getSession(): Session {
  if (memory) return memory;
  const id = lsGet(KEY_ID);
  const token = lsGet(KEY_TOKEN);
  if (id && token && id.length >= 6 && token.length >= 22) {
    memory = { playerId: id, token, fresh: false };
    return memory;
  }
  memory = { playerId: newPlayerId(), token: newToken(), fresh: true };
  lsSet(KEY_ID, memory.playerId);
  lsSet(KEY_TOKEN, memory.token);
  return memory;
}

/** Forget this identity (game reset or player removed). The next getSession() makes a new one. */
export function clearSession(): void {
  memory = null;
  lsDel(KEY_ID);
  lsDel(KEY_TOKEN);
  lsDel(KEY_VIEW);
}

export function readCachedView(): View | null {
  const raw = lsGet(KEY_VIEW);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as View;
    if (v && typeof v === 'object' && typeof v.v === 'number' && v.phase) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeCachedView(v: View): void {
  lsSet(KEY_VIEW, JSON.stringify(v));
}

export function readName(): string {
  return lsGet(KEY_NAME) ?? '';
}
export function writeName(n: string): void {
  lsSet(KEY_NAME, n);
}
