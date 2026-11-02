import test from 'node:test';
import assert from 'node:assert/strict';
import { formTeams, harness } from './helpers.ts';
import { previewTeamByEmoji } from '../../server/engine/index.ts';

test('join is idempotent by playerId; re-join only updates the name', () => {
  const h = harness();
  h.join('a', 'Alice');
  const role = h.state.players.a.role;
  const hash = h.state.players.a.tokenHash;
  h.ok(h.send('JOIN', { kind: 'player', playerId: 'a' }, { playerId: 'a', name: 'Alicia', tokenHash: 'other' }));
  assert.equal(h.state.playerOrder.length, 1);
  assert.equal(h.state.players.a.name, 'Alicia');
  assert.equal(h.state.players.a.role, role);
  assert.equal(h.state.players.a.tokenHash, hash);
});

test('join rejects malformed payloads and spoofed actors', () => {
  const h = harness();
  assert.equal(h.send('JOIN', { kind: 'player', playerId: 'a' }, { playerId: 'a', name: 'x' }), 'INVALID_PAYLOAD');
  assert.equal(h.send('JOIN', { kind: 'player', playerId: 'b' }, { playerId: 'a', name: 'x', tokenHash: 'h' }), 'FORBIDDEN');
  assert.equal(h.send('JOIN', { kind: 'admin' }, { playerId: 'a', name: 'x', tokenHash: 'h' }), 'FORBIDDEN');
});

test('roles are balanced: the first five joiners get five distinct roles', () => {
  const h = harness();
  for (let i = 0; i < 10; i++) h.join(`p${i}`);
  const first5 = new Set(h.state.playerOrder.slice(0, 5).map(id => h.state.players[id].role));
  assert.equal(first5.size, 5);
  const counts: Record<string, number> = {};
  for (const id of h.state.playerOrder) counts[h.state.players[id].role] = (counts[h.state.players[id].role] ?? 0) + 1;
  assert.deepEqual(Object.values(counts).sort(), [2, 2, 2, 2, 2]);
});

test('reroll works only while not in a team and always changes the role', () => {
  const h = harness();
  h.join('a');
  const before = h.state.players.a.role;
  h.ok(h.as('a', 'REROLL_ROLE'));
  assert.notEqual(h.state.players.a.role, before);
  h.ok(h.as('a', 'CREATE_TEAM', {}));
  assert.equal(h.as('a', 'REROLL_ROLE'), 'ALREADY_IN_TEAM');
});

test('create team: creator is first member, unique codes, default name', () => {
  const h = harness();
  h.join('a', 'Ann');
  h.ok(h.as('a', 'CREATE_TEAM', {}));
  const t = h.state.teams[h.state.players.a.teamId!];
  assert.deepEqual(t.playerIds, ['a']);
  assert.equal(t.name, "Ann's Crew");
  assert.match(t.battleCode, /^[1-9]\d$/);
  assert.equal(Array.from(t.emojiCode.replace(/️/g, '')).length, 3);
  assert.equal(h.as('a', 'CREATE_TEAM', {}), 'ALREADY_IN_TEAM');
});

test('team codes are unique across many teams', () => {
  const h = harness(7);
  for (let i = 0; i < 60; i++) {
    h.join(`p${i}`);
    h.ok(h.as(`p${i}`, 'CREATE_TEAM', {}));
  }
  const teams = Object.values(h.state.teams);
  assert.equal(new Set(teams.map(t => t.battleCode)).size, 60);
  assert.equal(new Set(teams.map(t => t.emojiCode)).size, 60);
});

test('join by emoji code: default crew size 5 refuses a sixth; with crew size 6 a sixth repeats a role and a seventh is refused', () => {
  const h = harness();
  const [tid] = formTeams(h, [5]);
  const code = h.state.teams[tid].emojiCode;
  h.join('x6');
  assert.equal(h.as('x6', 'JOIN_TEAM', { code }), 'TEAM_FULL');
  h.ok(h.admin('ADMIN_SET_CREW_SIZE', { size: 6 }));
  // a sixth joins and repeats a role
  h.ok(h.as('x6', 'JOIN_TEAM', { code }));
  assert.equal(h.state.teams[tid].playerIds.length, 6);
  h.join('x7');
  assert.equal(h.as('x7', 'JOIN_TEAM', { code }), 'TEAM_FULL');
  assert.equal(h.as('x7', 'JOIN_TEAM', { code: '🔥🔥🔥🔥🔥' }), 'UNKNOWN_CODE');
});

test('ROLE_TAKEN while the team has fewer than five members', () => {
  const h = harness();
  h.join('a');
  h.ok(h.as('a', 'CREATE_TEAM', {}));
  const code = h.state.teams[h.state.players.a.teamId!].emojiCode;
  // find a joiner with the same role as a
  let dup = '';
  for (let i = 0; i < 30 && !dup; i++) {
    h.join(`q${i}`);
    if (h.state.players[`q${i}`].role === h.state.players.a.role) dup = `q${i}`;
  }
  assert.ok(dup);
  assert.equal(h.as(dup, 'JOIN_TEAM', { code }), 'ROLE_TAKEN');
  assert.equal(h.state.players[dup].teamId, null);
});

test('emoji code matching ignores variation selectors and spacing', () => {
  const h = harness();
  const [tid] = formTeams(h, [1]);
  const code = h.state.teams[tid].emojiCode;
  h.join('late');
  const spaced = Array.from(code.replace(/️/g, '')).join(' ');
  h.ok(h.as('late', 'JOIN_TEAM', { code: spaced }));
});

