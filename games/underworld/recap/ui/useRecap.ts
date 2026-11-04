// Fetches the end-of-game recap (GET /api/recap) once the game is FINISHED. The recap is not part of the
// 4 KB per-phone view: it is one public document, cached by the browser (ETag) and kept in localStorage so a
// phone that loses signal after loading it still shows it. Never blocks the screen; failure just means "no recap yet".
import { useCallback, useEffect, useState } from 'react';
import { rand, sleep } from '../../../../src/game/backoff';
import { apiUrl, loadRuntimeConfig } from '../../../../src/game/config';
import type { RecapData } from '../../recap.ts';

const KEY = 'uw.recap';

interface Cached {
  etag: string | null;
  data: RecapData;
}

let memory: Cached | null = null;

function readCache(): Cached | null {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Cached;
      if (c && c.data && Array.isArray(c.data.crews) && c.data.front) memory = c;
    }
  } catch {
    /* no storage */
  }
  return memory;
}

function writeCache(c: Cached | null): void {
  memory = c;
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* quota or private mode: the in-memory copy is enough */
  }
}

/**
 * `active` is true while the game phase is FINISHED. `sid` and `v` come from the latest view: when either changes
 * (a resync, a restored game) the recap is asked for again, which is cheap thanks to the ETag.
 * `spreadMs` delays the first request by a random amount so 200 phones do not arrive in the same instant.
 */
export function useRecap(active: boolean, sid: string | undefined, v: number | undefined, spreadMs = 0): { recap: RecapData | null; failed: boolean; retry: () => void } {
  const [data, setData] = useState<RecapData | null>(() => (active ? (readCache()?.data ?? null) : null));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    const ctl = new AbortController();
    void (async () => {
      await loadRuntimeConfig();
      const cached = readCache();
      if (cached && !cancelled) setData(cached.data);
      if (spreadMs > 0 && !cached) await sleep(rand(0, spreadMs));
      let failures = 0;
      while (!cancelled) {
        try {
          const have = readCache();
          const res = await fetch(apiUrl(`/api/recap?v=${v ?? 0}`), { headers: have?.etag ? { 'If-None-Match': have.etag } : {}, signal: ctl.signal });
          if (cancelled) return;
          if (res.status === 304 && have) {
            setData(have.data);
            setFailed(false);
            return;
          }
          if (res.ok) {
            const body = (await res.json()) as RecapData;
            if (cancelled) return;
            if (body && Array.isArray(body.crews) && body.front) {
              writeCache({ etag: res.headers.get('ETag'), data: body });
              setData(body);
              setFailed(false);
              return;
            }
          } else if (res.status === 404) {
            // Not ready (or the game was reset): forget an old recap and look again in a while.
            writeCache(null);
            setData(null);
            await sleep(rand(8000, 15000));
            continue;
          }
        } catch {
          if (cancelled) return;
        }
        failures += 1;
        if (failures >= 2) setFailed(true);
        await sleep(Math.min(30000, 1500 * 2 ** Math.min(failures, 5)) * rand(0.5, 1));
      }
    })();
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [active, sid, v, spreadMs, attempt]);

  return { recap: active ? data : null, failed: active && !data && failed, retry };
}
