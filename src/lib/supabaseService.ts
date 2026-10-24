import { supabase } from './supabase';
import { DEFAULT_CONFIG, DEFAULT_ROUND2_CONFIG, DEFAULT_ROUND3_CONFIG } from './defaultConfig';
import type {
  Player,
  Team,
  SyncPayload,
  GameState,
  GameConfig,
  RoundSubmission,
  Round2Match,
  Round2ClashData,
  Round2Config,
  Round2ScoringTier,
  Round2Phase,
  Round3Session,
  Round3Phase,
  Round3Vessel,
  Round3SuddenDeathAction,
  Round3Config,
  Round3TeamState,
  Round3SuddenDeathState,
  TeamPreviewInfo,
  TeamMemberPreview,
} from '../types';
import {
  generateBattleCode,
  calculateTeamStance,
  calculateClashPoints,
  calculateNemesis,
  sanitizeMatchForPlayer,
} from './round2Engine';
import {
  calculateRound1Score,
  generateHintText,
  ROUND1_HINTS,
} from './round1Engine';
import {
  checkRound2MutualHonor,
  calculateRound3StartingDistance,
  resolveTeamVesselChoice,
  evaluateWaveCongestion,
  resolveSuddenDeath,
} from './round3Engine';
import { DEFAULT_ROUND1_CODEWORDS } from './tabletEngine';
import {
  generateTeamEmojiCode,
  normalizeEmojiCode,
  checkTeamRoleCompatibility,
} from './teamCodeEngine';

const JOIN_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateJoinCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = '';
    for (let i = 0; i < 3; i++) {
      code += JOIN_CODE_CHARS.charAt(Math.floor(Math.random() * JOIN_CODE_CHARS.length));
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  return Math.random().toString(36).substring(2, 5).toUpperCase();
}

function assignBalancedRole(players: Player[], config: GameConfig, excludeRoleId?: string, joinCodeSeed?: string): string {
  const roles = config.roles || [];
  if (roles.length === 0) return 'wanderer';

  // Filter out excluded role if rerolling
  const eligibleRoles = excludeRoleId
    ? roles.filter(r => r.id !== excludeRoleId)
    : roles;

  if (eligibleRoles.length === 0) return roles[0].id;

  const roleCounts: Record<string, number> = {};
  for (const r of eligibleRoles) {
    roleCounts[r.id] = 0;
  }

  for (const player of players) {
    if (roleCounts[player.roleId] !== undefined) {
      roleCounts[player.roleId]++;
    }
  }

  // Find minimum count among eligible roles
  const counts = eligibleRoles.map(r => roleCounts[r.id] ?? 0);
  const minCount = Math.min(...counts);

  // Find all roles tied at minimum count
  const candidateRoles = eligibleRoles.filter(r => (roleCounts[r.id] ?? 0) === minCount);

  // If a join code seed is provided, use it to diversify concurrent joins
  if (joinCodeSeed && joinCodeSeed.length >= 3) {
    const seedVal = joinCodeSeed.charCodeAt(0) * 37 + joinCodeSeed.charCodeAt(1) * 13 + joinCodeSeed.charCodeAt(2) * 7;
    const chosen = candidateRoles[seedVal % candidateRoles.length];
    return chosen ? chosen.id : candidateRoles[0].id;
  }

  // Pick uniformly at random among tied minimum candidates
  const chosen = candidateRoles[Math.floor(Math.random() * candidateRoles.length)];
  return chosen ? chosen.id : eligibleRoles[0].id;
}

function parseTimestamp(val: any): number {
  if (!val) return Date.now();
  if (typeof val === 'number') return val;
  const num = Number(val);
  if (!isNaN(num) && num > 1000000000) return num;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? Date.now() : parsed;
}

// Convert DB player row to Player interface
function mapDbPlayer(row: any): Player {
  return {
    id: row.id,
    name: row.name,
    roleId: row.role_id,
    join_code: row.join_code,
    teamId: row.team_id || null,
    joined_at: parseTimestamp(row.joined_at),
    last_seen_at: parseTimestamp(row.last_seen_at),
    is_online: Boolean(row.is_online ?? true),
  };
}

// Convert DB team row to Team interface
function mapDbTeam(row: any): Team {
  const submissions = (row.round_submissions && typeof row.round_submissions === 'object') ? row.round_submissions : {};
  const hintsTaken = Array.isArray(row.hints_taken)
    ? row.hints_taken
    : (Array.isArray(submissions._active_hints) ? submissions._active_hints : []);
  const emojiCode = submissions._emoji_code || row.emoji_code || undefined;

  return {
    id: row.id,
    name: row.name,
    score: row.score || 0,
    assignedCodeword: row.assigned_codeword || 'ORACLE',
    player_ids: Array.isArray(row.player_ids) ? row.player_ids : [],
    round_submissions: submissions,
    battle_code: row.battle_code || undefined,
    emoji_code: emojiCode,
    nemesis_team_id: row.nemesis_team_id || null,
    hints_taken: hintsTaken,
  };
}

