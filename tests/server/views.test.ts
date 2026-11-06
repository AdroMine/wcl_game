// Views: size cap and privacy scan over a full simulated 200-player, ~40-team game.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { CODEWORDS } from '../../server/engine/index.ts';
import type { GameState } from '../../server/engine/index.ts';
import { generateHintText } from '../../server/engine/round1.ts';
import { briefingSeconds } from '../../server/content.ts';
import { harness } from '../engine/helpers.ts';
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

function privacyViolations(state: GameState, tokens: Record<string, string>, pid: string, json: string, view: View): string[] {
  const bad: string[] = [];
  for (const p of Object.values(state.players)) {
    if (p.tokenHash && json.includes(p.tokenHash)) bad.push(`tokenHash of ${p.id}`);
  }
  for (const t of Object.values(tokens)) if (json.includes(t)) bad.push('raw token');
  if (json.includes(ADMIN_TOKEN)) bad.push('admin token');
  if (/tokenHash/i.test(json)) bad.push('tokenHash key');
  // Codewords: only the viewer's OWN crew's codeword, only during R1_ACTIVE, only as r1.tablet. Never another crew's.
  const compact = json.toUpperCase().replace(/\s+/g, '');
  const ownTeam = state.players[pid]?.teamId ? state.teams[state.players[pid].teamId!] : undefined;
  const ownWord = state.phase === 'R1_ACTIVE' ? ownTeam?.r1?.codeword : undefined;
  for (const w of CODEWORDS) {
    if (w === ownWord) continue;
    if (compact.includes(w.replace(/\s+/g, ''))) bad.push(`codeword ${w}`);
  }
  for (const t of Object.values(state.teams)) {
    const cw = t.r1?.codeword;
    if (cw && cw !== ownWord && compact.includes(cw.replace(/\s+/g, ''))) bad.push('team codeword');
  }
  if (view.r1?.tablet) {
    if (!ownWord || `${view.r1.tablet.line1} ${view.r1.tablet.line2}` !== ownWord) bad.push('tablet is not my own crew codeword');
  }
  if ((view.me as Record<string, unknown> | undefined)?.slice !== undefined) bad.push('ascii slice still sent');
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
      if (state.step === 'VOTE') {
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
        const slotMembers = Object.entries(t.r1.slots).map(([pid, slot]) => ({ slotIndex: slot, playerName: s.players[pid].name }));
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

test('screen view carries lobby.crewSize in the LOBBY phase only', () => {
  const h = harness(5);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 3 }));
  const vb = new ViewBuilder({ sid: 'x' });
  assert.deepEqual((JSON.parse(vb.screen(h.state, NOW).json) as { lobby?: unknown }).lobby, { crewSize: 3 });
  const late = samples.find(s => s.state.phase !== 'LOBBY')!;
  assert.equal('lobby' in JSON.parse(vb.screen(late.state, NOW).json), false);
});

test('screen view is public: no private fields, small', () => {
  const vb = new ViewBuilder({ sid: 'x', publicUrl: 'https://play.example' });
  for (const s of samples.filter((_, i) => i % 4 === 0)) {
    const { json } = vb.screen(s.state, NOW);
    for (const p of Object.values(s.state.players)) if (p.tokenHash) assert.ok(!json.includes(p.tokenHash));
    assert.ok(!/"(tokenHash|codeword|slice|me|tablet)"/i.test(json));
    const compact = json.toUpperCase().replace(/\s+/g, '');
    for (const w of CODEWORDS) assert.ok(!compact.includes(w.replace(/\s+/g, '')));
    assert.ok(Buffer.byteLength(json) < 6000, `${s.state.phase}: ${Buffer.byteLength(json)}`);
  }
});

test('R1: the crew sees its own tablet lines and slot; a crew of one still fits in 4096 bytes; no ascii slice is sent', () => {
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
  const view = JSON.parse(b.json) as View;
  assert.equal(view.me!.slot, 0);
  assert.equal(view.me!.slotCount, 1);
  assert.equal(`${view.r1!.tablet!.line1} ${view.r1!.tablet!.line2}`, team.r1!.codeword);
  assert.ok(!('slice' in view.me!) && !('sliceFmt' in view.me!));
  assert.equal(vb.degradedViews, 0);
});

