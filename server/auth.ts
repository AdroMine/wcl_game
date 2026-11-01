// Authentication. Players choose {playerId, token} in the browser; the server only ever stores
// sha256(token) (the engine's tokenHash). Admin access is a bearer token from the environment.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { GameState } from './engine/index.ts';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests of equal length (anything else is a mismatch). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type PlayerAuth = 'ok' | 'unknown' | 'bad-token';

/** Compare a presented token hash with the stored one. Admin-created players have no hash and can never authenticate. */
export function checkPlayer(state: GameState, playerId: string, presentedHash: string): PlayerAuth {
  const p = Object.hasOwn(state.players, playerId) ? state.players[playerId] : undefined;
  if (!p) return 'unknown';
  if (!p.tokenHash) return 'bad-token';
  return safeEqualHex(p.tokenHash, presentedHash) ? 'ok' : 'bad-token';
}

export interface AdminAuth {
  enabled: boolean;
  check(authorizationHeader: string | undefined): boolean;
}

export function createAdminAuth(adminToken: string | null): AdminAuth {
  if (!adminToken) return { enabled: false, check: () => false };
  // Hash both sides so the comparison is always over equal-length buffers.
  const expected = createHash('sha256').update(adminToken, 'utf8').digest();
  return {
    enabled: true,
    check(header) {
      if (typeof header !== 'string') return false;
      const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
      if (!m) return false;
      const given = createHash('sha256').update(m[1], 'utf8').digest();
      return timingSafeEqual(given, expected);
    },
  };
}
