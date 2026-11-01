// Views: size cap and privacy scan over a full simulated 200-player, ~40-team game.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { CODEWORDS } from '../../server/engine/index.ts';
import { getPlayerAsciiSlice } from '../../server/engine/ascii.ts';
import type { GameState } from '../../server/engine/index.ts';
import { generateHintText } from '../../server/engine/round1.ts';
import { hashToken } from '../../server/auth.ts';
import { ViewBuilder } from '../../server/transport/views.ts';
import { LIMITS } from '../../shared/protocol.ts';
import type { View } from '../../shared/protocol.ts';
import { runSimulation } from '../sim/simulate.ts';

const ADMIN_TOKEN = 'ADMIN-SECRET-for-scan-0123456789';
const NOW = 1_700_000_000_000;

interface Sample {
  tick: number;
  state: GameState;
}
const samples: Sample[] = [];
let finalState: GameState;

before(() => {
  let lastSeq = -1;
  const res = runSimulation({
    seed: 4242,
    players: 200,
    onTick(state, tick) {
      if (state.phaseSeq !== lastSeq || tick % 30 === 0) {
        lastSeq = state.phaseSeq;
        samples.push({ tick, state });
      }
    },
  });
  assert.deepEqual(res.failures, []);
  finalState = res.state;
});

/** Give every player a realistic token (the simulator stores fake hashes) and return the tokens. */
function withRealTokens(state: GameState): { state: GameState; tokens: Record<string, string> } {
  const tokens: Record<string, string> = {};
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    tokens[id] = `token-${id}-0123456789abcdef`;
    players[id] = { ...p, tokenHash: hashToken(tokens[id]) };
  }
  return { state: { ...state, players }, tokens };
}

const sliceCache = new WeakMap<GameState, Map<string, Set<string>>>();
/** JSON-escaped, non-trivial slice lines -> the players who own them. */
function sliceLines(state: GameState): Map<string, Set<string>> {
  let m = sliceCache.get(state);
  if (m) return m;
  m = new Map();
  for (const t of Object.values(state.teams)) {
    if (!t.r1) continue;
    for (const [qid, slot] of Object.entries(t.r1.slots)) {
      for (const raw of getPlayerAsciiSlice(t.r1.codeword, slot, t.r1.size)) {
        if (raw.trim().length <= 12) continue;
        const line = JSON.stringify(raw).slice(1, -1);
        if (!m.has(line)) m.set(line, new Set());
        m.get(line)!.add(qid);
      }
    }
  }
  sliceCache.set(state, m);
  return m;
}

function privacyViolations(state: GameState, tokens: Record<string, string>, pid: string, json: string, view: View): string[] {
  const bad: string[] = [];
  for (const p of Object.values(state.players)) {
    if (p.tokenHash && json.includes(p.tokenHash)) bad.push(`tokenHash of ${p.id}`);
  }
  for (const t of Object.values(tokens)) if (json.includes(t)) bad.push('raw token');
  if (json.includes(ADMIN_TOKEN)) bad.push('admin token');
  if (/tokenHash/i.test(json)) bad.push('tokenHash key');
  const compact = json.toUpperCase().replace(/\s+/g, '');
  for (const w of CODEWORDS) if (compact.includes(w.replace(/\s+/g, ''))) bad.push(`codeword ${w}`);
  for (const t of Object.values(state.teams)) {
    const cw = t.r1?.codeword;
    if (cw && compact.includes(cw.replace(/\s+/g, ''))) bad.push('team codeword');
  }
  // No other player's slice lines (only phases around Round 1 can leak them; scanning all 17k views would be slow).
  if (state.phase === 'R1_ACTIVE' || state.phase === 'R1_RESULTS' || state.phase === 'R2_PAIRING') {
    const mySlice = new Set(view.me?.slice ?? []);
    for (const [line, owners] of sliceLines(state)) {
      if (!mySlice.has(line) && !(owners.size === 1 && owners.has(pid)) && json.includes(line)) bad.push(`slice line of ${[...owners].join(',')}`);
    }
  }
  const me = state.players[pid];
  // Only the three sections of the view may carry per-player data.
  const keys = Object.keys(view);
  for (const k of keys) if (!['sid', 'v', 'serverNow', 'phase', 'me', 'team', 'r1', 'r2', 'r3', 'lobby', 'board', 'boardTotal', 'notice'].includes(k)) bad.push(`unexpected key ${k}`);
  if (view.me && view.me.id !== pid) bad.push('me is someone else');
  if (view.me && me && view.me.name !== me.name) bad.push('wrong name');
  return bad;
}