test('R1 tablet: every member of a crew sees the same two lines, only in R1_ACTIVE, and the slots are distinct', () => {
  const r1 = samples.filter(s => s.state.phase === 'R1_ACTIVE' && s.state.step === null).at(-1)!.state;
  const { state, tokens } = withRealTokens(r1);
  const vb = new ViewBuilder({ sid: 'x' });
  for (const t of Object.values(state.teams)) {
    if (!t.r1 || t.playerIds.length === 0) continue;
    const views = t.playerIds.map(pid => JSON.parse(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).json) as View);
    const [w1, w2] = t.r1.codeword.split(' ');
    for (const v of views) {
      assert.deepEqual(v.r1!.tablet, { line1: w1, line2: w2 });
      assert.equal(v.me!.slotCount, t.playerIds.length);
    }
    assert.deepEqual(views.map(v => v.me!.slot).sort(), t.playerIds.map((_, i) => i));
  }
  // not after the round
  const results = samples.filter(s => s.state.phase === 'R1_RESULTS').at(-1)!.state;
  const w = withRealTokens(results);
  const pid = results.playerOrder.find(id => results.players[id].teamId)!;
  const rv = JSON.parse(new ViewBuilder({ sid: 'x' }).forPlayer(w.state, pid, hashToken(w.tokens[pid]), NOW).json) as View;
  assert.equal(rv.r1?.tablet, undefined);
  assert.equal(rv.me?.slot, undefined);
});

test('briefing: views expose the step, its start and end time; hints unlock relative to the briefing end', () => {
  const h = harness(21);
  for (let i = 0; i < 5; i++) h.join(`pl${i}abc`);
  h.ok(h.as('pl0abc', 'CREATE_TEAM', { name: 'Crew' }));
  const code = h.state.teams[h.state.players.pl0abc.teamId!].emojiCode;
  for (let i = 1; i < 5; i++) h.admin('ADMIN_MOVE_PLAYER', { playerId: `pl${i}abc`, teamId: h.state.players.pl0abc.teamId });
  assert.ok(code);
  h.ok(h.admin('ADMIN_START_GAME'));
  const { state, tokens } = withRealTokens(h.state);
  const vb = new ViewBuilder({ sid: 'x' });
  const v = JSON.parse(vb.forPlayer(state, 'pl0abc', hashToken(tokens.pl0abc), NOW).json) as View;
  assert.equal(v.phase.name, 'R1_ACTIVE');
  assert.equal(v.phase.step, 'BRIEFING');
  assert.equal(v.phase.startedAt, state.phaseStartedAt);
  assert.equal(v.phase.endsAt! - v.phase.startedAt!, briefingSeconds(1) * 1000);
  assert.deepEqual(v.r1!.hints.map(x => x.unlocksAt - v.phase.endsAt!), [120_000, 180_000, 240_000]);
  assert.ok(v.r1!.tablet, 'the crew can preload its tablet during the briefing');
  // after the briefing: no startedAt, step null, hints relative to the real clock start
  h.nextDeadline();
  const w = withRealTokens(h.state);
  const v2 = JSON.parse(new ViewBuilder({ sid: 'x' }).forPlayer(w.state, 'pl0abc', hashToken(w.tokens.pl0abc), NOW).json) as View;
  assert.equal(v2.phase.step, null);
  assert.equal(v2.phase.startedAt, undefined);
  assert.equal(v2.phase.endsAt, h.state.r1.startedAt! + 300_000);
  assert.equal(v2.r1!.hints[0].unlocksAt, h.state.r1.startedAt! + 120_000);
});

test('lobby view carries the current crew size', () => {
  const h = harness(5);
  h.join('someone1');
  const { state, tokens } = withRealTokens(h.state);
  const vb = new ViewBuilder({ sid: 'x' });
  const v = JSON.parse(vb.forPlayer(state, 'someone1', hashToken(tokens.someone1), NOW).json) as View;
  assert.deepEqual(v.lobby, { players: 1, teams: 0, crewSize: 5 });
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 4 }));
  const w = withRealTokens(h.state);
  const v2 = JSON.parse(new ViewBuilder({ sid: 'x' }).forPlayer(w.state, 'someone1', hashToken(w.tokens.someone1), NOW).json) as View;
  assert.equal(v2.lobby!.crewSize, 4);
});

/**
 * Worst case: 40 crews of 6 (the absolute cap of 6), played through every step with votes cast,
 * wave reports and leashes. Measures the largest view of any player.
 */
