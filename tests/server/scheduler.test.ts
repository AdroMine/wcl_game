import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, due } from '../../server/engine/index.ts';
import type { Runtime as RuntimeT } from '../../server/runtime.ts';
import type { Command, GameState } from '../../server/engine/index.ts';
import { Runtime } from '../../server/runtime.ts';
import { Scheduler } from '../../server/scheduler.ts';
import { sleep } from './harness.ts';

function fixture() {
  let now = 1_000_000;
  const rt = new Runtime(createInitialState({ seed: 9 }), { clock: () => now });
  const send = (type: string, actor: Command['actor'], payload: unknown = {}, id?: string) =>
    rt.apply({ commandId: id ?? `${type}-${rt.commandsTotal}`, type, actor, payload }, now);
  for (let i = 0; i < 10; i++) {
    const id = `player-${i}-pad`;
    send('JOIN', { kind: 'player', playerId: id }, { playerId: id, tokenHash: `h${i}`, name: `P${i}` });
  }
  send('ADMIN_AUTO_GROUP', { kind: 'admin' });
  send('ADMIN_SET_DURATIONS', { kind: 'admin' }, { r1Seconds: 30, r2: { HUDDLE: 10, PARLEY: 10, VOTE: 10, DEBRIEF: 10 } });
  send('ADMIN_START_GAME', { kind: 'admin' });
  return { rt, sched: new Scheduler(rt), advance: (ms: number) => (now += ms), send, get now() { return now; } };
}

test('nothing happens before the deadline; the step advances once after it', () => {
  const f = fixture();
  assert.equal(f.rt.state.phase, 'R1_ACTIVE');
  const endsAt = f.rt.state.endsAt!;
  f.advance(endsAt - f.now - 1);
  assert.equal(f.sched.tick(), 0);
  f.advance(1);
  assert.equal(f.sched.tick(), 1);
  assert.equal(f.rt.state.phase, 'R1_RESULTS');
  assert.equal(f.sched.tick(), 0, 'R1_RESULTS has no timer');
});

test('an event-loop stall of ten minutes advances exactly one step per overdue deadline, never twice', () => {
  const f = fixture();
  f.advance(31_000);
  f.sched.tick();
  f.send('ADMIN_START_R2', { kind: 'admin' });
  f.send('ADMIN_R2_AUTO_PAIR', { kind: 'admin' });
  assert.equal(f.rt.state.phase, 'R2_CLASH');
  assert.equal(f.rt.state.step, 'HUDDLE');
  const seq0 = f.rt.state.phaseSeq;
  f.advance(10 * 60_000); // stall
  f.sched.tick();
  f.sched.tick();
  f.sched.tick();
  assert.equal(f.rt.state.step, 'PARLEY', 'one step, not a cascade that skips the vote');
  assert.equal(f.rt.state.phaseSeq, seq0 + 1);
  // the same system command delivered again is a no-op
  const before = f.rt.state.version;
  const dup = due(f.rt.state, f.now); // not due yet: nothing
  assert.deepEqual(dup, []);
  f.rt.apply({ commandId: `sys:advance:${seq0}`, type: 'SYS_ADVANCE', actor: { kind: 'system' }, payload: { phaseSeq: seq0 } }, f.now);
  assert.equal(f.rt.state.version, before);
  // every phase sequence number appears once in the log
  const seqs = f.rt.state.phaseLog.map(e => e.seq);
  assert.equal(new Set(seqs).size, seqs.length);
});

test('a full Round 2 plays out with irregular ticks and each step is entered exactly once', () => {
  const f = fixture();
  f.advance(31_000);
  f.sched.tick();
  f.send('ADMIN_START_R2', { kind: 'admin' });
  f.send('ADMIN_R2_AUTO_PAIR', { kind: 'admin' });
  let guard = 0;
  while (f.rt.state.phase === 'R2_CLASH' && guard++ < 1000) {
    f.advance(1 + ((guard * 7919) % 6000));
    f.sched.tick();
    if (guard % 3 === 0) f.sched.tick();
  }
  assert.equal(f.rt.state.phase, 'R2_RESULTS');
  const entered = f.rt.state.phaseLog.filter(e => e.phase === 'R2_CLASH').map(e => `${e.clash}/${e.step}`);
  assert.equal(entered.length, 12);
  assert.equal(new Set(entered).size, 12);
});

test('paused games do not advance; resuming keeps the remaining time', () => {
  const f = fixture();
  f.advance(10_000);
  f.send('ADMIN_PAUSE', { kind: 'admin' });
  const remaining = f.rt.state.endsAt! - f.rt.state.pausedAt!;
  f.advance(120_000);
  assert.equal(f.sched.tick(), 0);
  assert.equal(f.rt.state.phase, 'R1_ACTIVE');
  f.send('ADMIN_RESUME', { kind: 'admin' });
  assert.equal(f.rt.state.endsAt! - f.now, remaining);
  assert.equal(f.sched.tick(), 0);
});

test('start()/stop() run on a timer and survive an exception', async () => {
  const f = fixture();
  const errors: unknown[] = [];
  const s = new Scheduler(f.rt, { intervalMs: 20, onError: e => errors.push(e) });
  s.start();
  f.advance(31_000);
  await sleep(120);
  assert.equal(f.rt.state.phase, 'R1_RESULTS');
  const ticks = s.ticks;
  assert.ok(ticks >= 2);
  s.stop();
  await sleep(80);
  assert.equal(s.ticks, ticks, 'stopped');
  // exception inside tick is caught
  const bad = new Scheduler({ ...f.rt, now: () => 1, get state(): GameState { throw new Error('boom'); } } as unknown as RuntimeT, { intervalMs: 10, onError: e => errors.push(e) });
  bad.start();
  await sleep(60);
  bad.stop();
  assert.ok(errors.length >= 2, 'kept ticking after errors');
});

test('runtime metrics: apply timings, commands per second, errors', () => {
  const f = fixture();
  assert.ok(f.rt.p99ApplyMs() >= 0);
  assert.ok(f.rt.getMaxApplyMs() >= f.rt.p50ApplyMs());
  const r = f.send('ADMIN_RESUME', { kind: 'admin' });
  assert.equal(r.error, 'NOT_PAUSED');
  assert.equal(f.rt.errorCounts.NOT_PAUSED, 1);
  f.rt.resetMetrics();
  assert.equal(f.rt.p99ApplyMs(), 0);
});