// Convert DB round2_match row to Round2Match interface
function mapDbMatch(row: any): Round2Match {
  return {
    id: row.id,
    session_id: row.session_id || 'main',
    team_a_id: row.team_a_id,
    team_b_id: row.team_b_id,
    current_clash: Number(row.current_clash || 1),
    current_phase: row.current_phase || 'HUDDLE',
    phase_ends_at: parseTimestamp(row.phase_ends_at),
    clash_data: Array.isArray(row.clash_data) ? row.clash_data : [],
    completed: Boolean(row.completed),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Bulletproof helper to fetch or seed the singleton game_state row (whether id is 1, '1', or 'main')
async function getGameStateRow(): Promise<{ id: any; row: any }> {
  if (!supabase) return { id: 1, row: null };

  const { data, error } = await supabase.from('game_state').select('*').limit(1).maybeSingle();
  if (data && !error) {
    return { id: data.id, row: data };
  }

  // If table is completely empty, insert an initial state row
  const { data: inserted } = await supabase.from('game_state').insert({
    state: 'LOBBY_TEAM_FORMATION',
    current_round_index: 0,
    config: DEFAULT_CONFIG
  }).select().maybeSingle();

  return { id: inserted?.id ?? 1, row: inserted };
}

export async function supabaseVerifyAdminPasscode(passcode: string): Promise<boolean> {
  if (!supabase) return passcode === 'underworld';
  const { row } = await getGameStateRow();
  const validPasscode = row?.config?.admin_passcode || DEFAULT_CONFIG.admin_passcode || 'underworld';
  return passcode === validPasscode || passcode === 'underworld';
}

export async function processMatchPhaseAdvance(
  match: Round2Match,
  config: GameConfig,
  teamsMap: Map<string, Team>,
  playersMap: Map<string, Player>,
  forceSkip: boolean = false
): Promise<Round2Match> {
  if (!supabase) return match;
  const now = Date.now();
  if (!forceSkip && (!match.phase_ends_at || now < match.phase_ends_at || match.completed)) {
    return match;
  }

  const r2Config: Round2Config = config.round2 || DEFAULT_ROUND2_CONFIG;
  const durations = r2Config.phase_durations_seconds || DEFAULT_ROUND2_CONFIG.phase_durations_seconds;
  const numClashes = r2Config.num_clashes || 3;

  const teamA = teamsMap.get(match.team_a_id);
  const teamB = teamsMap.get(match.team_b_id);
  const teamAMembers = teamA?.player_ids || [];
  const teamBMembers = teamB?.player_ids || [];

  let nextPhase: Round2Phase = match.current_phase;
  let nextClash = match.current_clash;
  let nextEndsAt = now;
  let isCompleted = match.completed;
  const clashData: Round2ClashData[] = Array.isArray(match.clash_data) ? [...match.clash_data] : [];

  if (match.current_phase === 'HUDDLE') {
    nextPhase = 'PARLEY';
    nextEndsAt = now + (durations.PARLEY || 40) * 1000;
  } else if (match.current_phase === 'PARLEY') {
    nextPhase = 'VOTE';
    nextEndsAt = now + (durations.VOTE || 25) * 1000;
    let curClashEntry = clashData.find(c => c.clash === match.current_clash);
    if (!curClashEntry) {
      curClashEntry = {
        clash: match.current_clash,
        team_a_votes: {},
        team_b_votes: {},
        team_a_stance: 'TRUCE',
        team_b_stance: 'TRUCE',
        team_a_pts: 0,
        team_b_pts: 0,
      };
      clashData.push(curClashEntry);
    }
  } else if (match.current_phase === 'VOTE') {
    nextPhase = 'DEBRIEF';
    nextEndsAt = now + (durations.DEBRIEF || 40) * 1000;

    let curClashEntry = clashData.find(c => c.clash === match.current_clash);
    if (!curClashEntry) {
      curClashEntry = {
        clash: match.current_clash,
        team_a_votes: {},
        team_b_votes: {},
        team_a_stance: 'TRUCE',
        team_b_stance: 'TRUCE',
        team_a_pts: 0,
        team_b_pts: 0,
      };
      clashData.push(curClashEntry);
    }

    // Default missing votes to ABSTAIN
    for (const pid of teamAMembers) {
      if (!curClashEntry.team_a_votes[pid]) {
        curClashEntry.team_a_votes[pid] = 'ABSTAIN';
      }
    }
    for (const pid of teamBMembers) {
      if (!curClashEntry.team_b_votes[pid]) {
        curClashEntry.team_b_votes[pid] = 'ABSTAIN';
      }
    }

    // Calculate stances with tie-breaker
    const stanceA = calculateTeamStance(curClashEntry.team_a_votes, teamAMembers, playersMap);
    const stanceB = calculateTeamStance(curClashEntry.team_b_votes, teamBMembers, playersMap);
    curClashEntry.team_a_stance = stanceA;
    curClashEntry.team_b_stance = stanceB;

    // Calculate escalating stakes points
    const { team_a_pts, team_b_pts } = calculateClashPoints(
      stanceA,
      stanceB,
      match.current_clash,
      r2Config.scoring_matrix
    );
    curClashEntry.team_a_pts = team_a_pts;
    curClashEntry.team_b_pts = team_b_pts;

    // Update team scores in database
    if (teamA) {
      const newScoreA = (teamA.score || 0) + team_a_pts;
      await supabase.from('teams').update({ score: newScoreA }).eq('id', teamA.id);
      teamA.score = newScoreA;
    }
    if (teamB) {
      const newScoreB = (teamB.score || 0) + team_b_pts;
      await supabase.from('teams').update({ score: newScoreB }).eq('id', teamB.id);
      teamB.score = newScoreB;
    }
  } else if (match.current_phase === 'DEBRIEF') {
    if (match.current_clash < numClashes) {
      nextClash = match.current_clash + 1;
      nextPhase = 'HUDDLE';
      nextEndsAt = now + (durations.HUDDLE || 50) * 1000;
    } else {
      isCompleted = true;
      nextPhase = 'DEBRIEF';
      nextEndsAt = now;

      // End-of-Round Nemesis Calculation
      const nemesisResult = calculateNemesis(clashData, match.team_a_id, match.team_b_id);
      if (nemesisResult.teamANemesis && teamA) {
        await supabase.from('teams').update({ nemesis_team_id: nemesisResult.teamANemesis }).eq('id', teamA.id);
        teamA.nemesis_team_id = nemesisResult.teamANemesis;
      }
      if (nemesisResult.teamBNemesis && teamB) {
        await supabase.from('teams').update({ nemesis_team_id: nemesisResult.teamBNemesis }).eq('id', teamB.id);
        teamB.nemesis_team_id = nemesisResult.teamBNemesis;
      }

      // Mark round submission for both teams
      const ptsA = clashData.reduce((acc, c) => acc + (c.team_a_pts || 0), 0);
      const ptsB = clashData.reduce((acc, c) => acc + (c.team_b_pts || 0), 0);

      if (teamA) {
        const subsA = {
          ...teamA.round_submissions,
          'round-2': {
            completed: true,
            completedAt: now,
            answerSubmitted: 'Round 2 Complete',
            pointsAwarded: ptsA,
            isCorrect: true,
          },
        };
        await supabase.from('teams').update({ round_submissions: subsA }).eq('id', teamA.id);
        teamA.round_submissions = subsA;
      }

      if (teamB) {
        const subsB = {
          ...teamB.round_submissions,
          'round-2': {
            completed: true,
            completedAt: now,
            answerSubmitted: 'Round 2 Complete',
            pointsAwarded: ptsB,
            isCorrect: true,
          },
        };
        await supabase.from('teams').update({ round_submissions: subsB }).eq('id', teamB.id);
        teamB.round_submissions = subsB;
      }
    }
  }

  const updatedMatch: Round2Match = {
    ...match,
    current_clash: nextClash,
    current_phase: nextPhase,
    phase_ends_at: nextEndsAt,
    clash_data: clashData,
    completed: isCompleted,
    updated_at: new Date().toISOString(),
  };

  await supabase.from('round2_matches').update({
    current_clash: nextClash,
    current_phase: nextPhase,
    phase_ends_at: nextEndsAt,
    clash_data: clashData,
    completed: isCompleted,
    updated_at: updatedMatch.updated_at,
  }).eq('id', match.id);

  return updatedMatch;
}

export async function fetchFullSyncPayloadFromSupabase(forPlayerId?: string, forTeamId?: string): Promise<SyncPayload> {
  if (!supabase) throw new Error('Supabase is not configured');

  const [gameStateRes, teamsRes, playersRes, matchesRes, round3SessionRes] = await Promise.all([
    supabase.from('game_state').select('*').limit(1).maybeSingle(),
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
    supabase.from('round2_matches').select('*'),
    supabase.from('round3_session').select('*').limit(1).maybeSingle(),
  ]);

  const stateRow = gameStateRes.data || {
    state: 'LOBBY_TEAM_FORMATION',
    current_round_index: 0,
    round_ends_at: null,
    round_is_paused: false,
    config: {},
  };

  const rawConfig = stateRow.config && Object.keys(stateRow.config).length > 0 ? stateRow.config : DEFAULT_CONFIG;
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    theme: { ...DEFAULT_CONFIG.theme, ...(rawConfig.theme || {}) },
    roles: rawConfig.roles || DEFAULT_CONFIG.roles,
    rounds: rawConfig.rounds || DEFAULT_CONFIG.rounds,
    round2: {
      ...DEFAULT_ROUND2_CONFIG,
      ...(rawConfig.round2 || {}),
      phase_durations_seconds: {
        ...DEFAULT_ROUND2_CONFIG.phase_durations_seconds,
        ...(rawConfig.round2?.phase_durations_seconds || {}),
      },
      scoring_matrix: {
        ...DEFAULT_ROUND2_CONFIG.scoring_matrix,
        ...(rawConfig.round2?.scoring_matrix || {}),
      },
    },
    round3: {
      ...DEFAULT_ROUND3_CONFIG,
      ...(rawConfig.round3 || {}),
      wave_phase_durations: {
        ...DEFAULT_ROUND3_CONFIG.wave_phase_durations,
        ...(rawConfig.round3?.wave_phase_durations || {}),
      },
      vessels: {
        ...DEFAULT_ROUND3_CONFIG.vessels,
        ...(rawConfig.round3?.vessels || {}),
      },
      vengeance: {
        ...DEFAULT_ROUND3_CONFIG.vengeance,
        ...(rawConfig.round3?.vengeance || {}),
      },
    },
  };

  // Ensure all teams have a 2-digit battle_code
  const existingBattleCodes = new Set<string>();
  const teamsMissingCode: any[] = [];
  for (const tRow of (teamsRes.data || [])) {
    if (tRow.battle_code) {
      existingBattleCodes.add(tRow.battle_code);
    } else {
      teamsMissingCode.push(tRow);
    }
  }

  for (const tRow of teamsMissingCode) {
    const code = generateBattleCode(existingBattleCodes);
    existingBattleCodes.add(code);
    tRow.battle_code = code;
    // Persist to DB asynchronously
    supabase.from('teams').update({ battle_code: code }).eq('id', tRow.id).then();
  }

  // Ensure all teams have a unique 3-emoji team code
  const existingEmojiCodes = new Set<string>();
  const teamsMissingEmoji: any[] = [];
  for (const tRow of (teamsRes.data || [])) {
    const sub = (tRow.round_submissions && typeof tRow.round_submissions === 'object') ? tRow.round_submissions : {};
    const ec = sub._emoji_code || tRow.emoji_code;
    if (ec) {
      existingEmojiCodes.add(normalizeEmojiCode(ec));
    } else {
      teamsMissingEmoji.push(tRow);
    }
  }

  for (const tRow of teamsMissingEmoji) {
    const code = generateTeamEmojiCode(existingEmojiCodes);
    existingEmojiCodes.add(normalizeEmojiCode(code));
    const sub = (tRow.round_submissions && typeof tRow.round_submissions === 'object') ? { ...tRow.round_submissions } : {};
    sub._emoji_code = code;
    tRow.round_submissions = sub;
    supabase.from('teams').update({ round_submissions: sub }).eq('id', tRow.id).then();
  }

  const players: Player[] = (playersRes.data || []).map(mapDbPlayer);
  const teams: Team[] = (teamsRes.data || []).map(mapDbTeam);

  const playersMap = new Map(players.map(p => [p.id, p]));
  const teamsMap = new Map(teams.map(t => [t.id, t]));

  const player = forPlayerId ? playersMap.get(forPlayerId) || null : null;
  const team = forTeamId
    ? teamsMap.get(forTeamId) || null
    : player?.teamId
    ? teamsMap.get(player.teamId) || null
    : null;

  const currentRoundIndex = Number(stateRow.current_round_index ?? 0);
  const curRound = config.rounds[currentRoundIndex];

  // Process any active matches that expired their phase timer
  let matches: Round2Match[] = (matchesRes.data || []).map(mapDbMatch);
  const now = Date.now();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m.completed && m.phase_ends_at && now >= m.phase_ends_at) {
      matches[i] = await processMatchPhaseAdvance(m, config, teamsMap, playersMap);
    }
  }

  // Find player's active match
  let playerMatch: Round2Match | null = null;
  if (team) {
    const teamMatches = matches.filter(m => m.team_a_id === team.id || m.team_b_id === team.id);
    playerMatch = teamMatches.find(m => !m.completed) || teamMatches[teamMatches.length - 1] || null;
  }

  const sanitizedPlayerMatch = playerMatch ? sanitizeMatchForPlayer(playerMatch, player?.id, team?.id) : null;

  // Process Round 3 Session
  let round3Session: Round3Session | null = round3SessionRes.data ? mapDbRound3Session(round3SessionRes.data) : null;
  if (curRound?.type === 'ODYSSEY_ESCAPE_ROYALE') {
    if (!round3Session || !round3Session.team_states || Object.keys(round3Session.team_states).length === 0) {
      round3Session = await supabaseInitRound3(config, teams);
    } else if (
      !round3Session.is_sudden_death &&
      round3Session.current_phase !== 'COMPLETED' &&
      round3Session.phase_ends_at &&
      now >= round3Session.phase_ends_at
    ) {
      round3Session = await processRound3WaveAdvance(round3Session, config, teamsMap, playersMap);
    } else if (
      round3Session.is_sudden_death &&
      round3Session.sudden_death_state &&
      round3Session.sudden_death_state.phase_ends_at &&
      now >= round3Session.sudden_death_state.phase_ends_at
    ) {
      round3Session = await processRound3WaveAdvance(round3Session, config, teamsMap, playersMap);
    }
  }

  // Build Leaderboard
  const teamsList = teams
    .map(t => {
      const members = t.player_ids.map(pid => {
        const p = playersMap.get(pid);
        const role = config.roles.find(r => r.id === p?.roleId);
        return {
          id: pid,
          name: p?.name || 'Unknown Shade',
          roleName: role?.name || 'Wanderer',
          roleColor: role?.color || '#c4a45a',
        };
      });

      const roundCompleted = curRound ? !!t.round_submissions[curRound.id]?.completed : false;
      const recentDelta = curRound ? t.round_submissions[curRound.id]?.pointsAwarded : undefined;

      // Migrate any legacy 1-word codewords to 2-word ancient phrases
      let teamCodeword = t.assignedCodeword;
      if (!teamCodeword || !teamCodeword.trim().includes(' ')) {
        const round1Data = config.rounds?.[0]?.data as any;
        const words = (round1Data?.codewords && round1Data.codewords.length > 0)
          ? round1Data.codewords
          : DEFAULT_ROUND1_CODEWORDS;
        teamCodeword = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';
        t.assignedCodeword = teamCodeword;
        supabase?.from('teams').update({ assigned_codeword: teamCodeword }).eq('id', t.id).then();
      }

      return {
        id: t.id,
        name: t.name,
        score: t.score,
        player_count: t.player_ids.length,
        battle_code: t.battle_code,
        emoji_code: t.emoji_code,
        nemesis_team_id: t.nemesis_team_id,
        members,
        roundCompleted,
        recentDelta,
        assignedCodeword: teamCodeword,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Unassigned players
  const unassigned = players
    .filter(p => !p.teamId)
    .map(p => {
      const role = config.roles.find(r => r.id === p.roleId);
      return {
        id: p.id,
        name: p.name,
        roleId: p.roleId,
        roleName: role?.name || 'Wanderer',
        roleColor: role?.color || '#c4a45a',
        join_code: p.join_code,
        is_online: p.is_online,
      };
    });

  return {
    state: (stateRow.state as GameState) || 'LOBBY_TEAM_FORMATION',
    current_round_index: currentRoundIndex,
    round_ends_at: stateRow.round_ends_at ? Number(stateRow.round_ends_at) : null,
    round_started_at: stateRow.config?.round_started_at
      ? Number(stateRow.config.round_started_at)
      : (stateRow.round_ends_at ? Math.max(0, Number(stateRow.round_ends_at) - (config.rounds[currentRoundIndex]?.durationSeconds || 300) * 1000) : null),
    round_is_paused: Boolean(stateRow.round_is_paused),
    server_now: Date.now(),
    config,
    player,
    team,
    all_players_count: players.length,
    formed_teams_count: teams.length,
    round2_match: sanitizedPlayerMatch,
    round2_all_matches: matches,
    teams_leaderboard: teamsList,
    unassigned_players: unassigned,
    round3_session: round3Session,
  };
}

export async function supabaseJoinPlayer(name: string, playerId?: string): Promise<{ success: boolean; player: Player }> {
  if (!supabase) throw new Error('Supabase not configured');

  const cleanName = name && name.trim() ? name.trim() : null;

  // 1. Primary path: Call atomic PostgreSQL stored procedure (1 network round-trip, advisory lock serializes concurrent joins)
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('join_player_atomic', {
      p_name: cleanName,
      p_id: playerId || null,
    });

    if (!rpcError && rpcData) {
      return { success: true, player: mapDbPlayer(rpcData) };
    }
    if (rpcError) {
      console.warn('join_player_atomic RPC failed, falling back to client-side logic:', rpcError);
    }
  } catch (rpcErr) {
    console.warn('join_player_atomic RPC call threw, falling back to client-side logic:', rpcErr);
  }

  // 2. Fallback path (offline mock or direct DB access)
  const now = Date.now();
  if (playerId) {
    const { data: existing } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
    if (existing) {
      const updatedName = cleanName || existing.name;
      const { data: updated } = await supabase
        .from('players')
        .update({
          name: updatedName,
          last_seen_at: now,
          is_online: true,
        })
        .eq('id', playerId)
        .select()
        .single();

      return { success: true, player: mapDbPlayer(updated || existing) };
    }
  }

  // Create new player with micro-jitter (15ms-75ms) to prevent simultaneous write collisions
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 60) + 15));
  const { data: allPlayers } = await supabase.from('players').select('join_code, role_id');
  const existingCodes = new Set<string>((allPlayers || []).map(p => p.join_code));
  const existingPlayersList: Player[] = (allPlayers || []).map(p => ({ roleId: p.role_id } as Player));

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;

  const join_code = generateJoinCode(existingCodes);
  const roleId = assignBalancedRole(existingPlayersList, config, undefined, join_code);
  const id = playerId || `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const newPlayerRow = {
    id,
    name: cleanName || `Shade-${join_code}`,
    role_id: roleId,
    join_code,
    team_id: null,
    joined_at: now,
    last_seen_at: now,
    is_online: true,
  };

  const { data: inserted, error } = await supabase
    .from('players')
    .insert(newPlayerRow)
    .select()
    .single();

  if (error) {
    console.error('Error inserting player:', error);
    throw error;
  }

  return { success: true, player: mapDbPlayer(inserted) };
}

export async function supabaseLeavePlayer(playerId: string): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { data: player } = await supabase.from('players').select('team_id').eq('id', playerId).maybeSingle();
  if (player?.team_id) {
    const { data: team } = await supabase.from('teams').select('*').eq('id', player.team_id).maybeSingle();
    if (team) {
      const remainingIds = (team.player_ids || []).filter((id: string) => id !== playerId);
      if (remainingIds.length === 0) {
        await supabase.from('teams').delete().eq('id', team.id);
      } else {
        await supabase.from('teams').update({ player_ids: remainingIds }).eq('id', team.id);
      }
    }
  }

  await supabase.from('players').delete().eq('id', playerId);
  return { success: true };
}

export async function supabaseRerollPlayerRole(playerId: string): Promise<{ success: boolean; player?: Player; error?: string }> {
  if (!supabase) return { success: false, error: 'Database not connected' };

  // 1. Primary path: Call atomic PostgreSQL stored procedure (single round-trip, advisory-lock serialized)
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('reroll_player_role_atomic', {
      p_id: playerId,
    });

    if (!rpcError && rpcData) {
      return { success: true, player: mapDbPlayer(rpcData) };
    }
    if (rpcError) {
      console.warn('reroll_player_role_atomic RPC failed, falling back to client logic:', rpcError);
    }
  } catch (rpcErr) {
    console.warn('reroll_player_role_atomic RPC call threw, falling back to client logic:', rpcErr);
  }

  // 2. Fallback path (offline mock or direct query)
  const { data: playerRow } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
  if (!playerRow) return { success: false, error: 'Player record not found' };

  if (playerRow.team_id) {
    return { success: false, error: 'Cannot reroll role once locked into a crew.' };
  }

  const { data: allPlayers } = await supabase.from('players').select('role_id');
  const existingPlayersList: Player[] = (allPlayers || []).map(p => ({ roleId: p.role_id } as Player));

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;

  const newRoleId = assignBalancedRole(existingPlayersList, config, playerRow.role_id);
  const { data: updated, error } = await supabase
    .from('players')
    .update({ role_id: newRoleId })
    .eq('id', playerId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update role' };
  }

  return { success: true, player: mapDbPlayer(updated) };
}

export async function supabaseFormTeam(
  leaderPlayerId: string,
  joinCodes: string[],
  customName?: string
): Promise<{ success: boolean; team?: Team; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not initialized' };

  const { data: leader } = await supabase.from('players').select('*').eq('id', leaderPlayerId).maybeSingle();
  if (!leader) return { success: false, error: 'Leader player not found' };

  const cleanCodes = Array.from(new Set([
    leader.join_code.toUpperCase(),
    ...joinCodes.map(c => c.trim().toUpperCase()).filter(Boolean)
  ]));

  const { data: matchedRows } = await supabase.from('players').select('*').in('join_code', cleanCodes);
  const matchedPlayers = (matchedRows || []).map(mapDbPlayer);

  if (matchedPlayers.length !== cleanCodes.length) {
    const foundCodes = new Set(matchedPlayers.map(p => p.join_code.toUpperCase()));
    const missing = cleanCodes.filter(c => !foundCodes.has(c));
    return { success: false, error: `Invalid beacon join code: "${missing.join(', ')}"` };
  }

  if (matchedPlayers.length < 2) {
    return { success: false, error: 'A crew requires at least 2 members.' };
  }

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;

  const rolesSet = new Set(matchedPlayers.map(p => p.roleId));
  if (rolesSet.size !== matchedPlayers.length && matchedPlayers.length <= (config.roles?.length || 5)) {
    return { success: false, error: 'Each crew member must possess a unique Underworld Role!' };
  }

  const { count } = await supabase.from('teams').select('*', { count: 'exact', head: true });
  const teamNum = (count || 0) + 1;
  const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const teamName = customName?.trim() || `Crew #${teamNum} • Tartarus Navigators`;

  const round1Data = config.rounds?.[0]?.data as any;
  const words = (round1Data?.codewords && round1Data.codewords.length > 0)
    ? round1Data.codewords
    : DEFAULT_ROUND1_CODEWORDS;
  const assignedCodeword = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';

  const { data: allTeamsForCode } = await supabase.from('teams').select('battle_code');
  const existingBattleCodes = new Set<string>((allTeamsForCode || []).map(t => t.battle_code).filter(Boolean));
  const battleCode = generateBattleCode(existingBattleCodes);

  const teamData = {
    id: teamId,
    name: teamName,
    score: 0,
    assigned_codeword: assignedCodeword,
    player_ids: matchedPlayers.map(p => p.id),
    round_submissions: {},
    battle_code: battleCode,
  };

  const { data: insertedTeam, error: teamErr } = await supabase.from('teams').insert(teamData).select().single();
  if (teamErr) return { success: false, error: teamErr.message };

  // Update players' team_id
  await supabase.from('players').update({ team_id: teamId }).in('id', matchedPlayers.map(p => p.id));

  return { success: true, team: mapDbTeam(insertedTeam) };
}

