// The swarm's shared context: bot lifecycle, admin helpers, server health sampling and spawning the
// server as a child process (for the chaos-restart scenario).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, newCounters } from './bot.ts';
import type { Counters } from './bot.ts';
import { brain, newWorld } from './brain.ts';
import type { World } from './brain.ts';
import { mb, mulberry, sleep, slope, summarize } from './stats.ts';
import type { CommandResult, View } from '../../shared/protocol.ts';

export interface SwarmOptions {
  target: string;
  adminToken: string;
  bots: number;
  fast: boolean;
  joinSeconds: number;
  seed: number;
  dupRate: number;
  abortRate: number;
  spawn: boolean;
  verbose: boolean;
  json?: string;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ScenarioResult {
  name: string;
  pass: boolean;
  skipped?: boolean;
  checks: Check[];
  numbers: Record<string, number | string>;
  notes: string[];
  durationSec: number;
}

export interface Health {
  ok: boolean;
  version: number;
  sid: string;
  phase: string;
  paused: boolean;
  players: number;
  teams: number;
  clients: number;
  commandsPerSec: number;
  commandsTotal: number;
  commandsChanged: number;
  p50ApplyMs: number;
  p99ApplyMs: number;
  maxApplyMs: number;
  eventLoopLagMs: number;
  heapUsedMB: number;
  rssMB: number;
  snapshotAgeSec: number | null;
  lastSnapshotOk: boolean;
  maxViewBytes: number;
  degradedViews: number;
  maxFlushMs: number;
  sseBytesOut: number;
  sseEventsOut: number;
  sseDropped: Record<string, number>;
  sseMaxWritableBytes: number;
  uptimeSec: number;
}

export interface AdminTeam {
  id: string;
  name: string;
  battleCode: string;
  playerIds: string[];
  score: number;
  r1: { codeword: string; solved: boolean; points: number; solveSeconds: number | null } | null;
}

export interface AdminViewData {
  v: number;
  phase: { name: string; step: string | null; clash: number; wave: number; endsAt: number | null; paused: boolean; phaseSeq: number };
  counts: { players: number; teams: number; connected: number };
  players: { id: string; name: string; teamId: string | null; connected: boolean }[];
  teams: AdminTeam[];
  matches: { id: string; teamA: string; teamB: string; clashes: { clash: number; resolved: boolean; stanceA: string | null; stanceB: string | null; votedA: number; votedB: number }[] }[];
  unpairedTeamIds: string[];
  r3: { escapeOrder: string[]; waves: number; teams: Record<string, { distance: number; escaped: boolean; escapeRank: number | null; leashHolder: boolean }> } | null;
}

export const FAST_DURATIONS = { r1Seconds: 30, r2: { HUDDLE: 6, PARLEY: 5, VOTE: 10, DEBRIEF: 5 }, r3: { BLUFF: 6, VOTE: 10, REVEAL: 5 }, sdSeconds: 10 };
export const NORMAL_DURATIONS = { r1Seconds: 300, r2: { HUDDLE: 50, PARLEY: 40, VOTE: 25, DEBRIEF: 40 }, r3: { BLUFF: 55, VOTE: 20, REVEAL: 25 }, sdSeconds: 40 };

export interface SampleSummary {
  samples: number;
  maxP99ApplyMs: number;
  maxApplyMs: number;
  maxLoopLagMs: number;
  heapStartMB: number;
  heapEndMB: number;
  heapMaxMB: number;
  /** MB per minute over the second half of the samples. */
  heapSlopeMBperMin: number;
  rssMaxMB: number;
  maxClients: number;
  maxViewBytes: number;
  maxWritable: number;
  dropped: Record<string, number>;
  sseBytesOut: number;
  series: { t: number; heap: number; rss: number; lag: number; clients: number }[];
}

export class Sampler {
  private readonly sw: Swarm;
  private timer: NodeJS.Timeout | null = null;
  private readonly samples: (Health & { t: number })[] = [];
  private first: Health | null = null;

  constructor(sw: Swarm) {
    this.sw = sw;
  }

  start(everyMs = 1000): void {
    const tick = async () => {
      const h = await this.sw.health().catch(() => null);
      if (h) {
        if (!this.first) this.first = h;
        this.samples.push({ ...h, t: Date.now() });
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), everyMs);
  }

