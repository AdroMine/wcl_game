// What a bot does when it sees a view: form a team, solve Round 1, pair and vote in Round 2,
// pick vessels in Round 3. Every decision is made from the bot's own View (like a real phone), plus a
// small shared "world" standing in for things players tell each other out loud (the team code,
// the rival's battle code) or read off the tablet (the codeword).
import type { Bot } from './bot.ts';
import { sleep } from './stats.ts';
import type { View } from '../../shared/protocol.ts';

export interface World {
  codewords: Map<string, string>;
  rivalCode: Map<string, string>;
  groupCode: Map<number, string>;
  teamSize: number;
  flags: { lobby: boolean; r1: boolean; r2pair: boolean; r2vote: boolean; r3: boolean; sd: boolean };
  /** Probability that a team solves Round 1 on its own. */
  solveRate: number;
  /** Probability that a crew tries for bolder vessels. */
  boldness: number;
  /** Called by the brain when it needs fresh admin knowledge (codewords, pairings). */
  refresh?: () => Promise<void>;
  log?: (m: string) => void;
}

export function newWorld(teamSize = 5): World {
  return {
    codewords: new Map(),
    rivalCode: new Map(),
    groupCode: new Map(),
    teamSize,
    flags: { lobby: true, r1: true, r2pair: true, r2vote: true, r3: true, sd: true },
    solveRate: 0.85,
    boldness: 0.5,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function acted(bot: Bot, key: string): boolean {
  const set = (bot.memo.acted ??= new Set<string>()) as Set<string>;
  if (set.has(key)) return true;
  set.add(key);
  return false;
}

const stepKey = (v: View) => `${v.phase.name}/${v.phase.step}/${v.phase.clash}/${v.phase.wave}`;

function remainingMs(bot: Bot, v: View): number {
  return v.phase.endsAt == null ? 0 : Math.max(0, v.phase.endsAt - (Date.now() + bot.clockOffset));
}

function later(bot: Bot, v: View, ms: number, fn: () => Promise<unknown> | void): void {
  const key = stepKey(v);
  setTimeout(() => {
    if (bot.stopped || !bot.view || stepKey(bot.view) !== key || bot.view.phase.paused) return;
    void fn();
  }, ms);
}

async function joinTeamLoop(bot: Bot, world: World, group: number): Promise<void> {
  for (let attempt = 0; attempt < 12 && !bot.stopped; attempt++) {
    const v = bot.view;
    if (!v || v.phase.name !== 'LOBBY' || v.me?.joinedTeam) return;
    const code = world.groupCode.get(group);
    if (!code) {
      await sleep(400 + bot.rng() * 800);
      continue;
    }
    const r = await bot.cmd('JOIN_TEAM', { code });
    if (r?.body.ok) return;
    const err = r?.body.error;
    if (err === 'ROLE_TAKEN') await bot.cmd('REROLL_ROLE', {});
    else if (err === 'TEAM_FULL' || err === 'UNKNOWN_CODE' || err === 'ALREADY_IN_TEAM') return;
    await sleep(300 + bot.rng() * 1200);
  }
}

export function brain(world: World): (bot: Bot, v: View) => void {
  return (bot, v) => {
    const me = v.me;
    if (!me) return;
    const name = v.phase.name;
    const group = Math.floor(bot.index / world.teamSize);
    const leaderOfGroup = bot.index % world.teamSize === 0;

    // ---- lobby -------------------------------------------------------------
    if (world.flags.lobby && name === 'LOBBY') {
      if (leaderOfGroup && v.team) world.groupCode.set(group, v.team.emojiCode);
      if (!me.joinedTeam && !acted(bot, 'team')) {
        if (leaderOfGroup) setTimeout(() => void bot.cmd('CREATE_TEAM', { name: `Crew ${group}` }), 300 + bot.rng() * 2500);
        else setTimeout(() => void joinTeamLoop(bot, world, group), 1500 + bot.rng() * 3000);
      }
      return;
    }
    const team = v.team;
    if (!team) return;
    const isFirst = team.members[0]?.name === me.name;

    // ---- round 1 -----------------------------------------------------------
    if (world.flags.r1 && name === 'R1_ACTIVE' && v.phase.step !== 'BRIEFING' && v.r1 && !v.r1.solved) {
      const rem = remainingMs(bot, v);
      if (isFirst && !acted(bot, `solve:${team.id}`) && hash(team.id) % 100 < world.solveRate * 100 && rem > 6000) {
        const at = 1500 + bot.rng() * (rem - 5000);
        later(bot, v, at, async () => {
          if (!world.codewords.has(team.id)) await world.refresh?.();
          const cw = world.codewords.get(team.id);
          if (cw) await bot.cmd('R1_SUBMIT', { answer: cw.toLowerCase() });
        });
      }
      if (!acted(bot, `wrong:${team.id}`) && bot.rng() < 0.2) later(bot, v, 1000 + bot.rng() * 8000, () => bot.cmd('R1_SUBMIT', { answer: 'not the codeword' }));
      const nowServer = Date.now() + bot.clockOffset;
      for (const h of v.r1.hints) {
        if (!h.taken && nowServer >= h.unlocksAt + 500 && !acted(bot, `hint${h.index}`) && bot.rng() < 0.1) {
          void bot.cmd('R1_HINT', { hint: h.index });
        }
      }
      return;
    }

    // ---- round 2 -----------------------------------------------------------
    if (world.flags.r2pair && name === 'R2_PAIRING' && v.r2 && !v.r2.paired && isFirst && !acted(bot, 'pair')) {
      later(bot, v, 500 + bot.rng() * 4000, async () => {
        if (!world.rivalCode.has(team.id)) await world.refresh?.();
        const code = world.rivalCode.get(team.id);
        if (code) await bot.cmd('R2_PAIR', { code });
      });
      return;
    }
    if (world.flags.r2vote && name === 'R2_CLASH' && v.phase.step === 'VOTE' && v.r2?.paired && !me.myVote && !v.phase.paused && !acted(bot, `${stepKey(v)}@${v.sid}`)) {
      const personality = [0.05, 0.3, 0.6, 0.95][hash(team.id) % 4];
      const vote = bot.rng() < personality ? 'AMBUSH' : 'TRUCE';
      later(bot, v, bot.rng() * Math.max(500, remainingMs(bot, v) * 0.6), async () => {
        await bot.cmd('R2_VOTE', { vote });
        if (bot.rng() < 0.1) await bot.cmd('R2_VOTE', { vote: vote === 'AMBUSH' ? 'TRUCE' : 'AMBUSH' }); // first vote is final
      });
      return;
    }

    // ---- round 3 -----------------------------------------------------------
    if (world.flags.r3 && name === 'R3_ACTIVE' && v.phase.step === 'VOTE' && v.r3 && !v.r3.escaped && !v.phase.paused && !acted(bot, `${stepKey(v)}@${v.sid}`)) {
      const bold = hash(team.id + v.phase.wave) % 100 < world.boldness * 100;
      const x = bot.rng();
      const vessel = bold ? (x < 0.45 ? 'SAILBOAT' : x < 0.6 ? 'GHOST_SHIP' : 'ROWBOAT') : x < 0.8 ? 'ROWBOAT' : 'SAILBOAT';
      later(bot, v, bot.rng() * Math.max(500, remainingMs(bot, v) * 0.6), async () => {
        if (v.r3?.leash?.available && !v.r3.leash.armed && bot.rng() < 0.5) await bot.cmd('R3_ARM_LEASH', {});
        await bot.cmd('R3_VOTE', { vessel });
      });
      return;
    }
    if (world.flags.sd && v.phase.step === 'SUDDEN_DEATH' && v.r3?.sd?.mine && !v.r3.sd.resolved && !me.myVote && !v.phase.paused && !acted(bot, `${stepKey(v)}@${v.sid}`)) {
      const action = (['SHIELDS', 'RAM', 'SAILS'] as const)[Math.floor(bot.rng() * 3)];
      later(bot, v, bot.rng() * 4000, () => bot.cmd('SD_VOTE', { action }));
    }
  };
}