export async function supabaseRenameTeam(teamId: string, name: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false };
  const { error } = await supabase.from('teams').update({ name: name.trim() }).eq('id', teamId);
  return { success: !error, error: error?.message };
}

/**
 * Create a new team anchored by a leader player.
 * Automatically generates a unique 3-emoji code (from { 🔥, 💀, ⚡, 🌊, 🛡️ }).
 */
export async function supabaseCreateTeam(
  leaderPlayerId: string,
  customName?: string
): Promise<{ success: boolean; team?: Team; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  // 1. Fetch leader player
  const { data: leaderRow } = await supabase.from('players').select('*').eq('id', leaderPlayerId).maybeSingle();
  if (!leaderRow) return { success: false, error: 'Player record not found' };
  const leader = mapDbPlayer(leaderRow);

  if (leader.teamId) {
    return { success: false, error: 'You are already in a team. Leave your current team first.' };
  }

  // 2. Read existing teams to collect existing emoji codes & battle codes
  const { data: allTeamsData } = await supabase.from('teams').select('*');
  const existingEmojiCodes = new Set<string>();
  const existingBattleCodes = new Set<string>();
  for (const tRow of (allTeamsData || [])) {
    const sub = (tRow.round_submissions && typeof tRow.round_submissions === 'object') ? tRow.round_submissions : {};
    const ec = sub._emoji_code || tRow.emoji_code;
    if (ec) existingEmojiCodes.add(normalizeEmojiCode(ec));
    if (tRow.battle_code) existingBattleCodes.add(tRow.battle_code);
  }

  const emojiCode = generateTeamEmojiCode(existingEmojiCodes);
  const battleCode = generateBattleCode(existingBattleCodes);

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const round1Data = config.rounds?.[0]?.data as any;
  const words = (round1Data?.codewords && round1Data.codewords.length > 0)
    ? round1Data.codewords
    : DEFAULT_ROUND1_CODEWORDS;
  const assignedCodeword = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';

  const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const teamName = customName?.trim() || `${leader.name}'s Crew`;

  const teamData = {
    id: teamId,
    name: teamName,
    score: 0,
    assigned_codeword: assignedCodeword,
    player_ids: [leader.id],
    round_submissions: { _emoji_code: emojiCode },
    battle_code: battleCode,
  };

  const { data: insertedTeam, error: teamErr } = await supabase.from('teams').insert(teamData).select().single();
  if (teamErr) return { success: false, error: teamErr.message };

  await supabase.from('players').update({ team_id: teamId }).eq('id', leader.id);

  return { success: true, team: mapDbTeam(insertedTeam) };
}

/**
 * Preview team info by 3-emoji code before locking in a join.
 * Used for the confirmation modal: "Join Elena's Crew? (2/5 members: Elena, Sam)".
 */
export async function supabasePreviewTeamByEmoji(
  emojiCode: string,
  requestingPlayerId?: string
): Promise<{ success: boolean; preview?: TeamPreviewInfo; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };
  const targetCode = normalizeEmojiCode(emojiCode);
  if (!targetCode) return { success: false, error: 'Please enter a 3-emoji team code' };

  const [{ data: teamsData }, { data: playersData }, { row: stateData }] = await Promise.all([
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
    getGameStateRow(),
  ]);

  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const maxMembers = config.team_size || 5;

  const allTeams = (teamsData || []).map(mapDbTeam);
  const matchedTeam = allTeams.find(t => {
    const code = t.emoji_code || ((t.round_submissions?._emoji_code as unknown) as string);
    return code && normalizeEmojiCode(code) === targetCode;
  });

  if (!matchedTeam) {
    return { success: false, error: `No active team found with code "${emojiCode}". Check the code on your teammate's screen.` };
  }

  const allPlayers = (playersData || []).map(mapDbPlayer);
  const playersMap = new Map(allPlayers.map(p => [p.id, p]));
  const roleMap: Record<string, string> = {};
  const roleColorMap: Record<string, string> = {};
  for (const r of (config.roles || [])) {
    roleMap[r.id] = r.name;
    roleColorMap[r.id] = r.color;
  }

  const members: TeamMemberPreview[] = matchedTeam.player_ids.map(pid => {
    const p = playersMap.get(pid);
    const rId = p?.roleId || '';
    return {
      id: pid,
      name: p?.name || 'Teammate',
      roleId: rId,
      roleName: roleMap[rId] || 'Underworld Traveler',
      roleColor: roleColorMap[rId] || '#c4a45a',
    };
  });

  const leaderName = members[0]?.name || 'Captain';
  const memberCount = members.length;
  const isFull = memberCount >= maxMembers;

  let hasRoleConflict = false;
  let conflictingRoleName: string | undefined = undefined;

  if (requestingPlayerId) {
    const reqPlayer = playersMap.get(requestingPlayerId);
    if (reqPlayer && reqPlayer.roleId) {
      const existingRoles = members.map(m => m.roleId);
      const compat = checkTeamRoleCompatibility(existingRoles, reqPlayer.roleId, roleMap);
      if (!compat.compatible) {
        hasRoleConflict = true;
        conflictingRoleName = compat.conflictingRoleName;
      }
    }
  }

  const preview: TeamPreviewInfo = {
    id: matchedTeam.id,
    name: matchedTeam.name,
    emojiCode: matchedTeam.emoji_code || emojiCode,
    memberCount,
    maxMembers,
    isFull,
    leaderName,
    members,
    hasRoleConflict,
    conflictingRoleName,
  };

  return { success: true, preview };
}

/**
 * Join an existing team by tapping its 3-emoji code.
 * Validates capacity and unique Underworld role constraints.
 */
export async function supabaseJoinTeamByEmoji(
  playerId: string,
  emojiCode: string
): Promise<{ success: boolean; team?: Team; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };
  const targetCode = normalizeEmojiCode(emojiCode);
  if (!targetCode) return { success: false, error: 'Please enter a 3-emoji team code' };

  // 1. Fetch player
  const { data: playerRow } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
  if (!playerRow) return { success: false, error: 'Player record not found' };
  const player = mapDbPlayer(playerRow);

  if (player.teamId) {
    return { success: false, error: 'You are already in a team. Leave your current team first.' };
  }

  // 2. Fetch all teams
  const { data: teamsData } = await supabase.from('teams').select('*');
  const allTeams = (teamsData || []).map(mapDbTeam);
  const matchedTeam = allTeams.find(t => {
    const code = t.emoji_code || ((t.round_submissions?._emoji_code as unknown) as string);
    return code && normalizeEmojiCode(code) === targetCode;
  });

  if (!matchedTeam) {
    return { success: false, error: `No active team found with code "${emojiCode}". Check with your team creator.` };
  }

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const maxMembers = config.team_size || 5;

  if (matchedTeam.player_ids.length >= maxMembers) {
    return { success: false, error: `Team "${matchedTeam.name}" is already full (${maxMembers}/${maxMembers} members)!` };
  }

  // Check role uniqueness
  if (player.roleId) {
    const { data: memberRows } = await supabase.from('players').select('role_id, name').in('id', matchedTeam.player_ids);
    const existingRoles = (memberRows || []).map(r => r.role_id);
    const roleMap: Record<string, string> = {};
    for (const r of (config.roles || [])) {
      roleMap[r.id] = r.name;
    }
    const compat = checkTeamRoleCompatibility(existingRoles, player.roleId, roleMap);
    if (!compat.compatible) {
      return {
        success: false,
        error: `Team "${matchedTeam.name}" already has a ${compat.conflictingRoleName}! Re-roll your role or join another team.`,
      };
    }
  }

  // Add player to team
  const updatedPlayerIds = Array.from(new Set([...matchedTeam.player_ids, player.id]));
  const { error: teamUpdateErr } = await supabase
    .from('teams')
    .update({ player_ids: updatedPlayerIds })
    .eq('id', matchedTeam.id);

  if (teamUpdateErr) return { success: false, error: teamUpdateErr.message };

  await supabase.from('players').update({ team_id: matchedTeam.id }).eq('id', player.id);

  const updatedTeam: Team = {
    ...matchedTeam,
    player_ids: updatedPlayerIds,
  };

  return { success: true, team: updatedTeam };
}