test('every player view of a 200-player game is <= 4096 bytes and passes the privacy scan, in every phase', () => {
  const phasesSeen = new Set<string>();
  const maxByPhase: Record<string, number> = {};
  let checked = 0;
  for (const s of samples) {
    const { state, tokens } = withRealTokens(s.state);
    const vb = new ViewBuilder({ sid: 'test-sid' });
    for (const pid of state.playerOrder) {
      const b = vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW);
      assert.ok(b.bytes <= LIMITS.viewBytes, `${state.phase}/${state.step} ${pid}: ${b.bytes} bytes`);
      assert.equal(Buffer.byteLength(b.json), b.bytes);
      const view = JSON.parse(b.json) as View;
      assert.deepEqual(privacyViolations(state, tokens, pid, b.json, view), [], `${state.phase}/${state.step} ${pid}`);
      assert.equal(view.v, state.version);
      assert.equal(view.phase.name, state.phase);
      const key = `${state.phase}${state.step ? '/' + state.step : ''}`;
      maxByPhase[key] = Math.max(maxByPhase[key] ?? 0, b.bytes);
      phasesSeen.add(state.phase);
      checked++;
    }
    assert.equal(vb.degradedViews, 0, `a normal game should never need degradation (${state.phase}/${state.step})`);
  }
  for (const ph of ['LOBBY', 'R1_ACTIVE', 'R1_RESULTS', 'R2_PAIRING', 'R2_CLASH', 'R2_RESULTS', 'R3_ACTIVE', 'R3_RESULTS', 'FINISHED']) {
    assert.ok(phasesSeen.has(ph), `phase ${ph} was sampled`);
  }
  console.log(`# views checked: ${checked}, samples: ${samples.length}`);
  console.log(`# max view bytes per phase: ${JSON.stringify(maxByPhase)}`);
  assert.ok(checked > 5000);
});

test('teammates receive identical shared parts; only `me` differs', () => {
  for (const s of samples.filter((_, i) => i % 3 === 0)) {
    const { state, tokens } = withRealTokens(s.state);
    const vb = new ViewBuilder({ sid: 'x' });
    for (const t of Object.values(state.teams)) {
      const parts = t.playerIds.map(pid => {
        const v = JSON.parse(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).json) as Record<string, unknown>;
        delete v.me;
        return JSON.stringify(v);
      });
      assert.ok(parts.every(p => p === parts[0]), `team ${t.id} in ${state.phase}/${state.step}`);
    }
  }
});

test('votes: a player sees only their own vote; counts only; other teams stay hidden until reveal', () => {
  const sampled = samples.filter(s => s.state.phase === 'R2_CLASH' && s.state.step === 'VOTE');
  assert.ok(sampled.length > 0);
  let sawOwnVote = false;
  for (const s of sampled) {
    const { state, tokens } = withRealTokens(s.state);
    const vb = new ViewBuilder({ sid: 'x' });
    for (const pid of state.playerOrder) {
      const v = JSON.parse(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).json) as View;
      
      const team = state.players[pid].teamId ? state.teams[state.players[pid].teamId!] : null;
      const m = team ? state.r2.matches[state.r2.matchOfTeam[team.id]] : undefined;
      const clash = m?.clashes[state.clash - 1];
      if (team && m && clash && !m.cancelled) {
        assert.equal(v.r2?.clashes.length, state.clash - 1, 'only resolved clashes are shown');
        const own = (m.teamA === team.id ? clash.votesA : clash.votesB)[pid];
        assert.equal(v.me?.myVote, own);
        if (own) sawOwnVote = true;
        assert.equal(typeof v.r2?.votedCount, 'number');
      }
    }
  }
  assert.ok(sawOwnVote);
});

