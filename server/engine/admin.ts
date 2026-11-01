// Admin commands. Authentication happens in the server; the engine only checks actor.kind.
// Behaviour ported from the supabaseAdmin* functions in src/lib/supabaseService.ts.
import { MIN_DEADLINE_MS, ROLE_IDS, TEAM_MAX } from './config.ts';
import { asObj, cleanName, detachPlayer, recomputeScore, removeTeam, reqInt, reqString } from './common.ts';
import { effNow, setStep } from './clock.ts';
import { nextNumber } from './ids.ts';
import { addToTeam, autoGroup, pickBalancedRole, removePlayer } from './lobby.ts';
import { advance, endRound3 } from './phases.ts';
import { initRound1, adminMarkSolved } from './round1.ts';
import { adminAutoPair, adminPairAndMaybeStart, initRound2Pairing, startClashes, unpairTeam } from './round2.ts';
import { adminAdjustDistance, adminToggleHonour, startRound3, triggerSuddenDeath } from './round3.ts';
import { createInitialState } from './state.ts';
import type { Handler, RoleId } from './types.ts';
import { NOOP, fail } from './types.ts';
import { MAX_TEAM_NAME } from './config.ts';

const startGame: Handler = (d, _c, now, ev) => {
  if (d.phase !== 'LOBBY') return fail('WRONG_PHASE');
  initRound1(d, now);
  setStep(d, now, 'R1_ACTIVE', null, { durationMs: d.config.r1Seconds * 1000 }, ev);
  return undefined;
};

const startR2: Handler = (d, _c, now, ev) => {
  if (d.phase !== 'R1_RESULTS') return fail('WRONG_PHASE');
  initRound2Pairing(d);
  setStep(d, now, 'R2_PAIRING', null, { durationMs: null }, ev);
  return undefined;
};

const forceStartClashes: Handler = (d, _c, now, ev) => {
  if (d.phase !== 'R2_PAIRING') return fail('WRONG_PHASE');
  // Unpaired teams sit out Round 2 (pending confirmation in RULE_DECISIONS).
  startClashes(d, now, ev);
  return undefined;
};

const startR3: Handler = (d, _c, now, ev) => {
  if (d.phase !== 'R2_RESULTS') return fail('WRONG_PHASE');
  startRound3(d, now, ev);
  return undefined;
};

const finish: Handler = (d, _c, now, ev) => {
  if (d.phase !== 'R3_RESULTS') return fail('WRONG_PHASE');
  setStep(d, now, 'FINISHED', null, { durationMs: null }, ev);
  return undefined;
};

const pause: Handler = (d, _c, now, ev) => {
  if (d.pausedAt != null) return fail('ALREADY_PAUSED');
  d.pausedAt = now;
  ev.push({ type: 'PAUSED' });
  return undefined;
};

const resume: Handler = (d, _c, now, ev) => {
  if (d.pausedAt == null) return fail('NOT_PAUSED');
  const shift = Math.max(0, now - d.pausedAt);
  if (d.endsAt != null) d.endsAt += shift;
  if (d.r1.startedAt != null && d.phase === 'R1_ACTIVE') d.r1.startedAt += shift;
  d.phaseStartedAt += shift;
  d.pausedAt = null;
  ev.push({ type: 'RESUMED', shiftMs: shift });
  return undefined;
};

const skipStep: Handler = (d, c, now, ev) => {
  if (d.endsAt == null) return fail('NOT_TIMED');
  const seq = asObj(c.payload)?.phaseSeq;
  if (seq !== undefined && seq !== d.phaseSeq) return fail('STALE');
  return advance(d, now, ev);
};

const adjustDeadline: Handler = (d, c, now) => {
  if (d.endsAt == null) return fail('NOT_TIMED');
  const s = reqInt(asObj(c.payload), 'seconds');
  if (s === null) return fail('INVALID_PAYLOAD');
  const floor = effNow(d, now) + MIN_DEADLINE_MS;
  const next = Math.max(d.endsAt + s * 1000, floor);
  if (next === d.endsAt) return NOOP;
  d.endsAt = next;
  return undefined;
};

const adjustScore: Handler = (d, c, _now, ev) => {
  const o = asObj(c.payload);
  const id = reqString(o, 'teamId', 64);
  const delta = reqInt(o, 'delta');
  if (!id || delta === null) return fail('INVALID_PAYLOAD');
  const t = d.teams[id];
  if (!t) return fail('UNKNOWN_TEAM');
  if (delta === 0) return NOOP;
  t.adminAdjust += delta;
  recomputeScore(t);
  ev.push({ type: 'SCORE_ADJUSTED', teamId: id, delta });
  return undefined;
};