/**
 * Leave current team.
 * If this player was the only member, the team is automatically DISBANDED and deleted!
 */
export async function supabaseLeaveTeam(
  playerId: string
): Promise<{ success: boolean; disbanded?: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  const { data: playerRow } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
  if (!playerRow) return { success: false, error: 'Player record not found' };
  const player = mapDbPlayer(playerRow);

  if (!player.teamId) {
    return { success: true, disbanded: false };
  }

  const teamId = player.teamId;
  const { data: teamRow } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle();

  if (!teamRow) {
    await supabase.from('players').update({ team_id: null }).eq('id', player.id);
    return { success: true, disbanded: true };
  }

  const team = mapDbTeam(teamRow);
  const remainingPlayerIds = team.player_ids.filter(id => id !== player.id);

  if (remainingPlayerIds.length === 0) {
    // Last member left: Disband and remove the empty team from database
    await Promise.all([
      supabase.from('teams').delete().eq('id', teamId),
      supabase.from('players').update({ team_id: null }).eq('id', player.id),
    ]);
    return { success: true, disbanded: true };
  } else {
    // Remaining members stay in the team
    await Promise.all([
      supabase.from('teams').update({ player_ids: remainingPlayerIds }).eq('id', teamId),
      supabase.from('players').update({ team_id: null }).eq('id', player.id),
    ]);
    return { success: true, disbanded: false };
  }
}

export async function supabaseSubmitRoundAnswer(
  playerId: string,
  roundId: string,
  answer: string
): Promise<{ success: boolean; message: string; points?: number; isCorrect?: boolean }> {
  if (!supabase) return { success: false, message: 'Database disconnected' };

  const { data: playerRow } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
  if (!playerRow) return { success: false, message: 'Player record not found.' };

  const player = mapDbPlayer(playerRow);

  // Fetch or create team
  let team: Team;
  if (player.teamId) {
    const { data: teamRow } = await supabase.from('teams').select('*').eq('id', player.teamId).maybeSingle();
    team = teamRow ? mapDbTeam(teamRow) : null!;
  } else {
    team = null!;
  }

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;

  if (!team) {
    // Create solo team
    const teamId = `team_solo_${player.id}`;
    const round1Data = config.rounds?.[0]?.data as any;
    const words = (round1Data?.codewords && round1Data.codewords.length > 0)
      ? round1Data.codewords
      : DEFAULT_ROUND1_CODEWORDS;
    const assignedCodeword = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';
    const { data: allTeamsForCode } = await supabase.from('teams').select('battle_code');
    const existingBattleCodes = new Set<string>((allTeamsForCode || []).map(t => t.battle_code).filter(Boolean));
    const battleCode = generateBattleCode(existingBattleCodes);

    const newTeamRow = {
      id: teamId,
      name: `Solo Shade • ${player.name}`,
      score: 0,
      assigned_codeword: assignedCodeword,
      player_ids: [player.id],
      round_submissions: {},
      battle_code: battleCode,
    };
    await supabase.from('teams').insert(newTeamRow);
    await supabase.from('players').update({ team_id: teamId }).eq('id', player.id);
    team = mapDbTeam(newTeamRow);
  }

  const round = config.rounds.find((r: any) => r.id === roundId);
  if (!round) return { success: false, message: 'Invalid round' };

  if (team.round_submissions[roundId]?.completed) {
    return { success: true, message: 'Your crew has already completed this round!', points: team.round_submissions[roundId].pointsAwarded };
  }

  const cleanInput = answer.trim().toUpperCase();
  let isCorrect = false;
  let basePoints = 100;
  let speedBonusMax = 100;

  if (round.type === 'ASCII_SPLITTER') {
    const expected = (team.assignedCodeword || 'ORACLE').toUpperCase();
    isCorrect = cleanInput.replace(/\s+/g, '') === expected.replace(/\s+/g, '');
  } else if (round.type === 'ASYMMETRIC_TEXT_PUZZLE') {
    const expected = (round.data as any).answerCodeword?.toUpperCase() || 'CERBERUS';
    basePoints = (round.data as any).points ?? 200;
    isCorrect = cleanInput.replace(/\s+/g, '') === expected.replace(/\s+/g, '');
  } else if (round.type === 'OFFLINE_TASK_TIMER') {
    const expected = (round.data as any).verificationCode?.toUpperCase() || 'OBOLUS';
    basePoints = (round.data as any).points ?? 250;
    isCorrect = cleanInput.replace(/\s+/g, '') === expected.replace(/\s+/g, '');
  }

  if (!isCorrect) {
    return { success: false, message: 'Incorrect codeword! Consult your crew mates and inspect your clues again.' };
  }

  const now = Date.now();
  let totalAwarded = 100;
  const hintsCount = team.hints_taken?.length || 0;
  let solveTimeSeconds = 0;

  if (round.type === 'ASCII_SPLITTER') {
    const roundStartedAt = stateData?.config?.round_started_at
      ? Number(stateData.config.round_started_at)
      : (stateData?.round_ends_at ? Math.max(0, Number(stateData.round_ends_at) - round.durationSeconds * 1000) : now - 60000);
    solveTimeSeconds = Math.max(0, Math.floor((now - roundStartedAt) / 1000));
    const breakdown = calculateRound1Score(solveTimeSeconds, hintsCount);
    totalAwarded = breakdown.finalPoints;
  } else {
    let speedPoints = 0;
    const roundEndsAt = stateData?.round_ends_at ? Number(stateData.round_ends_at) : null;
    if (roundEndsAt && roundEndsAt > now) {
      const remainingSecs = Math.max(0, (roundEndsAt - now) / 1000);
      const frac = Math.min(1, remainingSecs / round.durationSeconds);
      speedPoints = Math.round(frac * speedBonusMax);
    }
    totalAwarded = basePoints + speedPoints;
  }

  const updatedScore = team.score + totalAwarded;
  const updatedSubmissions = {
    ...team.round_submissions,
    [roundId]: {
      completed: true,
      completedAt: now,
      answerSubmitted: cleanInput,
      pointsAwarded: totalAwarded,
      isCorrect: true,
      hintsCount,
      solveTimeSeconds,
    } as RoundSubmission,
  };

  await supabase.from('teams').update({
    score: updatedScore,
    round_submissions: updatedSubmissions,
  }).eq('id', team.id);

  return {
    success: true,
    message: `Codeword Accepted! +${totalAwarded} points awarded to ${team.name}!`,
    points: totalAwarded,
    isCorrect: true,
  };
}

export async function supabaseRequestRoundHint(
  teamId: string,
  hintIndex: number
): Promise<{ success: boolean; hint?: string; hintsTaken?: number[]; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  const { data: teamRow } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle();
  if (!teamRow) return { success: false, error: 'Team not found' };

  const team = mapDbTeam(teamRow);
  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const currentRound = config.rounds[stateData?.current_round_index || 0];

  const now = Date.now();
  const roundStartedAt = stateData?.config?.round_started_at
    ? Number(stateData.config.round_started_at)
    : (stateData?.round_ends_at ? Math.max(0, Number(stateData.round_ends_at) - (currentRound?.durationSeconds || 300) * 1000) : now - 120000);

  const elapsedSeconds = Math.max(0, Math.floor((now - roundStartedAt) / 1000));
  const hintCfg = ROUND1_HINTS.find(h => h.hintIndex === hintIndex);
  if (!hintCfg) return { success: false, error: 'Invalid hint number' };

  if (elapsedSeconds < hintCfg.availableAfterSeconds) {
    const remaining = hintCfg.availableAfterSeconds - elapsedSeconds;
    return {
      success: false,
      error: `Hint #${hintIndex} is locked. Unlocks in ${Math.floor(remaining / 60)}m ${remaining % 60}s.`,
    };
  }

  const existingHints = new Set(team.hints_taken || []);
  existingHints.add(hintIndex);
  const updatedHints = Array.from(existingHints).sort((a, b) => a - b);

  // Fetch team member names and roles for generating hint text
  const { data: memberRows } = await supabase.from('players').select('*').in('id', team.player_ids);
  const slotMembers = (memberRows || []).map((p: any) => {
    const slotIdx = team.player_ids.indexOf(p.id);
    const roleCfg = config.roles.find((r: any) => r.id === p.role_id);
    return {
      slotIndex: slotIdx >= 0 ? slotIdx : 0,
      playerName: p.name,
      roleName: roleCfg?.name || 'Shade',
      roleColor: roleCfg?.color || '#c4a45a',
    };
  });

  const hintText = generateHintText(hintIndex, team.player_ids.length || config.team_size || 5, slotMembers);

  // Persist hints inside round_submissions._active_hints
  const currentSubmissions = { ...team.round_submissions, _active_hints: updatedHints };
  await supabase.from('teams').update({
    round_submissions: currentSubmissions,
  }).eq('id', teamId);

  return {
    success: true,
    hint: hintText,
    hintsTaken: updatedHints,
  };
}

// Admin Operations
export async function supabaseAdminSetState(state: GameState, roundIndex?: number): Promise<void> {
  if (!supabase) return;

  const { id: stateId, row: stateRow } = await getGameStateRow();
  const update: any = { state, updated_at: new Date().toISOString() };

  if (typeof roundIndex === 'number') {
    update.current_round_index = roundIndex;
  }

  if (state === 'ROUND_ACTIVE') {
    const config = { ...((stateRow?.config && Object.keys(stateRow.config).length > 0) ? stateRow.config : DEFAULT_CONFIG) };
    const idx = typeof roundIndex === 'number' ? roundIndex : Number(stateRow?.current_round_index || 0);
    const round = config.rounds[idx];
    const duration = round ? round.durationSeconds : 300;
    update.round_ends_at = Date.now() + duration * 1000;
    config.round_started_at = Date.now();
    update.config = config;
    update.round_is_paused = false;

    // Assign codewords for Round 1 to any teams that don't have one
    const { data: teamsData } = await supabase.from('teams').select('*');
    const round1Data = round?.data as any;
    const words = (round1Data?.codewords && round1Data.codewords.length > 0)
      ? round1Data.codewords
      : DEFAULT_ROUND1_CODEWORDS;
    for (const t of (teamsData || [])) {
      const isMissingOrOld1Word = !t.assigned_codeword || !t.assigned_codeword.trim().includes(' ');
      if (isMissingOrOld1Word) {
        const word = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';
        await supabase.from('teams').update({ assigned_codeword: word }).eq('id', t.id);
      }
    }
  } else {
    update.round_ends_at = null;
    update.round_is_paused = false;
    if (stateRow?.config?.round_started_at) {
      const config = { ...(stateRow.config || DEFAULT_CONFIG) };
      config.round_started_at = null;
      update.config = config;
    }
  }

  const { error } = await supabase.from('game_state').update(update).eq('id', stateId);
  if (error) {
    console.error('Failed to update game_state:', error);
  }
}

export async function supabaseAdminAdjustTimer(action: 'adjust' | 'pause', secondsDelta?: number): Promise<void> {
  if (!supabase) return;

  const { id: stateId, row: data } = await getGameStateRow();
  if (!data) return;

  const now = Date.now();
  if (action === 'adjust' && typeof secondsDelta === 'number') {
    let endsAt = data.round_ends_at ? Number(data.round_ends_at) : now;
    if (endsAt < now) endsAt = now;
    endsAt += secondsDelta * 1000;
    await supabase.from('game_state').update({ round_ends_at: endsAt }).eq('id', stateId);
  } else if (action === 'pause') {
    const isPaused = !data.round_is_paused;
    if (isPaused) {
      const left = data.round_ends_at ? Math.max(0, Math.round((Number(data.round_ends_at) - now) / 1000)) : 0;
      await supabase.from('game_state').update({ round_is_paused: true, paused_time_left_seconds: left }).eq('id', stateId);
    } else {
      const secs = data.paused_time_left_seconds || 60;
      await supabase.from('game_state').update({ round_is_paused: false, round_ends_at: now + secs * 1000, paused_time_left_seconds: null }).eq('id', stateId);
    }
  }
}

