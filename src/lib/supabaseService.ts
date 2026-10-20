import { supabase } from './supabase';
import { DEFAULT_CONFIG, DEFAULT_ROUND2_CONFIG } from './defaultConfig';
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

function assignBalancedRole(players: Player[], config: GameConfig): string {
  const roles = config.roles;
  if (!roles || roles.length === 0) return 'wanderer';

  const roleCounts: Record<string, number> = {};
  for (const r of roles) {
    roleCounts[r.id] = 0;
  }

  for (const player of players) {
    if (roleCounts[player.roleId] !== undefined) {
      roleCounts[player.roleId]++;
    }
  }

  let minRole = roles[0].id;
  let minCount = roleCounts[minRole] ?? 0;

  for (const r of roles) {
    const count = roleCounts[r.id] ?? 0;
    if (count < minCount) {
      minCount = count;
      minRole = r.id;
    }
  }

  return minRole;
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

  return {
    id: row.id,
    name: row.name,
    score: row.score || 0,
    assignedCodeword: row.assigned_codeword || 'ORACLE',
    player_ids: Array.isArray(row.player_ids) ? row.player_ids : [],
    round_submissions: submissions,
    battle_code: row.battle_code || undefined,
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

  const [gameStateRes, teamsRes, playersRes, matchesRes] = await Promise.all([
    supabase.from('game_state').select('*').limit(1).maybeSingle(),
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
    supabase.from('round2_matches').select('*'),
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

      return {
        id: t.id,
        name: t.name,
        score: t.score,
        player_count: t.player_ids.length,
        battle_code: t.battle_code,
        nemesis_team_id: t.nemesis_team_id,
        members,
        roundCompleted,
        recentDelta,
        assignedCodeword: t.assignedCodeword,
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
  };
}

export async function supabaseJoinPlayer(name: string, playerId?: string): Promise<{ success: boolean; player: Player }> {
  if (!supabase) throw new Error('Supabase not configured');

  const now = Date.now();
  if (playerId) {
    const { data: existing } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
    if (existing) {
      const updatedName = name && name.trim() ? name.trim() : existing.name;
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

  // Create new player
  const { data: allPlayers } = await supabase.from('players').select('join_code, role_id');
  const existingCodes = new Set<string>((allPlayers || []).map(p => p.join_code));
  const existingPlayersList: Player[] = (allPlayers || []).map(p => ({ roleId: p.role_id } as Player));

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;

  const join_code = generateJoinCode(existingCodes);
  const roleId = assignBalancedRole(existingPlayersList, config);
  const id = playerId || `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const newPlayerRow = {
    id,
    name: name && name.trim() ? name.trim() : `Shade-${join_code}`,
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

  const words = ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];
  const assignedCodeword = words[Math.floor(Math.random() * words.length)];

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

  if (!team) {
    // Create solo team
    const teamId = `team_solo_${player.id}`;
    const words = ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];
    const assignedCodeword = words[Math.floor(Math.random() * words.length)];
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

  const { row: stateData } = await getGameStateRow();
  const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
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
    const words = (round?.data as any)?.codewords || ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];
    for (const t of (teamsData || [])) {
      if (!t.assigned_codeword) {
        const word = words[Math.floor(Math.random() * words.length)];
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

export async function supabaseAdminSpawnDemoCrew(): Promise<void> {
  if (!supabase) return;

  const [{ data: existingPlayers }, { data: existingTeams }] = await Promise.all([
    supabase.from('players').select('name'),
    supabase.from('teams').select('name'),
  ]);

  const usedPlayerNames = new Set((existingPlayers || []).map(p => p.name.toLowerCase()));
  const teamCount = (existingTeams || []).length;

  const roles = ['navigator', 'oracle', 'scholar', 'torchbearer', 'negotiator'];
  const createdPlayers: Player[] = [];

  for (const roleId of roles) {
    const pool = DEMO_NAMES_BY_ROLE[roleId] || ['Shade'];
    let chosenName = pool.find(n => !usedPlayerNames.has(n.toLowerCase()));
    if (!chosenName) {
      chosenName = `${pool[Math.floor(Math.random() * pool.length)]} ${teamCount + 1}`;
    }
    usedPlayerNames.add(chosenName.toLowerCase());

    const p = await supabaseAdminAddPlayer(chosenName, roleId);
    createdPlayers.push(p);
  }

  const theme = DEMO_CREW_NAME_THEMES[teamCount % DEMO_CREW_NAME_THEMES.length];
  const crewTitle = `Crew #${teamCount + 1} • ${theme}`;

  await supabaseFormTeam(
    createdPlayers[0].id,
    createdPlayers.slice(1).map(p => p.join_code),
    crewTitle
  );
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

