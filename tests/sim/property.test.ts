// Property tests over whole simulated games (seeded): command order within a tick, duplicates and
// snapshot/restore must not change the outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation } from './simulate.ts';
import type { SimOptions } from './simulate.ts';
import type { GameState } from '../../server/engine/index.ts';

const SEEDS = [11, 12, 13];
const PLAYERS = 120;
const base = (seed: number, extra: Partial<SimOptions> = {}): SimOptions => ({ seed, players: PLAYERS, ...extra });

/** Everything that defines the outcome of the game, independent of who-clicked-first. */
function outcome(s: GameState) {
  return {
    teams: s.teamOrder.map(id => {
      const t = s.teams[id];
      return { id, name: t.name, members: t.playerIds, r1Points: t.r1Points, r2Points: t.r2Points, adminAdjust: t.adminAdjust, score: t.score };
    }),
    moral: s.r2.moral,
    matches: Object.values(s.r2.matches).map(m => ({ id: m.id, a: m.teamA, b: m.teamB, clashes: m.clashes.map(c => ({ n: c.clash, a: c.stanceA, b: c.stanceB, pa: c.ptsA, pb: c.ptsB })) })),
    distances: Object.fromEntries(Object.entries(s.r3?.teams ?? {}).map(([id, t]) => [id, [t.distance, t.escaped, t.escapeRank, t.leashUsed]])),
    escapeOrder: s.r3?.escapeOrder,
    reports: s.r3?.reports,
    sd: s.r3?.sdHistory.map(x => [x.teamA, x.teamB, x.winnerTeamId]),
    phase: s.phase,
  };
}

const stripRing = (s: GameState): GameState => ({ ...s, applied: [] });

test('baseline runs are deterministic and satisfy every invariant', () => {
  for (const seed of SEEDS) {
    const a = runSimulation(base(seed));
    const b = runSimulation(base(seed));
    assert.deepEqual(a.failures, [], `seed ${seed}: ${a.failures.join('; ')}`);
    assert.equal(a.state.phase, 'FINISHED');
    assert.deepEqual(a.state, b.state);
  }
});

test('(a) shuffling independent player commands within a tick leaves the scores unchanged', () => {
  for (const seed of SEEDS) {
    const plain = runSimulation(base(seed));
    const shuffled = runSimulation(base(seed, { shuffle: true }));
    assert.deepEqual(shuffled.failures, [], `seed ${seed}: ${shuffled.failures.join('; ')}`);
    assert.deepEqual(outcome(shuffled.state), outcome(plain.state), `seed ${seed}`);
  }
});

test('(b) duplicates leave the final state identical', () => {
  for (const seed of SEEDS) {
    const plain = runSimulation(base(seed));
    // same commandId resent (immediately or a few ticks later): full state, including version and dedupe ring
    const sameId = runSimulation(base(seed, { dupSameId: 0.3 }));
    assert.deepEqual(sameId.failures, [], `seed ${seed}: ${sameId.failures.join('; ')}`);
    assert.ok(sameId.reduceCalls > plain.reduceCalls, 'duplicates were actually injected');
    assert.deepEqual(sameId.state, plain.state, `seed ${seed}: same-id duplicates changed the state`);
    // new commandId for the same intent (client retry after a lost response): identical apart from the ring
    const newId = runSimulation(base(seed, { dupNewId: 0.3 }));
    assert.deepEqual(newId.failures, [], `seed ${seed}: ${newId.failures.join('; ')}`);
    assert.ok(newId.reduceCalls > plain.reduceCalls);
    assert.deepEqual(stripRing(newId.state), stripRing(plain.state), `seed ${seed}: retried intents changed the state`);
  }
});

test('(c) a JSON snapshot/restore at a random point continues to an identical final state', () => {
  for (const seed of SEEDS) {
    const plain = runSimulation(base(seed));
    // pick a deterministic pseudo-random tick inside the game
    const at = 1 + ((seed * 2654435761) >>> 0) % (plain.ticks - 2);
    const restored = runSimulation(base(seed, { snapshotAtTick: at }));
    assert.deepEqual(restored.failures, [], `seed ${seed}: ${restored.failures.join('; ')}`);
    assert.deepEqual(restored.state, plain.state, `seed ${seed}: restore at tick ${at}`);
  }
  // and at a handful of fixed points covering each round
  const plain = runSimulation(base(21));
  for (const frac of [0.05, 0.12, 0.3, 0.45, 0.6, 0.75, 0.9]) {
    const at = Math.floor(plain.ticks * frac);
    assert.deepEqual(runSimulation(base(21, { snapshotAtTick: at })).state, plain.state, `restore at ${at}`);
  }
});

test('all of it at once: shuffle + duplicates + restore still reach the same outcome', () => {
  const seed = 31;
  const plain = runSimulation(base(seed));
  const chaos = runSimulation(base(seed, { shuffle: true, dupSameId: 0.2, dupNewId: 0.2, snapshotAtTick: 700 }));
  assert.deepEqual(chaos.failures, []);
  assert.deepEqual(outcome(chaos.state), outcome(plain.state));
});

test('the 200 player simulation meets the per-command time budget', () => {
  const r = runSimulation({ seed: 3, measure: true });
  assert.deepEqual(r.failures, []);
  assert.equal(Object.keys(r.state.players).length, 200);
  const mean = r.timesMs.reduce((a, b) => a + b, 0) / r.timesMs.length;
  assert.ok(mean < 5, `mean reduce time ${mean.toFixed(2)} ms`);
});