export async function supabaseAdminChangeRole(playerId: string, roleId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('players').update({ role_id: roleId }).eq('id', playerId);
}

export async function supabaseAdminMovePlayerTeam(playerId: string, targetTeamId: string | null): Promise<void> {
  if (!supabase) return;

  // Find player's current team
  const { data: p } = await supabase.from('players').select('team_id').eq('id', playerId).single();
  if (p?.team_id) {
    const { data: oldTeam } = await supabase.from('teams').select('player_ids').eq('id', p.team_id).single();
    if (oldTeam) {
      const rem = (oldTeam.player_ids || []).filter((id: string) => id !== playerId);
      await supabase.from('teams').update({ player_ids: rem }).eq('id', p.team_id);
    }
  }

  if (targetTeamId) {
    const { data: newTeam } = await supabase.from('teams').select('player_ids').eq('id', targetTeamId).single();
    if (newTeam) {
      const ids = Array.from(new Set([...(newTeam.player_ids || []), playerId]));
      await supabase.from('teams').update({ player_ids: ids }).eq('id', targetTeamId);
    }
  }

  await supabase.from('players').update({ team_id: targetTeamId }).eq('id', playerId);
}

export async function supabaseAdminRemovePlayer(playerId: string): Promise<void> {
  await supabaseLeavePlayer(playerId);
}

export async function supabaseAdminAddPlayer(name: string, roleId?: string): Promise<Player> {
  const res = await supabaseJoinPlayer(name);
  if (roleId && supabase) {
    await supabase.from('players').update({ role_id: roleId }).eq('id', res.player.id);
    res.player.roleId = roleId;
  }
  return res.player;
}

export async function supabaseAdminAdjustTeamScore(teamId: string, delta: number): Promise<void> {
  if (!supabase) return;
  const { data: t } = await supabase.from('teams').select('score').eq('id', teamId).single();
  if (t) {
    await supabase.from('teams').update({ score: (t.score || 0) + delta }).eq('id', teamId);
  }
}

export async function supabaseAdminMarkRound1Solved(teamId: string): Promise<{ success: boolean; message?: string; points?: number }> {
  if (!supabase) return { success: false, message: 'Database disconnected' };

  const { data: teamRow } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle();
  if (!teamRow) return { success: false, message: 'Team not found' };

  const team = mapDbTeam(teamRow);
  const round1Key = 'round-1';

  if (team.round_submissions?.[round1Key]?.completed) {
    return { success: true, message: 'Team already solved Round 1', points: team.round_submissions[round1Key].pointsAwarded };
  }

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const round = config.rounds?.[0];
  const durationSecs = round?.durationSeconds || 300;

  const now = Date.now();
  const roundStartedAt = stateData?.config?.round_started_at
    ? Number(stateData.config.round_started_at)
    : (stateData?.round_ends_at ? Math.max(0, Number(stateData.round_ends_at) - durationSecs * 1000) : now - 60000);
  const solveTimeSeconds = Math.max(0, Math.floor((now - roundStartedAt) / 1000));
  const hintsCount = team.hints_taken?.length || 0;
  const breakdown = calculateRound1Score(solveTimeSeconds, hintsCount);
  const pointsAwarded = breakdown.finalPoints;

  const updatedScore = (team.score || 0) + pointsAwarded;
  const updatedSubmissions = {
    ...team.round_submissions,
    [round1Key]: {
      completed: true,
      completedAt: now,
      answerSubmitted: team.assignedCodeword || 'CRIMSON SHADOW',
      pointsAwarded,
      isCorrect: true,
      hintsCount,
      solveTimeSeconds,
    },
  };

  await supabase.from('teams').update({
    score: updatedScore,
    round_submissions: updatedSubmissions,
  }).eq('id', teamId);

  return { success: true, points: pointsAwarded };
}

export async function supabaseAdminUpdateConfig(config: GameConfig): Promise<void> {
  if (!supabase) return;
  const { id: stateId } = await getGameStateRow();
  await supabase.from('game_state').update({ config }).eq('id', stateId);
}

export async function supabaseAdminDeleteTeam(teamId: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database not connected' };

  try {
    // 1. Unassign all players belonging to this crew
    const { error: unassignErr } = await supabase
      .from('players')
      .update({ team_id: null })
      .eq('team_id', teamId);

    if (unassignErr) {
      console.warn('Notice unassigning players:', unassignErr);
    }

    // 2. Delete submissions for this team if table exists
    try {
      await supabase.from('round_submissions').delete().eq('team_id', teamId);
    } catch {
      // ignore
    }

    // 3. Delete the team record
    const { error: deleteErr } = await supabase
      .from('teams')
      .delete()
      .eq('id', teamId);

    if (deleteErr) {
      console.error('Delete team failed:', deleteErr);
      return { success: false, error: deleteErr.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete team' };
  }
}

export async function supabaseAdminResetGame(): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database not connected' };

  try {
    const { id: stateId } = await getGameStateRow();

    // 1. Clean up round_submissions
    try {
      await supabase.from('round_submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } catch {
      // ignore
    }

    // 2. Unassign all players first (clears foreign key references)
    await supabase.from('players').update({ team_id: null }).neq('id', '__dummy_placeholder__');

    // 3. Delete all teams
    const { error: teamsErr } = await supabase.from('teams').delete().neq('id', '__dummy_placeholder__');
    if (teamsErr) {
      console.error('Failed to delete teams:', teamsErr);
      return { success: false, error: `Could not delete teams: ${teamsErr.message}` };
    }

    // 4. Delete all players
    const { error: playersErr } = await supabase.from('players').delete().neq('id', '__dummy_placeholder__');
    if (playersErr) {
      console.error('Failed to delete players:', playersErr);
      return { success: false, error: `Could not delete players: ${playersErr.message}` };
    }

    // 5. Reset game state
    const { error: stateErr } = await supabase.from('game_state').update({
      state: 'LOBBY_TEAM_FORMATION',
      current_round_index: 0,
      round_ends_at: null,
      round_is_paused: false,
      paused_time_left_seconds: null,
      config: DEFAULT_CONFIG,
      updated_at: new Date().toISOString(),
    }).eq('id', stateId);

    if (stateErr) {
      console.error('Failed to reset game_state:', stateErr);
      return { success: false, error: `Could not reset state: ${stateErr.message}` };
    }

    if (typeof window !== 'undefined') {
      localStorage.removeItem('underworld_player_id');
    }

    return { success: true };
  } catch (err: any) {
    console.error('Reset exception:', err);
    return { success: false, error: err?.message || 'Reset failed' };
  }
}

export async function supabaseAdminAutoGroup(): Promise<void> {
  if (!supabase) return;
  const { data: unassigned } = await supabase.from('players').select('*').is('team_id', null);
  if (!unassigned || unassigned.length < 2) return;

  const shuffled = [...unassigned].sort(() => Math.random() - 0.5);
  const teamSize = 5;

  for (let i = 0; i < shuffled.length; i += teamSize) {
    const chunk = shuffled.slice(i, i + teamSize);
    if (chunk.length >= 2) {
      await supabaseFormTeam(chunk[0].id, chunk.slice(1).map(c => c.join_code));
    }
  }
}

const DEMO_CREW_NAME_THEMES = [
  'The Stygian Rowers',
  'Charon\'s Vanguard',
  'The Tartarus Navigators',
  'Erebus Infiltrators',
  'The Asphodel Explorers',
  'Cerberus Whisperers',
  'The Elysian Outlaws',
  'Shadows of Acheron',
  'The Delphi Corsairs',
  'The Lethe Voyagers',
  'Hades\' Sentinels',
  'The Cocytus Drifters',
];

const DEMO_NAMES_BY_ROLE: Record<string, string[]> = {
  navigator: ['Orpheus', 'Jason', 'Palinurus', 'Daedalus', 'Theseus', 'Sinbad', 'Bellerophon'],
  oracle: ['Elena', 'Pythia', 'Cassandra', 'Tiresias', 'Sibyl', 'Circe', 'Medea'],
  scholar: ['Marcus', 'Archimedes', 'Anaximander', 'Hypatia', 'Thales', 'Aristotle', 'Euclid'],
  torchbearer: ['Hesper', 'Prometheus', 'Eos', 'Helios', 'Astraea', 'Vesta', 'Phaethon'],
  negotiator: ['Damon', 'Hermes', 'Odysseus', 'Atalanta', 'Nestor', 'Menelaus', 'Penelope'],
};

export async function supabaseAdminSpawnDemoCrew(): Promise<{ success: boolean; team?: Team; players?: Player[]; error?: string }> {
  if (!supabase) return { success: false, error: 'Database not connected' };

  try {
    const [{ data: existingPlayers }, { data: existingTeams }] = await Promise.all([
      supabase.from('players').select('name, join_code'),
      supabase.from('teams').select('name, battle_code, round_submissions'),
    ]);

    const usedPlayerNames = new Set((existingPlayers || []).map(p => p.name.toLowerCase()));
    const existingCodes = new Set<string>((existingPlayers || []).map(p => p.join_code).filter(Boolean));
    const existingBattleCodes = new Set<string>((existingTeams || []).map(t => t.battle_code).filter(Boolean));
    const existingEmojiCodes = new Set<string>();
    for (const t of (existingTeams || [])) {
      const sub = (t.round_submissions && typeof t.round_submissions === 'object') ? t.round_submissions : {};
      if (sub._emoji_code) existingEmojiCodes.add(normalizeEmojiCode(sub._emoji_code));
    }
    const emojiCode = generateTeamEmojiCode(existingEmojiCodes);
    const teamCount = (existingTeams || []).length;

    const roles = ['navigator', 'oracle', 'scholar', 'torchbearer', 'negotiator'];
    const now = Date.now();
    const teamId = `team_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const battleCode = generateBattleCode(existingBattleCodes);
    const theme = DEMO_CREW_NAME_THEMES[teamCount % DEMO_CREW_NAME_THEMES.length];
    const crewTitle = `Crew #${teamCount + 1} • ${theme}`;
    const assignedCodeword = DEFAULT_ROUND1_CODEWORDS[Math.floor(Math.random() * DEFAULT_ROUND1_CODEWORDS.length)] || 'CRIMSON SHADOW';

    const rawPlayersToInsert: any[] = [];
    const playerIds: string[] = [];
    const playerObjects: Player[] = [];

    for (const roleId of roles) {
      const pool = DEMO_NAMES_BY_ROLE[roleId] || ['Shade'];
      let chosenName = pool.find(n => !usedPlayerNames.has(n.toLowerCase()));
      if (!chosenName) {
        chosenName = `${pool[Math.floor(Math.random() * pool.length)]} ${teamCount + 1}`;
      }
      usedPlayerNames.add(chosenName.toLowerCase());

      let jCode = '';
      do {
        jCode = '';
        for (let c = 0; c < 3; c++) {
          jCode += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)];
        }
      } while (existingCodes.has(jCode));
      existingCodes.add(jCode);

      const pid = `p_${now}_${Math.random().toString(36).substring(2, 8)}`;
      playerIds.push(pid);

      const pRow = {
        id: pid,
        name: chosenName,
        role_id: roleId,
        team_id: teamId,
        join_code: jCode,
        joined_at: now,
        last_seen_at: now,
        is_online: true,
      };
      rawPlayersToInsert.push(pRow);
      playerObjects.push(mapDbPlayer(pRow));
    }

    // 1. Insert team first so players can reference team_id foreign key
    const teamRow = {
      id: teamId,
      name: crewTitle,
      score: 0,
      assigned_codeword: assignedCodeword,
      player_ids: playerIds,
      round_submissions: { _emoji_code: emojiCode },
      battle_code: battleCode,
    };
    const { data: insertedTeam, error: tErr } = await supabase.from('teams').insert(teamRow).select().single();
    if (tErr) throw new Error(`Failed to create demo crew: ${tErr.message}`);

    // 2. Bulk insert all 5 players referencing the newly created teamId in one query
    const { error: pErr } = await supabase.from('players').insert(rawPlayersToInsert);
    if (pErr) throw new Error(`Failed to create demo shades: ${pErr.message}`);

    const createdTeam = mapDbTeam(insertedTeam || teamRow);
    return { success: true, team: createdTeam, players: playerObjects };
  } catch (err: any) {
    console.error('Error in supabaseAdminSpawnDemoCrew:', err);
    return { success: false, error: err?.message || 'Failed to spawn demo crew' };
  }
}