test('leaving the last member removes the team; leave team requires membership', () => {
  const h = harness();
  h.join('a');
  assert.equal(h.as('a', 'LEAVE_TEAM'), 'NOT_IN_TEAM');
  h.ok(h.as('a', 'CREATE_TEAM', {}));
  h.ok(h.as('a', 'LEAVE_TEAM'));
  assert.equal(Object.keys(h.state.teams).length, 0);
  assert.equal(h.state.teamOrder.length, 0);
  assert.equal(h.state.players.a.teamId, null);
});

test('leave game removes the player and shrinks the team', () => {
  const h = harness();
  const [tid] = formTeams(h, [3]);
  h.ok(h.as('p0_1', 'LEAVE_GAME'));
  assert.equal(h.state.players.p0_1, undefined);
  assert.deepEqual(h.state.teams[tid].playerIds, ['p0_0', 'p0_2']);
});

test('rename team', () => {
  const h = harness();
  const [tid] = formTeams(h, [2]);
  h.ok(h.as('p0_1', 'RENAME_TEAM', { name: '  The   Wraiths ' }));
  assert.equal(h.state.teams[tid].name, 'The Wraiths');
  assert.equal(h.as('p0_1', 'RENAME_TEAM', { name: '' }), 'INVALID_PAYLOAD');
});

test('lobby team actions are refused outside the lobby', () => {
  const h = harness();
  const [tid] = formTeams(h, [3]);
  h.join('z');
  h.ok(h.admin('ADMIN_START_GAME'));
  assert.equal(h.as('z', 'CREATE_TEAM', {}), 'WRONG_PHASE');
  assert.equal(h.as('z', 'JOIN_TEAM', { code: h.state.teams[tid].emojiCode }), 'WRONG_PHASE');
  assert.equal(h.as('p0_0', 'LEAVE_TEAM'), 'WRONG_PHASE');
  assert.equal(h.as('z', 'REROLL_ROLE'), 'WRONG_PHASE');
});

test('previewTeamByEmoji is a pure selector with conflict detection', () => {
  const h = harness();
  const [tid] = formTeams(h, [3]);
  h.join('visitor');
  const r = previewTeamByEmoji(h.state, h.state.teams[tid].emojiCode, 'visitor');
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.preview.memberCount, 3);
    assert.equal(r.preview.maxMembers, 5);
    assert.equal(r.preview.isFull, false);
    const taken = h.state.teams[tid].playerIds.some(p => h.state.players[p].role === h.state.players.visitor.role);
    assert.equal(r.preview.hasRoleConflict, taken);
  }
  assert.deepEqual(previewTeamByEmoji(h.state, '', 'visitor'), { ok: false, error: 'INVALID_CODE' });
  assert.deepEqual(previewTeamByEmoji(h.state, '🔥🔥🔥🔥', 'visitor'), { ok: false, error: 'UNKNOWN_CODE' });
});

test('auto-group (N=5): crews of 5, a remainder of 2+ is its own crew, a single leftover stays unassigned', () => {
  const expected: Record<number, { sizes: number[]; unassigned: number }> = {
    1: { sizes: [], unassigned: 1 },
    2: { sizes: [2], unassigned: 0 },
    3: { sizes: [3], unassigned: 0 },
    4: { sizes: [4], unassigned: 0 },
    7: { sizes: [5, 2], unassigned: 0 },
    8: { sizes: [5, 3], unassigned: 0 },
    9: { sizes: [5, 4], unassigned: 0 },
    10: { sizes: [5, 5], unassigned: 0 },
    11: { sizes: [5, 5], unassigned: 1 },
    12: { sizes: [5, 5, 2], unassigned: 0 },
    13: { sizes: [5, 5, 3], unassigned: 0 },
    16: { sizes: [5, 5, 5], unassigned: 1 },
    200: { sizes: Array(40).fill(5), unassigned: 0 },
  };
  for (const [n, want] of Object.entries(expected)) {
    const h = harness(3);
    for (let i = 0; i < Number(n); i++) h.join(`p${i}`);
    const err = h.admin('ADMIN_AUTO_GROUP');
    if (want.sizes.length > 0) h.ok(err);
    const got = Object.values(h.state.teams)
      .map(t => t.playerIds.length)
      .sort((x, y) => y - x);
    assert.deepEqual(got, want.sizes.slice().sort((x, y) => y - x), `n=${n}`);
    assert.equal(Object.values(h.state.players).filter(p => !p.teamId).length, want.unassigned, `n=${n} unassigned`);
  }
});

test('auto-group gives distinct roles within teams of five when the role mix allows', () => {
  const h = harness(5);
  for (let i = 0; i < 100; i++) h.join(`p${i}`);
  h.ok(h.admin('ADMIN_AUTO_GROUP'));
  for (const t of Object.values(h.state.teams)) {
    const roles = new Set(t.playerIds.map(p => h.state.players[p].role));
    assert.equal(roles.size, 5);
  }
});

test('auto-group never tops up existing crews: new players form their own crew', () => {
  const h = harness();
  const [t0, t1] = formTeams(h, [5, 4]);
  h.join('s1');
  h.join('s2');
  h.ok(h.admin('ADMIN_AUTO_GROUP'));
  assert.equal(h.state.teams[t0].playerIds.length, 5);
  assert.equal(h.state.teams[t1].playerIds.length, 4);
  assert.equal(h.state.players.s1.teamId, h.state.players.s2.teamId);
  assert.equal(h.state.teams[h.state.players.s1.teamId!].playerIds.length, 2);
});