const adjustDistance: Handler = (d, c, _now, ev) => {
  const o = asObj(c.payload);
  const id = reqString(o, 'teamId', 64);
  const delta = reqInt(o, 'delta');
  if (!id || delta === null) return fail('INVALID_PAYLOAD');
  return adminAdjustDistance(d, id, delta, ev);
};

const toggleHonour: Handler = (d, c, _now, ev) => {
  const id = reqString(asObj(c.payload), 'teamId', 64);
  if (!id) return fail('INVALID_PAYLOAD');
  return adminToggleHonour(d, id, ev);
};

const movePlayer: Handler = (d, c, _now, ev) => {
  const o = asObj(c.payload);
  const pid = reqString(o, 'playerId', 64);
  if (!pid) return fail('INVALID_PAYLOAD');
  const p = d.players[pid];
  if (!p) return fail('UNKNOWN_PLAYER');
  const target = o!.teamId;
  if (target !== null && typeof target !== 'string') return fail('INVALID_PAYLOAD');
  if (target === p.teamId) return NOOP;
  if (target !== null) {
    const t = d.teams[target];
    if (!t) return fail('UNKNOWN_TEAM');
    if (t.playerIds.length >= TEAM_MAX) return fail('TEAM_FULL');
    detachPlayer(d, p);
    addToTeam(d, t, p);
  } else {
    detachPlayer(d, p);
  }
  ev.push({ type: 'PLAYER_MOVED', playerId: pid, teamId: target });
  return undefined;
};

const removePlayerCmd: Handler = (d, c, _now, ev) => {
  const pid = reqString(asObj(c.payload), 'playerId', 64);
  if (!pid) return fail('INVALID_PAYLOAD');
  const p = d.players[pid];
  if (!p) return fail('UNKNOWN_PLAYER');
  removePlayer(d, p);
  ev.push({ type: 'PLAYER_REMOVED', playerId: pid });
  return undefined;
};

const addPlayer: Handler = (d, c, _now, ev) => {
  const o = asObj(c.payload);
  const n = nextNumber(d);
  const id = `adm${n.toString(36)}`;
  const name = cleanName(o?.name) || `Shade-${n}`;
  const role: RoleId = ROLE_IDS.includes(o?.role as RoleId) ? (o!.role as RoleId) : pickBalancedRole(d);
  const teamId = o?.teamId;
  if (teamId !== undefined && teamId !== null) {
    if (typeof teamId !== 'string' || !d.teams[teamId]) return fail('UNKNOWN_TEAM');
    if (d.teams[teamId].playerIds.length >= TEAM_MAX) return fail('TEAM_FULL');
  }
  d.players[id] = { id, name, role, tokenHash: '', teamId: null, joinedSeq: n };
  d.playerOrder.push(id);
  if (typeof teamId === 'string') addToTeam(d, d.teams[teamId], d.players[id]);
  ev.push({ type: 'PLAYER_ADDED', playerId: id });
  return undefined;
};

const deleteTeam: Handler = (d, c, _now, ev) => {
  const id = reqString(asObj(c.payload), 'teamId', 64);
  if (!id) return fail('INVALID_PAYLOAD');
  if (!d.teams[id]) return fail('UNKNOWN_TEAM');
  removeTeam(d, id);
  ev.push({ type: 'TEAM_DELETED', teamId: id });
  return undefined;
};

const renameTeam: Handler = (d, c, _now, ev) => {
  const o = asObj(c.payload);
  const id = reqString(o, 'teamId', 64);
  const name = cleanName(o?.name, MAX_TEAM_NAME);
  if (!id || !name) return fail('INVALID_PAYLOAD');
  const t = d.teams[id];
  if (!t) return fail('UNKNOWN_TEAM');
  if (t.name === name) return NOOP;
  t.name = name;
  ev.push({ type: 'TEAM_RENAMED', teamId: id });
  return undefined;
};

const autoGroupCmd: Handler = (d, _c, _now, ev) => (autoGroup(d, ev) === 0 ? NOOP : undefined);