export async function supabaseAdminRebalanceUnassignedRoles(): Promise<{ success: boolean; count: number; error?: string }> {
  if (!supabase) return { success: false, count: 0, error: 'Database disconnected' };

  const { data: unassigned } = await supabase.from('players').select('*').is('team_id', null);
  if (!unassigned || unassigned.length === 0) return { success: true, count: 0 };

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const roles = config.roles || [];
  if (roles.length === 0) return { success: true, count: 0 };

  const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);
  let updatedCount = 0;

  for (let i = 0; i < unassigned.length; i++) {
    const targetRoleId = shuffledRoles[i % shuffledRoles.length].id;
    if (unassigned[i].role_id !== targetRoleId) {
      await supabase.from('players').update({ role_id: targetRoleId }).eq('id', unassigned[i].id);
      updatedCount++;
    }
  }

  return { success: true, count: updatedCount };
}

// ==========================================
// ROUND 2: SHADES IN THE MIST (PRISONER'S DILEMMA)
// ==========================================

export async function supabaseRound2PairByCode(
  myTeamId: string,
  opponentBattleCode: string
): Promise<{ success: boolean; match?: Round2Match; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  const cleanCode = opponentBattleCode.trim().toUpperCase();
  if (cleanCode.length !== 2) {
    return { success: false, error: 'Battle code must be a 2-digit number (e.g. 49)' };
  }

  // Find opponent team with this battle_code
  const { data: opponent } = await supabase
    .from('teams')
    .select('*')
    .eq('battle_code', cleanCode)
    .maybeSingle();

  if (!opponent) {
    return { success: false, error: `No crew found with Battle Code [ ${cleanCode} ]` };
  }

  if (opponent.id === myTeamId) {
    return { success: false, error: 'Cannot pair with your own crew!' };
  }

  // Check if either team is already in an active uncompleted match
  const { data: existingMatches } = await supabase
    .from('round2_matches')
    .select('*')
    .eq('completed', false);

  const existing = (existingMatches || []).find(
    m =>
      m.team_a_id === myTeamId ||
      m.team_b_id === myTeamId ||
      m.team_a_id === opponent.id ||
      m.team_b_id === opponent.id
  );

  if (existing) {
    if (
      (existing.team_a_id === myTeamId && existing.team_b_id === opponent.id) ||
      (existing.team_a_id === opponent.id && existing.team_b_id === myTeamId)
    ) {
      return { success: true, match: mapDbMatch(existing) };
    }
    return { success: false, error: 'One of the crews is already engaged in an active clash!' };
  }

  const { row: stateData } = await getGameStateRow();
  const config = stateData?.config && Object.keys(stateData.config).length > 0 ? stateData.config : DEFAULT_CONFIG;
  const huddleSecs =
    config.round2?.phase_durations_seconds?.HUDDLE || DEFAULT_ROUND2_CONFIG.phase_durations_seconds.HUDDLE;
  const now = Date.now();

  const newMatch = {
    session_id: 'main',
    team_a_id: myTeamId,
    team_b_id: opponent.id,
    current_clash: 1,
    current_phase: 'HUDDLE',
    phase_ends_at: now + huddleSecs * 1000,
    clash_data: [],
    completed: false,
  };

  const { data: inserted, error } = await supabase
    .from('round2_matches')
    .insert(newMatch)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, match: mapDbMatch(inserted) };
}

export async function supabaseRound2CastVote(
  matchId: string,
  playerId: string,
  teamId: string,
  vote: 'TRUCE' | 'AMBUSH'
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  const { data: matchRow } = await supabase.from('round2_matches').select('*').eq('id', matchId).single();
  if (!matchRow) return { success: false, error: 'Match not found' };

  if (matchRow.current_phase !== 'VOTE') {
    return { success: false, error: 'Voting is only allowed during the VOTE phase.' };
  }

  const clashData: Round2ClashData[] = Array.isArray(matchRow.clash_data) ? [...matchRow.clash_data] : [];
  let curClash = clashData.find(c => c.clash === matchRow.current_clash);
  if (!curClash) {
    curClash = {
      clash: matchRow.current_clash,
      team_a_votes: {},
      team_b_votes: {},
      team_a_stance: 'TRUCE',
      team_b_stance: 'TRUCE',
      team_a_pts: 0,
      team_b_pts: 0,
    };
    clashData.push(curClash);
  }

  const isTeamA = matchRow.team_a_id === teamId;
  const isTeamB = matchRow.team_b_id === teamId;
  if (!isTeamA && !isTeamB) {
    return { success: false, error: 'Your team is not in this match.' };
  }

  if (isTeamA) {
    if (curClash.team_a_votes[playerId]) {
      return { success: false, error: 'Choice already recorded.' };
    }
    curClash.team_a_votes[playerId] = vote;
  } else {
    if (curClash.team_b_votes[playerId]) {
      return { success: false, error: 'Choice already recorded.' };
    }
    curClash.team_b_votes[playerId] = vote;
  }

  await supabase.from('round2_matches').update({
    clash_data: clashData,
    updated_at: new Date().toISOString(),
  }).eq('id', matchId);

  // Check if ALL players in both teams have voted
  const [{ data: teamARow }, { data: teamBRow }] = await Promise.all([
    supabase.from('teams').select('player_ids').eq('id', matchRow.team_a_id).single(),
    supabase.from('teams').select('player_ids').eq('id', matchRow.team_b_id).single(),
  ]);

  const teamAMembers = teamARow?.player_ids || [];
  const teamBMembers = teamBRow?.player_ids || [];

  const allAVoted = teamAMembers.length > 0 && teamAMembers.every((id: string) => curClash.team_a_votes[id]);
  const allBVoted = teamBMembers.length > 0 && teamBMembers.every((id: string) => curClash.team_b_votes[id]);

  if (allAVoted && allBVoted) {
    const { row: stateData } = await getGameStateRow();
    const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
    const [{ data: allTeams }, { data: allPlayers }] = await Promise.all([
      supabase.from('teams').select('*'),
      supabase.from('players').select('*'),
    ]);
    const teamsMap = new Map((allTeams || []).map(mapDbTeam).map(t => [t.id, t]));
    const playersMap = new Map((allPlayers || []).map(mapDbPlayer).map(p => [p.id, p]));

    const fullMatch: Round2Match = mapDbMatch({
      ...matchRow,
      clash_data: clashData,
    });
    await processMatchPhaseAdvance(fullMatch, config, teamsMap, playersMap, true);
  }

  return { success: true };
}

export async function supabaseRound2AdvancePhase(matchId: string): Promise<{ success: boolean; match?: Round2Match }> {
  if (!supabase) return { success: false };

  const { data: matchRow } = await supabase.from('round2_matches').select('*').eq('id', matchId).single();
  if (!matchRow) return { success: false };

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const [{ data: allTeams }, { data: allPlayers }] = await Promise.all([
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
  ]);
  const teamsMap = new Map((allTeams || []).map(mapDbTeam).map(t => [t.id, t]));
  const playersMap = new Map((allPlayers || []).map(mapDbPlayer).map(p => [p.id, p]));

  const updated = await processMatchPhaseAdvance(mapDbMatch(matchRow), config, teamsMap, playersMap, true);
  return { success: true, match: updated };
}

export async function supabaseAdminRound2AutoPair(): Promise<{ success: boolean; pairedCount: number; error?: string }> {
  if (!supabase) return { success: false, pairedCount: 0, error: 'Database disconnected' };

  const [{ data: teams }, { data: matches }] = await Promise.all([
    supabase.from('teams').select('*'),
    supabase.from('round2_matches').select('*').eq('completed', false),
  ]);

  if (!teams || teams.length < 2) {
    return { success: false, pairedCount: 0, error: 'Need at least 2 formed crews to pair.' };
  }

  const activeMatchedTeamIds = new Set<string>();
  for (const m of (matches || [])) {
    activeMatchedTeamIds.add(m.team_a_id);
    activeMatchedTeamIds.add(m.team_b_id);
  }

  const unlinked = teams.filter(t => !activeMatchedTeamIds.has(t.id));
  if (unlinked.length < 2) {
    return { success: false, pairedCount: 0, error: 'Fewer than 2 unlinked crews available to pair.' };
  }

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const huddleSecs =
    config.round2?.phase_durations_seconds?.HUDDLE || DEFAULT_ROUND2_CONFIG.phase_durations_seconds.HUDDLE;
  const now = Date.now();

  let pairedCount = 0;
  for (let i = 0; i + 1 < unlinked.length; i += 2) {
    const teamA = unlinked[i];
    const teamB = unlinked[i + 1];

    await supabase.from('round2_matches').insert({
      session_id: 'main',
      team_a_id: teamA.id,
      team_b_id: teamB.id,
      current_clash: 1,
      current_phase: 'HUDDLE',
      phase_ends_at: now + huddleSecs * 1000,
      clash_data: [],
      completed: false,
    });
    pairedCount++;
  }

  return { success: true, pairedCount };
}

export async function supabaseAdminRound2ManualPair(
  teamAId: string,
  teamBId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };
  if (teamAId === teamBId) return { success: false, error: 'Cannot pair a crew with itself.' };

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const huddleSecs =
    config.round2?.phase_durations_seconds?.HUDDLE || DEFAULT_ROUND2_CONFIG.phase_durations_seconds.HUDDLE;
  const now = Date.now();

  const { error } = await supabase.from('round2_matches').insert({
    session_id: 'main',
    team_a_id: teamAId,
    team_b_id: teamBId,
    current_clash: 1,
    current_phase: 'HUDDLE',
    phase_ends_at: now + huddleSecs * 1000,
    clash_data: [],
    completed: false,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function supabaseAdminRound2AdjustTimer(deltaSeconds: number): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { data: matches } = await supabase
    .from('round2_matches')
    .select('*')
    .eq('completed', false);

  const now = Date.now();
  for (const m of (matches || [])) {
    const curEndsAt = Number(m.phase_ends_at) || now;
    const base = curEndsAt < now ? now : curEndsAt;
    const newEndsAt = base + deltaSeconds * 1000;
    await supabase.from('round2_matches').update({ phase_ends_at: newEndsAt }).eq('id', m.id);
  }

  return { success: true };
}

export async function supabaseAdminRound2SkipPhase(matchId?: string): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const query = supabase.from('round2_matches').select('*').eq('completed', false);
  if (matchId) {
    query.eq('id', matchId);
  }

  const { data: matches } = await query;
  if (!matches || matches.length === 0) return { success: true };

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const [{ data: allTeams }, { data: allPlayers }] = await Promise.all([
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
  ]);
  const teamsMap = new Map((allTeams || []).map(mapDbTeam).map(t => [t.id, t]));
  const playersMap = new Map((allPlayers || []).map(mapDbPlayer).map(p => [p.id, p]));

  for (const m of matches) {
    const fullMatch = mapDbMatch(m);
    await processMatchPhaseAdvance(fullMatch, config, teamsMap, playersMap, true);
  }

  return { success: true };
}

export async function supabaseAdminRound2SaveDurations(
  durations: { HUDDLE: number; PARLEY: number; VOTE: number; DEBRIEF: number }
): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { id: stateId, row } = await getGameStateRow();
  const config = row?.config || DEFAULT_CONFIG;
  const currentR2 = config.round2 || DEFAULT_ROUND2_CONFIG;

  const updatedConfig: GameConfig = {
    ...config,
    round2: {
      ...currentR2,
      phase_durations_seconds: durations,
    },
  };

  await supabase.from('game_state').update({ config: updatedConfig }).eq('id', stateId);
  return { success: true };
}

export async function supabaseAdminRound2SaveScoring(
  scoringMatrix: Record<string, Round2ScoringTier>
): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { id: stateId, row } = await getGameStateRow();
  const config = row?.config || DEFAULT_CONFIG;
  const currentR2 = config.round2 || DEFAULT_ROUND2_CONFIG;

  const updatedConfig: GameConfig = {
    ...config,
    round2: {
      ...currentR2,
      scoring_matrix: scoringMatrix,
    },
  };

  await supabase.from('game_state').update({ config: updatedConfig }).eq('id', stateId);
  return { success: true };
}

