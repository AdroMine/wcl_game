// HTTP transport on node:http. Routes are documented in docs/PROTOCOL.md.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { checkPlayer, hashToken } from '../auth.ts';
import type { AdminAuth } from '../auth.ts';
import type { ServerConfig } from '../config.ts';
import { buildExportCsv, buildExportJson, buildMeta, buildRecap } from '../content.ts';
import { COMMAND_TYPES, previewTeamByEmoji } from '../engine/index.ts';
import type { Command, GameState } from '../engine/index.ts';
import type { Persistence } from '../persistence/index.ts';
import { gameStateProblem, pauseRestored } from '../persistence/index.ts';
import type { Runtime } from '../runtime.ts';
import { isValidPlayerId, validateAdminBody, validateCommandEnvelope, LIMITS } from '../../shared/protocol.ts';
import type { CommandResult, ErrorCode } from '../../shared/protocol.ts';
import { buildAdminView } from './adminView.ts';
import { RateLimiter } from './rateLimit.ts';
import type { RateLimitConfig } from './rateLimit.ts';
import { SseHub } from './sseHub.ts';
import { serveStatic } from './static.ts';
import { ViewBuilder } from './views.ts';

export interface HttpContext {
  config: ServerConfig;
  runtime: Runtime;
  hub: SseHub;
  views: ViewBuilder;
  persistence: Persistence | null;
  admin: AdminAuth;
  limits: RateLimitConfig;
  /** Hook for the app: called after an admin restore replaced the state. */
  restoredFrom?: string | null;
}

