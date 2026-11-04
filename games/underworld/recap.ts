// "Underworld Wrapped": the crew-level recap computed from the final game state. A pure function of a
// GameState (no clock, no randomness, no I/O), served as one public JSON document by GET /api/recap once
// the game is FINISHED. It holds crew names and emblems (already public on the projector) and crew-level
// statistics only: never a player name, id, token or any individual vote. Every list is in a fixed order and
// every tie is broken by final rank, so the same state always gives the same recap.
import type { GameState, MoralStatus, Vessel } from '../../server/engine/types.ts';
import { R2_CLASHES } from './rounds/mist/content.ts';
import { R3 } from './rounds/styx/content.ts';
import { clashSides, finalRanking, finishedAt } from './analysis.ts';
import type { ClashOutcome } from './analysis.ts';
import { AWARDS, FRONT_PAGE, RECAP_SUBTITLE, RECAP_TITLE, SLIDE_TITLES, TEASER } from './recapContent.ts';

export const RECAP_FORMAT = 2;

/** One crew. Every other list in the recap refers to crews by their index in `crews` (final rank order, 0 = first). */
export interface RecapCrew {
  name: string;
  /** The crew's 3-emoji team code (unique); phones find their own crew with it. */
  emoji: string;
  rank: number;
  score: number;
  r1Points: number;
  r2Points: number;
  /** One character per clash: T truce, A ambush, - no stance (unpaired or unplayed). */
  stances: string;
  /** One character per clash: M mutual truce, B betrayer (this crew ambushed a truce), D betrayed, F brawl, Y bye, - none. */
  outcomes: string;
  rival: number;
  moral: MoralStatus;
  /** Round 1: seconds to solve (null: not solved), wrong guesses, hints taken. */
  solveSeconds: number | null;
  wrong: number;
  hints: number;
  /** One character per wave: R, S, G the boat the crew took, - not sailing (already escaped). */
  boats: string;
  /** One character per wave: X the boat crashed (capsized or collided), . no crash or not sailing. */
  crashes: string;
  /** Metres after each wave (index 0 = the start). */
  metres: number[];
  /** Rank on the river after each wave (index 0 = the start). */
  ranks: number[];
  /** Average vote unanimity over the waves it sailed, 0 to 1 (null when it never sailed). */
  unanimity: number | null;
  /** Escape place (1 = Gold), 0 when it did not escape. */
  escape: number;
  awards: string[];
}

export interface RecapAward {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  crew: number;
  /** A short computed line, e.g. "ambushed 3 of 3 clashes". */
  stat: string;
}

/** One escape place on the front page. */
export interface FrontMedal {
  /** Crew index. */
  crew: number;
  /** 1 Gold, 2 Silver, 3 Bronze. */
  place: number;
  /** Wave in which the crew escaped (null when unknown). */
  wave: number | null;
  /** True when a Sudden Death involving this crew helped settle the places. */
  suddenDeath: boolean;
}

/** Everything "The Underworld Times" front page prints, crew-level only. The words come from recapContent.ts. */
export interface FrontPage {
  masthead: string;
  /** Edition line before the date, e.g. "VOL. I". */
  volume: string;
  kicker: string;
  /** Headline with the Gold crew's name in curly quotes. */
  headline: string;
  dek: string;
  next: string;
  crews: number;
  shades: number;
  medals: FrontMedal[];
  round2: { clashes: number; bothTruce: number; backstab: number; bothAmbush: number; honourable: number };
  round3: {
    waves: number;
    ghostAttempts: number;
    ghostCrashed: number;
    /** Crew indexes whose Ghost Ship got through alone. */
    ghostMadeIt: number[];
    sailboatSunk: number;
    sailboatCapsizedWaves: number;
  };
  /** Closing quote: the Most Treacherous crew (or the Saints), null when neither award exists. */
  quote: { label: string; crew: number; line: string } | null;
}