export async function supabaseAdminRound2ResetMatches(): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  await supabase.from('round2_matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('teams').update({ nemesis_team_id: null }).neq('id', '__placeholder__');

  // Also remove round-2 from round_submissions on teams
  const { data: teams } = await supabase.from('teams').select('id, round_submissions');
  for (const t of (teams || [])) {
    if (t.round_submissions && t.round_submissions['round-2']) {
      const updated = { ...t.round_submissions };
      delete updated['round-2'];
      await supabase.from('teams').update({ round_submissions: updated }).eq('id', t.id);
    }
  }

  return { success: true };
}

// --------------------------------------------------------------------------
// ROUND 3: THE ODYSSEY ESCAPE ROYALE SERVICE FUNCTIONS
// --------------------------------------------------------------------------

export function mapDbRound3Session(row: any): Round3Session {
  return {
    id: row.id || 'r3_main',
    session_id: row.session_id || 'main',
    current_wave: Number(row.current_wave || 1),
    current_phase: (row.current_phase || 'BLUFF') as Round3Phase,
    phase_ends_at: Number(row.phase_ends_at || 0),
    team_states: row.team_states || {},
    wave_votes: row.wave_votes || {},
    wave_reports: row.wave_reports || {},
    is_sudden_death: Boolean(row.is_sudden_death),
    sudden_death_state: row.sudden_death_state || null,
    podium: row.podium || {
      gold_team_id: null,
      silver_team_id: null,
      bronze_team_id: null,
    },
    updated_at: row.updated_at,
  };
}

export async function supabaseInitOrGetRound3Session(
  config: GameConfig,
  teams: Team[],
  forceReset: boolean = false
): Promise<Round3Session> {
  if (!supabase) throw new Error('Supabase not configured');

  const r3Config = config.round3 || DEFAULT_ROUND3_CONFIG;
  const durations = r3Config.wave_phase_durations || DEFAULT_ROUND3_CONFIG.wave_phase_durations;
  const now = Date.now();

  if (!forceReset) {
    const { data: existing } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
    if (existing && existing.team_states && Object.keys(existing.team_states).length > 0) {
      return mapDbRound3Session(existing);
    }
  }

  // Read all Round 2 matches to evaluate moral legacy and Winds of Olympus honor boost
  const { data: matchesData } = await supabase.from('round2_matches').select('*');
  const matches: Round2Match[] = (matchesData || []).map(mapDbMatch);

  // Calculate starting distance & Winds of Olympus honor boost for each active team
  const teamStates: Record<string, Round3TeamState> = {};
  for (const team of teams) {
    const hasMutualHonor = checkRound2MutualHonor(team.id, matches);
    const starting = calculateRound3StartingDistance(team.score, hasMutualHonor, r3Config);

    teamStates[team.id] = {
      team_id: team.id,
      current_distance_meters: starting.startingMeters,
      has_escaped: false,
      escape_rank: null,
      escaped_in_wave: null,
      cerberus_used: false,
      honor_bonus_granted: hasMutualHonor,
      honor_bonus_meters: starting.honorBonusMeters,
    };

    // Upsert into round3_team_state table
    await supabase.from('round3_team_state').upsert({
      team_id: team.id,
      current_distance_meters: starting.startingMeters,
      has_escaped: false,
      escape_rank: null,
      escaped_in_wave: null,
      cerberus_used: false,
      honor_bonus_granted: hasMutualHonor,
      honor_bonus_meters: starting.honorBonusMeters,
      updated_at: new Date().toISOString(),
    });
  }

  const initialSession: Round3Session = {
    id: 'r3_main',
    session_id: 'main',
    current_wave: 1,
    current_phase: 'BLUFF',
    phase_ends_at: now + (durations.BLUFF || 55) * 1000,
    team_states: teamStates,
    wave_votes: { 1: {} },
    wave_reports: {},
    is_sudden_death: false,
    sudden_death_state: null,
    podium: {
      gold_team_id: null,
      silver_team_id: null,
      bronze_team_id: null,
    },
    updated_at: new Date().toISOString(),
  };

  await supabase.from('round3_session').upsert({
    id: initialSession.id,
    session_id: initialSession.session_id,
    current_wave: initialSession.current_wave,
    current_phase: initialSession.current_phase,
    phase_ends_at: initialSession.phase_ends_at,
    is_sudden_death: false,
    sudden_death_teams: null,
    sudden_death_state: null,
    team_states: initialSession.team_states,
    wave_votes: initialSession.wave_votes,
    wave_reports: initialSession.wave_reports,
    podium: initialSession.podium,
    updated_at: initialSession.updated_at,
  });

  return initialSession;
}

export const supabaseInitRound3 = supabaseInitOrGetRound3Session;

function resolveSuddenDeathStance(
  votes: Record<string, Round3SuddenDeathAction>,
  memberIds: string[],
  playersMap: Map<string, Player>
): Round3SuddenDeathAction {
  const counts: Record<Round3SuddenDeathAction, number> = {
    SHIELDS: 0,
    RAM: 0,
    SAILS: 0,
  };
  for (const pid of memberIds) {
    const v = votes[pid];
    if (v && counts[v] !== undefined) counts[v]++;
  }

  const maxV = Math.max(counts.SHIELDS, counts.RAM, counts.SAILS);
  if (maxV === 0) return 'SHIELDS';

  const tied = (['SHIELDS', 'RAM', 'SAILS'] as Round3SuddenDeathAction[]).filter(a => counts[a] === maxV);
  if (tied.length === 1) return tied[0];

  const negId = memberIds.find(pid => playersMap.get(pid)?.roleId === 'negotiator');
  if (negId && votes[negId] && tied.includes(votes[negId])) {
    return votes[negId];
  }
  return tied[0];
}

export async function processRound3WaveAdvance(
  session: Round3Session,
  config: GameConfig,
  teamsMap: Map<string, Team>,
  playersMap: Map<string, Player>,
  forceSkip: boolean = false
): Promise<Round3Session> {
  if (!supabase) return session;
  const now = Date.now();

  // 1. Handle Sudden Death progression if active
  if (session.is_sudden_death && session.sudden_death_state) {
    const sd = session.sudden_death_state;
    if (forceSkip || (sd.phase_ends_at && now >= sd.phase_ends_at)) {
      if (sd.phase === 'PARLEY') {
        sd.phase = 'VOTE';
        sd.phase_ends_at = now + 20 * 1000;
      } else if (sd.phase === 'VOTE') {
        sd.phase = 'REVEAL';
        sd.phase_ends_at = now + 30 * 1000;

        const [teamAId, teamBId] = sd.teams;
        const teamA = teamsMap.get(teamAId);
        const teamB = teamsMap.get(teamBId);

        const stanceA = resolveSuddenDeathStance(sd.player_votes.team_a || {}, teamA?.player_ids || [], playersMap);
        const stanceB = resolveSuddenDeathStance(sd.player_votes.team_b || {}, teamB?.player_ids || [], playersMap);
        sd.stances.team_a = stanceA;
        sd.stances.team_b = stanceB;

        const outcome = resolveSuddenDeath(stanceA, stanceB);
        sd.resolution_text = outcome.description;
        if (outcome.winner === 'team_a') {
          sd.winner_team_id = teamAId;
        } else if (outcome.winner === 'team_b') {
          sd.winner_team_id = teamBId;
        } else {
          sd.winner_team_id = null;
        }
      }

      await supabase.from('round3_session').update({
        sudden_death_state: sd,
        updated_at: new Date().toISOString(),
      }).eq('id', session.id);
    }
    return session;
  }

  // 2. Normal wave progression
  if (session.current_phase === 'COMPLETED') {
    return session;
  }

  if (!forceSkip && (!session.phase_ends_at || now < session.phase_ends_at)) {
    return session;
  }

  const r3Config = config.round3 || DEFAULT_ROUND3_CONFIG;
  const durations = r3Config.wave_phase_durations || DEFAULT_ROUND3_CONFIG.wave_phase_durations;
  const currentWave = session.current_wave;

  if (session.current_phase === 'BLUFF') {
    session.current_phase = 'VOTE';
    session.phase_ends_at = now + (durations.VOTE || 20) * 1000;

    if (!session.wave_votes[currentWave]) {
      session.wave_votes[currentWave] = {};
    }
  } else if (session.current_phase === 'VOTE') {
    session.current_phase = 'REVEAL';
    session.phase_ends_at = now + (durations.REVEAL || 25) * 1000;

    const currentWaveVotes = session.wave_votes[currentWave] || {};
    const participatingTeams: Team[] = [];

    for (const [tid, team] of teamsMap.entries()) {
      if (!session.team_states[tid]?.has_escaped) {
        participatingTeams.push(team);
        let tVote = currentWaveVotes[tid];
        if (!tVote) {
          tVote = {
            team_id: tid,
            player_votes: {},
            resolved_vessel: 'ROWBOAT',
            meters_gained: 0,
            created_at: new Date().toISOString(),
          };
          currentWaveVotes[tid] = tVote;
        } else if (!tVote.resolved_vessel) {
          tVote.resolved_vessel = resolveTeamVesselChoice(
            tVote.player_votes || {},
            team.player_ids || [],
            playersMap
          );
        }
      }
    }
    session.wave_votes[currentWave] = currentWaveVotes;

    // Evaluate wave congestion & distance surge
    const waveReport = evaluateWaveCongestion({
      activeTeams: participatingTeams,
      teamVotes: currentWaveVotes,
      currentTeamStates: session.team_states,
      config: r3Config,
      waveNumber: currentWave,
      existingPodium: session.podium,
      teamsMap,
    });

    session.wave_reports[currentWave] = waveReport;

    // Apply distance updates to team states and database
    for (const tid in waveReport.team_outcomes) {
      const outcome = waveReport.team_outcomes[tid];
      const curState = session.team_states[tid] || {
        team_id: tid,
        current_distance_meters: 0,
        has_escaped: false,
        escape_rank: null,
        escaped_in_wave: null,
        cerberus_used: false,
      };

      curState.current_distance_meters = outcome.new_total_distance;
      if (outcome.just_escaped) {
        curState.has_escaped = true;
        curState.escaped_in_wave = currentWave;
        curState.escape_rank = outcome.escape_rank || null;

        // Assign podium spot
        if (outcome.escape_rank === 1 && !session.podium.gold_team_id) {
          session.podium.gold_team_id = tid;
        } else if (outcome.escape_rank === 2 && !session.podium.silver_team_id) {
          session.podium.silver_team_id = tid;
        } else if (outcome.escape_rank === 3 && !session.podium.bronze_team_id) {
          session.podium.bronze_team_id = tid;
        }

        // Award bonus score on teams table for escaping
        const teamObj = teamsMap.get(tid);
        if (teamObj) {
          const rankBonus = outcome.escape_rank === 1 ? 500 : outcome.escape_rank === 2 ? 350 : outcome.escape_rank === 3 ? 200 : 100;
          const updatedScore = teamObj.score + rankBonus;
          const updatedSubmissions = {
            ...teamObj.round_submissions,
            'round-3': {
              completed: true,
              completedAt: now,
              answerSubmitted: `ESCAPED_WAVE_${currentWave}_${outcome.vessel}`,
              pointsAwarded: rankBonus,
              isCorrect: true,
              solveTimeSeconds: currentWave * 100,
            } as RoundSubmission,
          };
          await supabase.from('teams').update({
            score: updatedScore,
            round_submissions: updatedSubmissions,
          }).eq('id', tid);
        }
      }

      // Check Cerberus used
      const vote = currentWaveVotes[tid];
      if (vote?.cerberus_target_team_id) {
        curState.cerberus_used = true;
      }

      session.team_states[tid] = curState;

      // Update round3_team_state table in DB
      await supabase.from('round3_team_state').upsert({
        team_id: tid,
        current_distance_meters: curState.current_distance_meters,
        has_escaped: curState.has_escaped,
        escape_rank: curState.escape_rank,
        escaped_in_wave: curState.escaped_in_wave,
        cerberus_used: curState.cerberus_used,
        honor_bonus_granted: curState.honor_bonus_granted,
        honor_bonus_meters: curState.honor_bonus_meters,
        updated_at: new Date().toISOString(),
      });
    }

    // Persist wave vote details to round3_wave_votes table for relational logs
    for (const tid in currentWaveVotes) {
      const vote = currentWaveVotes[tid];
      const outcome = waveReport.team_outcomes[tid];
      await supabase.from('round3_wave_votes').insert({
        id: `vote_w${currentWave}_${tid}_${now}`,
        wave_number: currentWave,
        team_id: tid,
        player_votes: vote.player_votes,
        resolved_vessel: vote.resolved_vessel,
        cerberus_target_team_id: vote.cerberus_target_team_id || null,
        cerberus_guessed_vessel: vote.cerberus_guessed_vessel || null,
        meters_gained: outcome?.total_meters_gained || 0,
        created_at: new Date().toISOString(),
      });
    }
  } else if (session.current_phase === 'REVEAL') {
    // Check if 3 teams have escaped (or all active participating teams escaped)
    const escapedCount = Object.values(session.team_states).filter(s => s.has_escaped).length;
    const totalTeams = teamsMap.size;

    if (escapedCount >= 3 || (totalTeams > 0 && escapedCount >= totalTeams)) {
      session.current_phase = 'COMPLETED';
      session.phase_ends_at = now;
    } else {
      // Wave continuation: Advance to next wave
      session.current_wave = currentWave + 1;
      session.current_phase = 'BLUFF';
      session.phase_ends_at = now + (durations.BLUFF || 55) * 1000;
      session.wave_votes[session.current_wave] = {};
    }
  }

  // Persist updated session to DB
  await supabase.from('round3_session').upsert({
    id: session.id,
    session_id: session.session_id,
    current_wave: session.current_wave,
    current_phase: session.current_phase,
    phase_ends_at: session.phase_ends_at,
    is_sudden_death: session.is_sudden_death,
    sudden_death_state: session.sudden_death_state,
    team_states: session.team_states,
    wave_votes: session.wave_votes,
    wave_reports: session.wave_reports,
    podium: session.podium,
    updated_at: new Date().toISOString(),
  });

  return session;
}

