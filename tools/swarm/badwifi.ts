// The "bad pub wifi" chaos for the bad-wifi scenario. It runs next to a normal full game (playFullGame) and
// injects what really happens in a pub: phones that lose signal for a while, page refreshes, players who
// leave for good (alone or a whole crew), crews that do not vote, the host removing a player mid-round and
// players who join after the game started. Everything random comes from one seeded generator, so the same
// --seed injects the same plan (the exact timing of a live server still varies).
//
// Nothing here touches the server process: it only plays phones (SSE + commands) and the host (admin commands).
import type { Bot } from './bot.ts';
import { FAST_DURATIONS } from './context.ts';
import type { AdminViewData, Check, Swarm } from './context.ts';
import { fmt, mulberry, percentile, sleep } from './stats.ts';
import type { View } from '../../shared/protocol.ts';

/** Catch-up bound after a phone gets its signal back (the web client reconnects within 0-5 s, plus a round trip). */
export const CATCH_UP_LIMIT_MS = 10_000;
const STUCK_MS = 10_000;
const OFFLINE_SHARE = 0.15;
const OUTAGE_MIN_MS = 5000;
const OUTAGE_MAX_MS = 60_000;

const keyOf = (name: string, step: string | null | undefined, clash: number, wave: number) => `${name}/${step ?? ''}/${clash}/${wave}`;
const viewKey = (v: View) => keyOf(v.phase.name, v.phase.step, v.phase.clash, v.phase.wave);
const admKey = (a: AdminViewData) => keyOf(a.phase.name, a.phase.step, a.phase.clash, a.phase.wave);

interface Outage {
  bot: Bot;
  endAt: number;
  startKey: string;
  forced: boolean;
}

interface Pending {
  bot: Bot;
  t0: number;
  refV: number | null;
}

interface LateJoiner {
  bot: Bot;
  when: string;
  teamId: string | null;
  joinOk: boolean;
  moveOk: boolean;
  gotCrewView: boolean;
  matesSee: boolean | null;
  placedAt: number;
  voteChecked: boolean;
  voteOk: boolean | null;
  note: string;
}

export class Chaos {
  readonly checks: Check[] = [];
  readonly numbers: Record<string, number | string> = {};
  readonly notes: string[] = [];
  private readonly sw: Swarm;
  private readonly rng: () => number;
  private adm: AdminViewData | null = null;
  private running = false;
  private quiet = false;
  private timers: NodeJS.Timeout[] = [];
  private seenAt = new Map<string, number>();
  private voteStartedAt = new Map<string, number>();
  private crewBots = new Map<string, Bot[]>();
  private fired = new Set<string>();
  private actionErrors: string[] = [];

  // plan
  private silentR2: string | undefined;
  private abstainR2 = new Set<string>();
  private silentR3: string | undefined;
  private abstainR3 = new Set<string>();
  private specialCrews = new Set<string>();
  private outagePool: Bot[] = [];
  private refreshBots: Bot[] = [];
  private leavers: Bot[] = [];
  private removalCands: Bot[] = [];
  private silencedR2At: { clash: number; step: string | null } | null = null;
  private silencedR3AtWave = 0;
  private basePlayers = 0;

  // observations
  private outages: Outage[] = [];
  private pending: Pending[] = [];
  private injected = 0;
  private forcedInjected = 0;
  private spanning = 0;
  private catchUps: number[] = [];
  private catchUpNoRef = 0;
  private neverCaughtUp = 0;
  private offlineSamples: number[] = [];
  private peakOffline = 0;
  private mismatchSince = new Map<string, number>();
  private stuckEpisodes = 0;
  private stuckFlagged = new Set<string>();
  private refreshResults: { ok: boolean; ms: number; detail: string }[] = [];
  private leaverRounds: string[] = [];
  private silentCrewPhones = 0;
  private removed: { id: string; round: string; viewGone: boolean; matesSaw: boolean | null; rejected401: boolean; carriedOn: boolean }[] = [];
  private late: LateJoiner[] = [];
  private waveReports = new Map<number, NonNullable<NonNullable<AdminViewData['r3']>['lastReport']>>();
  private clashSeen = new Map<number, number>();
  private waveSeen = new Map<number, number>();
  private phaseSeen = new Map<string, number>();
  private lastTick = 0;
  private quiesced: { ms: number; stragglers: number } | null = null;

  constructor(sw: Swarm) {
    this.sw = sw;
    this.rng = mulberry(sw.opts.seed * 7919 + 13);
    sw.world.abstain = (_bot, v) => this.abstains(v);
  }

  // ---- helpers -----------------------------------------------------------------

  private shuffle<T>(a: T[]): T[] {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }

  private between(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  private teamOf(b: Bot): string | undefined {
    return b.view?.team?.id;
  }

  private since(key: string): number {
    const t = this.seenAt.get(key);
    return t === undefined ? -1 : Date.now() - t;
  }

  private abstains(v: View): boolean {
    const crew = v.team?.id;
    if (!crew) return false;
    if (v.phase.name === 'R2_CLASH' && v.phase.clash === 2 && this.abstainR2.has(crew)) return true;
    if (v.phase.name === 'R3_ACTIVE' && (v.phase.wave === 2 || v.phase.wave === 3) && this.abstainR3.has(crew)) return true;
    return false;
  }

  private async safe(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.actionErrors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private check(name: string, pass: boolean, detail = ''): void {
    this.checks.push({ name, pass, detail });
  }

  private num(k: string, v: number | string): void {
    this.numbers[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
  }

  // ---- plan --------------------------------------------------------------------

  /** Called once the crews are formed, before the game starts. */
  async begin(): Promise<void> {
    const sw = this.sw;
    const a = await sw.adminView();
    this.adm = a;
    this.basePlayers = a.players.length;
    for (const b of sw.bots) {
      const t = this.teamOf(b);
      if (!t) continue;
      if (!this.crewBots.has(t)) this.crewBots.set(t, []);
      this.crewBots.get(t)!.push(b);
    }
    // Crews that do special things sit in different matches (the bots pair crews 2k and 2k+1 in creation order).
    const order = a.teams.map(t => t.id).filter(id => this.crewBots.has(id));
    const slotOf = (id: string) => Math.floor(a.teams.findIndex(t => t.id === id) / 2);
    const shuffled = this.shuffle(order);
    const usedSlots = new Set<number>();
    const pickCrew = (): string | undefined => {
      const i = shuffled.findIndex(id => !usedSlots.has(slotOf(id)));
      if (i < 0) return undefined;
      const [id] = shuffled.splice(i, 1);
      usedSlots.add(slotOf(id));
      this.specialCrews.add(id);
      return id;
    };
    this.silentR2 = pickCrew();
    for (let i = 0; i < 2; i++) {
      const c = pickCrew();
      if (c) this.abstainR2.add(c);
    }
    this.silentR3 = pickCrew();
    for (let i = 0; i < 2; i++) {
      const c = pickCrew();
      if (c) this.abstainR3.add(c);
    }
    const n = sw.bots.length;
    const normal = this.shuffle(sw.bots.filter(b => !this.specialCrews.has(this.teamOf(b) ?? '')));
    const taken = new Set<Bot>();
    const takeBots = (count: number, distinctCrews: Set<string> | null): Bot[] => {
      const out: Bot[] = [];
      for (const b of normal) {
        if (out.length >= count) break;
        if (taken.has(b)) continue;
        const c = this.teamOf(b) ?? '';
        if (distinctCrews) {
          if (distinctCrews.has(c)) continue;
          distinctCrews.add(c);
        }
        taken.add(b);
        out.push(b);
      }
      return out;
    };
    this.refreshBots = takeBots(Math.max(2, Math.round(n * 0.05)), null);
    const leaverCrews = new Set<string>();
    this.leavers = takeBots(Math.max(2, Math.round(n * 0.03)), leaverCrews);
    this.removalCands = takeBots(6, new Set(leaverCrews));
    const silentPhones = new Set<Bot>([this.silentR2, this.silentR3].flatMap(c => (c ? (this.crewBots.get(c) ?? []) : [])));
    this.outagePool = sw.bots.filter(b => !taken.has(b) && !silentPhones.has(b));
    this.notes.push(
      `plan (seed ${sw.opts.seed}): ${this.crewBots.size} crews; silent crew in R2 ${this.silentR2 ?? '-'}, in R3 ${this.silentR3 ?? '-'}; non-voting crews R2 clash 2: ${[...this.abstainR2].join(',') || '-'}, R3 waves 2-3: ${[...this.abstainR3].join(',') || '-'}; ` +
        `${this.refreshBots.length} refreshes, ${this.leavers.length} leavers, ${this.removalCands.length} removal candidates, ${this.outagePool.length} phones can lose signal`,
    );
    this.running = true;
    this.lastTick = Date.now();
    this.timers.push(setInterval(() => this.pollCatchUp(), 50));
    void this.loop();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        this.adm = await this.sw.adminView();
      } catch {
        /* keep the previous snapshot */
      }
      if (this.adm) await this.tick(this.adm);
      await sleep(750);
    }
  }

  // ---- the timeline ------------------------------------------------------------

  private async tick(a: AdminViewData): Promise<void> {
    const now = Date.now();
    const dt = Math.min(5000, now - this.lastTick);
    this.lastTick = now;
    const name = a.phase.name;
    const step = a.phase.step;
    const key = admKey(a);
    for (const k of [`phase:${name}`, `step:${key}`]) if (!this.seenAt.has(k)) this.seenAt.set(k, now);
    if (!this.phaseSeen.has(name)) this.phaseSeen.set(name, now);
    // A clash starts at its huddle; clash 1's BRIEFING (story, skipped by the host) is not clash time.
    if (name === 'R2_CLASH' && step !== 'BRIEFING' && !this.clashSeen.has(a.phase.clash)) this.clashSeen.set(a.phase.clash, now);
    if (name === 'R3_ACTIVE' && !this.waveSeen.has(a.phase.wave)) this.waveSeen.set(a.phase.wave, now);
    if (step === 'VOTE') {
      const vk = `${name}/${a.phase.clash}/${a.phase.wave}`;
      if (!this.voteStartedAt.has(vk)) this.voteStartedAt.set(vk, now);
    }
    const rep = a.r3?.lastReport;
    if (rep && !this.waveReports.has(rep.wave)) this.waveReports.set(rep.wave, rep);

    this.expireOutages(a);
    this.detectStuck(a, now);
    if (name === 'R3_RESULTS' || name === 'FINISHED') this.quiet = true;
    if (!this.quiet) this.injectOutages(a, dt);
    const offlineNow = this.sw.bots.filter(b => b.offline && !b.excluded).length;
    this.peakOffline = Math.max(this.peakOffline, offlineNow);
    if (!this.quiet && name !== 'LOBBY') this.offlineSamples.push(offlineNow);

    // ---- one-off events, each fired once when its moment comes ----
    const once = (id: string, cond: boolean, fn: () => Promise<void>) => {
      if (!cond || this.fired.has(id)) return;
      this.fired.add(id);
      void this.safe(id, fn);
    };
    const phaseSince = this.since(`phase:${name}`);
    const stepSince = this.since(`step:${key}`);

    // Round 1: late joiners
    for (let i = 0; i < 3; i++) once(`late-r1-${i}`, name === 'R1_ACTIVE' && phaseSince >= 1500 + i * 1500, () => this.lateJoin('R1'));
    // Round 2
    once('silent-r2', name === 'R2_CLASH' && !!this.silentR2, () => this.silenceCrew(this.silentR2!, 'R2', a));
    for (let i = 0; i < 3; i++) once(`late-r2-${i}`, name === 'R2_CLASH' && a.phase.clash === 1 && phaseSince >= 300 + i * 900, () => this.lateJoin('R2'));
    once('remove-r2', name === 'R2_CLASH' && a.phase.clash === 2 && step === 'VOTE' && stepSince >= 1500, () => this.removePlayer('R2'));
    once('span-r2', name === 'R2_CLASH' && a.phase.clash === 1 && step === 'VOTE' && stepSince >= 800, () => this.forceSpanningOutage(a));
    // Round 3
    once('silent-r3', name === 'R3_ACTIVE' && a.phase.wave >= 2 && !!this.silentR3, () => this.silenceCrew(this.silentR3!, 'R3', a));
    once('remove-r3', name === 'R3_ACTIVE' && a.phase.wave >= 2 && step === 'VOTE' && stepSince >= 1500, () => this.removePlayer('R3'));
    once('span-r3', name === 'R3_ACTIVE' && step === 'VOTE' && stepSince >= 800, () => this.forceSpanningOutage(a));

    // refreshes and leavers are spread over the three rounds
    const rounds = ['R1_ACTIVE', 'R2_CLASH', 'R3_ACTIVE'];
    this.refreshBots.forEach((b, i) => {
      const round = rounds[i % 3];
      once(`refresh-${i}`, name === round && phaseSince >= 2500 + ((i * 3719) % 14_000), () => this.refreshPhone(b));
    });
    this.leavers.forEach((b, i) => {
      const round = rounds[Math.floor((i * 3) / Math.max(1, this.leavers.length))] ?? 'R3_ACTIVE';
      once(`leave-${i}`, name === round && phaseSince >= 3000 + ((i * 2953) % 9000), async () => {
        b.goSilent();
        this.leaverRounds.push(round);
      });
    });

    this.verifyLateVotes(a);
  }

  // ---- no signal ---------------------------------------------------------------

  private canLoseSignal(b: Bot): boolean {
    return !b.offline && !b.excluded && !b.stopped && !b.muted && !this.pending.some(p => p.bot === b);
  }

  private injectOutages(a: AdminViewData, dtMs: number): void {
    const target = OFFLINE_SHARE * this.sw.bots.length;
    const meanSec = (OUTAGE_MIN_MS + OUTAGE_MAX_MS) / 2000;
    const want = (target / meanSec) * (dtMs / 1000);
    let count = Math.floor(want) + (this.rng() < want - Math.floor(want) ? 1 : 0);
    const offline = this.outages.length;
    if (offline + count < target * 0.5) count = Math.ceil(target * 0.5) - offline; // fill up quickly at the start
    if (offline + count > target * 1.4) count = Math.max(0, Math.floor(target * 1.4) - offline);
    const candidates = this.shuffle(this.outagePool.filter(b => this.canLoseSignal(b)));
    for (let i = 0; i < count && i < candidates.length; i++) this.startOutage(candidates[i], this.between(OUTAGE_MIN_MS, OUTAGE_MAX_MS), admKey(a), false);
  }

  private startOutage(bot: Bot, durMs: number, startKey: string, forced: boolean): void {
    bot.goOffline();
    this.outages.push({ bot, endAt: Date.now() + durMs, startKey, forced });
    this.injected++;
    if (forced) this.forcedInjected++;
  }

  private expireOutages(a: AdminViewData): void {
    const now = Date.now();
    const keep: Outage[] = [];
    for (const o of this.outages) {
      if (o.endAt <= now) this.endOutage(o, a);
      else keep.push(o);
    }
    this.outages = keep;
  }

  private endOutage(o: Outage, a: AdminViewData | null, wakeMs?: number): void {
    const bot = o.bot;
    // Most phones get the browser's 'online' event (reconnect within 0.4 s); some only reconnect on their backoff timer (1 to 5 s).
    const wake = wakeMs ?? (this.rng() < 0.7 ? this.rng() * 400 : this.between(1000, 5000));
    const mates = (this.crewBots.get(this.teamOf(bot) ?? '') ?? []).filter(m => m !== bot && !m.offline && !m.excluded && !!m.view && m.view.sid === bot.view?.sid);
    const refV = mates.length > 0 ? Math.max(...mates.map(m => m.view!.v)) : null;
    if (refV === null) this.catchUpNoRef++;
    if (a && admKey(a) !== o.startKey) this.spanning++;
    bot.comeOnline(wake);
    this.pending.push({ bot, t0: Date.now(), refV });
  }

  /** A few phones lose signal exactly across a VOTE -> DEBRIEF/REVEAL change. */
  private async forceSpanningOutage(a: AdminViewData): Promise<void> {
    const endsIn = Math.max(0, (a.phase.endsAt ?? Date.now()) - Date.now());
    const pick = this.shuffle(this.outagePool.filter(b => this.canLoseSignal(b))).slice(0, 5);
    for (const b of pick) this.startOutage(b, endsIn + this.between(5000, 9000), admKey(a), true);
  }

  /** Every 50 ms: has a returned phone got a fresh view at least as new as its online crewmates had? */
  private pollCatchUp(): void {
    const now = Date.now();
    const keep: Pending[] = [];
    for (const p of this.pending) {
      const b = p.bot;
      if (b.excluded) continue;
      const done = !b.offline && b.lastSeenAt > p.t0 && !!b.view && (p.refV === null || b.view.v >= p.refV);
      if (done) this.catchUps.push(now - p.t0);
      else if (now - p.t0 > 30_000) {
        this.neverCaughtUp++;
        this.catchUps.push(now - p.t0);
      } else keep.push(p);
    }
    this.pending = keep;
  }

  /** A phone that is online but shows an old phase/step for longer than STUCK_MS is a bug. */
  private detectStuck(a: AdminViewData, now: number): void {
    const key = admKey(a);
    for (const b of this.sw.liveBots()) {
      if (b.offline || !b.view || this.pending.some(p => p.bot === b)) {
        this.mismatchSince.delete(b.id);
        continue;
      }
      if (viewKey(b.view) === key) {
        this.mismatchSince.delete(b.id);
        continue;
      }
      const since = this.mismatchSince.get(b.id) ?? now;
      this.mismatchSince.set(b.id, since);
      if (now - since > STUCK_MS && !this.stuckFlagged.has(`${b.id}@${since}`)) {
        this.stuckFlagged.add(`${b.id}@${since}`);
        this.stuckEpisodes++;
        this.notes.push(`stuck: ${b.cfg.name} showed ${viewKey(b.view)} while the server was in ${key} for ${Math.round((now - since) / 1000)} s`);
      }
    }
  }

  /** End the chaos before the end of the game: everybody gets signal back and must show the live state. */
  async quiesce(): Promise<void> {
    this.quiet = true;
    const t0 = Date.now();
    const a = this.adm;
    for (const o of this.outages) this.endOutage(o, a, this.rng() * 400);
    this.outages = [];
    for (let i = 0; i < 400 && this.pending.length > 0; i++) await sleep(50);
    let live = await this.sw.adminView();
    this.adm = live;
    for (let i = 0; i < 100; i++) {
      live = await this.sw.adminView();
      if (this.sw.liveBots().every(b => b.view && viewKey(b.view) === admKey(live))) break;
      await sleep(100);
    }
    const stragglers = this.sw.liveBots().filter(b => !b.view || viewKey(b.view) !== admKey(live)).length;
    this.quiesced = { ms: Date.now() - t0, stragglers };
  }

  // ---- leaving, refreshing, removal, joining ------------------------------------------

  private silenceCrew(teamId: string, round: string, a: AdminViewData): Promise<void> {
    const bots = this.crewBots.get(teamId) ?? [];
    if (round === 'R2') this.silencedR2At = { clash: a.phase.clash, step: a.phase.step };
    else this.silencedR3AtWave = a.phase.wave;
    for (const b of bots) {
      this.outages = this.outages.filter(o => o.bot !== b);
      b.goSilent();
    }
    this.silentCrewPhones += bots.length;
    return Promise.resolve();
  }

  private async refreshPhone(b: Bot): Promise<void> {
    const v = b.view;
    if (b.offline || !v?.me || !v.team) {
      this.refreshResults.push({ ok: false, ms: 0, detail: `${b.cfg.name} had no seat to refresh from` });
      return;
    }
    const before = { id: v.me.id, name: v.me.name, role: v.me.role, team: v.team.id, joined: v.me.joinedTeam };
    const t0 = Date.now();
    b.refresh(this.between(500, 3000));
    const t = await b.waitFor(() => true, 20_000);
    const w = b.view;
    const same = !!w?.me && w.me.id === before.id && w.me.name === before.name && w.me.role === before.role && w.me.joinedTeam === before.joined && w.team?.id === before.team;
    this.refreshResults.push({ ok: t !== null && same, ms: t === null ? -1 : t - t0, detail: same ? '' : `${b.cfg.name}: ${JSON.stringify(before)} -> ${JSON.stringify({ id: w?.me?.id, name: w?.me?.name, role: w?.me?.role, team: w?.team?.id })}` });
  }

  private async removePlayer(round: string): Promise<void> {
    const a = this.adm!;
    const cand = this.removalCands.find(b => {
      if (b.excluded || b.offline || !b.view?.team) return false;
      if (round === 'R3' && a.r3?.teams[b.view.team.id]?.escaped) return false;
      return true;
    });
    if (!cand) {
      this.notes.push(`${round}: no removal candidate was available`);
      return;
    }
    cand.muted = true; // the host removed it; a still-open phone sends nothing useful any more
    const crew = this.teamOf(cand)!;
    const mates = (this.crewBots.get(crew) ?? []).filter(m => m !== cand && !m.offline && !m.excluded && !!m.view?.team);
    const before = mates[0]?.view?.team?.members.length ?? null;
    const res = await this.sw.admin('ADMIN_REMOVE_PLAYER', { playerId: cand.id });
    if (!res.ok) this.notes.push(`${round}: ADMIN_REMOVE_PLAYER failed: ${res.error}`);
    const gone = await cand.waitFor(v => !v.me && !v.team, 8000);
    const matesSaw = before === null || mates.length === 0 ? null : (await mates[0].waitFor(v => (v.team?.members.length ?? 99) === before - 1, 8000)) !== null;
    // a removed phone that still tries to act is turned away
    const hit = await fetch(`${this.sw.target}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ commandId: `rm-${cand.id}`, playerId: cand.id, token: cand.cfg.token, type: 'R2_VOTE', payload: { vote: 'TRUCE' } }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    await hit?.body?.cancel();
    // the crew carries on: it is still told about the next step and its other members still see themselves
    const crewOk = mates.length === 0 || mates.filter(m => !m.offline).every(m => !!m.view?.me && m.view.team?.id === crew);
    cand.excluded = true;
    this.removed.push({ id: cand.id, round, viewGone: res.ok && gone !== null, matesSaw, rejected401: hit?.status === 401, carriedOn: crewOk });
  }

  private async lateJoin(when: string): Promise<void> {
    const b = this.sw.addBot('Late');
    b.start();
    const rec: LateJoiner = { bot: b, when, teamId: null, joinOk: false, moveOk: false, gotCrewView: false, matesSee: null, placedAt: 0, voteChecked: false, voteOk: null, note: '' };
    this.late.push(rec);
    await b.waitFor(() => true, 15_000);
    const j = await b.cmd('JOIN', { name: b.cfg.name });
    rec.joinOk = j?.body.ok === true;
    const a = await this.sw.adminView();
    const paired = (id: string) => !a.unpairedTeamIds.includes(id);
    const options = a.teams.filter(t => t.playerIds.length < 6 && !this.specialCrews.has(t.id) && (when === 'R1' || paired(t.id)));
    if (options.length === 0) {
      rec.note = 'no crew with room';
      return;
    }
    const team = options[Math.floor(this.rng() * options.length)];
    rec.teamId = team.id;
    const mv = await this.sw.admin('ADMIN_MOVE_PLAYER', { playerId: b.id, teamId: team.id });
    rec.moveOk = mv.ok;
    rec.gotCrewView = (await b.waitFor(v => v.team?.id === team.id && v.me?.joinedTeam === true, 8000)) !== null;
    rec.placedAt = Date.now();
    const mate = (this.crewBots.get(team.id) ?? []).find(m => !m.offline && !m.excluded && !!m.view);
    if (mate) rec.matesSee = (await mate.waitFor(v => !!v.team?.members.some(m => m.name === b.cfg.name), 8000)) !== null;
  }

  /** A joiner placed before a Round 2 vote must have a counted vote of their own when that clash is scored. */
  private verifyLateVotes(a: AdminViewData): void {
    if (a.phase.name !== 'R2_CLASH' || a.phase.step !== 'DEBRIEF') return;
    if (this.since(`step:${admKey(a)}`) < 1500) return;
    const voteAt = this.voteStartedAt.get(`R2_CLASH/${a.phase.clash}/0`);
    for (const L of this.late) {
      if (L.voteChecked || !L.gotCrewView || !L.teamId || voteAt === undefined || voteAt < L.placedAt) continue;
      L.voteChecked = true;
      if (a.unpairedTeamIds.includes(L.teamId)) {
        L.note = 'crew was unpaired: no vote to check';
        continue;
      }
      L.voteOk = !!L.bot.view?.me?.myVote;
    }
  }

  // ---- final checks ----------------------------------------------------------------

  async finish(gameOk: boolean): Promise<void> {
    this.stop();
    const sw = this.sw;
    const c = sw.counters;
    const a = await sw.adminView();
    const limitSec = CATCH_UP_LIMIT_MS / 1000;

    // 1. flaky signal
    const sorted = [...this.catchUps].sort((x, y) => x - y);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const max = sorted[sorted.length - 1] ?? 0;
    const avgOffline = this.offlineSamples.length ? this.offlineSamples.reduce((s, x) => s + x, 0) / this.offlineSamples.length : 0;
    const n = Math.max(1, sw.bots.length);
    const minOutages = Math.max(3, Math.floor(n / 10));
    this.check(`flaky signal: ${this.injected} outages injected (>= ${minOutages}), on average ${fmt((avgOffline / n) * 100, 1)}% of phones offline (peak ${fmt((this.peakOffline / n) * 100, 1)}%)`, this.injected >= minOutages && avgOffline / n >= 0.07, '');
    this.check('flaky signal: some outages spanned a phase change', this.spanning >= 1, `${this.spanning} outages ended in a different step than they began in (${this.forcedInjected} forced across a vote)`);
    this.check(`flaky signal: every phone caught up within ${limitSec} s of getting signal back`, this.neverCaughtUp === 0 && max < CATCH_UP_LIMIT_MS && sorted.length > 0, `${sorted.length} reconnects, catch-up p50 ${fmt(p50, 0)} ms, p95 ${fmt(p95, 0)} ms, max ${fmt(max, 0)} ms, never caught up ${this.neverCaughtUp}`);
    this.check(`flaky signal: no online phone showed an old phase for more than ${STUCK_MS / 1000} s`, this.stuckEpisodes === 0, `${this.stuckEpisodes} stuck episodes`);
    const stale = sw.liveBots().filter(b => b.view?.phase.name !== 'FINISHED');
    this.check('flaky signal: no phone is stuck on an old phase at the end', stale.length === 0, stale.length ? stale.slice(0, 5).map(b => `${b.cfg.name}:${b.view?.phase.name}`).join(', ') : `${sw.liveBots().length} phones on FINISHED`);
    if (this.quiesced) this.check('end of chaos: everybody showed the live step within 10 s of the last signal coming back', this.quiesced.stragglers === 0 && this.quiesced.ms < 15_000, `${this.quiesced.ms} ms, ${this.quiesced.stragglers} stragglers`);

    // 2. page refresh
    const rfOk = this.refreshResults.filter(r => r.ok).length;
    const rfMs = this.refreshResults.filter(r => r.ms >= 0).map(r => r.ms).sort((x, y) => x - y);
    this.check('page refresh: every refreshed phone got its own seat, crew and role back', this.refreshResults.length >= 2 && rfOk === this.refreshResults.length, `${rfOk}/${this.refreshResults.length}, fresh view after p50 ${fmt(percentile(rfMs, 50), 0)} ms, max ${fmt(rfMs[rfMs.length - 1] ?? 0, 0)} ms${this.refreshResults.filter(r => !r.ok).map(r => ` | ${r.detail}`).join('')}`);
    const lateJoined = this.late.filter(l => l.joinOk).length;
    const expectedPlayers = this.basePlayers + lateJoined - this.removed.filter(r => r.viewGone).length;
    const ids = new Set(a.players.map(p => p.id));
    this.check('no refresh or reconnect created a duplicate player', a.players.length === ids.size && a.players.length === expectedPlayers, `${a.players.length} players on the server, expected ${expectedPlayers} (${this.basePlayers} + ${lateJoined} late - ${this.removed.length} removed)`);

    // 3 + 4. leavers, silent crews, crews that do not vote
    const decided = a.matches.filter(m => !m.cancelled);
    const allResolved = decided.length > 0 && decided.every(m => m.clashes.length === 3 && m.clashes.every(cl => cl.resolved));
    this.check('Round 2: every clash of every match resolved', allResolved, `${decided.length} matches`);
    const r2Len = (FAST_DURATIONS.r2.HUDDLE + FAST_DURATIONS.r2.PARLEY + FAST_DURATIONS.r2.VOTE + FAST_DURATIONS.r2.DEBRIEF) * 1000;
    const slow2: string[] = [];
    for (const i of [1, 2]) {
      const s0 = this.clashSeen.get(i);
      const s1 = this.clashSeen.get(i + 1);
      if (s0 && s1 && s1 - s0 > r2Len + 4000) slow2.push(`clash ${i}->${i + 1} took ${fmt((s1 - s0) / 1000)} s`);
    }
    const c3 = this.clashSeen.get(3);
    const res2 = this.phaseSeen.get('R2_RESULTS');
    if (c3 && res2 && res2 - c3 > r2Len + 4000) slow2.push(`clash 3 took ${fmt((res2 - c3) / 1000)} s`);
    this.check(`Round 2: clashes ran on the deadlines (each <= ${r2Len / 1000 + 4} s)`, slow2.length === 0 && this.clashSeen.size === 3, slow2.join(', ') || `clashes seen ${this.clashSeen.size}`);

    const r2Expect = (teamId: string | undefined, clashes: number[], label: string, minEvaluated: number) => {
      if (!teamId) return;
      const m = a.matches.find(x => x.teamA === teamId || x.teamB === teamId);
      if (!m) {
        this.notes.push(`${label}: ${teamId} was unpaired, not evaluated`);
        this.check(`${label}: crew was in a match`, false, teamId);
        return;
      }
      const side = m.teamA === teamId ? 'A' : 'B';
      const bad: string[] = [];
      let evaluated = 0;
      for (const i of clashes) {
        const cl = m.clashes[i - 1];
        if (!cl) continue;
        evaluated++;
        const votes = side === 'A' ? cl.votedA : cl.votedB;
        const stance = side === 'A' ? cl.stanceA : cl.stanceB;
        if (!cl.resolved || votes !== 0 || stance !== 'TRUCE') bad.push(`clash ${i}: resolved ${cl.resolved}, votes ${votes}, stance ${stance}`);
      }
      this.check(`${label}: clash resolved on time with no votes counted -> TRUCE`, evaluated >= minEvaluated && bad.length === 0, `${evaluated} clashes checked${bad.length ? `; ${bad.join('; ')}` : ''}`);
    };
    if (this.silencedR2At) {
      const first = this.silencedR2At.step === 'HUDDLE' || this.silencedR2At.step === 'PARLEY' || this.silencedR2At.step === 'BRIEFING' ? this.silencedR2At.clash : this.silencedR2At.clash + 1;
      r2Expect(this.silentR2, [1, 2, 3].filter(i => i >= first), 'silent crew (gone from Round 2)', 2);
    } else if (this.silentR2) this.check('silent crew in Round 2 was silenced', false, 'the moment never came');
    for (const t of this.abstainR2) r2Expect(t, [2], 'crew that did not vote (Round 2 clash 2)', 1);

    // Round 3
    const waveLen = (FAST_DURATIONS.r3.BLUFF + FAST_DURATIONS.r3.VOTE + FAST_DURATIONS.r3.REVEAL) * 1000;
    const waves = [...this.waveSeen.keys()].sort((x, y) => x - y);
    const slow3: string[] = [];
    for (let i = 0; i + 1 < waves.length; i++) {
      const d = this.waveSeen.get(waves[i + 1])! - this.waveSeen.get(waves[i])!;
      if (d > waveLen + 4000) slow3.push(`wave ${waves[i]}->${waves[i + 1]} took ${fmt(d / 1000)} s`);
    }
    this.check(`Round 3: every wave resolved on its deadline (each <= ${waveLen / 1000 + 4} s)`, waves.length >= 3 && slow3.length === 0, `${waves.length} waves seen${slow3.length ? `; ${slow3.join(', ')}` : ''}`);
    const noVote = (label: string, crews: (string | undefined)[], from: number, to: number) => {
      const bad: string[] = [];
      let evaluated = 0;
      for (const t of crews) {
        if (!t) continue;
        for (let w = from; w <= to; w++) {
          const o = this.waveReports.get(w)?.outcomes[t];
          if (!o) continue; // crew already escaped
          evaluated++;
          if (o.vessel !== 'ROWBOAT' || o.unanimity !== 0) bad.push(`${t} wave ${w}: ${o.vessel}, unanimity ${o.unanimity}`);
        }
      }
      this.check(`${label}: no votes counted -> Rowboat`, evaluated >= 1 && bad.length === 0, `${evaluated} crew-waves checked${bad.length ? `; ${bad.join('; ')}` : ''}`);
    };
    const lastWave = Math.max(0, ...this.waveReports.keys());
    if (this.silentR2) noVote('silent crew from Round 2, in Round 3', [this.silentR2], 1, lastWave);
    if (this.silentR3) noVote('silent crew (gone in Round 3)', [this.silentR3], this.silencedR3AtWave + 1, lastWave);
    noVote('crew that did not vote (Round 3 waves 2-3)', [...this.abstainR3], 2, 3);

    this.check('leavers: single phones went silent in every round', this.leaverRounds.length >= Math.min(2, this.leavers.length) && new Set(this.leaverRounds).size >= Math.min(2, this.leavers.length), `${this.leaverRounds.length} leavers (${this.leaverRounds.join(', ')})`);
    this.check('the game reached FINISHED with a podium although crews went silent', gameOk, '');

    // 5. host removes a player
    for (const round of ['R2', 'R3']) {
      const r = this.removed.find(x => x.round === round);
      this.check(`host removes a player in ${round}: they are out of the game, their crew carries on`, !!r && r.viewGone && r.matesSaw !== false && r.rejected401 && r.carriedOn, r ? `view without seat ${r.viewGone}, crewmates saw the smaller crew ${r.matesSaw}, later commands refused with 401 ${r.rejected401}, crew still has its seat ${r.carriedOn}` : 'no removal happened');
    }

    // 6. late joiners
    const badLate = this.late.filter(l => !(l.joinOk && l.moveOk && l.gotCrewView && l.matesSee !== false));
    this.check('late joiners: joined, placed by the host and saw their crew', this.late.length >= 4 && badLate.length === 0, `${this.late.length} joiners${badLate.length ? `; failed: ${badLate.map(l => `${l.bot.cfg.name} (${l.note || `join ${l.joinOk} move ${l.moveOk} view ${l.gotCrewView} mates ${l.matesSee}`})`).join(', ')}` : ''}`);
    const voted = this.late.filter(l => l.voteChecked && l.voteOk !== null);
    const noVoteLate = voted.filter(l => !l.voteOk);
    this.check('late joiners: could vote in the next Round 2 vote', voted.length >= 1 && noVoteLate.length === 0, `${voted.filter(l => l.voteOk).length}/${voted.length} had their own vote counted; ${this.late.filter(l => !l.voteChecked).length} not checked`);

    this.check('chaos actions ran without errors', this.actionErrors.length === 0, this.actionErrors.slice(0, 3).join(' | '));

    this.num('outagesInjected', this.injected);
    this.num('outagesAcrossAPhaseChange', this.spanning);
    this.num('reconnectsAfterOutage', sorted.length);
    this.num('catchUpP50ms', p50);
    this.num('catchUpP95ms', p95);
    this.num('catchUpMaxMs', max);
    this.num('offlineAvgPct', (avgOffline / n) * 100);
    this.num('offlinePeakPct', (this.peakOffline / n) * 100);
    this.num('pageRefreshes', this.refreshResults.length);
    this.num('leaversSingle', this.leaverRounds.length);
    this.num('phonesInSilentCrews', this.silentCrewPhones);
    this.num('removedByHost', this.removed.length);
    this.num('lateJoiners', this.late.length);
    this.num('commandsRetried', c.retries);
    this.num('commandsGivenUpOffline', c.lostCmds);
    this.num('networkErrors', c.networkErrors);
    this.num('stuckEpisodes', this.stuckEpisodes);
    for (const l of this.late) if (l.note) this.notes.push(`late joiner ${l.bot.cfg.name}: ${l.note}`);
  }
}