test('round 3: vessels stay hidden until REVEAL and the leash target is only shown to the holder', () => {
  let leashSeen = false;
  for (const s of samples.filter(x => x.state.phase === 'R3_ACTIVE')) {
    const { state, tokens } = withRealTokens(s.state);
    const vb = new ViewBuilder({ sid: 'x' });
    for (const pid of state.playerOrder.filter((_, i) => i % 7 === 0)) {
      const v = JSON.parse(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).json) as View;
      if (state.step === 'BLUFF' || state.step === 'VOTE') {
        assert.ok(v.r3 === undefined || v.r3.fleet.every(r => r[3] === ''), 'no vessel before reveal');
        if (v.r3) assert.ok(!v.r3.lastWave || v.r3.lastWave.wave < state.wave);
      }
      const tid = state.players[pid].teamId;
      const t3 = tid ? state.r3?.teams[tid] : undefined;
      if (v.r3?.leash) {
        leashSeen = true;
        assert.ok(t3?.leashHolder, 'only the holder sees a leash');
      } else if (t3 && !t3.leashHolder) {
        assert.equal(v.r3?.leash, undefined);
      }
    }
  }
  assert.ok(leashSeen, 'the simulation should contain a leash holder');
});

test('unknown player, wrong token and missing credentials get a view without `me`', () => {
  const { state, tokens } = withRealTokens(finalState);
  const vb = new ViewBuilder({ sid: 'x' });
  const pid = state.playerOrder[0];
  for (const [id, tok] of [
    ['nobody-12345', hashToken('abc')],
    [pid, hashToken('wrong')],
    [pid, null],
    [null, null],
  ] as const) {
    const b = vb.forPlayer(state, id, tok, NOW);
    const v = JSON.parse(b.json) as View;
    assert.equal(v.me, undefined);
    assert.equal(v.team, undefined);
    assert.ok(!b.known);
    assert.ok(b.bytes < 1500);
  }
  assert.ok(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).known);
});

test('adversarial: maximum-length multibyte names, all hints taken, still <= 4096 bytes and never leaks', () => {
  const r1 = samples.filter(s => s.state.phase === 'R1_ACTIVE').at(-1)!.state;
  const r3 = samples.filter(s => s.state.phase === 'R3_ACTIVE' && s.state.step === 'REVEAL').at(-1)?.state ?? samples.filter(s => s.state.phase === 'R3_RESULTS').at(-1)!.state;
  for (const base of [r1, r3, finalState]) {
    const s = structuredClone(base);
    const long = (c: string, n: number, i: number) => `${String.fromCharCode(c.charCodeAt(0) + (i % 20))}`.repeat(n);
    let i = 0;
    for (const p of Object.values(s.players)) p.name = long('漢', 24, i++);
    for (const t of Object.values(s.teams)) {
      t.name = long('漢', 32, i++);
      if (t.r1) {
        t.r1.hintsTaken = [1, 2, 3];
        const slotMembers = Object.entries(t.r1.slots).map(([pid, slot]) => ({ slotIndex: slot, playerName: s.players[pid].name, roleName: 'Torchbearer' }));
        for (const h of [1, 2, 3]) t.r1.hintTexts[String(h)] = generateHintText(h, t.r1.size, slotMembers);
      }
    }
    const { state, tokens } = withRealTokens(s);
    const vb = new ViewBuilder({ sid: 'x' });
    vb.setNotice('N'.repeat(300));
    let max = 0;
    for (const pid of state.playerOrder) {
      const b = vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW);
      assert.ok(b.bytes <= LIMITS.viewBytes, `${state.phase}: ${b.bytes}`);
      const view = JSON.parse(b.json) as View;
      assert.deepEqual(privacyViolations(state, tokens, pid, b.json, view), []);
      max = Math.max(max, b.bytes);
    }
    console.log(`# adversarial ${base.phase}/${base.step}: max ${max} bytes, degraded views ${vb.degradedViews}`);
  }
});