export interface RecapData {
  format: number;
  game: string;
  title: string;
  subtitle: string;
  version: number;
  finishedAt: number | null;
  players: number;
  crews: RecapCrew[];
  headlines: string[];
  /** Per clash: how many crews chose Truce and Ambush. */
  betrayal: { clash: number; truce: number; ambush: number }[];
  /** Clash c to c+1: how many crews went Truce>Truce (tt), Truce>Ambush (ta), Ambush>Truce (at), Ambush>Ambush (aa). */
  flows: { from: number; to: number; tt: number; ta: number; at: number; aa: number }[];
  /** Per clash, crews by outcome. */
  dilemma: { clash: number; mutualTruce: number; betrayer: number; betrayed: number; brawl: number; bye: number }[];
  moral: Record<MoralStatus, number>;
  fleet: { wave: number; active: number; rowboat: number; sailboat: number; ghost: number; capacity: number; capsized: boolean; collided: boolean; ghostSolo: number }[];
  ghost: { crews: number; boardings: number; collisions: number; solo: number; soloCrews: number };
  race: { waves: number; target: number; leashes: { wave: number; holder: number; target: number; kind: string; holderDelta: number; targetDelta: number }[] };
  tablet: { crews: number; solved: number; fastestSeconds: number | null; medianSeconds: number | null; wrongTotal: number };
  awards: RecapAward[];
  /** Crew indexes of the three escape places, Gold first. */
  podium: number[];
  teaser: { title: string; lines: string[] };
  slideTitles: Record<string, string>;
  front: FrontPage;
}

const OUTCOME_CHAR: Record<ClashOutcome, string> = { MUTUAL_TRUCE: 'M', BETRAYER: 'B', BETRAYED: 'D', BRAWL: 'F', BYE: 'Y' };
const VESSEL_CHAR: Record<Vessel, string> = { ROWBOAT: 'R', SAILBOAT: 'S', GHOST_SHIP: 'G' };

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);