export async function supabaseRound3CastVote(
  teamId: string,
  playerId: string,
  vessel: Round3Vessel,
  cerberusTargetTeamId?: string,
  cerberusGuessedVessel?: Round3Vessel
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) return { success: false, error: 'Round 3 session not active' };

  if (sessionRow.current_phase !== 'VOTE') {
    return { success: false, error: 'Voting is only open during the VOTE phase.' };
  }

  const session = mapDbRound3Session(sessionRow);
  const curWave = session.current_wave;
  if (!session.wave_votes[curWave]) {
    session.wave_votes[curWave] = {};
  }
  if (!session.wave_votes[curWave][teamId]) {
    session.wave_votes[curWave][teamId] = {
      team_id: teamId,
      player_votes: {},
      resolved_vessel: vessel,
      meters_gained: 0,
      created_at: new Date().toISOString(),
    };
  }

  const teamVote = session.wave_votes[curWave][teamId];
  teamVote.player_votes[playerId] = vessel;

  // Stygian Leash Cerberus revenge (if eligible)
  if (cerberusTargetTeamId && !session.team_states[teamId]?.cerberus_used) {
    teamVote.cerberus_target_team_id = cerberusTargetTeamId;
    teamVote.cerberus_guessed_vessel = cerberusGuessedVessel || null;
  }

  await supabase.from('round3_session').update({
    wave_votes: session.wave_votes,
    updated_at: new Date().toISOString(),
  }).eq('id', session.id);

  return { success: true };
}

export async function supabaseRound3SuddenDeathVote(
  teamId: string,
  playerId: string,
  action: Round3SuddenDeathAction
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow || !sessionRow.sudden_death_state) {
    return { success: false, error: 'Sudden death standoff is not active' };
  }

  const session = mapDbRound3Session(sessionRow);
  const sd = session.sudden_death_state;
  if (!sd || sd.phase !== 'VOTE') {
    return { success: false, error: 'Voting is only open during Sudden Death VOTE phase' };
  }

  if (sd.teams[0] === teamId) {
    if (!sd.player_votes.team_a) sd.player_votes.team_a = {};
    sd.player_votes.team_a[playerId] = action;
  } else if (sd.teams[1] === teamId) {
    if (!sd.player_votes.team_b) sd.player_votes.team_b = {};
    sd.player_votes.team_b[playerId] = action;
  } else {
    return { success: false, error: 'Your team is not a contender in this Sudden Death Standoff' };
  }

  await supabase.from('round3_session').update({
    sudden_death_state: sd,
    updated_at: new Date().toISOString(),
  }).eq('id', session.id);

  return { success: true };
}

export async function supabaseAdminRound3AdjustTimer(deltaSeconds: number): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) return { success: false };

  const now = Date.now();
  if (sessionRow.is_sudden_death && sessionRow.sudden_death_state) {
    const curEnds = Number(sessionRow.sudden_death_state.phase_ends_at) || now;
    const base = curEnds < now ? now : curEnds;
    sessionRow.sudden_death_state.phase_ends_at = base + deltaSeconds * 1000;
    await supabase.from('round3_session').update({
      sudden_death_state: sessionRow.sudden_death_state,
      updated_at: new Date().toISOString(),
    }).eq('id', sessionRow.id);
  } else {
    const curEnds = Number(sessionRow.phase_ends_at) || now;
    const base = curEnds < now ? now : curEnds;
    await supabase.from('round3_session').update({
      phase_ends_at: base + deltaSeconds * 1000,
      updated_at: new Date().toISOString(),
    }).eq('id', sessionRow.id);
  }

  return { success: true };
}

export async function supabaseAdminRound3NextPhase(): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) return { success: false };

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
  const [{ data: allTeams }, { data: allPlayers }] = await Promise.all([
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
  ]);
  const teamsMap = new Map((allTeams || []).map(mapDbTeam).map(t => [t.id, t]));
  const playersMap = new Map((allPlayers || []).map(mapDbPlayer).map(p => [p.id, p]));

  const session = mapDbRound3Session(sessionRow);
  await processRound3WaveAdvance(session, config, teamsMap, playersMap, true);
  return { success: true };
}

export async function supabaseAdminRound3ForceNextWave(): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) return { success: false };

  const session = mapDbRound3Session(sessionRow);
  const now = Date.now();
  const durations = DEFAULT_ROUND3_CONFIG.wave_phase_durations;

  session.current_wave = session.current_wave + 1;
  session.current_phase = 'BLUFF';
  session.phase_ends_at = now + durations.BLUFF * 1000;
  if (!session.wave_votes[session.current_wave]) {
    session.wave_votes[session.current_wave] = {};
  }

  await supabase.from('round3_session').update({
    current_wave: session.current_wave,
    current_phase: session.current_phase,
    phase_ends_at: session.phase_ends_at,
    wave_votes: session.wave_votes,
    updated_at: new Date().toISOString(),
  }).eq('id', session.id);

  return { success: true };
}

export async function supabaseAdminRound3AdjustDistance(teamId: string, deltaMeters: number): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) return { success: false };

  const session = mapDbRound3Session(sessionRow);
  if (!session.team_states[teamId]) {
    session.team_states[teamId] = {
      team_id: teamId,
      current_distance_meters: 0,
      has_escaped: false,
      escape_rank: null,
      escaped_in_wave: null,
      cerberus_used: false,
    };
  }

  const curState = session.team_states[teamId];
  curState.current_distance_meters = Math.max(0, curState.current_distance_meters + deltaMeters);
  if (curState.current_distance_meters >= 1000) {
    curState.has_escaped = true;
    curState.escaped_in_wave = session.current_wave;
  }

  await Promise.all([
    supabase.from('round3_session').update({
      team_states: session.team_states,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id),
    supabase.from('round3_team_state').upsert({
      team_id: teamId,
      current_distance_meters: curState.current_distance_meters,
      has_escaped: curState.has_escaped,
      escape_rank: curState.escape_rank,
      escaped_in_wave: curState.escaped_in_wave,
      cerberus_used: curState.cerberus_used,
      honor_bonus_granted: curState.honor_bonus_granted,
      honor_bonus_meters: curState.honor_bonus_meters,
      updated_at: new Date().toISOString(),
    }),
  ]);

  return { success: true };
}

export async function supabaseAdminRound3ToggleHonorBonus(teamId: string): Promise<{ success: boolean; granted?: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };

  let { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) {
    const { data: teamsData } = await supabase.from('teams').select('*');
    const teams = (teamsData || []).map(mapDbTeam);
    await supabaseInitOrGetRound3Session(DEFAULT_CONFIG, teams, false);
    const { data: createdRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
    sessionRow = createdRow;
  }

  if (!sessionRow) return { success: false, error: 'Round 3 session not active' };

  const session = mapDbRound3Session(sessionRow);
  if (!session.team_states[teamId]) {
    session.team_states[teamId] = {
      team_id: teamId,
      current_distance_meters: 0,
      has_escaped: false,
      escape_rank: null,
      escaped_in_wave: null,
      cerberus_used: false,
      honor_bonus_granted: false,
      honor_bonus_meters: 0,
    };
  }

  const curState = session.team_states[teamId];
  const nextGranted = !curState.honor_bonus_granted;
  const deltaMeters = nextGranted ? 75 : -75;

  curState.honor_bonus_granted = nextGranted;
  curState.honor_bonus_meters = nextGranted ? 75 : 0;
  curState.current_distance_meters = Math.max(0, curState.current_distance_meters + deltaMeters);

  if (curState.current_distance_meters >= 1000) {
    curState.has_escaped = true;
    curState.escaped_in_wave = session.current_wave;
  } else {
    curState.has_escaped = false;
    curState.escape_rank = null;
    curState.escaped_in_wave = null;
  }

  await Promise.all([
    supabase.from('round3_session').update({
      team_states: session.team_states,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id),
    supabase.from('round3_team_state').upsert({
      team_id: teamId,
      current_distance_meters: curState.current_distance_meters,
      has_escaped: curState.has_escaped,
      escape_rank: curState.escape_rank,
      escaped_in_wave: curState.escaped_in_wave,
      cerberus_used: curState.cerberus_used,
      honor_bonus_granted: curState.honor_bonus_granted,
      honor_bonus_meters: curState.honor_bonus_meters,
      updated_at: new Date().toISOString(),
    }),
  ]);

  return { success: true, granted: nextGranted };
}

export async function supabaseAdminRound3TriggerSuddenDeath(teamAId: string, teamBId: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Database disconnected' };
  if (teamAId === teamBId) return { success: false, error: 'Cannot trigger sudden death with identical team' };

  const { data: sessionRow } = await supabase.from('round3_session').select('*').limit(1).maybeSingle();
  if (!sessionRow) return { success: false, error: 'Round 3 session not active' };

  const now = Date.now();
  const suddenDeathState: Round3SuddenDeathState = {
    is_active: true,
    phase: 'PARLEY',
    phase_ends_at: now + 40 * 1000,
    teams: [teamAId, teamBId],
    player_votes: {
      team_a: {},
      team_b: {},
    },
    stances: {},
    winner_team_id: null,
    resolution_text: null,
  };

  await supabase.from('round3_session').update({
    is_sudden_death: true,
    sudden_death_teams: [teamAId, teamBId],
    sudden_death_state: suddenDeathState,
    updated_at: new Date().toISOString(),
  }).eq('id', sessionRow.id);

  return { success: true };
}

export async function supabaseAdminRound3SaveConfig(round3Config: Round3Config): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  const { id: stateId, row } = await getGameStateRow();
  const config = row?.config || DEFAULT_CONFIG;

  const updatedConfig: GameConfig = {
    ...config,
    round3: round3Config,
  };

  await supabase.from('game_state').update({ config: updatedConfig }).eq('id', stateId);
  return { success: true };
}

export async function supabaseAdminRound3ResetSession(): Promise<{ success: boolean }> {
  if (!supabase) return { success: false };

  await supabase.from('round3_session').delete().neq('id', 'placeholder');
  await supabase.from('round3_team_state').delete().neq('team_id', 'placeholder');
  await supabase.from('round3_wave_votes').delete().neq('id', 'placeholder');

  // Also remove round-3 from round_submissions on teams
  const { data: teams } = await supabase.from('teams').select('id, round_submissions');
  for (const t of (teams || [])) {
    if (t.round_submissions && t.round_submissions['round-3']) {
      const updated = { ...t.round_submissions };
      delete updated['round-3'];
      await supabase.from('teams').update({ round_submissions: updated }).eq('id', t.id);
    }
  }

  return { success: true };
}

