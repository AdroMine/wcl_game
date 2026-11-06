// The recorded game data, the admin export and the "Underworld Wrapped" recap, on a simulated game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRestoredState } from '../../server/engine/index.ts';
import type { GameState, Vessel } from '../../server/engine/index.ts';
import { resolveTeamVesselChoice, calculateVoteUnanimity } from '../../server/engine/round3.ts';
import { gameStateProblem } from '../../server/persistence/validate.ts';
import { decodeVoteLog } from '../../games/underworld/analysis.ts';
import { buildGameCsv, buildGameExport, CSV_COLUMNS } from '../../games/underworld/export.ts';
import { buildRecap } from '../../games/underworld/recap.ts';
import { runSimulation } from '../sim/simulate.ts';
import { formTeams, harness, setupR3, toReveal, toVote, voteR3 } from './helpers.ts';

let cached: GameState | null = null;
function finishedGame(): GameState {
  if (!cached) {
    const r = runSimulation({ seed: 11, players: 120 });
    assert.deepEqual(r.failures, []);
    assert.equal(r.state.phase, 'FINISHED');
    cached = r.state;
  }
  return cached;
}

/** Minimal RFC 4180 parser for the checks below. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// ---- recording ---------------------------------------------------------------------------------

test('round 1: wrong guesses are counted and timed, a retry of the same guess is not counted twice, the guess is clipped', () => {
  const h = harness(5);
  formTeams(h, [3, 3]);
  h.ok(h.admin('ADMIN_START_GAME'));
  h.ok(h.admin('ADMIN_SKIP_STEP')); // briefing: the clock starts
  const tid = h.state.teamOrder[0];
  const pid = h.state.teams[tid].playerIds[0];
  const v0 = h.state.version;
  assert.equal(h.as(pid, 'R1_SUBMIT', { answer: 'nope' }), 'WRONG_ANSWER');
  assert.equal(h.state.version, v0 + 1, 'a recorded wrong guess moves the version');
  assert.equal(h.state.teams[tid].r1!.wrong.count, 1);
  assert.equal(h.as(pid, 'R1_SUBMIT', { answer: ' NOPE ' }), 'WRONG_ANSWER'); // same guess right away: a retry
  assert.equal(h.state.teams[tid].r1!.wrong.count, 1);
  h.tick(30);
  assert.equal(h.as(pid, 'R1_SUBMIT', { answer: 'x'.repeat(100) }), 'WRONG_ANSWER');
  const w = h.state.teams[tid].r1!.wrong;
  assert.equal(w.count, 2);
  assert.deepEqual(w.log[0], [0, 'nope']);
  assert.equal(w.log[1][0], 30);
  assert.equal(w.log[1][1].length, 24);
  // the other crew is untouched, and a correct answer is still accepted afterwards
  assert.equal(h.state.teams[h.state.teamOrder[1]].r1!.wrong.count, 0);
  h.ok(h.as(pid, 'R1_SUBMIT', { answer: h.state.teams[tid].r1!.codeword }));
  assert.equal(h.state.teams[tid].r1!.solved, true);
  // a stringified copy (snapshot) keeps it
  assert.deepEqual(JSON.parse(JSON.stringify(h.state)).teams[tid].r1.wrong, w);
});

test('round 3: the vote log keeps every wave of every active crew and re-derives the recorded outcome', () => {
  const s = finishedGame();
  const r3 = s.r3!;
  assert.ok(r3.reports.length >= 2);
  const decoded = decodeVoteLog(s);
  for (const rep of r3.reports) {
    for (const [tid, o] of Object.entries(rep.outcomes)) {
      const e = decoded.find(d => d.wave === rep.wave && d.teamId === tid);
      assert.ok(e, `wave ${rep.wave} crew ${tid} has a vote log entry`);
      const votes: Record<string, Vessel> = {};
      for (const v of e.votes) if (v.vessel) votes[v.playerId] = v.vessel;
      const members = e.votes.map(v => v.playerId);
      assert.equal(resolveTeamVesselChoice(votes, members), o.vessel, `vessel of ${tid} wave ${rep.wave}`);
      assert.equal(calculateVoteUnanimity(votes, members, o.vessel), o.unanimity, `unanimity of ${tid} wave ${rep.wave}`);
    }
  }
  assert.equal(decoded.length, r3.voteLog.length);
  // sim: wrong guesses were recorded
  const wrong = s.teamOrder.reduce((n, id) => n + (s.teams[id].r1?.wrong.count ?? 0), 0);
  assert.ok(wrong > 0, 'the simulation sends wrong guesses');
  for (const id of s.teamOrder) {
    const w = s.teams[id].r1!.wrong;
    assert.ok(w.log.length <= 20 && w.log.length <= w.count);
    for (const [sec] of w.log) assert.ok(sec >= 0 && sec <= 300);
  }
});

test('round 3: the roster is written only when it changes, and a changed roster stays aligned', () => {
  const { h, t } = setupR3(9, [3, 3, 3, 3]);
  toVote(h);
  for (const tid of t) voteR3(h, tid, 'ROWBOAT');
  toReveal(h);
  const first = h.state.r3!.voteLog.filter(e => e.teamId === t[0]);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].members, h.state.teams[t[0]].playerIds);
  assert.equal(first[0].votes, 'RRR');
  // wave 2: nobody in t[1] votes; the roster is unchanged, so no member list is repeated
  h.nextDeadline(); // REVEAL ends -> next wave VOTE
  toVote(h);
  for (const tid of [t[0], t[2], t[3]]) voteR3(h, tid, 'SAILBOAT');
  toReveal(h);
  const log = h.state.r3!.voteLog;
  const second = log.find(e => e.wave === 2 && e.teamId === t[1])!;
  assert.equal(second.votes, '---');
  assert.equal(second.members, undefined);
  const dec = decodeVoteLog(h.state).find(e => e.wave === 2 && e.teamId === t[0])!;
  assert.deepEqual(dec.votes.map(v => v.vessel), ['SAILBOAT', 'SAILBOAT', 'SAILBOAT']);
  assert.deepEqual(dec.votes.map(v => v.playerId), h.state.teams[t[0]].playerIds);
});

test('state growth: the new logs are small (estimate for 40 crews x 8 waves)', () => {
  const s = finishedGame();
  const waves = s.r3!.reports.length;
  const crews = s.teamOrder.length;
  const logBytes = JSON.stringify(s.r3!.voteLog).length;
  const wrongBytes = JSON.stringify(s.teamOrder.map(id => s.teams[id].r1!.wrong)).length;
  const perEntry = logBytes / Math.max(1, s.r3!.voteLog.length);
  // 40 crews x 8 waves of ~35-byte entries plus one roster (5 ids) per crew
  const estimate = Math.round(40 * 8 * perEntry);
  console.log(`voteLog: ${s.r3!.voteLog.length} entries (${crews} crews, ${waves} waves) = ${logBytes} bytes, ${perEntry.toFixed(0)} B/entry, ~${estimate} bytes for 40 x 8; wrong guesses ${wrongBytes} bytes`);
  assert.ok(estimate < 40_000, `estimated ${estimate} bytes`);
  assert.ok(wrongBytes < 40 * 600);
});

test('old snapshots without the new fields normalise, validate and still export and recap', () => {
  const s = finishedGame();
  const old = JSON.parse(JSON.stringify(s)) as GameState;
  for (const t of Object.values(old.teams)) if (t.r1) delete (t.r1 as Partial<typeof t.r1>).wrong;
  delete (old.r3 as Partial<NonNullable<GameState['r3']>>).voteLog;
  assert.equal(gameStateProblem(old), null);
  const norm = normalizeRestoredState(old);
  assert.deepEqual(norm.r3!.voteLog, []);
  for (const id of norm.teamOrder) assert.deepEqual(norm.teams[id].r1!.wrong, { count: 0, log: [] });
  assert.equal(normalizeRestoredState(norm), norm, 'nothing missing: same object');
  // even without normalising, the pure functions do not throw
  const exp = buildGameExport(old, 1) as { round3: { waves: { crews: { votes: unknown }[] }[] } };
  assert.equal(exp.round3.waves[0].crews[0].votes, null);
  assert.ok(buildGameCsv(old).length > 100);
  assert.equal(buildRecap(old).crews.length, s.teamOrder.length);
});

// ---- export -------------------------------------------------------------------------------------

test('export.json: complete, tidy, and free of token hashes', () => {
  const s = finishedGame();
  const doc = buildGameExport(s, 1_700_000_000_000) as Record<string, any>;
  const text = JSON.stringify(doc);
  for (const p of Object.values(s.players)) assert.ok(!text.includes(p.tokenHash), 'no token hash');
  assert.ok(!text.includes('tokenHash'));
  assert.equal(doc.format, 1);
  assert.equal(doc.game_meta.crews, s.teamOrder.length);
  assert.equal(doc.crews.length, s.teamOrder.length);
  assert.ok(doc.crews[0].members.length >= 3 && doc.crews[0].members[0].name);
  assert.equal(doc.round1.length, s.teamOrder.length);
  assert.ok(doc.round1.some((r: any) => r.wrongGuessCount > 0));
  // round 2: every resolved clash, every member listed with a vote or null
  const resolved = Object.values(s.r2.matches).reduce((n, m) => n + m.clashes.filter(c => c.resolved).length, 0);
  assert.equal(doc.round2.clashes.length, resolved);
  for (const c of doc.round2.clashes) {
    assert.ok(['TRUCE', 'AMBUSH'].includes(c.crewA.stance));
    assert.equal(c.crewA.votes.length, s.teams[c.crewA.id].playerIds.length);
    assert.ok(['MUTUAL_TRUCE', 'BETRAYER', 'BETRAYED', 'BRAWL'].includes(c.outcomeA));
  }
  // round 3: per wave per active crew, with per-player votes
  assert.equal(doc.round3.waves.length, s.r3!.reports.length);
  for (const w of doc.round3.waves) for (const c of w.crews) assert.equal(c.votes.length, c.votes.filter((v: any) => v.name).length);
  assert.equal(doc.suddenDeath.length, s.r3!.sdHistory.length);
  assert.equal(doc.timeline.length, s.phaseLog.length);
  assert.equal(doc.standings.length, s.teamOrder.length);
  assert.equal(doc.standings[0].rank, 1);
  assert.equal(doc.podium.length, Math.min(3, s.r3!.escapeOrder.length));
  assert.deepEqual(JSON.parse(text), doc, 'plain JSON');
});

test('export.csv: one row per vote or action, fixed columns, quoted and defused text', () => {
  const s = finishedGame();
  const text = buildGameCsv(s);
  assert.ok(text.startsWith('﻿'));
  const rows = parseCsv(text.slice(1));
  assert.deepEqual(rows[0], [...CSV_COLUMNS]);
  assert.ok(rows.length > 500);
  for (const r of rows) assert.equal(r.length, CSV_COLUMNS.length, JSON.stringify(r));
  const body = rows.slice(1);
  const col = (n: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(n);
  assert.ok(body.some(r => r[col('round')] === '1' && r[col('action')] === 'WRONG_GUESS'));
  const r2 = body.filter(r => r[col('round')] === '2' && r[col('action')] === 'VOTE');
  const members = Object.values(s.r2.matches).reduce((n, m) => n + m.clashes.filter(c => c.resolved).length * (s.teams[m.teamA].playerIds.length + s.teams[m.teamB].playerIds.length), 0);
  assert.equal(r2.length, members);
  const r3 = body.filter(r => r[col('round')] === '3' && r[col('action')] === 'VOTE');
  assert.equal(r3.length, decodeVoteLog(s).reduce((n, e) => n + e.votes.length, 0));
  assert.ok(r3.every(r => ['ROWBOAT', 'SAILBOAT', 'GHOST_SHIP', 'ABSTAIN'].includes(r[col('choice')])));
  assert.ok(!text.includes('tokenHash') && Object.values(s.players).every(p => !text.includes(p.tokenHash)));
  // a name that starts like a formula is defused
  const evil = JSON.parse(JSON.stringify(s)) as GameState;
  const pid = evil.playerOrder[0];
  evil.players[pid].name = '=HYPERLINK("http://x","a,b")';
  const rows2 = parseCsv(buildGameCsv(evil).slice(1));
  const hit = rows2.find(r => r[col('player_id')] === pid)!;
  assert.equal(hit[col('player')], `'=HYPERLINK("http://x","a,b")`);
});

// ---- recap --------------------------------------------------------------------------------------

test('recap: crew-level only, deterministic, small, and consistent with the game', () => {
  const s = finishedGame();
  const a = buildRecap(s);
  const b = buildRecap(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(a, b, 'same state, same recap');
  const text = JSON.stringify(a);
  assert.deepEqual(JSON.parse(text), a);
  for (const p of Object.values(s.players)) {
    assert.ok(!text.includes(p.id), 'no player id');
    assert.ok(!text.includes(p.name), 'no player name');
    assert.ok(!text.includes(p.tokenHash));
  }
  assert.ok(!text.includes('codeword'));
  assert.ok(text.length < 60_000, `recap ${text.length} bytes`);
  assert.equal(a.crews.length, s.teamOrder.length);
  assert.deepEqual(a.crews.map(c => c.rank), a.crews.map((_, i) => i + 1));

  // betrayal and dilemma add up
  const withRival = a.crews.filter(c => c.rival >= 0).length;
  for (let c = 0; c < 3; c++) {
    const d = a.dilemma[c];
    assert.equal(d.mutualTruce + d.betrayer + d.betrayed + d.brawl + d.bye, a.crews.filter(x => x.outcomes[c] !== '-').length);
    assert.equal(d.betrayer, d.betrayed, 'each betrayal has a victim');
    assert.equal(a.betrayal[c].truce + a.betrayal[c].ambush, withRival, `clash ${c + 1} stances`);
  }
  for (const f of a.flows) assert.equal(f.tt + f.ta + f.at + f.aa, withRival);
  assert.equal(Object.values(a.moral).reduce((x, y) => x + y, 0), a.crews.length);

  // fleet and race
  assert.equal(a.fleet.length, s.r3!.reports.length);
  for (const f of a.fleet) assert.equal(f.rowboat + f.sailboat + f.ghost, s.r3!.reports[f.wave - 1].activeCrews);
  for (const c of a.crews) {
    assert.equal(c.metres.length, a.race.waves + 1);
    assert.equal(c.ranks.length, a.race.waves + 1);
    assert.equal(c.boats.length, a.race.waves);
  }
  for (let w = 0; w <= a.race.waves; w++) assert.deepEqual(a.crews.map(c => c.ranks[w]).sort((x, y) => x - y), a.crews.map((_, i) => i + 1), `ranks are a permutation at step ${w}`);
  assert.deepEqual(a.podium.map(i => a.crews[i].escape), a.podium.map((_, i) => i + 1));
  assert.ok(a.ghost.soloCrews <= a.ghost.crews);

  // tablet
  assert.equal(a.tablet.solved, s.teamOrder.filter(id => s.teams[id].r1?.solved).length);
  assert.equal(a.tablet.wrongTotal, a.crews.reduce((n, c) => n + c.wrong, 0));

  // awards: crew-level, unique ids, referenced both ways, none for a missing qualifier
  assert.ok(a.awards.length >= 2);
  assert.equal(new Set(a.awards.map(x => x.id)).size, a.awards.length);
  for (const aw of a.awards) {
    assert.ok(aw.crew >= 0 && aw.crew < a.crews.length);
    assert.ok(a.crews[aw.crew].awards.includes(aw.id));
    assert.ok(aw.stat.length > 0);
  }
  const fastest = a.awards.find(x => x.id === 'tablet');
  if (fastest) assert.equal(a.crews[fastest.crew].solveSeconds, a.tablet.fastestSeconds);
  const treach = a.awards.find(x => x.id === 'treacherous');
  if (treach) assert.ok(a.crews.every(c => (c.stances.match(/A/g) ?? []).length <= (a.crews[treach.crew].stances.match(/A/g) ?? []).length));

  // headlines: computed sentences
  assert.ok(a.headlines.length >= 3);
  assert.ok(a.headlines.some(x => /chose to betray/.test(x)));
  assert.ok(a.headlines.every(x => x.length > 5 && !x.includes('undefined') && !x.includes('NaN')));
  assert.equal(a.teaser.title, 'A Christmas game is coming');
});

test('recap: an empty or unplayed game gives an empty but valid recap (no awards, no headlines that lie)', () => {
  const h = harness(3);
  const r = buildRecap(h.state);
  assert.equal(r.crews.length, 0);
  assert.equal(r.awards.length, 0);
  assert.equal(r.fleet.length, 0);
  assert.deepEqual(r.headlines, []);
  assert.ok(buildGameCsv(h.state).length > 10);
  assert.equal((buildGameExport(h.state, 0) as { crews: unknown[] }).crews.length, 0);
});

test('recap front page: medals, clash tiles, river tiles, headline and quote agree with the game', () => {
  const s = finishedGame();
  const a = buildRecap(s);
  const f = a.front;
  assert.equal(f.crews, s.teamOrder.length);
  assert.equal(f.shades, s.playerOrder.length);
  assert.deepEqual(f.medals.map(m => m.place), a.podium.map((_, i) => i + 1));
  assert.deepEqual(f.medals.map(m => m.crew), a.podium);
  for (const m of f.medals) {
    assert.equal(m.wave, s.r3!.teams[s.teamOrder.find(id => s.teams[id].name === a.crews[m.crew].name)!]?.escapedInWave ?? m.wave);
    assert.ok(m.wave === null || (m.wave >= 1 && m.wave <= a.race.waves));
  }
  // every counted clash is exactly one of the three outcomes; honourable crews match the moral wall
  const r2 = f.round2;
  assert.equal(r2.clashes, r2.bothTruce + r2.backstab + r2.bothAmbush);
  assert.equal(r2.backstab, a.dilemma.reduce((n, d) => n + d.betrayed, 0));
  assert.equal(r2.honourable, a.moral.HONOURABLE);
  // river tiles
  const r3 = f.round3;
  assert.equal(r3.waves, a.race.waves);
  assert.equal(r3.ghostAttempts, a.ghost.boardings);
  assert.equal(r3.ghostCrashed, a.ghost.collisions);
  assert.ok(r3.ghostCrashed <= r3.ghostAttempts);
  assert.equal(r3.ghostMadeIt.length, a.ghost.soloCrews);
  assert.equal(r3.sailboatCapsizedWaves, a.fleet.filter(x => x.capsized).length);
  assert.equal(r3.sailboatSunk, a.fleet.reduce((n, x) => n + (x.capsized ? x.sailboat : 0), 0));
  // headline: Gold crew in curly quotes, phrase follows the share of ambush stances
  const ambush = a.betrayal.reduce((n, b) => n + b.ambush, 0);
  const all = a.betrayal.reduce((n, b) => n + b.truce + b.ambush, 0);
  const gold = a.crews[f.medals[0].crew];
  assert.ok(f.headline.startsWith(`“${gold.name}” escapes first as `));
  assert.equal(f.headline.endsWith('the room turns on itself'), ambush * 2 >= all);
  assert.equal(f.kicker, ambush * 2 >= all ? 'BETRAYAL IN TARTARUS' : 'HONOUR AMONG SHADES');
  assert.ok(f.dek.includes('crews'));
  // closing quote: the Most Treacherous award winner, never "broke a truce"
  const treach = a.awards.find(x => x.id === 'treacherous');
  if (treach) {
    assert.equal(f.quote?.crew, treach.crew);
    assert.equal(f.quote?.line, `“${a.crews[treach.crew].name}” ${treach.stat}.`);
  }
  assert.ok(!JSON.stringify(f).includes('broke a truce'));
  for (const p of Object.values(s.players)) assert.ok(!JSON.stringify(f).includes(p.name) || a.crews.some(c => c.name.includes(p.name)));
});

test('recap front page: an unplayed game has no medals, no tiles and no quote, and a Round 1 only game keeps the page valid', () => {
  const h = harness(3);
  const f = buildRecap(h.state).front;
  assert.deepEqual(f.medals, []);
  assert.equal(f.round2.clashes, 0);
  assert.equal(f.round3.waves, 0);
  assert.equal(f.quote, null);
  assert.equal(f.headline, 'Nobody has escaped Tartarus yet');
});

test('recap: The True Angel needs truce in every clash AND at least one betrayal; ties name every crew', () => {
  const base = finishedGame();
  /** Every match plays all-truce except the listed ones, where side A stays faithful and side B ambushes the first `n` clashes. */
  const build = (betrayedMatches: number[]) => {
    const s: GameState = JSON.parse(JSON.stringify(base));
    const ms = Object.values(s.r2.matches).filter(m => m.clashes.length >= 3 && m.clashes.every(c => c.resolved));
    ms.forEach((m, k) => {
      m.clashes.forEach(c => {
        c.stanceA = 'TRUCE';
        c.stanceB = betrayedMatches.includes(k) && c.clash === 1 ? 'AMBUSH' : 'TRUCE';
      });
    });
    return { s, ms };
  };
  const angel = (s: GameState) => buildRecap(s).awards.find(a => a.id === 'saints');

  assert.equal(angel(build([]).s), undefined, 'faithful but never betrayed: no award');

  const one = build([0]);
  const win = angel(one.s)!;
  assert.ok(win, 'faithful and betrayed once: award');
  assert.equal(buildRecap(one.s).crews[win.crew].name, one.s.teams[one.ms[0].teamA].name);
  assert.equal(win.title, 'The True Angel');

  const two = build([0, 1]);
  const tie = angel(two.s)!;
  const r2 = buildRecap(two.s);
  const names = [tie.crew, ...(tie.tied ?? [])].map(c => r2.crews[c].name);
  for (const m of [0, 1]) assert.ok(names.includes(two.s.teams[two.ms[m].teamA].name), 'tie lists both crews');
});