export function buildRecap(s: GameState): RecapData {
  const ranking = finalRanking(s);
  const idxOf = new Map(ranking.map((r, i) => [r.teamId, i] as const));
  const ix = (teamId: string | null): number => (teamId == null ? -1 : (idxOf.get(teamId) ?? -1));
  const ids = ranking.map(r => r.teamId);
  const nClash = R2_CLASHES;

  // ---- Round 2 -----------------------------------------------------------------------
  const sides = clashSides(s);
  const stanceStr: string[][] = ids.map(() => Array.from({ length: nClash }, () => '-'));
  const outStr: string[][] = ids.map(() => Array.from({ length: nClash }, () => '-'));
  const rivalOf: number[] = ids.map(() => -1);
  const betrayal = Array.from({ length: nClash }, (_, i) => ({ clash: i + 1, truce: 0, ambush: 0 }));
  const dilemma = Array.from({ length: nClash }, (_, i) => ({ clash: i + 1, mutualTruce: 0, betrayer: 0, betrayed: 0, brawl: 0, bye: 0 }));
  for (const x of sides) {
    const i = ix(x.teamId);
    if (i < 0 || x.clash < 1 || x.clash > nClash) continue;
    const c = x.clash - 1;
    if (x.stance) {
      stanceStr[i][c] = x.stance === 'AMBUSH' ? 'A' : 'T';
      if (x.stance === 'AMBUSH') betrayal[c].ambush++;
      else betrayal[c].truce++;
    }
    outStr[i][c] = OUTCOME_CHAR[x.outcome];
    const d = dilemma[c];
    if (x.outcome === 'MUTUAL_TRUCE') d.mutualTruce++;
    else if (x.outcome === 'BETRAYER') d.betrayer++;
    else if (x.outcome === 'BETRAYED') d.betrayed++;
    else if (x.outcome === 'BRAWL') d.brawl++;
    else d.bye++;
    if (x.rivalId) rivalOf[i] = ix(x.rivalId);
  }
  const flows: RecapData['flows'] = [];
  for (let c = 0; c + 1 < nClash; c++) {
    const f = { from: c + 1, to: c + 2, tt: 0, ta: 0, at: 0, aa: 0 };
    for (let i = 0; i < ids.length; i++) {
      const a = stanceStr[i][c];
      const b = stanceStr[i][c + 1];
      if (a === 'T' && b === 'T') f.tt++;
      else if (a === 'T' && b === 'A') f.ta++;
      else if (a === 'A' && b === 'T') f.at++;
      else if (a === 'A' && b === 'A') f.aa++;
    }
    flows.push(f);
  }
  const moral: Record<MoralStatus, number> = { HONOURABLE: 0, BETRAYED: 0, AGGRESSOR: 0, BLOOD_FEUD: 0, NONE: 0 };
  for (const id of ids) moral[s.r2.moral[id]?.status ?? 'NONE']++;

  // ---- Round 3 -----------------------------------------------------------------------
  const reports = s.r3?.reports ?? [];
  const W = reports.length;
  const boats: string[][] = ids.map(() => Array.from({ length: W }, () => '-'));
  const crash: string[][] = ids.map(() => Array.from({ length: W }, () => '.'));
  const metres: number[][] = ids.map(id => [s.r3?.teams[id]?.startDistance ?? 0]);
  const unanSum: number[] = ids.map(() => 0);
  const unanN: number[] = ids.map(() => 0);
  const splitWaves: number[] = ids.map(() => 0);
  const ghostBoardings: number[] = ids.map(() => 0);
  const ghostCrashes: number[] = ids.map(() => 0);
  const escRank = new Map<string, number>();
  const rankHist: number[][] = ids.map(() => []);

  /** Standing on the river: escaped crews by escape place, then by metres, then by final rank. */
  const standing = (placed: Map<string, number>, dist: number[]): number[] => {
    const order = ids.map((_, i) => i);
    order.sort((a, b) => {
      const pa = placed.get(ids[a]);
      const pb = placed.get(ids[b]);
      if (pa !== undefined || pb !== undefined) {
        if (pa === undefined) return 1;
        if (pb === undefined) return -1;
        if (pa !== pb) return pa - pb;
      }
      return dist[b] - dist[a] || a - b;
    });
    const rank: number[] = [];
    order.forEach((crew, r) => (rank[crew] = r + 1));
    return rank;
  };
  const last = (i: number) => metres[i][metres[i].length - 1];
  standing(escRank, ids.map((_, i) => last(i))).forEach((r, i) => rankHist[i].push(r));

  const fleet: RecapData['fleet'] = [];
  const leashes: RecapData['race']['leashes'] = [];
  const everGhost = new Set<number>();
  const soloCrews = new Set<number>();
  let collisions = 0;
  let solo = 0;
  reports.forEach((rep, w) => {
    const counts = { ROWBOAT: 0, SAILBOAT: 0, GHOST_SHIP: 0 } as Record<Vessel, number>;
    for (let i = 0; i < ids.length; i++) {
      const o = rep.outcomes[ids[i]];
      if (!o) {
        metres[i].push(last(i));
        continue;
      }
      counts[o.vessel]++;
      boats[i][w] = VESSEL_CHAR[o.vessel];
      const crashed = (o.vessel === 'SAILBOAT' && rep.sailboatCapsized) || (o.vessel === 'GHOST_SHIP' && rep.ghostCollided);
      if (crashed) crash[i][w] = 'X';
      if (o.vessel === 'GHOST_SHIP') {
        ghostBoardings[i]++;
        everGhost.add(i);
        if (rep.ghostCollided) ghostCrashes[i]++;
      }
      unanSum[i] += o.unanimity;
      unanN[i]++;
      if (o.unanimity < 0.999) splitWaves[i]++;
      metres[i].push(o.newDistance);
      if (o.escaped && o.escapeRank != null && !escRank.has(ids[i])) escRank.set(ids[i], o.escapeRank);
    }
    const gs = ix(rep.ghostSoloTeamId);
    if (gs >= 0) {
      solo++;
      soloCrews.add(gs);
    }
    if (rep.ghostCollided) collisions += counts.GHOST_SHIP;
    fleet.push({
      wave: rep.wave,
      active: rep.activeCrews,
      rowboat: counts.ROWBOAT,
      sailboat: counts.SAILBOAT,
      ghost: counts.GHOST_SHIP,
      capacity: rep.sailboatCapacity,
      capsized: rep.sailboatCapsized,
      collided: rep.ghostCollided,
      ghostSolo: gs,
    });
    for (const e of rep.leashEvents) leashes.push({ wave: rep.wave, holder: ix(e.holder), target: ix(e.target), kind: e.kind, holderDelta: e.holderDelta, targetDelta: e.targetDelta });
    // The last wave uses the final escape order (a Sudden Death can swap two places).
    if (w === W - 1) for (const [tid, t3] of Object.entries(s.r3?.teams ?? {})) if (t3.escapeRank != null) escRank.set(tid, t3.escapeRank);
    standing(escRank, ids.map((_, i) => last(i))).forEach((r, i) => rankHist[i].push(r));
  });

  // ---- Round 1 -----------------------------------------------------------------------
  const solved = ids.filter(id => s.teams[id].r1?.solved && s.teams[id].r1?.solveSeconds != null);
  const solveTimes = solved.map(id => s.teams[id].r1!.solveSeconds as number).sort((a, b) => a - b);

  // ---- crews -------------------------------------------------------------------------
  const crews: RecapCrew[] = ids.map((id, i) => {
    const t = s.teams[id];
    return {
      name: t.name,
      emoji: t.emojiCode,
      rank: i + 1,
      score: t.score,
      r1Points: t.r1Points,
      r2Points: t.r2Points,
      stances: stanceStr[i].join(''),
      outcomes: outStr[i].join(''),
      rival: rivalOf[i],
      moral: s.r2.moral[id]?.status ?? 'NONE',
      solveSeconds: t.r1?.solved ? (t.r1.solveSeconds ?? null) : null,
      wrong: t.r1?.wrong?.count ?? 0,
      hints: t.r1?.hintsTaken.length ?? 0,
      boats: boats[i].join(''),
      crashes: crash[i].join(''),
      metres: metres[i],
      ranks: rankHist[i],
      unanimity: unanN[i] > 0 ? Math.round((unanSum[i] / unanN[i]) * 100) / 100 : null,
      escape: s.r3?.teams[id]?.escapeRank ?? 0,
      awards: [],
    };
  });

  // ---- awards (crew-level only; ties go to the better final rank) ---------------------
  const awards: RecapAward[] = [];
  const give = (id: string, crew: number, stat: string): void => {
    const def = AWARDS[id];
    if (!def || crew < 0) return;
    awards.push({ id, title: def.title, emoji: def.emoji, blurb: def.blurb, crew, stat });
    crews[crew].awards.push(id);
  };
  /** Index of the best crew by a numeric score (higher wins), only among crews with a score >= min; ties: lowest index. */
  const best = (score: (i: number) => number, min: number): number => {
    let bi = -1;
    let bs = -Infinity;
    for (let i = 0; i < ids.length; i++) {
      const v = score(i);
      if (v >= min && v > bs) {
        bs = v;
        bi = i;
      }
    }
    return bi;
  };
  const count = (str: string, ch: string) => str.split(ch).length - 1;

  {
    const i = best(c => count(crews[c].stances, 'A') * 100 + count(crews[c].outcomes, 'B'), 200);
    if (i >= 0) give('treacherous', i, `ambushed in ${count(crews[i].stances, 'A')} of ${count(crews[i].stances, 'A') + count(crews[i].stances, 'T')} clashes`);
  }
  {
    const faithful = (c: number) => crews[c].rival >= 0 && count(crews[c].stances, 'T') === nClash;
    const i = best(c => (faithful(c) ? 1 + count(crews[c].outcomes, 'D') : -1), 1);
    if (i >= 0) {
      const n = crews.filter((_, c) => faithful(c)).length;
      const b = count(crews[i].outcomes, 'D');
      give('saints', i, `Truce all ${nClash} clashes${b > 0 ? `, betrayed ${b === 1 ? 'once' : `${b} times`}` : ''} (${plural(n, 'crew')} kept the faith)`);
    }
  }
  {
    const i = best(c => ghostCrashes[c] * 100 + ghostBoardings[c], 100);
    if (i >= 0) give('kamikaze', i, `${plural(ghostCrashes[i], 'Ghost Ship collision')} in ${plural(ghostBoardings[i], 'attempt')}`);
  }
  {
    // Biggest leash swing (holder gain plus the target's loss); the earliest wave wins a tie.
    let bi = -1;
    let bv = 0;
    let bl: RecapData['race']['leashes'][number] | null = null;
    for (const l of leashes) {
      if (l.holderDelta <= 0 || l.holder < 0) continue;
      const v = l.holderDelta - l.targetDelta;
      if (v > bv) {
        bv = v;
        bi = l.holder;
        bl = l;
      }
    }
    if (bl && bi >= 0) give('revenge', bi, `+${bl.holderDelta} m for them, ${bl.targetDelta} m for ${bl.target >= 0 ? crews[bl.target].name : 'their nemesis'} in wave ${bl.wave}`);
  }
  {
    let bi = -1;
    let bv = 0.8;
    for (let i = 0; i < ids.length; i++) {
      const u = crews[i].unanimity;
      if (u !== null && unanN[i] >= 2 && u < bv) {
        bv = u;
        bi = i;
      }
    }
    if (bi >= 0) give('divided', bi, `${Math.round(bv * 100)}% agreement, split in ${splitWaves[bi]} of ${unanN[bi]} waves`);
  }
  {
    const i = best(c => (W > 0 ? crews[c].ranks[0] - crews[c].ranks[crews[c].ranks.length - 1] : 0), 2);
    if (i >= 0) give('comeback', i, `from ${ordinal(crews[i].ranks[0])} to ${ordinal(crews[i].ranks[crews[i].ranks.length - 1])} on the river`);
  }
  {
    let bi = -1;
    for (let i = 0; i < ids.length; i++) {
      const sec = crews[i].solveSeconds;
      if (sec === null) continue;
      const cur = bi < 0 ? null : crews[bi];
      if (!cur || sec < (cur.solveSeconds as number) || (sec === cur.solveSeconds && crews[i].hints < cur.hints)) bi = i;
    }
    if (bi >= 0) give('tablet', bi, `${crews[bi].solveSeconds} s${crews[bi].hints === 0 ? ', no hints' : ''}`);
  }

  // ---- headlines ---------------------------------------------------------------------
  const headlines: string[] = [];
  const played = betrayal.filter(b => b.truce + b.ambush > 0);
  if (played.length > 0) {
    const l = played[played.length - 1];
    const f = played[0];
    const lastPct = pct(l.ambush, l.truce + l.ambush);
    headlines.push(lastPct === 0 ? `Not one crew chose to betray in clash ${l.clash}.` : lastPct === 100 ? `By clash ${l.clash}, every crew chose to betray.` : `By clash ${l.clash}, ${lastPct}% of the room chose to betray.`);
    if (played.length > 1 && l.ambush !== f.ambush) {
      const a = pct(f.ambush, f.truce + f.ambush);
      const b = pct(l.ambush, l.truce + l.ambush);
      headlines.push(a !== b ? `Betrayal ${b > a ? 'climbed' : 'fell'} from ${a}% in clash ${f.clash} to ${b}% in clash ${l.clash}.` : '');
    }
  }
  if (everGhost.size > 0) {
    headlines.push(`${plural(everGhost.size, 'crew')} gambled on the Ghost Ship. ${soloCrews.size === 0 ? 'None made it.' : `${soloCrews.size} made it.`}`);
  }
  if (ids.length > 0 && s.teams[ids[0]]?.r1) {
    headlines.push(
      `${solved.length} of ${plural(ids.length, 'crew')} cracked the tablet${solveTimes.length > 0 ? `. The fastest took ${solveTimes[0]} seconds.` : '.'}`,
    );
  }
  if (moral.HONOURABLE > 0) headlines.push(`${plural(moral.HONOURABLE, 'crew')} kept honour through every clash.`);
  if (W > 0) {
    const caps = fleet.filter(f => f.capsized).length;
    if (caps > 0) headlines.push(`The Sailboat capsized in ${caps} of ${plural(W, 'wave')}.`);
  }
  const leashHits = leashes.filter(l => l.holderDelta > 0).length;
  if (leashHits > 0) headlines.push(`${plural(leashHits, 'Stygian Leash', 'Stygian Leashes')} landed.`);
  const escaped = crews.filter(c => c.escape > 0).length;
  if (W > 0) headlines.push(`${plural(escaped, 'crew')} escaped Tartarus in ${plural(W, 'wave')}.`);

  const podium = [1, 2, 3].map(p => crews.findIndex(c => c.escape === p)).filter(i => i >= 0);

  // ---- front page ----------------------------------------------------------------------
  const sumOf = (k: 'mutualTruce' | 'betrayer' | 'brawl') => dilemma.reduce((a, x) => a + x[k], 0);
  const bothTruce = Math.round(sumOf('mutualTruce') / 2);
  const backstab = sumOf('betrayer');
  const bothAmbush = Math.round(sumOf('brawl') / 2);
  const stanceTotal = betrayal.reduce((a, b) => a + b.truce + b.ambush, 0);
  const ambushTotal = betrayal.reduce((a, b) => a + b.ambush, 0);
  const turnsOnItself = stanceTotal > 0 && ambushTotal * 2 >= stanceTotal;
  const sdTeams = new Set<string>();
  for (const sd of s.r3?.sdHistory ?? []) {
    if (!sd.resolved) continue;
    sdTeams.add(sd.teamA);
    sdTeams.add(sd.teamB);
  }
  const medals: FrontMedal[] = podium.map(i => ({
    crew: i,
    place: crews[i].escape,
    wave: s.r3?.teams[ids[i]]?.escapedInWave ?? null,
    suddenDeath: sdTeams.has(ids[i]),
  }));
  const trs = awards.find(a => a.id === 'treacherous');
  const sts = awards.find(a => a.id === 'saints');
  let quote: FrontPage['quote'] = null;
  if (trs) quote = { label: FRONT_PAGE.quoteTreacherousLabel, crew: trs.crew, line: `“${crews[trs.crew].name}” ${trs.stat}.` };
  else if (sts) quote = { label: FRONT_PAGE.quoteSaintsLabel, crew: sts.crew, line: `“${crews[sts.crew].name}” kept the truce in all ${nClash} clashes.` };
  const gold = medals.find(m => m.place === 1);
  const front: FrontPage = {
    masthead: FRONT_PAGE.masthead,
    volume: FRONT_PAGE.volume,
    kicker: turnsOnItself ? FRONT_PAGE.kickerBetrayal : FRONT_PAGE.kickerHonour,
    headline: gold
      ? `“${crews[gold.crew].name}” ${FRONT_PAGE.escapesFirst} ${turnsOnItself ? FRONT_PAGE.roomBetrays : FRONT_PAGE.roomKeepsPeace}`
      : FRONT_PAGE.noWinnerHeadline,
    dek: FRONT_PAGE.dek.replace('{crews}', plural(ids.length, 'crew')),
    next: FRONT_PAGE.next,
    crews: ids.length,
    shades: s.playerOrder.length,
    medals,
    round2: { clashes: bothTruce + backstab + bothAmbush, bothTruce, backstab, bothAmbush, honourable: moral.HONOURABLE },
    round3: {
      waves: W,
      ghostAttempts: ghostBoardings.reduce((a, b) => a + b, 0),
      ghostCrashed: collisions,
      ghostMadeIt: [...soloCrews].sort((a, b) => a - b),
      sailboatSunk: fleet.reduce((a, f) => a + (f.capsized ? f.sailboat : 0), 0),
      sailboatCapsizedWaves: fleet.filter(f => f.capsized).length,
    },
    quote,
  };

  return {
    format: RECAP_FORMAT,
    game: 'underworld',
    title: RECAP_TITLE,
    subtitle: RECAP_SUBTITLE,
    version: s.version,
    finishedAt: finishedAt(s),
    players: s.playerOrder.length,
    crews,
    headlines: headlines.filter(h => h.length > 0),
    betrayal,
    flows,
    dilemma,
    moral,
    fleet,
    ghost: { crews: everGhost.size, boardings: ghostBoardings.reduce((a, b) => a + b, 0), collisions, solo, soloCrews: soloCrews.size },
    race: { waves: W, target: R3.targetDistance, leashes },
    tablet: {
      crews: ids.length,
      solved: solved.length,
      fastestSeconds: solveTimes.length > 0 ? solveTimes[0] : null,
      medianSeconds: solveTimes.length > 0 ? solveTimes[Math.floor((solveTimes.length - 1) / 2)] : null,
      wrongTotal: crews.reduce((a, c) => a + c.wrong, 0),
    },
    awards,
    podium,
    teaser: { title: TEASER.title, lines: [...TEASER.lines] },
    slideTitles: { ...SLIDE_TITLES },
    front,
  };
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
