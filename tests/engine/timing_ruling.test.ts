// Organizer ruling, Nov 4 2026: Round 2 clash = VOTE (talk and vote) -> DEBRIEF; Round 3 wave = VOTE -> REVEAL.
// Snapshots written before the ruling (HUDDLE / PARLEY / BLUFF steps, old duration keys) must still restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness, pairByCode, setupR3, toR2Pairing } from './helpers.ts';
import { normalizeRestoredState, reduce } from '../../server/engine/index.ts';
import type { GameState } from '../../server/engine/index.ts';
import { gameStateProblem, pauseRestored } from '../../server/persistence/index.ts';

const oldCopy = (s: GameState): Record<string, any> => JSON.parse(JSON.stringify(s));

function r2InVote() {
  const h = harness(7);
  const t = formTeams(h, [5, 5]);
  toR2Pairing(h);
  pairByCode(h, t[0], t[1]);
  h.nextDeadline(); // briefing -> clash 1 VOTE
  return { h, t };
}

test('default durations: R2 {VOTE 60, DEBRIEF 15}, R3 {VOTE 40, REVEAL 25}', () => {
  const h = harness();
  assert.deepEqual(h.state.config.r2, { VOTE: 60, DEBRIEF: 15 });
  assert.deepEqual(h.state.config.r3, { VOTE: 40, REVEAL: 25 });
});

test('old snapshot in HUDDLE or PARLEY restores into that clash\'s VOTE (remaining time + a full VOTE)', () => {
  for (const oldStep of ['HUDDLE', 'PARLEY']) {
    const { h, t } = r2InVote();
    const old = oldCopy(h.state);
    old.step = oldStep;
    old.config.r2 = { HUDDLE: 50, PARLEY: 40, VOTE: 25, DEBRIEF: 40 };
    old.config.r3 = { BLUFF: 55, VOTE: 20, REVEAL: 25 };
    assert.equal(gameStateProblem(old), null, 'old shape still validates');
    const norm = normalizeRestoredState(old as GameState);
    assert.equal(norm.step, 'VOTE');
    assert.equal(norm.clash, 1);
    assert.equal(norm.endsAt, old.endsAt + 60_000);
    assert.deepEqual(norm.config.r2, { VOTE: 60, DEBRIEF: 15 });
    assert.deepEqual(norm.config.r3, { VOTE: 40, REVEAL: 25 });
    assert.equal(normalizeRestoredState(norm), norm, 'idempotent');
    assert.equal(gameStateProblem(norm), null);
    // restored games boot paused; once resumed, votes are accepted
    const paused = pauseRestored(old as GameState, h.now, 'boot');
    assert.equal(paused.step, 'VOTE');
    assert.notEqual(paused.pausedAt, null);
    const r = reduce(norm, { commandId: 'v1', type: 'R2_VOTE', actor: { kind: 'player', playerId: norm.teams[t[0]].playerIds[0] }, payload: { vote: 'TRUCE' } }, { now: h.now });
    assert.equal(r.error, undefined);
  }
});

test('old snapshot in BLUFF restores into that wave\'s VOTE; customised durations are summed', () => {
  const { h } = setupR3(34, [5, 5], () => 'TRUCE');
  const old = oldCopy(h.state);
  old.step = 'BLUFF';
  old.config.r2 = { HUDDLE: 10, PARLEY: 10, VOTE: 10, DEBRIEF: 12 };
  old.config.r3 = { BLUFF: 30, VOTE: 15, REVEAL: 20 };
  old.returnTo = { phase: 'R3_ACTIVE', step: 'BLUFF', clash: 0, wave: 1, remainingMs: 9000 };
  const norm = normalizeRestoredState(old as GameState);
  assert.equal(norm.step, 'VOTE');
  assert.equal(norm.wave, 1);
  assert.equal(norm.endsAt, old.endsAt + 45_000);
  assert.deepEqual(norm.config.r2, { VOTE: 30, DEBRIEF: 12 });
  assert.deepEqual(norm.config.r3, { VOTE: 45, REVEAL: 20 });
  assert.equal(norm.returnTo!.step, 'VOTE');
});

test('R2 clash and R3 wave accept votes (and the leash) from the first second', () => {
  const { h, t } = r2InVote();
  assert.equal(h.state.step, 'VOTE');
  h.ok(h.as(h.state.teams[t[0]].playerIds[0], 'R2_VOTE', { vote: 'AMBUSH' }));
  const g = setupR3(41, [5, 5, 5, 5], (c, _tid, i) => (i === 1 && c <= 2 ? 'AMBUSH' : 'TRUCE'));
  assert.equal(g.h.state.step, 'VOTE');
  const holder = g.h.state.teams[g.t[0]].playerIds[0];
  g.h.ok(g.h.as(holder, 'R3_ARM_LEASH', {}));
  g.h.ok(g.h.as(g.h.state.teams[g.t[2]].playerIds[0], 'R3_VOTE', { vessel: 'ROWBOAT' }));
});
