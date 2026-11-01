// Sending commands. One commandId per user action; the SAME id is re-sent on network errors and 5xx
// (the server applies an id at most once, so retries are safe).
import { ERROR_MESSAGES } from '../../shared/protocol.ts';
import type { CommandResult, ErrorCode, PlayerCommandPayloads, PlayerCommandType } from '../../shared/protocol.ts';
import { rand, sleep } from './backoff.ts';
import { apiUrl } from './config.ts';

export interface SendResult {
  ok: boolean;
  error?: string;
  /** Friendly text for the UI when ok is false. */
  message?: string;
}

const TOTAL_BUDGET_MS = 20_000;
const ATTEMPT_TIMEOUT_MS = 8_000;

export function newCommandId(): string {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
  return `c-${id}`;
}

export function friendlyError(code: string | undefined, fallback?: Record<string, string>): string {
  if (!code) return 'Something went wrong. Try again.';
  if (code === 'NETWORK') return 'No connection. Your action was not sent. Try again.';
  const table = fallback ?? {};
  return table[code] ?? (ERROR_MESSAGES as Record<string, string>)[code] ?? 'Something went wrong. Try again.';
}

export async function postCommand(
  playerId: string,
  token: string,
  type: PlayerCommandType,
  payload: unknown,
  errorTexts?: Record<string, string>,
  commandId: string = newCommandId(),
): Promise<SendResult & { v?: number }> {
  const body = JSON.stringify({ commandId, playerId, token, type, payload });
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let wait = Math.min(4000, 400 * 2 ** (attempt - 1));
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
      // text/plain avoids a CORS preflight when the API is on another origin; the server parses any content type as JSON.
      const res = await fetch(apiUrl('/api/command'), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        signal: ctl.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (res.status === 429) {
        const ra = Number(res.headers.get('Retry-After'));
        wait = (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500) + rand(0, 800);
      } else if (res.status >= 500) {
        // retry below
      } else {
        let j: CommandResult | { error?: string; ok?: boolean } = {};
        try {
          j = (await res.json()) as CommandResult;
        } catch {
          /* empty body */
        }
        if (res.ok && j.ok) return { ok: true, v: (j as CommandResult).v };
        const code = (j.error as ErrorCode | undefined) ?? (res.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST');
        return { ok: false, error: code, message: friendlyError(code, errorTexts) };
      }
    } catch {
      // network error or timeout: retry with the same commandId
    }
    if (Date.now() - started + wait > TOTAL_BUDGET_MS) {
      return { ok: false, error: 'NETWORK', message: friendlyError('NETWORK') };
    }
    await sleep(wait * rand(0.7, 1.3));
  }
}

export type SendFn = <T extends PlayerCommandType>(type: T, payload?: PlayerCommandPayloads[T]) => Promise<SendResult>;