  stop(): SampleSummary {
    if (this.timer) clearInterval(this.timer);
    const s = this.samples;
    const half = s.slice(Math.floor(s.length / 2));
    const last = s[s.length - 1];
    return {
      samples: s.length,
      maxP99ApplyMs: Math.max(0, ...s.map(x => x.p99ApplyMs)),
      maxApplyMs: Math.max(0, ...s.map(x => x.maxApplyMs)),
      maxLoopLagMs: Math.max(0, ...s.map(x => x.eventLoopLagMs)),
      heapStartMB: s[0]?.heapUsedMB ?? 0,
      heapEndMB: last?.heapUsedMB ?? 0,
      heapMaxMB: Math.max(0, ...s.map(x => x.heapUsedMB)),
      heapSlopeMBperMin: half.length > 3 ? slope(half.map(x => x.t / 60000), half.map(x => x.heapUsedMB)) : 0,
      rssMaxMB: Math.max(0, ...s.map(x => x.rssMB)),
      maxClients: Math.max(0, ...s.map(x => x.clients)),
      maxViewBytes: Math.max(0, ...s.map(x => x.maxViewBytes)),
      maxWritable: Math.max(0, ...s.map(x => x.sseMaxWritableBytes)),
      dropped: last?.sseDropped ?? {},
      sseBytesOut: (last?.sseBytesOut ?? 0) - (this.first?.sseBytesOut ?? 0),
      series: s.map(x => ({ t: x.t, heap: x.heapUsedMB, rss: x.rssMB, lag: x.eventLoopLagMs, clients: x.clients })),
    };
  }
}

export class SpawnedServer {
  port = 0;
  dir = '';
  child: ChildProcess | null = null;
  readonly adminToken: string;
  private readonly extraEnv: Record<string, string>;

  constructor(adminToken: string, extraEnv: Record<string, string> = {}) {
    this.adminToken = adminToken;
    this.extraEnv = extraEnv;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async init(): Promise<void> {
    this.dir = await mkdtemp(join(tmpdir(), 'wcl-swarm-'));
    this.port = await new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
  }

  async start(): Promise<void> {
    const entry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'index.ts');
    this.child = spawn(process.execPath, [entry], {
      env: { ...process.env, PORT: String(this.port), ADMIN_TOKEN: this.adminToken, SNAPSHOT_DIR: this.dir, ALLOWED_ORIGIN: '*', NODE_ENV: 'development', NODE_NO_WARNINGS: '1', ...this.extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout?.resume();
    this.child.stderr?.resume();
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(500) });
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      await sleep(100);
    }
    throw new Error('spawned server did not become healthy');
  }

  kill(signal: NodeJS.Signals): Promise<void> {
    return new Promise(resolve => {
      const c = this.child;
      if (!c || c.exitCode !== null) return resolve();
      c.once('exit', () => resolve());
      c.kill(signal);
    });
  }

  async cleanup(): Promise<void> {
    await this.kill('SIGTERM');
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
  }
}

export class Swarm {
  opts: SwarmOptions;
  counters: Counters = newCounters();
  bots: Bot[] = [];
  world: World = newWorld();
  server: SpawnedServer | null = null;
  runTag = Math.random().toString(36).slice(2, 7);
  private pairingRefresh: Promise<void> | null = null;
  private lastRefresh = 0;
  serverOffset = 0;

  constructor(opts: SwarmOptions) {
    this.opts = opts;
    this.world.refresh = () => this.refreshWorld();
    this.world.log = m => this.log(m);
  }

  get target(): string {
    return this.server ? this.server.url : this.opts.target;
  }

  log(m: string): void {
    if (this.opts.verbose) console.log(`  [swarm] ${m}`);
  }

  // ---- HTTP helpers ------------------------------------------------------------