function worstCase(nameFor: (kind: 'player' | 'team', i: number) => string): { max: Record<string, number>; degraded: number; overall: number; views: number } {
  const h = harness(77);
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 6 }));
  const crews = 40;
  const teamIds: string[] = [];
  let n = 0;
  for (let c = 0; c < crews; c++) {
    h.ok(h.admin('ADMIN_ADD_PLAYER', { name: nameFor('player', n++) }));
    const lead = h.state.playerOrder.at(-1)!;
    h.join(`creator${c}`, nameFor('player', n++));
    h.ok(h.as(`creator${c}`, 'CREATE_TEAM', { name: nameFor('team', c) }));
    const tid = h.state.players[`creator${c}`].teamId!;
    teamIds.push(tid);
    h.ok(h.admin('ADMIN_MOVE_PLAYER', { playerId: lead, teamId: tid }));
    for (let k = 0; k < 4; k++) {
      h.ok(h.admin('ADMIN_ADD_PLAYER', { name: nameFor('player', n++), teamId: tid }));
    }
  }
  assert.ok(teamIds.every(t => h.state.teams[t].playerIds.length === 6));
  const max: Record<string, number> = {};
  let degraded = 0;
  let overall = 0;
  let views = 0;
  const measure = (label: string): void => {
    const { state, tokens } = withRealTokens(h.state);
    const vb = new ViewBuilder({ sid: 'w' });
    for (const pid of state.playerOrder) {
      // every phone has a token in this synthetic game
      const b = vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW);
      assert.ok(b.bytes <= LIMITS.viewBytes, `${label} ${pid}: ${b.bytes} bytes`);
      max[label] = Math.max(max[label] ?? 0, b.bytes);
      overall = Math.max(overall, b.bytes);
      views++;
    }
    degraded += vb.degradedViews;
  };
  measure('LOBBY');
  const members = (t: string) => h.state.teams[t].playerIds;
  h.ok(h.admin('ADMIN_START_GAME'));
  measure('R1 BRIEFING');
  h.nextDeadline();
  // every crew takes hints (long hint texts name the members) after 4 minutes
  h.tick(245);
  for (const t of teamIds) for (const i of [1, 2, 3]) h.ok(h.as(members(t)[0], 'R1_HINT', { hint: i }), 'hint');
  measure('R1 running, all hints taken');
  h.ok(h.admin('ADMIN_SKIP_STEP'));
  measure('R1_RESULTS');
  h.ok(h.admin('ADMIN_START_R2'));
  measure('R2_PAIRING');
  h.ok(h.admin('ADMIN_R2_AUTO_PAIR'));
  measure('R2 BRIEFING');
  for (let clash = 1; clash <= 3; clash++) {
    while (h.state.step !== 'VOTE') h.nextDeadline();
    // mixed votes: stances differ per crew so that every moral status occurs
    teamIds.forEach((t, ti) => {
      members(t).forEach((pid, mi) => {
        if (mi === 6) return; // one member never votes
        const v = (ti % 4 === 1 && clash <= 2) || (ti % 4 === 0 && clash === 3) ? 'AMBUSH' : mi % 3 === 0 && ti % 2 ? 'AMBUSH' : 'TRUCE';
        h.ok(h.as(pid, 'R2_VOTE', { vote: v }));
      });
    });
    measure(`R2 clash ${clash} VOTE (all voted)`);
    h.nextDeadline();
    measure(`R2 clash ${clash} DEBRIEF`);
    h.nextDeadline();
  }
  while (h.state.phase === 'R2_CLASH') h.nextDeadline();
  measure('R2_RESULTS');
  h.ok(h.admin('ADMIN_START_R3'));
  measure('R3 BRIEFING');
  for (let wave = 1; wave <= 6 && h.state.phase === 'R3_ACTIVE'; wave++) {
    while (h.state.step !== 'VOTE') h.nextDeadline();
    const active = h.state.teamOrder.filter(t => h.state.r3!.teams[t] && !h.state.r3!.teams[t].escaped);
    active.forEach((t, ti) => {
      const t3 = h.state.r3!.teams[t];
      members(t).forEach((pid, mi) => {
        const vessel = (['ROWBOAT', 'SAILBOAT', 'GHOST_SHIP'] as const)[(ti + mi + wave) % 3 === 0 && ti % 5 === 0 ? 2 : ti % 3 === 0 ? 1 : 0];
        h.ok(h.as(pid, 'R3_VOTE', { vessel }));
      });
      if (t3.leashHolder && !t3.leashUsed) h.as(members(t)[0], 'R3_ARM_LEASH', {});
    });
    measure(`R3 wave ${wave} VOTE`);
    h.nextDeadline();
    measure(`R3 wave ${wave} REVEAL`);
    h.nextDeadline();
  }
  if (h.state.phase === 'R3_ACTIVE') h.ok(h.admin('ADMIN_END_R3'));
  measure('R3_RESULTS');
  h.ok(h.admin('ADMIN_FINISH'));
  measure('FINISHED');
  return { max, degraded, overall, views };
}