const MAX_RESTORE_BYTES = 25 * 1024 * 1024;
const MAX_ADMIN_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  status: number;
  code: ErrorCode;
  constructor(status: number, code: ErrorCode, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export function createHttpServer(ctx: HttpContext): Server {
  const { config, runtime, hub, views, admin } = ctx;
  const metaJson = JSON.stringify(buildMeta());
  const cmdLimiter = new RateLimiter(ctx.limits.playerCommands);
  const viewLimiter = new RateLimiter(ctx.limits.playerViews);
  const ipLimiter = new RateLimiter(ctx.limits.ip);
  const adminFailLimiter = new RateLimiter(ctx.limits.adminFailures);
  const origins = new Set(config.allowedOrigins);

  // ---- helpers -----------------------------------------------------------------

  function clientIp(req: IncomingMessage): string {
    if (config.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function corsHeaders(req: IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    if (!origin) return {};
    if (config.allowAnyOrigin || origins.has(origin.replace(/\/+$/, ''))) {
      return {
        'Access-Control-Allow-Origin': config.allowAnyOrigin ? '*' : origin,
        ...(config.allowAnyOrigin ? {} : { Vary: 'Origin' }),
        'Access-Control-Expose-Headers': 'ETag, X-Server-Now, Retry-After, Content-Disposition',
      };
    }
    return {};
  }

  function send(req: IncomingMessage, res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string | number> = {}): void {
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...corsHeaders(req), ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const sendJson = (req: IncomingMessage, res: ServerResponse, status: number, obj: unknown, extra: Record<string, string | number> = {}) =>
    send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);

  function sendError(req: IncomingMessage, res: ServerResponse, status: number, code: ErrorCode, message?: string, extra: Record<string, string | number> = {}): void {
    sendJson(req, res, status, { ok: false, v: runtime.state.version, error: code, ...(message ? { message } : {}) }, extra);
  }

  function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > limit) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'PAYLOAD_TOO_LARGE'));
          chunks.length = 0;
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => reject(new HttpError(400, 'BAD_REQUEST')));
    });
  }

  async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
    const buf = await readBody(req, limit);
    if (buf.length === 0) return {};
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'invalid JSON');
    }
  }

  /** Per-IP limit shared by every API route. Returns false after answering 429. */
  function ipOk(req: IncomingMessage, res: ServerResponse): boolean {
    const ip = clientIp(req);
    if (ipLimiter.take(ip, Date.now())) return true;
    sendError(req, res, 429, 'RATE_LIMITED', undefined, { 'Retry-After': ipLimiter.retryAfterSec(ip) });
    return false;
  }

  function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
    if (!admin.enabled) {
      sendError(req, res, 503, 'UNAUTHORIZED', 'admin is disabled on this server');
      return false;
    }
    const ip = clientIp(req);
    // Failed attempts are metered per IP; once the budget is spent the token is not even checked.
    if (!adminFailLimiter.has(ip, Date.now())) {
      sendError(req, res, 429, 'RATE_LIMITED', undefined, { 'Retry-After': adminFailLimiter.retryAfterSec(ip) });
      return false;
    }
    if (admin.check(req.headers.authorization)) return true;
    adminFailLimiter.take(ip, Date.now());
    sendError(req, res, 401, 'UNAUTHORIZED');
    return false;
  }

  function playerCreds(url: URL): { playerId: string | null; tokenHash: string | null } {
    const pid = url.searchParams.get('playerId');
    const tok = url.searchParams.get('token');
    if (!isValidPlayerId(pid) || !tok || tok.length < LIMITS.tokenMin || tok.length > LIMITS.tokenMax) return { playerId: null, tokenHash: null };
    return { playerId: pid, tokenHash: hashToken(tok) };
  }

  function health(): Record<string, unknown> {
    const mem = process.memoryUsage();
    const st = runtime.state;
    const ps = ctx.persistence?.status();
    const hs = hub.stats();
    return {
      ok: true,
      version: st.version,
      sid: runtime.sid,
      phase: st.phase,
      step: st.step,
      paused: st.pausedAt != null,
      players: st.playerOrder.length,
      teams: st.teamOrder.length,
      clients: hs.clients,
      connectedPlayers: hub.connectedPlayerIds().length,
      commandsPerSec: runtime.commandsPerSec(),
      commandsTotal: runtime.commandsTotal,
      commandsChanged: runtime.commandsChanged,
      p50ApplyMs: round(runtime.p50ApplyMs()),
      p99ApplyMs: round(runtime.p99ApplyMs()),
      maxApplyMs: round(runtime.getMaxApplyMs()),
      eventLoopLagMs: runtime.eventLoopLagMs(),
      heapUsedMB: round(mem.heapUsed / 1048576),
      rssMB: round(mem.rss / 1048576),
      snapshotAgeSec: ps?.snapshotAgeSec ?? null,
      lastSnapshotOk: ps?.lastSnapshotOk ?? true,
      maxViewBytes: views.maxViewBytes,
      degradedViews: views.degradedViews,
      lastFlushMs: round(hs.lastFlushMs),
      maxFlushMs: round(hs.maxFlushMs),
      sseBytesOut: hs.bytesOut,
      sseEventsOut: hs.eventsOut,
      sseDropped: hs.dropped,
      sseMaxWritableBytes: hs.maxWritableSeen,
      uptimeSec: Math.round((runtime.now() - runtime.startedAt) / 1000),
    };
  }

  // ---- routes ------------------------------------------------------------------

  async function handlePlayerCommand(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!ipOk(req, res)) return;
    const body = await readJson(req, LIMITS.commandBodyBytes);
    const v = validateCommandEnvelope(body);
    if (!v.ok) return sendError(req, res, 400, 'BAD_REQUEST', v.message);
    const env = v.value;
    const hash = hashToken(env.token);
    const state = runtime.state;
    const auth = checkPlayer(state, env.playerId, hash);
    if (auth === 'bad-token' || (auth === 'unknown' && env.type !== 'JOIN')) return sendError(req, res, 401, 'UNAUTHORIZED');
    if (!cmdLimiter.take(env.playerId, Date.now())) {
      return sendError(req, res, 429, 'RATE_LIMITED', undefined, { 'Retry-After': cmdLimiter.retryAfterSec(env.playerId) });
    }
    const payload = env.type === 'JOIN' ? { playerId: env.playerId, tokenHash: hash, ...(env.payload as object) } : env.payload;
    const cmd: Command = { commandId: env.commandId, type: env.type, actor: { kind: 'player', playerId: env.playerId }, payload };
    const r = runtime.apply(cmd);
    const out: CommandResult = r.ok ? { ok: true, v: r.version } : { ok: false, v: r.version, error: r.error as ErrorCode };
    sendJson(req, res, 200, out);
  }

  function handleStream(req: IncomingMessage, res: ServerResponse, url: URL, screen: boolean): void {
    if (!ipOk(req, res)) return;
    const { playerId, tokenHash } = screen ? { playerId: null, tokenHash: null } : playerCreds(url);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(req),
    });
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 30_000);
    req.socket.setTimeout(0);
    const retry = 2000 + Math.floor(Math.random() * 3001);
    hub.connect(res, screen ? 'screen' : 'player', playerId, tokenHash, retry);
  }

  function handleView(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!ipOk(req, res)) return;
    const { playerId, tokenHash } = playerCreds(url);
    if (playerId && !viewLimiter.take(playerId, Date.now())) {
      return sendError(req, res, 429, 'RATE_LIMITED', undefined, { 'Retry-After': viewLimiter.retryAfterSec(playerId) });
    }
    const now = Date.now();
    const b = views.forPlayer(runtime.state, playerId, tokenHash, now);
    const etag = `"${b.hash}"`;
    const common = { ETag: etag, 'X-Server-Now': now, 'Cache-Control': 'no-cache' };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...common, ...corsHeaders(req) });
      res.end();
      return;
    }
    send(req, res, 200, b.json, 'application/json; charset=utf-8', common);
  }

  function handleScreenView(req: IncomingMessage, res: ServerResponse): void {
    if (!ipOk(req, res)) return;
    const now = Date.now();
    const s = views.screen(runtime.state, now);
    const etag = `"${s.hash}"`;
    const common = { ETag: etag, 'X-Server-Now': now, 'Cache-Control': 'no-cache' };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...common, ...corsHeaders(req) });
      res.end();
      return;
    }
    send(req, res, 200, s.json, 'application/json; charset=utf-8', common);
  }

  // The recap is built once per state version and served to every phone and the projector (ETag + gzip).
  let recapCache: { version: number; json: string; gz: Buffer; etag: string } | null = null;

  function handleRecap(req: IncomingMessage, res: ServerResponse): void {
    if (!ipOk(req, res)) return;
    const st = runtime.state;
    if (st.phase !== 'FINISHED') return sendError(req, res, 404, 'BAD_REQUEST', 'the recap is ready when the game is finished');
    if (!recapCache || recapCache.version !== st.version) {
      const json = JSON.stringify(buildRecap(st));
      recapCache = { version: st.version, json, gz: gzipSync(json), etag: `"r${st.version}-${createHash('sha1').update(json).digest('base64url').slice(0, 10)}"` };
    }
    const c = recapCache;
    // Cacheable by the browser and by a CDN; the client adds ?v=<state version> so each game version is its own URL.
    const common = { ETag: c.etag, 'Cache-Control': 'public, max-age=20', Vary: 'Accept-Encoding, Origin' };
    if (req.headers['if-none-match'] === c.etag) {
      res.writeHead(304, { ...common, ...corsHeaders(req), Vary: 'Accept-Encoding, Origin' });
      res.end();
      return;
    }
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    send(req, res, 200, acceptsGzip ? c.gz : c.json, 'application/json; charset=utf-8', { ...common, ...(acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}) });
  }

  function handleTeamPreview(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!ipOk(req, res)) return;
    const { playerId, tokenHash } = playerCreds(url);
    if (!playerId || !tokenHash || checkPlayer(runtime.state, playerId, tokenHash) !== 'ok') return sendError(req, res, 401, 'UNAUTHORIZED');
    if (!viewLimiter.take(playerId, Date.now())) return sendError(req, res, 429, 'RATE_LIMITED', undefined, { 'Retry-After': 1 });
    const code = (url.searchParams.get('code') ?? '').slice(0, LIMITS.emojiCode);
    const r = previewTeamByEmoji(runtime.state, code);
    if (!r.ok) return sendError(req, res, r.error === 'INVALID_CODE' ? 400 : 404, r.error);
    const p = r.preview;
    sendJson(req, res, 200, {
      ok: true,
      team: {
        name: p.name,
        emojiCode: p.emojiCode,
        memberCount: p.memberCount,
        maxMembers: p.maxMembers,
        isFull: p.isFull,
        leaderName: p.leaderName,
        members: p.members.map(m => ({ name: m.name })),
      },
    });
  }

  // ---- admin -------------------------------------------------------------------

  async function handleAdminCommand(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req, MAX_ADMIN_BODY_BYTES);
    const v = validateAdminBody(body);
    if (!v.ok) return sendError(req, res, 400, 'BAD_REQUEST', v.message);
    if (!COMMAND_TYPES.includes(v.value.type)) return sendError(req, res, 400, 'BAD_REQUEST', 'unknown admin command');
    const cmd: Command = { commandId: v.value.commandId ?? `adm:${randomUUID()}`, type: v.value.type, actor: { kind: 'admin' }, payload: v.value.payload ?? {} };
    const r = runtime.apply(cmd);
    sendJson(req, res, 200, r.ok ? { ok: true, v: r.version } : { ok: false, v: r.version, error: r.error });
  }

  function handleAdminView(req: IncomingMessage, res: ServerResponse): void {
    const now = Date.now();
    const a = buildAdminView({ state: runtime.state, connected: new Set(hub.connectedPlayerIds()), sid: runtime.sid, now, notice: views.getNotice() });
    const etag = `"a-${a.hash}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', ...corsHeaders(req) });
      res.end();
      return;
    }
    // Metrics are appended outside the ETag: they change constantly (the status strip polls /health).
    const body = `{"serverNow":${now},"metrics":${JSON.stringify({ ...health(), persistence: ctx.persistence?.status() ?? null })},${a.stable.slice(1)}`;
    send(req, res, 200, body, 'application/json; charset=utf-8', { ETag: etag, 'Cache-Control': 'no-cache' });
  }

  function handleAdminBackup(req: IncomingMessage, res: ServerResponse): void {
    const st = runtime.state;
    const body = `{"format":1,"savedAt":${Date.now()},"version":${st.version},"state":${JSON.stringify(st)}}`;
    send(req, res, 200, body, 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="underworld-v${st.version}.json"` });
  }

  /** Game-data export (admin only): everything recorded about the game, as one JSON document or one CSV row per vote or action. */
  function handleAdminExport(req: IncomingMessage, res: ServerResponse, kind: 'json' | 'csv'): void {
    const st = runtime.state;
    const name = `underworld-export-v${st.version}.${kind}`;
    const headers = { 'Content-Disposition': `attachment; filename="${name}"` };
    if (kind === 'json') send(req, res, 200, JSON.stringify(buildExportJson(st, Date.now()), null, 1), 'application/json; charset=utf-8', headers);
    else send(req, res, 200, buildExportCsv(st), 'text/csv; charset=utf-8', headers);
  }

  async function handleAdminRestore(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req, MAX_RESTORE_BYTES)) as Record<string, unknown> | null;
    const isEnvelope = !!body && typeof body === 'object' && 'state' in body && 'format' in body;
    const candidate = isEnvelope ? (body as { state: unknown }).state : body;
    const savedAt = isEnvelope && typeof body?.savedAt === 'number' ? (body.savedAt as number) : Date.now();
    const problem = gameStateProblem(candidate);
    if (problem) return sendError(req, res, 400, 'BAD_REQUEST', `not a game state: ${problem}`);
    const incoming = candidate as GameState;
    // Dry run: every view must build before the live state is touched.
    try {
      const probe = new ViewBuilder({ sid: 'probe' });
      for (const pid of incoming.playerOrder) probe.forPlayer(incoming, pid, incoming.players[pid].tokenHash, savedAt);
      probe.screen(incoming, savedAt);
    } catch (e) {
      return sendError(req, res, 400, 'BAD_REQUEST', `state cannot be rendered: ${e instanceof Error ? e.message : 'error'}`);
    }
    const paused = pauseRestored(incoming, savedAt, randomBytes(6).toString('hex'));
    // Keep the version monotonic so clients of this server instance accept the restored state.
    const next: GameState = { ...paused, version: Math.max(runtime.state.version, paused.version) + 1 };
    runtime.replaceState(next);
    views.invalidate();
    hub.resync();
    ctx.persistence?.snapshotNow();
    sendJson(req, res, 200, { ok: true, v: next.version, phase: next.phase, paused: true });
  }

  async function handleAdminNotice(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req, 2048)) as { text?: unknown };
    if (!body || typeof body !== 'object' || (body.text !== undefined && body.text !== null && typeof body.text !== 'string')) {
      return sendError(req, res, 400, 'BAD_REQUEST', 'text must be a string');
    }
    views.setNotice(typeof body.text === 'string' ? body.text.trim() : null);
    hub.markDirty();
    sendJson(req, res, 200, { ok: true, v: runtime.state.version });
  }

  // ---- dispatch ----------------------------------------------------------------

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }

    if (path === '/health' && (method === 'GET' || method === 'HEAD')) return sendJson(req, res, 200, health());
    if (path === '/api/meta' && method === 'GET') {
      return send(req, res, 200, metaJson, 'application/json; charset=utf-8', { 'Cache-Control': 'public, max-age=300' });
    }
    if (path === '/api/command' && method === 'POST') return handlePlayerCommand(req, res);
    if (path === '/api/recap' && (method === 'GET' || method === 'HEAD')) return handleRecap(req, res);
    if (path === '/api/stream' && method === 'GET') return handleStream(req, res, url, false);
    if (path === '/api/view' && method === 'GET') return handleView(req, res, url);
    if (path === '/api/team-preview' && method === 'GET') return handleTeamPreview(req, res, url);
    if ((path === '/screen-view' || path === '/api/screen') && method === 'GET') return handleScreenView(req, res);
    if (path === '/api/screen/stream' && method === 'GET') return handleStream(req, res, url, true);

    if (path.startsWith('/api/admin/')) {
      if (!ipOk(req, res)) return;
      if (!requireAdmin(req, res)) return;
      if (path === '/api/admin/command' && method === 'POST') return handleAdminCommand(req, res);
      if (path === '/api/admin/view' && method === 'GET') return handleAdminView(req, res);
      if (path === '/api/admin/backup' && method === 'GET') return handleAdminBackup(req, res);
      if (path === '/api/admin/export.json' && method === 'GET') return handleAdminExport(req, res, 'json');
      if (path === '/api/admin/export.csv' && method === 'GET') return handleAdminExport(req, res, 'csv');
      if (path === '/api/admin/restore' && method === 'POST') return handleAdminRestore(req, res);
      if (path === '/api/admin/resync' && method === 'POST') {
        const n = hub.resync();
        return sendJson(req, res, 200, { ok: true, v: runtime.state.version, notified: n });
      }
      if (path === '/api/admin/notice' && method === 'POST') return handleAdminNotice(req, res);
      if (path === '/api/admin/reset-metrics' && method === 'POST') {
        runtime.resetMetrics();
        views.maxViewBytes = 0;
        return sendJson(req, res, 200, { ok: true });
      }
      return sendError(req, res, 404, 'BAD_REQUEST', 'unknown admin route');
    }

    if (path.startsWith('/api/')) return sendError(req, res, 404, 'BAD_REQUEST', 'unknown route');

    if (config.staticDir && (await serveStatic(config.staticDir, req, res, path, corsHeaders(req)))) return;
    if (path === '/' && method === 'GET') {
      return send(req, res, 200, 'Underworld game server. See /health.\n', 'text/plain; charset=utf-8');
    }
    sendJson(req, res, 404, { ok: false, error: 'BAD_REQUEST', message: 'not found' });
  }

  const server = createServer((req, res) => {
    route(req, res).catch(e => {
      if (e instanceof HttpError) {
        sendError(req, res, e.status, e.code, e.status === 400 ? e.message : undefined, e.status === 413 ? { Connection: 'close' } : {});
        return;
      }
      console.error('request failed', e instanceof Error ? e.message : 'unknown');
      if (!res.headersSent) sendError(req, res, 500, 'BAD_REQUEST', 'internal error');
      else res.destroy();
    });
  });
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;
  server.timeout = 0;
  return server;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
