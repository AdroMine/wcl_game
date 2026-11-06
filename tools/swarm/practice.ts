// The `practice` scenario: bot crews that fill the OTHER crews while a human organizer drives the game from /admin
// and plays one or more seats. The bots never touch admin phase controls; they only follow the phases they see,
// at a human pace. Needs no admin token unless --reset is passed.
//
//   node tools/swarm/swarm.ts --target http://localhost:3001 --scenario practice --crews 4 --bots-per-crew 3
import { Bot, newCounters } from './bot.ts';
import { mulberry, sleep } from './stats.ts';
import type { View } from '../../shared/protocol.ts';

export interface PracticeOptions {
  target: string;
  crews: number;
  botsPerCrew: number;
  /** One bot crew never types a code and waits for the humans to enter its crew code. */
  leaveRivalForHumans: boolean;
  reset: boolean;
  adminToken: string;
  seed: number;
  verbose: boolean;
}

interface CrewInfo {
  teamId?: string;
  emojiCode?: string;
  battleCode?: string;
}

const stepKey = (v: View) => `${v.phase.name}/${v.phase.step}/${v.phase.clash}/${v.phase.wave}`;
const stamp = () => new Date().toTimeString().slice(0, 8);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function runPractice(o: PracticeOptions): Promise<number> {
  if (o.reset) {
    if (!o.adminToken) {
      console.error('--reset needs --admin-token (or $ADMIN_TOKEN)');
      return 2;
    }
    const res = await fetch(`${o.target}/api/admin/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ADMIN_RESET_GAME', payload: {} }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) {
      console.error(`reset failed: HTTP ${res.status} ${body.error ?? ''}`);
      return 2;
    }
    console.log('game reset (--reset)');
  }

  const size = Math.max(1, o.botsPerCrew);
  const nBots = o.crews * size;
  const tag = Math.random().toString(36).slice(2, 7);
  const rng = mulberry(o.seed);
  const counters = newCounters();
  const crews: CrewInfo[] = Array.from({ length: o.crews }, () => ({}));
  const reservedCrew = o.leaveRivalForHumans && o.crews > 0 ? o.crews - 1 : -1;
  // Bot crews that pair among themselves, two by two in order. A leftover waits like the reserved crew.
  const pairable = crews.map((_, i) => i).filter(i => i !== reservedCrew);
  const partnerOf = new Map<number, number>(); // crew that types -> crew whose code it types
  for (let i = 0; i + 1 < pairable.length; i += 2) partnerOf.set(pairable[i], pairable[i + 1]);

  let finished: () => void = () => {};
  const done = new Promise<void>(r => (finished = r));
  const bots: Bot[] = [];

  const acted = (bot: Bot, key: string): boolean => {
    const set = (bot.memo.acted ??= new Set<string>()) as Set<string>;
    if (set.has(key)) return true;
    set.add(key);
    return false;
  };
  const later = (bot: Bot, v: View, ms: number, fn: () => Promise<unknown> | void) => {
    const key = stepKey(v);
    setTimeout(() => {
      if (bot.stopped || !bot.view || stepKey(bot.view) !== key || bot.view.phase.paused) return;
      void fn();
    }, ms);
  };
  const remaining = (bot: Bot, v: View) => (v.phase.endsAt == null ? 8000 : Math.max(0, v.phase.endsAt - (Date.now() + bot.clockOffset)));

  async function joinLoop(bot: Bot): Promise<void> {
    for (let i = 0; i < 30 && !bot.stopped; i++) {
      if (bot.view?.me) return;
      const r = await bot.cmd('JOIN', { name: bot.cfg.name });
      if (r?.body.ok) return;
      await sleep(1000 + rng() * 2000);
    }
  }

  async function joinTeamLoop(bot: Bot, crew: number): Promise<void> {
    for (let i = 0; i < 20 && !bot.stopped; i++) {
      const v = bot.view;
      if (!v || v.phase.name !== 'LOBBY' || v.me?.joinedTeam) return;
      const code = crews[crew].emojiCode;
      if (!code) {
        await sleep(500 + rng() * 800);
        continue;
      }
      const r = await bot.cmd('JOIN_TEAM', { code });
      if (r?.body.ok) return;
      const err = r?.body.error;
      if (err === 'TEAM_FULL' || err === 'UNKNOWN_CODE' || err === 'ALREADY_IN_TEAM') return;
      await sleep(400 + rng() * 1200);
    }
  }

  const onView = (bot: Bot, v: View): void => {
    const crew = Math.floor(bot.index / size);
    const leader = bot.index % size === 0;
    const me = v.me;
    if (!me) {
      // Never joined, or the host reset the game: (re)join and forget what we did.
      if (!bot.memo.joining) {
        bot.memo.joining = true;
        bot.memo.acted = new Set<string>();
        crews[crew] = {};
        void sleep(300 + rng() * 2000).then(() => joinLoop(bot)).finally(() => (bot.memo.joining = false));
      }
      return;
    }
    if (v.team) {
      const c = crews[crew];
      c.teamId = v.team.id;
      c.emojiCode = v.team.emojiCode;
      c.battleCode = v.team.emojiCode;
    }
    const name = v.phase.name;
    const step = v.phase.step;
    if (name === 'FINISHED') {
      finished();
      return;
    }

    if (name === 'LOBBY') {
      if (!me.joinedTeam && !acted(bot, 'team')) {
        if (leader) setTimeout(() => void bot.cmd('CREATE_TEAM', { name: `Practice crew ${crew + 1}` }), 300 + rng() * 2000);
        else setTimeout(() => void joinTeamLoop(bot, crew), 1500 + rng() * 3000);
      }
      return;
    }
    const team = v.team;
    if (!team || step === 'BRIEFING') return; // the briefing accepts no submissions or votes

    // ---- round 1: the crew's codeword is on the tablet in every member's view -----------------------------------
    if (name === 'R1_ACTIVE' && v.r1 && !v.r1.solved && leader) {
      const rem = remaining(bot, v);
      if (!acted(bot, `solve:${v.sid}`)) {
        const solves = hash(team.id) % 100 < 80; // some crews run out the clock
        const t = v.r1.tablet;
        if (solves && t && rem > 6000) {
          const at = 3000 + rng() * (rem * 0.7);
          later(bot, v, at, () => bot.cmd('R1_SUBMIT', { answer: `${t.line1} ${t.line2}`.toLowerCase() }));
        }
      }
      return;
    }

    // ---- round 2 --------------------------------------------------------------------------------------------------
    if (name === 'R2_PAIRING' && v.r2 && !v.r2.paired && leader) {
      const target = partnerOf.get(crew);
      if (target !== undefined && !acted(bot, `pair:${v.sid}`)) {
        later(bot, v, 1000 + rng() * 6000, async () => {
          const code = crews[target].emojiCode;
          if (code) await bot.cmd('R2_PAIR', { code });
        });
      }
      return;
    }
    if (name === 'R2_CLASH' && step === 'VOTE' && v.r2?.paired && !me.myVote && !acted(bot, `vote:${stepKey(v)}@${v.sid}`)) {
      const personality = [0.1, 0.35, 0.6, 0.9][hash(team.id) % 4];
      const vote = rng() < personality ? 'AMBUSH' : 'TRUCE';
      later(bot, v, 500 + rng() * Math.max(300, remaining(bot, v) * 0.7), () => bot.cmd('R2_VOTE', { vote }));
      return;
    }

    // ---- round 3 --------------------------------------------------------------------------------------------------
    if (name === 'R3_ACTIVE' && step === 'VOTE' && v.r3 && !v.r3.escaped && !me.myVote && !acted(bot, `vote:${stepKey(v)}@${v.sid}`)) {
      const vessel = (['ROWBOAT', 'SAILBOAT', 'GHOST_SHIP'] as const)[Math.floor(rng() * 3)];
      later(bot, v, 500 + rng() * Math.max(300, remaining(bot, v) * 0.7), async () => {
        const leash = bot.view?.r3?.leash;
        if (leash?.available && !leash.armed && rng() < 0.3) await bot.cmd('R3_ARM_LEASH', {});
        await bot.cmd('R3_VOTE', { vessel });
      });
      return;
    }
    if (step === 'SUDDEN_DEATH' && v.r3?.sd?.mine && !v.r3.sd.resolved && !me.myVote && !acted(bot, `sd:${stepKey(v)}@${v.sid}`)) {
      const action = (['SHIELDS', 'RAM', 'SAILS'] as const)[Math.floor(rng() * 3)];
      later(bot, v, 500 + rng() * 5000, () => bot.cmd('SD_VOTE', { action }));
    }
  };

  // ---- one status line per phase step ------------------------------------------------------------------------------
  let lastKey = '';
  const statusTimer = setInterval(() => {
    const v = bots.find(b => b.view)?.view;
    if (!v) return;
    const key = stepKey(v);
    if (key === lastKey) return;
    lastKey = key;
    const leaders = bots.filter(b => b.index % size === 0 && b.view);
    const solved = leaders.filter(b => b.view?.r1?.solved).length;
    const paired = leaders.filter(b => b.view?.r2?.paired).length;
    const escaped = leaders.filter(b => b.view?.r3?.escaped).length;
    const bits = [`${v.phase.name}${v.phase.step ? '/' + v.phase.step : ''}`];
    if (v.phase.clash) bits.push(`clash ${v.phase.clash}`);
    if (v.phase.wave) bits.push(`wave ${v.phase.wave}`);
    if (v.phase.endsAt) bits.push(`${Math.max(0, Math.round((v.phase.endsAt - v.serverNow) / 1000))}s`);
    bits.push(`bot crews: ${solved}/${o.crews} solved R1, ${paired}/${o.crews} paired, ${escaped}/${o.crews} escaped`);
    console.log(`[${stamp()}] ${bits.join(' | ')}`);
  }, 700);

  const stopAll = () => {
    clearInterval(statusTimer);
    for (const b of bots) b.stop();
  };
  process.once('SIGINT', () => {
    console.log('\nstopping practice bots');
    stopAll();
    process.exit(0);
  });

  for (let i = 0; i < nBots; i++) {
    const tok = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng() * 36)]).join('');
    bots.push(
      new Bot({
        target: o.target,
        index: i,
        id: `practice-${tag}-${String(i).padStart(3, '0')}`,
        token: `${tok}${tag}`,
        name: `Practice ${Math.floor(i / size) + 1}.${(i % size) + 1}`,
        dupRate: 0.02,
        abortRate: 0,
        seed: o.seed * 1000 + i,
        counters,
        onView,
      }),
    );
  }
  for (const b of bots) b.start();

  console.log(`practice: ${o.crews} bot crews of ${size} (${nBots} bots) on ${o.target}`);
  console.log(`  you drive the phases from /admin. Bots follow at human pace until the game is FINISHED (Ctrl+C to stop).`);
  console.log(
    `  pairing: ${[...partnerOf].map(([a, b]) => `crew ${a + 1} types crew ${b + 1}`).join(', ') || 'none'}${
      reservedCrew >= 0 ? `; crew ${reservedCrew + 1} waits for YOU to enter its crew code` : ''
    }`,
  );
  const first = await bots[0]?.waitFor(v => !!v.me || v.phase.name === 'LOBBY', 20_000);
  if (first === null) {
    console.error('cannot get a first view from the server');
    stopAll();
    return 2;
  }
  // Tell the organizer the codes of the waiting crew once they exist.
  if (reservedCrew >= 0) {
    void (async () => {
      for (let i = 0; i < 600; i++) {
        await sleep(1000);
        const c = crews[reservedCrew];
        if (c.battleCode) {
          console.log(`  waiting crew "${`Practice crew ${reservedCrew + 1}`}": team code ${c.emojiCode}, crew code ${c.emojiCode}`);
          return;
        }
      }
    })();
  }
  await done;
  await sleep(1500);
  console.log(`[${stamp()}] FINISHED. Practice over.`);
  stopAll();
  return 0;
}
