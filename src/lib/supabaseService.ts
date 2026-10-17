import { supabase } from './supabase';
import { DEFAULT_CONFIG } from './defaultConfig';
import type { Player, Team, SyncPayload, GameState, GameConfig, RoundSubmission } from '../types';

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

// Convert DB player row to Player interface
function mapDbPlayer(row: any): Player {
  return {
    id: row.id,
    name: row.name,
    roleId: row.role_id,
    join_code: row.join_code,
    teamId: row.team_id || null,
    joined_at: Number(row.joined_at || Date.now()),
    last_seen_at: Number(row.last_seen_at || Date.now()),
    is_online: Boolean(row.is_online ?? true),
  };
}

// Convert DB team row to Team interface
function mapDbTeam(row: any): Team {
  return {
    id: row.id,
    name: row.name,
    score: row.score || 0,
    assignedCodeword: row.assigned_codeword || 'ORACLE',
    player_ids: Array.isArray(row.player_ids) ? row.player_ids : [],
    round_submissions: (row.round_submissions && typeof row.round_submissions === 'object') ? row.round_submissions : {},
  };
}

export async function fetchFullSyncPayloadFromSupabase(forPlayerId?: string): Promise<SyncPayload> {
  if (!supabase) throw new Error('Supabase is not configured');

  const [gameStateRes, teamsRes, playersRes] = await Promise.all([
    supabase.from('game_state').select('*').eq('id', 'main').single(),
    supabase.from('teams').select('*'),
    supabase.from('players').select('*'),
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
  };

  const players: Player[] = (playersRes.data || []).map(mapDbPlayer);
  const teams: Team[] = (teamsRes.data || []).map(mapDbTeam);

  const playersMap = new Map(players.map(p => [p.id, p]));
  const teamsMap = new Map(teams.map(t => [t.id, t]));

  const player = forPlayerId ? playersMap.get(forPlayerId) || null : null;
  const team = player?.teamId ? teamsMap.get(player.teamId) || null : null;

  const currentRoundIndex = Number(stateRow.current_round_index ?? 0);
  const curRound = config.rounds[currentRoundIndex];

  // Build Leaderboard
  const teamsList = teams
    .map(t => {
      const members = t.player_ids.map(pid => {
        const p = playersMap.get(pid);
        const role = config.roles.find(r => r.id === p?.roleId);
        return {
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
        members,
        roundCompleted,
        recentDelta,
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
    round_is_paused: Boolean(stateRow.round_is_paused),
    server_now: Date.now(),
    config,
    player,
    team,
    all_players_count: players.length,
    formed_teams_count: teams.length,
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

  const { data: stateData } = await supabase.from('game_state').select('config').eq('id', 'main').single();
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

  const { data: stateData } = await supabase.from('game_state').select('config').eq('id', 'main').single();
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

  const teamData = {
    id: teamId,
    name: teamName,
    score: 0,
    assigned_codeword: assignedCodeword,
    player_ids: matchedPlayers.map(p => p.id),
    round_submissions: {},
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
    const newTeamRow = {
      id: teamId,
      name: `Solo Shade • ${player.name}`,
      score: 0,
      assigned_codeword: assignedCodeword,
      player_ids: [player.id],
      round_submissions: {},
    };
    await supabase.from('teams').insert(newTeamRow);
    await supabase.from('players').update({ team_id: teamId }).eq('id', player.id);
    team = mapDbTeam(newTeamRow);
  }

  const { data: stateData } = await supabase.from('game_state').select('*').eq('id', 'main').single();
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
    basePoints = (round.data as any).pointsBase ?? 100;
    speedBonusMax = (round.data as any).pointsSpeedBonusMax ?? 100;
    isCorrect = cleanInput === expected;
  } else if (round.type === 'ASYMMETRIC_TEXT_PUZZLE') {
    const expected = (round.data as any).answerCodeword?.toUpperCase() || 'CERBERUS';
    basePoints = (round.data as any).points ?? 200;
    isCorrect = cleanInput === expected;
  } else if (round.type === 'OFFLINE_TASK_TIMER') {
    const expected = (round.data as any).verificationCode?.toUpperCase() || 'OBOLUS';
    basePoints = (round.data as any).points ?? 250;
    isCorrect = cleanInput === expected;
  }

  if (!isCorrect) {
    return { success: false, message: 'Incorrect codeword! Consult your crew mates and inspect your clues again.' };
  }

  const now = Date.now();
  let speedPoints = 0;
  const roundEndsAt = stateData.round_ends_at ? Number(stateData.round_ends_at) : null;
  if (roundEndsAt && roundEndsAt > now) {
    const remainingSecs = Math.max(0, (roundEndsAt - now) / 1000);
    const frac = Math.min(1, remainingSecs / round.durationSeconds);
    speedPoints = Math.round(frac * speedBonusMax);
  }

  const totalAwarded = basePoints + speedPoints;
  const updatedScore = team.score + totalAwarded;
  const updatedSubmissions = {
    ...team.round_submissions,
    [roundId]: {
      completed: true,
      completedAt: now,
      answerSubmitted: cleanInput,
      pointsAwarded: totalAwarded,
      isCorrect: true,
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

// Admin Operations
export async function supabaseAdminSetState(state: GameState, roundIndex?: number): Promise<void> {
  if (!supabase) return;

  const update: any = { state };
  if (typeof roundIndex === 'number') {
    update.current_round_index = roundIndex;
  }

  if (state === 'ROUND_ACTIVE') {
    const { data: stateData } = await supabase.from('game_state').select('config, current_round_index').eq('id', 'main').single();
    const config = (stateData?.config && Object.keys(stateData.config).length > 0) ? stateData.config : DEFAULT_CONFIG;
    const idx = typeof roundIndex === 'number' ? roundIndex : Number(stateData?.current_round_index || 0);
    const round = config.rounds[idx];
    const duration = round ? round.durationSeconds : 300;
    update.round_ends_at = Date.now() + duration * 1000;
    update.round_is_paused = false;
  } else {
    update.round_ends_at = null;
    update.round_is_paused = false;
  }

  await supabase.from('game_state').update(update).eq('id', 'main');
}

export async function supabaseAdminAdjustTimer(action: 'adjust' | 'pause', secondsDelta?: number): Promise<void> {
  if (!supabase) return;

  const { data } = await supabase.from('game_state').select('*').eq('id', 'main').single();
  if (!data) return;

  const now = Date.now();
  if (action === 'adjust' && typeof secondsDelta === 'number') {
    let endsAt = data.round_ends_at ? Number(data.round_ends_at) : now;
    if (endsAt < now) endsAt = now;
    endsAt += secondsDelta * 1000;
    await supabase.from('game_state').update({ round_ends_at: endsAt }).eq('id', 'main');
  } else if (action === 'pause') {
    const isPaused = !data.round_is_paused;
    if (isPaused) {
      const left = data.round_ends_at ? Math.max(0, Math.round((Number(data.round_ends_at) - now) / 1000)) : 0;
      await supabase.from('game_state').update({ round_is_paused: true, paused_time_left_seconds: left }).eq('id', 'main');
    } else {
      const secs = data.paused_time_left_seconds || 60;
      await supabase.from('game_state').update({ round_is_paused: false, round_ends_at: now + secs * 1000, paused_time_left_seconds: null }).eq('id', 'main');
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
  await supabase.from('game_state').update({ config }).eq('id', 'main');
}

export async function supabaseAdminResetGame(): Promise<void> {
  if (!supabase) return;
  await supabase.from('players').delete().neq('id', 'none');
  await supabase.from('teams').delete().neq('id', 'none');
  await supabase.from('game_state').update({
    state: 'LOBBY_TEAM_FORMATION',
    current_round_index: 0,
    round_ends_at: null,
    round_is_paused: false,
    paused_time_left_seconds: null,
    config: DEFAULT_CONFIG,
  }).eq('id', 'main');
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

export async function supabaseAdminSpawnDemoCrew(): Promise<void> {
  const names = [
    { name: 'Orpheus', roleId: 'navigator' },
    { name: 'Elena', roleId: 'oracle' },
    { name: 'Marcus', roleId: 'scholar' },
    { name: 'Hesper', roleId: 'torchbearer' },
    { name: 'Damon', roleId: 'negotiator' },
  ];

  const createdPlayers: Player[] = [];
  for (const item of names) {
    const p = await supabaseAdminAddPlayer(item.name, item.roleId);
    createdPlayers.push(p);
  }

  await supabaseFormTeam(
    createdPlayers[0].id,
    createdPlayers.slice(1).map(p => p.join_code),
    'The Stygian Rowers (Demo Crew)'
  );
}