const setDurations: Handler = (d, c) => {
  const o = asObj(c.payload);
  if (!o) return fail('INVALID_PAYLOAD');
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 3600;
  const next = structuredClone(d.config);
  let touched = false;
  const apply = (v: unknown, set: (n: number) => void) => {
    if (v === undefined) return true;
    if (!ok(v)) return false;
    set(v);
    touched = true;
    return true;
  };
  const r2 = asObj(o.r2) ?? {};
  const r3 = asObj(o.r3) ?? {};
  const good =
    apply(o.r1Seconds, n => (next.r1Seconds = n)) &&
    apply(o.sdSeconds, n => (next.sdSeconds = n)) &&
    apply(r2.HUDDLE, n => (next.r2.HUDDLE = n)) &&
    apply(r2.PARLEY, n => (next.r2.PARLEY = n)) &&
    apply(r2.VOTE, n => (next.r2.VOTE = n)) &&
    apply(r2.DEBRIEF, n => (next.r2.DEBRIEF = n)) &&
    apply(r3.BLUFF, n => (next.r3.BLUFF = n)) &&
    apply(r3.VOTE, n => (next.r3.VOTE = n)) &&
    apply(r3.REVEAL, n => (next.r3.REVEAL = n));
  if (!good) return fail('INVALID_DURATION');
  if (!touched) return NOOP;
  d.config = next;
  return undefined;
};

const resetGame: Handler = (d, _c, now, ev) => {
  const fresh = createInitialState({ seed: 1 });
  const keep = { version: d.version, rng: d.rng, idCounter: d.idCounter, applied: d.applied, phaseSeq: d.phaseSeq + 1 };
  Object.assign(d, fresh, keep);
  d.phaseLog = [{ seq: d.phaseSeq, phase: 'LOBBY', step: null, clash: 0, wave: 0, at: now }];
  ev.push({ type: 'GAME_RESET' });
  return undefined;
};

const suddenDeath: Handler = (d, c, now, ev) => {
  const o = asObj(c.payload);
  const a = reqString(o, 'teamA', 64);
  const b = reqString(o, 'teamB', 64);
  if (!a || !b) return fail('INVALID_PAYLOAD');
  return triggerSuddenDeath(d, a, b, now, ev);
};

const markSolved: Handler = (d, c, now, ev) => {
  const id = reqString(asObj(c.payload), 'teamId', 64);
  if (!id) return fail('INVALID_PAYLOAD');
  return adminMarkSolved(d, id, now, ev);
};

const r2Pair: Handler = (d, c, now, ev) => {
  const o = asObj(c.payload);
  const a = reqString(o, 'teamA', 64);
  const b = reqString(o, 'teamB', 64);
  if (!a || !b) return fail('INVALID_PAYLOAD');
  return adminPairAndMaybeStart(d, a, b, now, ev);
};

const r2Unpair: Handler = (d, c) => {
  if (d.phase !== 'R2_PAIRING') return fail('WRONG_PHASE');
  const id = reqString(asObj(c.payload), 'teamId', 64);
  if (!id) return fail('INVALID_PAYLOAD');
  if (!d.teams[id]) return fail('UNKNOWN_TEAM');
  return unpairTeam(d, id) ? undefined : NOOP;
};

const r2AutoPair: Handler = (d, _c, now, ev) => adminAutoPair(d, now, ev);

const endR3: Handler = (d, _c, now, ev) => endRound3(d, now, ev);

export const adminHandlers: Record<string, Handler> = {
  ADMIN_START_GAME: startGame,
  ADMIN_START_R2: startR2,
  ADMIN_R2_FORCE_START: forceStartClashes,
  ADMIN_START_R3: startR3,
  ADMIN_END_R3: endR3,
  ADMIN_FINISH: finish,
  ADMIN_PAUSE: pause,
  ADMIN_RESUME: resume,
  ADMIN_SKIP_STEP: skipStep,
  ADMIN_ADJUST_DEADLINE: adjustDeadline,
  ADMIN_ADJUST_SCORE: adjustScore,
  ADMIN_ADJUST_DISTANCE: adjustDistance,
  ADMIN_TOGGLE_HONOUR: toggleHonour,
  ADMIN_MOVE_PLAYER: movePlayer,
  ADMIN_REMOVE_PLAYER: removePlayerCmd,
  ADMIN_ADD_PLAYER: addPlayer,
  ADMIN_DELETE_TEAM: deleteTeam,
  ADMIN_RENAME_TEAM: renameTeam,
  ADMIN_AUTO_GROUP: autoGroupCmd,
  ADMIN_SET_DURATIONS: setDurations,
  ADMIN_RESET_GAME: resetGame,
  ADMIN_TRIGGER_SUDDEN_DEATH: suddenDeath,
  ADMIN_MARK_R1_SOLVED: markSolved,
  ADMIN_R2_PAIR: r2Pair,
  ADMIN_R2_UNPAIR: r2Unpair,
  ADMIN_R2_AUTO_PAIR: r2AutoPair,
};