  async admin(type: string, payload: unknown = {}): Promise<CommandResult> {
    const res = await fetch(`${this.target}/api/admin/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 503) throw new Error(`admin request refused (HTTP ${res.status}): check --admin-token`);
    return (await res.json()) as CommandResult;
  }

  async adminPost(path: string, body: unknown = {}): Promise<Response> {
    return fetch(`${this.target}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.opts.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async adminView(): Promise<AdminViewData> {
    const res = await fetch(`${this.target}/api/admin/view`, { headers: { Authorization: `Bearer ${this.opts.adminToken}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`admin view failed: HTTP ${res.status}`);
    return (await res.json()) as AdminViewData;
  }

  async health(): Promise<Health> {
    const res = await fetch(`${this.target}/health`, { signal: AbortSignal.timeout(5000) });
    return (await res.json()) as Health;
  }

  async resetMetrics(): Promise<void> {
    await this.adminPost('/api/admin/reset-metrics');
  }

  sampler(): Sampler {
    return new Sampler(this);
  }

  /** Estimate server clock minus local clock using the lowest-RTT of a few samples. */
  async measureClockOffset(): Promise<number> {
    let best = { rtt: Infinity, offset: 0 };
    for (let i = 0; i < 8; i++) {
      const t0 = Date.now();
      const res = await fetch(`${this.target}/api/view`);
      const t1 = Date.now();
      const sn = Number(res.headers.get('x-server-now'));
      await res.body?.cancel();
      if (sn && t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: sn - (t0 + t1) / 2 };
      await sleep(20);
    }
    this.serverOffset = best.offset;
    return best.offset;
  }

  // ---- shared knowledge ("the codeword on the tablet", "the rival's battle code") -----

  refreshWorld(): Promise<void> {
    if (this.pairingRefresh && Date.now() - this.lastRefresh < 1000) return this.pairingRefresh;
    this.lastRefresh = Date.now();
    this.pairingRefresh = (async () => {
      const a = await this.adminView();
      for (const t of a.teams) {
        if (t.r1?.codeword) this.world.codewords.set(t.id, t.r1.codeword);
      }
      // Rivals: consecutive teams in creation order, like crews who sit next to each other.
      const unpaired = a.teams.filter(t => a.unpairedTeamIds.includes(t.id));
      for (let i = 0; i + 1 < unpaired.length; i += 2) {
        this.world.rivalCode.set(unpaired[i].id, unpaired[i + 1].battleCode);
        this.world.rivalCode.set(unpaired[i + 1].id, unpaired[i].battleCode);
      }
    })();
    return this.pairingRefresh;
  }

  // ---- bots ------------------------------------------------------------------------

  makeBots(n: number, tweak: { dupRate?: number; abortRate?: number } = {}): Bot[] {
    const rng = mulberry(this.opts.seed);
    this.bots = Array.from({ length: n }, (_, i) => {
      const tok = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng() * 36)]).join('');
      return new Bot({
        target: this.target,
        index: i,
        id: `bot-${this.runTag}-${String(i).padStart(3, '0')}`,
        token: `${tok}${this.runTag}`,
        name: `Bot ${String(i).padStart(3, '0')}`,
        dupRate: tweak.dupRate ?? this.opts.dupRate,
        abortRate: tweak.abortRate ?? this.opts.abortRate,
        seed: this.opts.seed * 1000 + i,
        counters: this.counters,
        onView: brain(this.world),
      });
    });
    return this.bots;
  }

  startBots(): void {
    for (const b of this.bots) b.start();
  }

  stopBots(): void {
    for (const b of this.bots) b.stop();
  }

  async waitAll(pred: (v: View, b: Bot) => boolean, timeoutMs: number, bots: Bot[] = this.bots): Promise<(number | null)[]> {
    return Promise.all(bots.map(b => b.waitFor(v => pred(v, b), timeoutMs)));
  }

  /** Every bot opens its stream and receives a first view. */
  async connectAll(timeoutMs = 30_000): Promise<boolean> {
    this.startBots();
    const t = await this.waitAll(() => true, timeoutMs);
    return t.every(x => x !== null);
  }

  async resetGame(durations = FAST_DURATIONS): Promise<void> {
    const r = await this.admin('ADMIN_RESET_GAME');
    if (!r.ok) throw new Error(`reset failed: ${r.error}`);
    const d = await this.admin('ADMIN_SET_DURATIONS', durations);
    if (!d.ok) throw new Error(`set durations failed: ${d.error}`);
    const h = await this.admin('ADMIN_RESUME').catch(() => null);
    void h; // a restored/paused server is resumed; "not paused" is fine
  }

  /** Join all bots over `spreadMs`; resolves with the number of accepted JOIN commands. */
  async joinAll(spreadMs: number): Promise<number> {
    let ok = 0;
    await Promise.all(
      this.bots.map(async b => {
        await sleep(b.rng() * spreadMs);
        const r = await b.cmd('JOIN', { name: b.cfg.name });
        if (r?.body.ok) ok++;
      }),
    );
    return ok;
  }

  /** Bots form teams like players do; stragglers are grouped by the admin. Resolves true when every bot has a team. */
  async formTeams(timeoutMs = 40_000): Promise<boolean> {
    const t0 = Date.now();
    const settled = async (ms: number) => {
      const r = await this.waitAll(v => !!v.me?.joinedTeam, ms);
      return r.every(x => x !== null);
    };
    if (await settled(Math.min(timeoutMs, 12_000))) return true;
    this.log('some bots have no team yet: admin auto-group');
    await this.admin('ADMIN_AUTO_GROUP');
    if (await settled(Math.min(8000, Math.max(5000, timeoutMs - (Date.now() - t0))))) return true;
    // Auto-group leaves a single straggler for the host to place: move each one into a crew with room (< 6).
    const loners = this.bots.filter(b => !b.view?.me?.joinedTeam);
    const crews = new Map<string, number>();
    for (const b of this.bots) if (b.view?.team) crews.set(b.view.team.id, b.view.team.members.length);
    for (const b of loners) {
      const room = [...crews.entries()].sort((x, y) => x[1] - y[1]).find(([, n]) => n < 6);
      if (!room) break;
      this.log(`placing straggler ${b.cfg.name} by hand`);
      await this.admin('ADMIN_MOVE_PLAYER', { playerId: b.id, teamId: room[0] });
      crews.set(room[0], room[1] + 1);
    }
    return settled(Math.max(5000, timeoutMs - (Date.now() - t0)));
  }

  /** Reset, create bots, connect, join, form teams. */
  async setup(opts: { joinSpreadMs: number; teams?: boolean; durations?: typeof FAST_DURATIONS; bots?: number } = { joinSpreadMs: 8000 }): Promise<{ joined: number; teamed: boolean }> {
    await this.resetGame(opts.durations);
    this.makeBots(opts.bots ?? this.opts.bots);
    if (!(await this.connectAll())) throw new Error('not every bot could open its stream');
    const joined = await this.joinAll(opts.joinSpreadMs);
    const teamed = opts.teams === false ? false : await this.formTeams();
    return { joined, teamed };
  }

  /** Run `fn` for every bot at (nearly) the same instant. */
  async barrier<T>(bots: Bot[], leadMs: number, fn: (b: Bot) => Promise<T>): Promise<{ at: number; results: T[] }> {
    const at = Date.now() + leadMs;
    const results = await Promise.all(
      bots.map(async b => {
        const wait = at - Date.now();
        if (wait > 0) await sleep(wait);
        return fn(b);
      }),
    );
    return { at, results };
  }

  async waitPhase(name: string, step: string | null | undefined, timeoutMs: number): Promise<boolean> {
    const t0 = Date.now();
    for (;;) {
      const a = await this.adminView();
      if (a.phase.name === name && (step === undefined || a.phase.step === step)) return true;
      if (Date.now() - t0 > timeoutMs) return false;
      await sleep(250);
    }
  }

  async skipUntilStep(step: string, maxSkips = 8): Promise<boolean> {
    for (let i = 0; i < maxSkips; i++) {
      const a = await this.adminView();
      if (a.phase.step === step) return true;
      await this.admin('ADMIN_SKIP_STEP', { phaseSeq: a.phase.phaseSeq });
      await sleep(100);
    }
    return (await this.adminView()).phase.step === step;
  }

  bytesReceived(): { sse: number; poll: number; cmd: number; total: number } {
    const c = this.counters;
    return { sse: c.bytesSse, poll: c.bytesPoll, cmd: c.bytesCmd, total: c.bytesSse + c.bytesPoll + c.bytesCmd };
  }

  dispose(): void {
    this.stopBots();
  }
}

export { mb, summarize };
