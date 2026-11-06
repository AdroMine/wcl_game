// Golden values ported from tests/test_team_codes.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEmojiCodeLabels,
  generateTeamEmojiCode,
  normalizeEmojiCode,
  parseEmojiCode,
} from '../../server/engine/teamCodes.ts';
import { TEAM_EMOJI_LABELS, TEAM_EMOJI_POOL } from '../../server/engine/config.ts';
import { rngInt, rngNext, rngShuffle, seedToState } from '../../server/engine/rng.ts';
import { nextId } from '../../server/engine/ids.ts';

test('4-emoji pool and labels (the shield is retired but old codes still parse)', () => {
  assert.equal(TEAM_EMOJI_POOL.length, 4);
  assert.deepEqual([...TEAM_EMOJI_POOL], ['🔥', '💀', '⚡', '🌊']);
  assert.equal(TEAM_EMOJI_LABELS['🔥'], 'Fire');
  assert.equal(TEAM_EMOJI_LABELS['🛡️'], undefined);
});

test('normalisation and parsing', () => {
  assert.deepEqual(parseEmojiCode('💀⚡🛡️'), ['💀', '⚡', '🛡️']);
  assert.equal(normalizeEmojiCode('⚡'), normalizeEmojiCode('⚡️'));
});

test('phonetic labels', () => {
  assert.equal(formatEmojiCodeLabels('💀⚡🛡️'), 'Skull • Bolt • Shield');
  assert.equal(formatEmojiCodeLabels('🔥🌊💀'), 'Fire • Wave • Skull');
});

test('50 unique emoji codes without collision', () => {
  const rng = { rng: seedToState(42) };
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const code = generateTeamEmojiCode(rng, seen);
    assert.ok(Array.from(normalizeEmojiCode(code)).length >= 3);
    assert.ok(!seen.has(normalizeEmojiCode(code)));
    seen.add(normalizeEmojiCode(code));
  }
  assert.equal(seen.size, 50);
});

test('all 64 three-emoji codes can be allocated, then it expands to four', () => {
  const rng = { rng: seedToState(9) };
  const seen = new Set<string>();
  for (let i = 0; i < 64; i++) {
    const code = generateTeamEmojiCode(rng, seen);
    assert.equal(Array.from(normalizeEmojiCode(code)).length, 3);
    seen.add(normalizeEmojiCode(code));
  }
  assert.equal(seen.size, 64);
  assert.equal(Array.from(normalizeEmojiCode(generateTeamEmojiCode(rng, seen))).length, 4);
});

test('rng is deterministic and well spread; shuffle is a permutation', () => {
  const a = { rng: seedToState(123) };
  const b = { rng: seedToState(123) };
  const xs = Array.from({ length: 20 }, () => rngNext(a));
  const ys = Array.from({ length: 20 }, () => rngNext(b));
  assert.deepEqual(xs, ys);
  assert.ok(xs.every(x => x >= 0 && x < 1));
  const buckets = new Array(10).fill(0);
  const c = { rng: seedToState(5) };
  for (let i = 0; i < 10000; i++) buckets[rngInt(c, 10)]++;
  assert.ok(buckets.every(n => n > 800 && n < 1200));
  const sh = rngShuffle(c, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(sh.slice().sort(), [1, 2, 3, 4, 5, 6]);
});

test('ids come from a counter, never from time', () => {
  const s = { idCounter: 0 };
  assert.equal(nextId(s, 't'), 't1');
  assert.equal(nextId(s, 't'), 't2');
  assert.equal(s.idCounter, 2);
});
