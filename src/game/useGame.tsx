// The one data layer of the phone app: GameProvider + useGame().
// The server is the only source of truth. This module displays what the server sends, keeps a
// connection alive on bad networks and sends commands. It never changes the game phase by itself.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, PlayerCommandPayloads, PlayerCommandType, View } from '../../shared/protocol.ts';
import { rand, sleep } from './backoff.ts';
import { ClockOffset } from './clock.ts';
import { postCommand } from './commands.ts';
import type { SendResult } from './commands.ts';
import { apiUrl, loadRuntimeConfig } from './config.ts';
import { LiveFeed } from './feed.ts';
import type { FeedStatus } from './feed.ts';
import { getSession, readCachedView, writeCachedView } from './session.ts';

export type GameStatus = FeedStatus;

export interface GameApi {
  /** The last view received (or cached from the previous visit). Null only on a first-ever load. */
  view: View | null;
  /** Static content from /api/meta (briefings, texts). Null until loaded (cached between visits). */
  meta: Meta | null;
  status: GameStatus;
  /** True once a live view arrived in this page load. Until then a cached view may be stale. */
  synced: boolean;
  /** True when this device already had an identity before this page load. */
  knownDevice: boolean;
  playerId: string;
  serverOffsetMs: number;
  send: <T extends PlayerCommandType>(type: T, payload?: PlayerCommandPayloads[T]) => Promise<SendResult>;
  /** Milliseconds until `endsAt` on the server clock; null when the step has no timer. While paused: the frozen remaining time. */
  timeLeftMs: (endsAt: number | null | undefined) => number | null;
  /** Server "now" in ms since epoch (client clock corrected by the offset). While paused it is frozen at pausedAt. */
  serverNow: () => number;
  /** GET /api/team-preview for the join-by-emoji flow. */
  previewTeam: (code: string) => Promise<{ ok: true; team: TeamPreview } | { ok: false; message: string }>;
}

export interface TeamPreview {
  name: string;
  emojiCode: string;
  memberCount: number;
  maxMembers: number;
  isFull: boolean;
  leaderName: string;
  members: { name: string }[];
}

const Ctx = createContext<GameApi | null>(null);

const META_KEY = 'uw.meta';
const OFFSET_KEY = 'uw.offset';

function readMeta(): Meta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as Meta) : null;
  } catch {
    return null;
  }
}

function readOffset(): number {
  try {
    const n = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => getSession());
  const [view, setView] = useState<View | null>(() => readCachedView());
  const [meta, setMeta] = useState<Meta | null>(() => readMeta());
  const [status, setStatus] = useState<GameStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [offset, setOffset] = useState<number>(() => readOffset());
  const clock = useRef(new ClockOffset(readOffset()));
  const feedRef = useRef<LiveFeed<View> | null>(null);
  const metaRef = useRef<Meta | null>(meta);
  const viewRef = useRef<View | null>(view);
  const statusRef = useRef<GameStatus>('connecting');
  const offsetRef = useRef(offset);
  viewRef.current = view;
  metaRef.current = meta;
  statusRef.current = status;
  offsetRef.current = offset;

  // Live view feed.
  useEffect(() => {
    let cancelled = false;
    let feed: LiveFeed<View> | null = null;
    const cached = readCachedView();
    void loadRuntimeConfig().then(() => {
      if (cancelled) return;
      const q = `playerId=${encodeURIComponent(session.playerId)}&token=${encodeURIComponent(session.token)}`;
      feed = new LiveFeed<View>({
        streamUrl: () => apiUrl(`/api/stream?${q}`),
        pollUrl: () => apiUrl(`/api/view?${q}`),
        initial: cached ? { sid: cached.sid, v: cached.v } : null,
        onStatus: s => setStatus(s),
        onValue: (v, serverNow) => {
          const off = clock.current.add(serverNow);
          offsetRef.current = off;
          setOffset(off);
          try {
            localStorage.setItem(OFFSET_KEY, String(Math.round(off)));
          } catch {
            /* ignore */
          }
          writeCachedView(v);
          setView(v);
          setSynced(true);
        },
      });
      feedRef.current = feed;
      feed.start();
    });
    return () => {
      cancelled = true;
      feed?.stop();
      feedRef.current = null;
    };
  }, [session]);

  // Static content, loaded once. Retried with jitter; the cached copy keeps the app usable meanwhile.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadRuntimeConfig();
      let attempt = 0;
      while (!cancelled) {
        try {
          const res = await fetch(apiUrl('/api/meta'));
          if (res.ok) {
            const m = (await res.json()) as Meta;
            if (cancelled) return;
            setMeta(m);
            try {
              localStorage.setItem(META_KEY, JSON.stringify(m));
            } catch {
              /* ignore */
            }
            return;
          }
        } catch {
          /* retry */
        }
        attempt += 1;
        await sleep(Math.min(30000, 1500 * 2 ** Math.min(attempt, 5)) * rand(0.5, 1));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    async <T extends PlayerCommandType>(type: T, payload?: PlayerCommandPayloads[T]): Promise<SendResult> => {
      const r = await postCommand(session.playerId, session.token, type, payload ?? {}, metaRef.current?.errors);
      if (r.ok && statusRef.current !== 'live') feedRef.current?.pollNow();
      return { ok: r.ok, error: r.error, message: r.message };
    },
    [session],
  );

  const serverNow = useCallback((): number => {
    const v = viewRef.current;
    if (v?.phase.paused && v.phase.pausedAt) return v.phase.pausedAt;
    return Date.now() + offsetRef.current;
  }, []);

  const timeLeftMs = useCallback((endsAt: number | null | undefined): number | null => {
    const v = viewRef.current;
    if (v?.phase.paused && v.phase.pausedRemainingMs !== undefined) return v.phase.pausedRemainingMs;
    if (endsAt == null) return null;
    return Math.max(0, endsAt - (Date.now() + offsetRef.current));
  }, []);

  const previewTeam = useCallback(
    async (code: string) => {
      try {
        const q = `code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(session.playerId)}&token=${encodeURIComponent(session.token)}`;
        const res = await fetch(apiUrl(`/api/team-preview?${q}`), { cache: 'no-store' });
        const j = (await res.json()) as { ok?: boolean; team?: TeamPreview; error?: string };
        if (res.ok && j.ok && j.team) return { ok: true as const, team: j.team };
        const e = j.error ?? 'UNKNOWN_CODE';
        return { ok: false as const, message: metaRef.current?.errors[e] ?? (e === 'UNKNOWN_CODE' ? 'No team has that code.' : 'Could not look up that team.') };
      } catch {
        return { ok: false as const, message: 'No connection. Try again.' };
      }
    },
    [session],
  );

  const api = useMemo<GameApi>(
    () => ({
      view,
      meta,
      status,
      synced,
      knownDevice: !session.fresh,
      playerId: session.playerId,
      serverOffsetMs: offset,
      send,
      timeLeftMs,
      serverNow,
      previewTeam,
    }),
    [view, meta, status, synced, session, offset, send, timeLeftMs, serverNow, previewTeam],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGame(): GameApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame must be used inside <GameProvider>');
  return v;
}