test('worst case: 40 crews of 6, ordinary names: every view <= 4096 bytes and nothing is degraded', () => {
  const r = worstCase((kind, i) => (kind === 'player' ? `Player ${i % 1000}` : `Crew number ${i}`));
  console.log(`# worst case (40 crews of 6, ordinary names): max view ${r.overall} bytes over ${r.views} views; per step ${JSON.stringify(r.max)}`);
  assert.equal(r.degraded, 0, 'no view needed degrading');
  assert.ok(r.overall <= LIMITS.viewBytes);
});

test('worst case: 40 crews of 6 with maximum-length multibyte names stay <= 4096 bytes (degrading if needed)', () => {
  const r = worstCase((kind, i) => String.fromCharCode(0x6f22 + (i % 50)).repeat(kind === 'player' ? 24 : 32));
  console.log(`# worst case (40 crews of 6, multibyte names): max view ${r.overall} bytes, degraded views ${r.degraded}`);
  assert.ok(r.overall <= LIMITS.viewBytes);
});

test('view data: R2 voted-by flags during VOTE, revealed teammate votes afterwards, R3 report and honourable flag', () => {
  // R2: VOTE sample with at least one team where some teammates voted
  let sawVotedBy = false;
  for (const s of samples.filter(x => x.state.phase === 'R2_CLASH' && x.state.step === 'VOTE')) {
    const { state, tokens } = withRealTokens(s.state);
    const vb = new ViewBuilder({ sid: 'x' });
    for (const t of Object.values(state.teams)) {
      const pid = t.playerIds[0];
      if (!pid) continue;
      const v = JSON.parse(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).json) as View;
      if (!v.r2?.votedBy) continue;
      const m = state.r2.matches[state.r2.matchOfTeam[t.id]];
      const bucket = m.teamA === t.id ? m.clashes[state.clash - 1].votesA : m.clashes[state.clash - 1].votesB;
      assert.deepEqual(v.r2.votedBy, t.playerIds.map(p => bucket[p] !== undefined));
      assert.equal(v.r2.votedBy.filter(Boolean).length, v.r2.votedCount);
      assert.ok(!JSON.stringify(v.r2).includes('AMBUSH') && !JSON.stringify(v.r2).includes('TRUCE') || state.clash > 1, 'no vote content before the reveal');
      if (v.r2.votedBy.some(Boolean)) sawVotedBy = true;
    }
  }
  assert.ok(sawVotedBy);
  // after the reveal: myVotes lists every member's vote
  const after = samples.filter(x => x.state.phase === 'R2_RESULTS').at(-1)!.state;
  const { state, tokens } = withRealTokens(after);
  const vb = new ViewBuilder({ sid: 'x' });
  let saw = 0;
  for (const t of Object.values(state.teams)) {
    const pid = t.playerIds[0];
    if (!pid) continue;
    const v = JSON.parse(vb.forPlayer(state, pid, hashToken(tokens[pid]), NOW).json) as View;
    for (const c of v.r2?.clashes ?? []) {
      assert.equal(c.myVotes.length, t.playerIds.length);
      assert.match(c.myVotes, /^[TA-]+$/);
      saw++;
    }
  }
  assert.ok(saw > 20);
  // R3: honourable flag and the vessel report
  let honourable = 0;
  let report = 0;
  for (const s of samples.filter(x => x.state.phase === 'R3_ACTIVE' && x.state.step === 'REVEAL')) {
    const { state: st, tokens: tk } = withRealTokens(s.state);
    const b = new ViewBuilder({ sid: 'x' });
    for (const t of Object.values(st.teams)) {
      const pid = t.playerIds[0];
      if (!pid || !st.r3?.teams[t.id]) continue;
      const v = JSON.parse(b.forPlayer(st, pid, hashToken(tk[pid]), NOW).json) as View;
      assert.equal(v.r3?.honourable === true, st.r3.teams[t.id].honourBonus);
      if (v.r3?.honourable) honourable++;
      if (v.r3?.lastWave) {
        report++;
        assert.deepEqual(v.r3.lastWave.vessels.map(r => r[0]), ['R', 'S', 'G']);
        const total = v.r3.lastWave.vessels.reduce((a, r) => a + r[1], 0);
        assert.equal(total, st.r3.reports.at(-1)!.activeCrews);
      }
    }
  }
  assert.ok(report > 0);
  assert.ok(honourable >= 0);
});