test('team parts are cached per version: 200 players cost one build per team', () => {
  const { state, tokens } = withRealTokens(samples.filter(s => s.state.phase === 'R2_CLASH').at(3)!.state);
  const vb = new ViewBuilder({ sid: 'x' });
  for (const pid of state.playerOrder) vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW);
  const teamsWithMembers = Object.values(state.teams).filter(t => t.playerIds.length > 0).length;
  assert.equal(vb.teamBuilds, teamsWithMembers);
  assert.equal(vb.globalBuilds, 1);
  for (const pid of state.playerOrder) vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW + 1000);
  assert.equal(vb.teamBuilds, teamsWithMembers, 'same version: no rebuild');
});

test('content hash ignores v and serverNow but follows content', () => {
  const { state, tokens } = withRealTokens(samples.filter(s => s.state.phase === 'R2_CLASH').at(2)!.state);
  const vb = new ViewBuilder({ sid: 'x' });
  const pid = state.playerOrder.find(id => state.players[id].teamId)!;
  const h = hashToken(tokens[pid]);
  const a = vb.forPlayer(state, pid, h, NOW);
  const b = vb.forPlayer(state, pid, h, NOW + 5000);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.json, b.json);
  vb.setNotice('Hello');
  const c = vb.forPlayer(state, pid, h, NOW);
  assert.notEqual(a.hash, c.hash);
  assert.equal((JSON.parse(c.json) as View).notice, 'Hello');
  assert.notEqual(new ViewBuilder({ sid: 'other' }).forPlayer(state, pid, h, NOW).hash, a.hash, 'sid is part of the content');
});

test('screen view is public: no private fields, small', () => {
  const vb = new ViewBuilder({ sid: 'x', publicUrl: 'https://play.example' });
  for (const s of samples.filter((_, i) => i % 4 === 0)) {
    const { json } = vb.screen(s.state, NOW);
    for (const p of Object.values(s.state.players)) if (p.tokenHash) assert.ok(!json.includes(p.tokenHash));
    assert.ok(!/"(tokenHash|codeword|slice|me)"/i.test(json));
    const compact = json.toUpperCase().replace(/\s+/g, '');
    for (const w of CODEWORDS) assert.ok(!compact.includes(w.replace(/\s+/g, '')));
    assert.ok(Buffer.byteLength(json) < 6000, `${s.state.phase}: ${Buffer.byteLength(json)}`);
  }
});

test('a crew of one gets the whole tablet: the view stays <= 4096 bytes and the slice is losslessly re-encoded', () => {
  const base = structuredClone(samples.filter(s => s.state.phase === 'R1_ACTIVE').at(-1)!.state);
  const team = Object.values(base.teams).find(t => t.r1)!;
  const pid = Object.keys(team.r1!.slots)[0];
  team.r1!.slots = { [pid]: 0 };
  team.r1!.size = 1;
  team.playerIds = [pid];
  for (const p of Object.values(base.players)) if (p.teamId === team.id && p.id !== pid) p.teamId = null;
  const { state, tokens } = withRealTokens(base);
  const vb = new ViewBuilder({ sid: 'x' });
  const b = vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW);
  assert.ok(b.bytes <= LIMITS.viewBytes, `${b.bytes}`);
  const me = (JSON.parse(b.json) as View).me!;
  assert.equal(me.slice!.length, 15);
  assert.equal(me.sliceFmt, 'hash');
  const full = getPlayerAsciiSlice(team.r1!.codeword, 0, 1);
  assert.deepEqual(me.slice!.map(l => l.replaceAll('#', '█')), full);
});
