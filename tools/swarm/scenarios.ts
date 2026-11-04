// The scenarios from docs/REBUILD_PLAN.md "Verification gates" plus a full game.
import { Swarm, SpawnedServer, FAST_DURATIONS, NORMAL_DURATIONS } from './context.ts';
import type { AdminViewData, Check, SampleSummary, ScenarioResult } from './context.ts';
import { fmt, mb, sleep, summarize } from './stats.ts';
import { Chaos, CATCH_UP_LIMIT_MS } from './badwifi.ts';
import type { View } from '../../shared/protocol.ts';

export const SCENARIOS = ['join-storm', 'round-start', 'phase-change', 'r2-vote-burst', 'chaos-restart', 'duplicates-slow-readers', 'soak', 'full-game', 'bad-wifi'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

const MAX_APPLY_P99_MS = 50;
/**
 * A hosted server on a shared CPU (e.g. Render free, 0.1 CPU) is paused by its host for 100-200 ms at a time;
 * that shows up as apply time although the engine itself takes ~1 ms. Remote targets get a bar that still
 * catches a real slowdown, and the local bar stays a regression guard.
 */
const MAX_APPLY_P99_REMOTE_MS = 250;
function applyLimitMs(sw: Swarm): number {
  const host = new URL(sw.target).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' ? MAX_APPLY_P99_MS : MAX_APPLY_P99_REMOTE_MS;
}
const MAX_VIEW_BYTES = 4096;
const FORBIDDEN_ERRORS = ['INVALID_PAYLOAD', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'BAD_REQUEST', 'UNAUTHORIZED', 'UNKNOWN_PLAYER', 'PAYLOAD_TOO_LARGE'];

class Report {
  checks: Check[] = [];
  numbers: Record<string, number | string> = {};
  notes: string[] = [];
  t0 = Date.now();
  skipped = false;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  check(name: string, pass: boolean, detail = ''): boolean {
    this.checks.push({ name, pass, detail });
    return pass;
  }
  num(k: string, v: number | string): void {
    this.numbers[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
  }
  done(): ScenarioResult {
    return { name: this.name, pass: !this.skipped && this.checks.every(c => c.pass), skipped: this.skipped, checks: this.checks, numbers: this.numbers, notes: this.notes, durationSec: Math.round((Date.now() - this.t0) / 100) / 10 };
  }
}

function commonChecks(r: Report, sw: Swarm, s: SampleSummary, opts: { applyLimit?: boolean } = {}): void {
  const c = sw.counters;
  if (opts.applyLimit !== false) r.check(`server p99 apply time < ${applyLimitMs(sw)} ms${applyLimitMs(sw) === MAX_APPLY_P99_MS ? '' : ' (remote host)'}`, s.maxP99ApplyMs < applyLimitMs(sw), `${fmt(s.maxP99ApplyMs, 2)} ms (max single apply ${fmt(s.maxApplyMs, 2)} ms)`);
  r.check(`every view <= ${MAX_VIEW_BYTES} bytes`, s.maxViewBytes <= MAX_VIEW_BYTES && c.maxEventBytes <= MAX_VIEW_BYTES, `server max ${s.maxViewBytes}, largest event seen by a bot ${c.maxEventBytes}`);
  const bad = Object.entries(c.errors).filter(([k]) => FORBIDDEN_ERRORS.includes(k));
  r.check('no protocol-level errors from well-behaved bots', bad.length === 0, bad.length ? JSON.stringify(bad) : 'none');
  r.check('duplicates of accepted commands were answered ok', c.dupMismatch === 0, `${c.dupSent} duplicates sent, ${c.dupMismatch} mismatches`);
  r.num('commandsSent', c.sent);
  r.num('commandsOk', c.ok);
  r.num('commandErrors', JSON.stringify(c.errors));
  r.num('timeoutsRetried', c.timeouts);
  r.num('duplicatesSent', c.dupSent);
  r.num('p99ApplyMs', s.maxP99ApplyMs);
  r.num('maxEventLoopLagMs', s.maxLoopLagMs);
  r.num('heapStartMB', s.heapStartMB);
  r.num('heapEndMB', s.heapEndMB);
  r.num('rssMaxMB', s.rssMaxMB);
  r.num('maxViewBytes', Math.max(s.maxViewBytes, c.maxEventBytes));
  const rtt = summarize(c.rtts);
  r.num('commandRttP50ms', rtt.p50);
  r.num('commandRttP99ms', rtt.p99);
  const by = sw.bytesReceived();
  r.num('bytesReceivedTotalMB', mb(by.total));
  r.num('bytesPerBotKB', by.total / Math.max(1, sw.bots.length) / 1024);
}

// ---- setup shared by most scenarios ------------------------------------------------------------

async function lobbyReady(sw: Swarm, r: Report, spread = 8000): Promise<boolean> {
  sw.world.flags = { lobby: true, r1: false, r2pair: false, r2vote: false, r3: false, sd: false };
  const { joined, teamed } = await sw.setup({ joinSpreadMs: spread, durations: FAST_DURATIONS });
  r.check('all bots joined', joined === sw.bots.length, `${joined}/${sw.bots.length}`);
  r.check('all bots are in a team', teamed, '');
  return joined === sw.bots.length && teamed;
}

/** Admin drives the game into the first Round 2 clash: start, skip Round 1, pair everybody, force the clock if a crew is left over. */
async function toR2Clash(sw: Swarm): Promise<void> {
  await sw.admin('ADMIN_START_GAME');
  await sw.admin('ADMIN_SKIP_STEP'); // the Round 1 briefing: the 5:00 clock starts
  await sw.admin('ADMIN_SKIP_STEP'); // Round 1 itself
  await sw.admin('ADMIN_START_R2');
  await sw.admin('ADMIN_R2_AUTO_PAIR');
  if ((await sw.adminView()).phase.name === 'R2_PAIRING') await sw.admin('ADMIN_R2_FORCE_START');
  await skipBriefing(sw);
}

/** Skip the BRIEFING step if the game is in one (the round's real clock then starts at once). */
async function skipBriefing(sw: Swarm): Promise<void> {
  const a = await sw.adminView();
  if (a.phase.step === 'BRIEFING') await sw.admin('ADMIN_SKIP_STEP', { phaseSeq: a.phase.phaseSeq });
  await sleep(150);
}

function teamGroups(sw: Swarm): Map<string, typeof sw.bots> {
  const m = new Map<string, typeof sw.bots>();
  for (const b of sw.bots) {
    const t = b.view?.team?.id;
    if (!t) continue;
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(b);
  }
  return m;
}

function viewMinus(v: View | null, drop: string[]): string {
  if (!v) return '';
  const o = { ...v } as unknown as Record<string, unknown>;
  for (const k of drop) delete o[k];
  return JSON.stringify(o);
}

// ---- scenarios ---------------------------------------------------------------------------------------

async function joinStorm(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('join-storm');
  await sw.resetGame();
  sw.world.flags = { lobby: false, r1: false, r2pair: false, r2vote: false, r3: false, sd: false };
  const bots = sw.makeBots(sw.opts.bots, { abortRate: 0.05, dupRate: 0.05 });
  r.check('all bots open a stream', await sw.connectAll(), '');
  const sampler = sw.sampler();
  sampler.start(500);
  await sw.resetMetrics();
  const spread = sw.opts.joinSeconds * 1000;
  r.num('joinSpreadSec', sw.opts.joinSeconds);
  const t0 = Date.now();
  const results = await Promise.all(
    bots.map(async b => {
      await sleep(b.rng() * spread);
      const res = await b.cmd('JOIN', { name: b.cfg.name });
      return res?.body.ok === true;
    }),
  );
  const joinOk = results.filter(Boolean).length;
  r.check('every JOIN got an ok answer (after retries with the same player id)', joinOk === bots.length, `${joinOk}/${bots.length}`);
  r.check('every bot sees itself in its own stream', (await sw.waitAll(v => !!v.me, 10_000)).every(x => x !== null), '');
  // hijack attempts: same playerId, a different token
  const hijacks = await Promise.all(
    bots.slice(0, 10).map(async b => {
      const res = await fetch(`${sw.target}/api/command`, {
        method: 'POST',
        body: JSON.stringify({ commandId: `hj-${b.id}`, playerId: b.id, token: 'hijacker-token-0123456789abcdef', type: 'JOIN', payload: { name: 'EVIL' } }),
      });
      return res.status;
    }),
  );
  r.check('hijack attempts are rejected (401)', hijacks.every(s => s === 401), JSON.stringify(hijacks));
  const a = await sw.adminView();
  const ids = new Set(a.players.map(p => p.id));
  r.check('200 unique players on the server, no duplicates, no lost joins', a.players.length === bots.length && ids.size === bots.length, `players ${a.players.length}, unique ${ids.size}`);
  r.check('names intact after hijack attempts', !a.players.some(p => p.name === 'EVIL') && bots.every(b => b.view?.me?.name === b.cfg.name), '');
  r.num('joinWallSec', (Date.now() - t0) / 1000);
  commonChecks(r, sw, sampler.stop());
  return r.done();
}

async function roundStart(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('round-start');
  if (!(await lobbyReady(sw, r))) return r.done();
  const g = teamGroups(sw);
  r.num('teams', g.size);
  await sw.admin('ADMIN_SET_DURATIONS', { r1Seconds: 60 });
  const start = await sw.admin('ADMIN_START_GAME');
  r.check('game started', start.ok, start.error ?? '');
  await skipBriefing(sw);
  await sw.refreshWorld();
  const sampler = sw.sampler();
  sampler.start(250);
  await sw.resetMetrics();
  const h0 = await sw.health();
  // Every bot acts in the same instant: submit the correct codeword (the whole team at once), with duplicates.
  const { at, results } = await sw.barrier(sw.bots, 1500, async b => {
    const cw = sw.world.codewords.get(b.view?.team?.id ?? '');
    return cw ? b.cmd('R1_SUBMIT', { answer: cw }, { dups: 1 }) : null;
  });
  const answered = results.filter(x => x?.body.ok).length;
  r.check('every command was answered ok', answered === sw.bots.length, `${answered}/${sw.bots.length}`);
  await sleep(1200);
  const h1 = await sw.health();
  const a = await sw.adminView();
  const solved = a.teams.filter(t => t.r1?.solved).length;
  r.check('each team solved exactly once', solved === a.teams.length, `${solved}/${a.teams.length} teams solved`);
  r.check('each command applied exactly once (state changes == teams)', h1.commandsChanged - h0.commandsChanged === a.teams.length, `${h1.commandsChanged - h0.commandsChanged} state changes for ${a.teams.length} teams from ${sw.bots.length * 2} requests`);
  const pts = a.teams.map(t => t.r1?.points ?? 0);
  r.check('points are a single speed-tier award (no double scoring)', pts.every(p => [300, 250, 200, 150, 100].includes(p)), JSON.stringify([...new Set(pts)]));
  const seen = await sw.waitAll(v => v.r1?.solved === true, 3000);
  const lat = summarize(seen.filter((x): x is number => x !== null).map(t => t - at));
  r.check('every bot sees its team solved within 2 s', seen.every(x => x !== null) && lat.max < 2000, `p50 ${fmt(lat.p50, 0)} ms, p99 ${fmt(lat.p99, 0)} ms, max ${fmt(lat.max, 0)} ms`);
  r.num('burstToViewP50ms', lat.p50);
  r.num('burstToViewP99ms', lat.p99);
  const s = sampler.stop();
  r.check(`server p99 apply time < ${applyLimitMs(sw)} ms during the burst`, h1.p99ApplyMs < applyLimitMs(sw), `${h1.p99ApplyMs} ms (max ${h1.maxApplyMs} ms)`);
  commonChecks(r, sw, s, { applyLimit: false });
  return r.done();
}

async function phaseChange(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('phase-change');
  if (!(await lobbyReady(sw, r))) return r.done();
  await sw.measureClockOffset();
  const sampler = sw.sampler();
  sampler.start(500);
  await sw.admin('ADMIN_SET_DURATIONS', { r1Seconds: 12, r2: { HUDDLE: 8, PARLEY: 6, VOTE: 8, DEBRIEF: 5 } });
  await sw.admin('ADMIN_START_GAME');
  await sw.waitAll(v => v.phase.name === 'R1_ACTIVE', 5000);
  await skipBriefing(sw);
  const endsAt = (await sw.adminView()).phase.endsAt!;
  const deadlineLocal = endsAt - sw.serverOffset;
  // 1. a real deadline passes with all bots connected (scheduler -> flush -> network)
  const times = await sw.waitAll(v => v.phase.name === 'R1_RESULTS', 15_000);
  const lat1 = summarize(times.map(t => (t === null ? NaN : t - deadlineLocal)));
  r.check('deadline: every bot sees the new phase', times.every(t => t !== null), `${times.filter(t => t !== null).length}/${sw.bots.length}`);
  r.check('deadline: all within 2 s of the deadline', lat1.max < 2000, `p50 ${fmt(lat1.p50, 0)} ms, p99 ${fmt(lat1.p99, 0)} ms, max ${fmt(lat1.max, 0)} ms`);
  r.num('deadlineLatencyP50ms', lat1.p50);
  r.num('deadlineLatencyP99ms', lat1.p99);
  // 2. admin-driven transitions: time from the command to every bot showing the NEW state (version moved past the old one)
  const worst: number[] = [];
  const topV = () => Math.max(...sw.bots.map(b => b.view?.v ?? 0));
  const step = async (label: string, run: () => Promise<unknown>, cond: (v: View) => boolean, bots = sw.bots) => {
    await sleep(400);
    const base = topV();
    const t0 = Date.now();
    await run();
    const ts = await sw.waitAll(v => v.v > base && cond(v), 5000, bots);
    const l = summarize(ts.map(t => (t === null ? NaN : t - t0)));
    worst.push(l.max);
    r.check(`${label}: all bots within 2 s of the command`, ts.every(t => t !== null) && l.max < 2000, `${ts.filter(t => t !== null).length}/${bots.length} bots, p50 ${fmt(l.p50, 0)} ms, p99 ${fmt(l.p99, 0)} ms, max ${fmt(l.max, 0)} ms`);
    return l;
  };
  await step('start Round 2', () => sw.admin('ADMIN_START_R2'), v => v.phase.name === 'R2_PAIRING');
  // With an odd number of crews one crew stays unpaired and the clock does not start by itself: the host forces it.
  {
    await sleep(400);
    const base = topV();
    const t0 = Date.now();
    await sw.admin('ADMIN_R2_AUTO_PAIR');
    const left = new Set((await sw.adminView()).unpairedTeamIds);
    const bots = sw.bots.filter(b => !left.has(b.view?.team?.id ?? ''));
    const ts = await sw.waitAll(v => v.v > base && (v.r2?.paired === true || v.phase.name === 'R2_CLASH'), 5000, bots);
    const l = summarize(ts.map(t => (t === null ? NaN : t - t0)));
    worst.push(l.max);
    r.check('auto-pair crews: every paired crew is told within 2 s', ts.every(t => t !== null) && l.max < 2000, `${ts.filter(t => t !== null).length}/${bots.length} bots, p50 ${fmt(l.p50, 0)} ms, max ${fmt(l.max, 0)} ms`);
  }
  if ((await sw.adminView()).phase.name === 'R2_PAIRING') {
    await step('force the first clash to start', () => sw.admin('ADMIN_R2_FORCE_START'), v => v.phase.name === 'R2_CLASH');
  }
  await step('skip huddle', () => sw.admin('ADMIN_SKIP_STEP'), v => v.phase.step === 'PARLEY');
  await step('pause', () => sw.admin('ADMIN_PAUSE'), v => v.phase.paused);
  await step('resume', () => sw.admin('ADMIN_RESUME'), v => !v.phase.paused);
  // force resync: every bot must receive the resync event, reconnect and show a fresh view
  {
    await sleep(400);
    const t0 = Date.now();
    const res = await sw.adminPost('/api/admin/resync');
    const notified = ((await res.json()) as { notified: number }).notified;
    const ts = await sw.waitAll(() => true, 8000).then(() => null);
    void ts;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !sw.bots.every(b => b.resyncAt > t0 && b.lastSeenAt > b.resyncAt)) await sleep(50);
    const done = sw.bots.filter(b => b.resyncAt > t0 && b.lastSeenAt > b.resyncAt);
    const l = summarize(done.map(b => b.lastSeenAt - t0));
    r.check('force resync: every bot got the resync event and reloaded its view (client jitter included)', done.length === sw.bots.length, `${done.length}/${sw.bots.length}, notified ${notified}, p50 ${fmt(l.p50, 0)} ms, max ${fmt(l.max, 0)} ms`);
    r.num('resyncReloadMaxMs', l.max);
  }
  r.num('worstAdminTransitionMs', Math.max(...worst));
  commonChecks(r, sw, sampler.stop());
  return r.done();
}

async function r2VoteBurst(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('r2-vote-burst');
  if (!(await lobbyReady(sw, r))) return r.done();
  await sw.admin('ADMIN_SET_DURATIONS', { r2: { HUDDLE: 6, PARLEY: 5, VOTE: 25, DEBRIEF: 8 } });
  await toR2Clash(sw);
  await sw.skipUntilStep('VOTE');
  const sampler = sw.sampler();
  sampler.start(250);
  await sw.waitAll(v => v.phase.step === 'VOTE', 5000);
  const a0 = await sw.adminView();
  const pairedTeams = new Set(a0.teams.filter(t => !a0.unpairedTeamIds.includes(t.id)).map(t => t.id));
  const voters = sw.bots.filter(b => pairedTeams.has(b.view?.team?.id ?? ''));
  await sw.resetMetrics();
  const h0 = await sw.health();
  const first = new Map<string, string>();
  // all voters vote inside one second, 30% send duplicates, 10% also try to change their mind with a NEW commandId
  const { at, results } = await sw.barrier(voters, 800, async b => {
    await sleep(b.rng() * 1000);
    const vote = b.rng() < 0.5 ? 'TRUCE' : 'AMBUSH';
    first.set(b.id, vote);
    const res = await b.cmd('R2_VOTE', { vote }, { dups: b.rng() < 0.3 ? 1 : 0 });
    if (b.rng() < 0.1) await b.cmd('R2_VOTE', { vote: vote === 'TRUCE' ? 'AMBUSH' : 'TRUCE' });
    return res;
  });
  void at;
  r.check('every vote was answered ok', results.every(x => x?.body.ok), `${results.filter(x => x?.body.ok).length}/${voters.length}`);
  await sleep(1500);
  const h1 = await sw.health();
  const a = await sw.adminView();
  let counted = 0;
  for (const m of a.matches) {
    const c = m.clashes[a0.phase.clash - 1];
    counted += c.votedA + c.votedB;
  }
  r.check('each vote counted exactly once', counted === voters.length, `${counted} counted for ${voters.length} voters`);
  r.check('state changes == votes (duplicates and re-votes changed nothing)', h1.commandsChanged - h0.commandsChanged === voters.length, `${h1.commandsChanged - h0.commandsChanged} changes for ${voters.length} voters`);
  // first vote is final: each voter's view still shows the first vote
  const kept = voters.filter(b => b.view?.me?.myVote === first.get(b.id)).length;
  r.check('first vote is final (re-votes ignored)', kept === voters.length, `${kept}/${voters.length}`);
  // every team's view is consistent
  const groups = teamGroups(sw);
  let consistent = 0;
  let total = 0;
  let allVoted = 0;
  for (const [tid, members] of groups) {
    if (!pairedTeams.has(tid)) continue;
    total++;
    const shapes = new Set(members.map(b => viewMinus(b.view, ['me', 'v', 'serverNow'])));
    if (shapes.size === 1) consistent++;
    if (members.every(b => b.view?.r2?.votedCount === members.length)) allVoted++;
  }
  r.check("every team's members see the same team/phase/board data", consistent === total, `${consistent}/${total} teams`);
  r.check('every team shows all teammates voted (votedCount == team size)', allVoted === total, `${allVoted}/${total}`);
  // after the vote closes, both rivals agree on the stances
  await sw.waitAll(v => v.phase.step === 'DEBRIEF', 40_000);
  await sleep(500);
  const rivalOk = a.matches.every(m => {
    const ta = groups.get(m.teamA)?.[0]?.view?.r2?.clashes[0];
    const tb = groups.get(m.teamB)?.[0]?.view?.r2?.clashes[0];
    return !!ta && !!tb && ta.myStance === tb.rivalStance && tb.myStance === ta.rivalStance && ta.myPts === tb.rivalPts;
  });
  r.check('rival crews see mirrored results after the clash', rivalOk, `${a.matches.length} matches`);
  commonChecks(r, sw, sampler.stop());
  r.check(`server p99 apply time < ${applyLimitMs(sw)} ms during the burst`, h1.p99ApplyMs < applyLimitMs(sw), `${h1.p99ApplyMs} ms (max ${h1.maxApplyMs} ms)`);
  return r.done();
}

async function chaosRestart(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('chaos-restart');
  if (!sw.server) {
    r.skipped = true;
    r.notes.push(
      'SKIPPED: this scenario needs to kill and restart the server. Re-run with --spawn-server, or do it by hand:',
      '  1. start the server with SNAPSHOT_DIR on a stable directory and run the swarm: node tools/swarm/swarm.ts --target <url> --admin-token <t> --scenario full-game --fast',
      '  2. while it is mid Round 2, kill -9 the server process and start it again with the same SNAPSHOT_DIR',
      '  3. check /health shows the same phase and "paused": true, bots reconnect on their own, then POST /api/admin/command ADMIN_RESUME',
    );
    return r.done();
  }
  sw.world.flags = { lobby: true, r1: false, r2pair: false, r2vote: true, r3: false, sd: false };
  const { joined, teamed } = await sw.setup({ joinSpreadMs: 8000 });
  r.check('all bots joined and teamed', joined === sw.bots.length && teamed, `${joined} joined, teamed ${teamed}`);
  await sw.admin('ADMIN_SET_DURATIONS', { r2: { HUDDLE: 6, PARLEY: 5, VOTE: 30, DEBRIEF: 8 } });
  await toR2Clash(sw);
  await sw.skipUntilStep('VOTE');
  await sleep(4000); // votes are flowing
  const pre = await sw.health();
  const preAdmin = await sw.adminView();
  const oldSid = pre.sid;
  const tKill = Date.now();
  await sw.server.kill('SIGKILL');
  r.notes.push(`killed server (SIGKILL) at version ${pre.version}, ${preAdmin.phase.name}/${preAdmin.phase.step} clash ${preAdmin.phase.clash}`);
  await sleep(3000);
  await sw.server.start();
  const tUp = Date.now();
  r.num('downtimeSec', (tUp - tKill) / 1000);
  const converged = await sw.waitAll(v => v.sid !== oldSid && v.phase.paused === true, 60_000);
  r.check('all bots reconnected on their own', converged.every(t => t !== null), `${converged.filter(t => t !== null).length}/${sw.bots.length}`);
  const rec = summarize(converged.filter((t): t is number => t !== null).map(t => t - tUp));
  r.check('reconnects are spread out by jitter (no stampede)', rec.max - rec.min > 500, `first ${fmt(rec.min, 0)} ms, p50 ${fmt(rec.p50, 0)} ms, p99 ${fmt(rec.p99, 0)} ms, last ${fmt(rec.max, 0)} ms`);
  r.num('reconnectP50ms', rec.p50);
  r.num('reconnectP99ms', rec.p99);
  r.num('reconnectMaxMs', rec.max);
  await sleep(1500);
  const versions = new Set(sw.bots.map(b => b.view?.v));
  r.check('all bots converge on one version', versions.size === 1, `versions seen: ${[...versions].join(',')}`);
  const post = await sw.health();
  const postAdmin = await sw.adminView();
  r.check('restored into PAUSED', post.paused === true, '');
  r.check('same phase, step and clash after the restart', postAdmin.phase.name === preAdmin.phase.name && postAdmin.phase.step === preAdmin.phase.step && postAdmin.phase.clash === preAdmin.phase.clash, `${postAdmin.phase.name}/${postAdmin.phase.step}/${postAdmin.phase.clash}`);
  r.check('no players lost', postAdmin.counts.players === sw.bots.length, `${postAdmin.counts.players}`);
  r.check('every bot still recognised (tokens survive the restart)', sw.bots.every(b => !!b.view?.me), '');
  r.num('versionBeforeKill', pre.version);
  r.num('versionAfterRestore', post.version);
  r.num('versionsLostToSnapshotGap', Math.max(0, pre.version - post.version));
  const resumeAt = Date.now();
  const rr = await sw.admin('ADMIN_RESUME');
  r.check('admin can resume', rr.ok, rr.error ?? '');
  const resumed = await sw.waitAll(v => v.phase.paused === false, 5000);
  r.check('every bot sees the game resume within 2 s', resumed.every(t => t !== null) && Math.max(...resumed.map(t => (t ?? Infinity) - resumeAt)) < 2000, '');
  const advanced = await sw.waitAll(v => v.phase.step === 'DEBRIEF' || v.phase.clash > preAdmin.phase.clash || v.phase.name !== 'R2_CLASH', 45_000);
  r.check('the round continues on its own after the resume', advanced.every(t => t !== null), `${advanced.filter(t => t !== null).length}/${sw.bots.length} reached the next step`);
  await sw.waitAll(v => v.phase.step === 'DEBRIEF', 45_000);
  const fin = await sw.adminView();
  const m0 = fin.matches.reduce((n, m) => n + (m.clashes[preAdmin.phase.clash - 1]?.votedA ?? 0) + (m.clashes[preAdmin.phase.clash - 1]?.votedB ?? 0), 0);
  const paired0 = fin.teams.filter(t => !fin.unpairedTeamIds.includes(t.id)).reduce((n, t) => n + t.playerIds.length, 0);
  r.check('votes lost in the snapshot gap are cast again by the phones after the resume', m0 >= paired0 * 0.95, `${m0} votes counted for ${paired0} voters`);
  r.num('botReconnects', sw.counters.reconnects);
  r.num('restartsSeenByBots', sw.counters.restartsSeen);
  r.num('pollFallbackRequests', sw.counters.polls);
  commonChecks(r, sw, { samples: 0, maxP99ApplyMs: Math.max(pre.p99ApplyMs, post.p99ApplyMs), maxApplyMs: Math.max(pre.maxApplyMs, post.maxApplyMs), maxLoopLagMs: post.eventLoopLagMs, heapStartMB: 0, heapEndMB: post.heapUsedMB, heapMaxMB: post.heapUsedMB, heapSlopeMBperMin: 0, rssMaxMB: post.rssMB, maxClients: post.clients, maxViewBytes: post.maxViewBytes, maxWritable: post.sseMaxWritableBytes, dropped: post.sseDropped, sseBytesOut: 0, series: [] });
  return r.done();
}

async function duplicatesSlowReaders(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('duplicates-slow-readers');
  const bots0 = sw.opts.bots;
  sw.world.flags = { lobby: true, r1: false, r2pair: false, r2vote: true, r3: false, sd: false };
  await sw.resetGame();
  sw.makeBots(bots0, { dupRate: 1, abortRate: 0.03 });
  r.check('all bots open a stream', await sw.connectAll(), '');
  await sw.joinAll(6000);
  r.check('all bots in a team', await sw.formTeams(), '');
  await toR2Clash(sw);
  // 10% of the phones stop reading their stream
  const slow = sw.bots.filter((_, i) => i % 10 === 3);
  const normal = sw.bots.filter((_, i) => i % 10 !== 3);
  for (const b of slow) b.stopReading();
  r.num('slowReaders', slow.length);
  await sleep(1000);
  const sampler = sw.sampler();
  sampler.start(500);
  await sw.resetMetrics();
  const h0 = await sw.health();
  // Record every normal bot's first vote per clash, check at the end of each vote that it was kept.
  let kept = 0;
  let checked = 0;
  const seenStep = new Set<string>();
  const t0 = Date.now();
  const timeoutMs = 3 * (FAST_DURATIONS.r2.HUDDLE + FAST_DURATIONS.r2.PARLEY + FAST_DURATIONS.r2.VOTE + FAST_DURATIONS.r2.DEBRIEF) * 1000 + 40_000;
  while (Date.now() - t0 < timeoutMs) {
    const a = await sw.adminView();
    if (a.phase.name === 'R2_RESULTS') break;
    if (a.phase.step === 'DEBRIEF' && !seenStep.has(`d${a.phase.clash}`)) {
      seenStep.add(`d${a.phase.clash}`);
      await sleep(800);
      for (const b of normal) {
        const mv = b.memo[`vote${a.phase.clash}`];
        if (mv === undefined) continue;
        checked++;
        if (b.view?.me?.myVote === mv) kept++;
      }
    }
    // remember each bot's current vote the moment it appears in its view (it is the first vote sent)
    if (a.phase.step === 'VOTE') {
      for (const b of normal) if (b.view?.me?.myVote && b.memo[`vote${a.phase.clash}`] === undefined) b.memo[`vote${a.phase.clash}`] = b.view.me.myVote;
    }
    await sleep(400);
  }
  const done = (await sw.adminView()).phase.name === 'R2_RESULTS';
  r.check('Round 2 played through with 10% slow readers and duplicates everywhere', done, '');
  r.check('first votes kept despite duplicates and re-votes', checked > 0 && kept === checked, `${kept}/${checked} observed votes kept`);
  await sleep(1000);
  const h1 = await sw.health();
  const s = sampler.stop();
  r.num('sseDroppedConnections', JSON.stringify(h1.sseDropped));
  r.num('maxBufferedBytesPerConnection', h1.sseMaxWritableBytes);
  r.check('no connection ever buffered more than 64 KB (slow clients are dropped, not buffered)', h1.sseMaxWritableBytes <= 64 * 1024, `${h1.sseMaxWritableBytes} bytes`);
  const growth = s.heapEndMB - s.heapStartMB;
  r.check('server memory stays flat (heap growth < 40 MB)', growth < 40, `heap ${fmt(s.heapStartMB)} -> ${fmt(s.heapEndMB)} MB (max ${fmt(s.heapMaxMB)}), slope ${fmt(s.heapSlopeMBperMin, 2)} MB/min`);
  // normal phones converged on the live state while the slow ones lagged
  const live = (await sw.health()).version;
  const lag = normal.filter(b => (b.view?.v ?? 0) < live - 2).length;
  r.check('normal readers are up to date', lag === 0, `${lag} behind`);
  // the slow phones start reading again and catch up
  for (const b of slow) b.conn?.resume();
  for (const b of slow) b.streamPaused = false;
  const caught = await sw.waitAll(v => v.v >= live, 20_000, slow);
  r.check('slow readers catch up (or reconnect) once they read again', caught.every(t => t !== null), `${caught.filter(t => t !== null).length}/${slow.length}`);
  r.num('commandsChangedDuringRun', h1.commandsChanged - h0.commandsChanged);
  commonChecks(r, sw, s);
  return r.done();
}

// ---- full game ---------------------------------------------------------------------------------------

export interface GameRun {
  ok: boolean;
  reason?: string;
  podium: string[];
  waves: number;
  sampler: SampleSummary;
  wallSec: number;
  bytes: ReturnType<Swarm['bytesReceived']>;
  serverBytesOut: number;
}

/** Points where a scenario can join in while playFullGame drives the game. */
interface GameHooks {
  /** Crews are formed, the game has not started. */
  afterSetup?: () => Promise<void>;
  /** Round 3 is over, Sudden Death is next. */
  beforeSuddenDeath?: () => Promise<void>;
}

async function playFullGame(sw: Swarm, r: Report, label: string, hooks: GameHooks = {}): Promise<GameRun | null> {
  const fast = sw.opts.fast || label === 'full-game' || label === 'bad-wifi';
  const dur = fast ? FAST_DURATIONS : NORMAL_DURATIONS;
  sw.world.flags = { lobby: true, r1: true, r2pair: true, r2vote: true, r3: true, sd: true };
  sw.world.boldness = fast ? 0.8 : 0.55;
  const pause = fast ? 4000 : 10_000; // the host reads the results screen before pressing "next"
  const t0 = Date.now();
  let waves = 0;
  const { joined, teamed } = await sw.setup({ joinSpreadMs: fast ? 8000 : Math.min(60_000, sw.opts.joinSeconds * 1000), durations: dur });
  r.check('all bots joined and teamed', joined === sw.bots.length && teamed, `${joined} joined, teamed ${teamed}`);
  if (!teamed) return null;
  await hooks.afterSetup?.();
  const sampler = sw.sampler();
  sampler.start(fast ? 1000 : 2000);
  await sw.resetMetrics();
  const h0 = await sw.health();
  const phaseTimeout = (ms: number) => ms + 30_000;

  const must = async (what: string, p: Promise<boolean>) => {
    const ok = await p;
    r.check(what, ok, '');
    return ok;
  };

  await sleep(2000);
  await sw.admin('ADMIN_START_GAME');
  await skipBriefing(sw);
  await sw.refreshWorld();
  if (!(await must('Round 1 ran and closed at its deadline', sw.waitPhase('R1_RESULTS', null, phaseTimeout(dur.r1Seconds * 1000))))) return finish(false, 'R1');
  const a1 = await sw.adminView();
  r.num('r1TeamsSolved', a1.teams.filter(t => t.r1?.solved).length);
  r.num('teams', a1.teams.length);
  await sleep(pause);

  await sw.admin('ADMIN_START_R2');
  await sw.refreshWorld();
  await sleep(Math.min(20_000, dur.r2.HUDDLE * 1000 + 6000));
  await sw.admin('ADMIN_R2_AUTO_PAIR'); // the host pairs any crew that could not find its rival
  if ((await sw.adminView()).phase.name === 'R2_PAIRING') {
    r.notes.push('an odd number of crews: the host started the clashes with one crew unpaired');
    await sw.admin('ADMIN_R2_FORCE_START');
  }
  await skipBriefing(sw);
  const r2Len = 3 * (dur.r2.HUDDLE + dur.r2.PARLEY + dur.r2.VOTE + dur.r2.DEBRIEF) * 1000;
  if (!(await must('Round 2 ran through three clashes', sw.waitPhase('R2_RESULTS', null, phaseTimeout(r2Len))))) return finish(false, 'R2');
  await sleep(pause);

  await sw.admin('ADMIN_START_R3');
  await skipBriefing(sw);
  const r3Start = Date.now();
  const waveLen = (dur.r3.BLUFF + dur.r3.VOTE + dur.r3.REVEAL) * 1000;
  for (;;) {
    const a = await sw.adminView();
    waves = a.r3?.waves ?? 0;
    if (a.phase.name === 'R3_RESULTS') break;
    if (a.phase.name === 'R3_ACTIVE' && a.phase.wave >= 16) {
      r.notes.push('Round 3 hit the 16-wave safety cap: ended by the admin');
      await sw.admin('ADMIN_END_R3');
    }
    if (Date.now() - r3Start > 20 * waveLen + 60_000) return finish(false, 'R3 timeout');
    await sleep(500);
  }
  r.check('Round 3 ended with escapes', true, `${waves} waves`);
  await hooks.beforeSuddenDeath?.();
  await sleep(1500);
  // Sudden Death between the top two (host decision), played by those crews' bots
  const a3 = await sw.adminView();
  const order = a3.r3?.escapeOrder ?? [];
  if (order.length >= 2) {
    const sd = await sw.admin('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: order[0], teamB: order[1] });
    r.check('sudden death between the top two started', sd.ok, sd.error ?? '');
    if (sd.ok) {
      const resolved = await sw.waitAll(v => v.r3?.sd?.resolved === true, dur.sdSeconds * 1000 + 15_000);
      r.check('sudden death resolved and every bot saw the result', resolved.every(t => t !== null), `${resolved.filter(t => t !== null).length}/${sw.bots.length}`);
    }
  }
  await sleep(pause / 2);
  await sw.admin('ADMIN_FINISH');
  const fin = await sw.waitAll(v => v.phase.name === 'FINISHED', 10_000);
  r.check('every bot reached FINISHED', fin.every(t => t !== null), `${fin.filter(t => t !== null).length}/${sw.bots.length}`);
  await sleep(800);
  return finish(true);

  async function finish(ok: boolean, reason?: string): Promise<GameRun> {
    const s = sampler.stop();
    const h1 = await sw.health();
    const views = sw.liveBots().map(b => b.view).filter((v): v is View => !!v);
    const podium = views.find(v => v.r3?.podium)?.r3?.podium ?? [];
    if (ok) {
      r.check('podium has Gold, Silver and Bronze', podium.length === 3, podium.join(' | '));
      r.check('all bots show the same podium and leaderboard', new Set(views.map(v => JSON.stringify([v.r3?.podium ?? v.board, v.board]))).size <= 2 + 0, '');
      const distinctBoards = new Set(views.map(v => JSON.stringify(v.board)));
      r.check('all bots show the same final leaderboard', distinctBoards.size === 1, `${distinctBoards.size} distinct`);
      const a = await sw.adminView();
      const ranks = a.teams.map(t => a.r3?.teams[t.id]?.escapeRank).filter(x => x != null);
      r.check('crews that escaped see their rank', sw.bots.filter(b => (b.view?.r3?.escapedRank ?? 0) > 0).length > 0 && ranks.length >= 3, `${ranks.length} crews escaped`);
    }
    r.num('gameWallSec', (Date.now() - t0) / 1000);
    r.num('waves', waves);
    r.num('serverBytesOutMB', mb(h1.sseBytesOut - h0.sseBytesOut));
    r.num('serverEventsOut', h1.sseEventsOut - h0.sseEventsOut);
    return { ok, reason, podium, waves, sampler: s, wallSec: (Date.now() - t0) / 1000, bytes: sw.bytesReceived(), serverBytesOut: h1.sseBytesOut - h0.sseBytesOut };
  }
}

const RENDER_FREE_GB = 5;

function bandwidth(r: Report, sw: Swarm, run: GameRun, gameSeconds: number, normalPace: boolean): void {
  const totalMB = mb(run.bytes.total);
  r.num('bytesReceivedSseMB', mb(run.bytes.sse));
  r.num('bytesReceivedCommandsMB', mb(run.bytes.cmd));
  r.num('bytesReceivedPollingMB', mb(run.bytes.poll));
  r.num('bytesReceivedTotalMB', totalMB);
  r.num('bytesPerBotKB', run.bytes.total / sw.bots.length / 1024);
  // Render counts outbound traffic of the service: responses + SSE. The bots' received bytes are what left the server.
  const perSecMB = totalMB / Math.max(1, gameSeconds);
  r.num('avgOutboundKBperSec', perSecMB * 1024);
  if (normalPace) {
    r.num('estimatedGamesPer5GB', Math.floor((RENDER_FREE_GB * 1024) / Math.max(0.01, totalMB)));
    r.notes.push(`bandwidth: one ${Math.round(gameSeconds / 60)}-minute game with ${sw.bots.length} bots moved ${fmt(totalMB, 1)} MB (${fmt(run.bytes.total / sw.bots.length / 1024, 0)} KB per phone) => about ${Math.floor((RENDER_FREE_GB * 1024) / Math.max(0.01, totalMB))} such games fit in a 5 GB month`);
  } else {
    r.notes.push(`bandwidth (fast pace, ${Math.round(gameSeconds)} s game): ${fmt(totalMB, 1)} MB total; the stream cost is dominated by view-change events, so a normal-pace game costs more: run the soak scenario for the real estimate`);
  }
}

async function fullGame(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('full-game');
  const run = await playFullGame(sw, r, 'full-game');
  if (!run) return r.done();
  r.check('game reached the podium', run.ok, run.reason ?? '');
  commonChecks(r, sw, run.sampler);
  bandwidth(r, sw, run, run.wallSec, false);
  return r.done();
}

/**
 * A whole game over bad pub wifi: phones lose signal at random, refresh, leave for good (alone and as whole crews),
 * crews skip votes, the host removes players and new players join mid-game. See badwifi.ts.
 */
async function badWifi(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('bad-wifi');
  const chaos = new Chaos(sw);
  let run: GameRun | null = null;
  try {
    run = await playFullGame(sw, r, 'bad-wifi', { afterSetup: () => chaos.begin(), beforeSuddenDeath: () => chaos.quiesce() });
    if (!run) return r.done();
    r.check('game reached the podium', run.ok, run.reason ?? '');
    await chaos.finish(run.ok);
  } finally {
    chaos.stop();
  }
  r.checks.push(...chaos.checks);
  Object.assign(r.numbers, chaos.numbers);
  r.notes.push(...chaos.notes);
  r.num('catchUpLimitMs', CATCH_UP_LIMIT_MS);
  commonChecks(r, sw, run.sampler);
  bandwidth(r, sw, run, run.wallSec, false);
  return r.done();
}

async function soak(sw: Swarm): Promise<ScenarioResult> {
  const r = new Report('soak');
  const run = await playFullGame(sw, r, 'soak');
  if (!run) return r.done();
  r.check('game reached the podium', run.ok, run.reason ?? '');
  const s = run.sampler;
  // Each sample is already a windowed p99 of the server's event-loop delay. The swarm shares this machine's CPU,
  // so a single window may spike (GC, a snapshot write): judge the typical window and bound the worst one.
  const lags = s.series.map(x => x.lag).sort((a, b) => a - b);
  const lagP99 = lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.99))] ?? 0;
  r.check('event-loop lag stays low (p99 of windows < 50 ms, worst window < 100 ms)', lagP99 < 50 && s.maxLoopLagMs < 100, `p99 ${fmt(lagP99, 1)} ms, worst ${fmt(s.maxLoopLagMs, 1)} ms over ${lags.length} windows`);
  const growth = s.heapEndMB - s.heapStartMB;
  r.check('heap stays flat (end within +30 MB of start, slope < 20 MB/min)', growth < 30 && s.heapSlopeMBperMin < 20, `${fmt(s.heapStartMB)} -> ${fmt(s.heapEndMB)} MB (max ${fmt(s.heapMaxMB)}), slope ${fmt(s.heapSlopeMBperMin, 2)} MB/min over the second half`);
  r.check('RSS did not run away (< 400 MB)', s.rssMaxMB < 400, `${fmt(s.rssMaxMB)} MB`);
  r.num('gameMinutes', run.wallSec / 60);
  commonChecks(r, sw, s);
  bandwidth(r, sw, run, run.wallSec, !sw.opts.fast);
  const pts = s.series.filter((_, i) => i % Math.max(1, Math.floor(s.series.length / 12)) === 0);
  r.notes.push(`heap MB over time: ${pts.map(p => fmt(p.heap, 0)).join(' ')}`);
  return r.done();
}

export async function runScenario(name: ScenarioName, opts: Swarm['opts'], sharedServer: SpawnedServer | null): Promise<ScenarioResult> {
  const sw = new Swarm(opts);
  sw.server = sharedServer;
  try {
    switch (name) {
      case 'join-storm':
        return await joinStorm(sw);
      case 'round-start':
        return await roundStart(sw);
      case 'phase-change':
        return await phaseChange(sw);
      case 'r2-vote-burst':
        return await r2VoteBurst(sw);
      case 'chaos-restart':
        return await chaosRestart(sw);
      case 'duplicates-slow-readers':
        return await duplicatesSlowReaders(sw);
      case 'soak':
        return await soak(sw);
      case 'full-game':
        return await fullGame(sw);
      case 'bad-wifi':
        return await badWifi(sw);
    }
  } catch (e) {
    const r = new Report(name);
    r.check('scenario ran without throwing', false, e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') ?? e.message : String(e));
    return r.done();
  } finally {
    sw.dispose();
  }
}

export type { AdminViewData };
