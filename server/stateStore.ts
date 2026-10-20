import {
  GameConfig,
  GameState,
  Player,
  Team,
  SyncPayload,
  Round2Match,
  Round2ClashData,
  Round2Config,
  Round2Phase,
  Round2ScoringTier,
  Round2Vote,
} from '../src/types';
import { DEFAULT_CONFIG, DEFAULT_ROUND2_CONFIG } from '../src/lib/defaultConfig';
import {
  generateBattleCode,
  calculateTeamStance,
  calculateClashPoints,
  calculateNemesis,
  sanitizeMatchForPlayer,
} from '../src/lib/round2Engine';
import {
  calculateRound1Score,
  generateHintText,
  ROUND1_HINTS,
} from '../src/lib/round1Engine';
import { DEFAULT_ROUND1_CODEWORDS } from '../src/lib/tabletEngine';
import fs from 'fs';
import path from 'path';

const STORAGE_FILE = path.join(process.cwd(), 'server_state.json');

// Characters for easy 3-character join codes (avoiding confusing chars like 0/O and 1/I)
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

export class UnderworldStateStore {
  config: GameConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  state: GameState = 'LOBBY_TEAM_FORMATION';
  current_round_index: number = 0;
  round_ends_at: number | null = null;
  round_started_at: number | null = null;
  round_is_paused: boolean = false;
  paused_time_left_seconds: number | null = null;
  
  players: Map<string, Player> = new Map();
  teams: Map<string, Team> = new Map();
  round2_matches: Map<string, Round2Match> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  saveToDisk() {
    try {
      const data = {
        config: this.config,
        state: this.state,
        current_round_index: this.current_round_index,
        round_ends_at: this.round_ends_at,
        round_started_at: this.round_started_at,
        round_is_paused: this.round_is_paused,
        paused_time_left_seconds: this.paused_time_left_seconds,
        players: Array.from(this.players.entries()),
        teams: Array.from(this.teams.entries()),
        round2_matches: Array.from(this.round2_matches.entries()),
      };
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save state to disk:', e);
    }
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(STORAGE_FILE)) {
        const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.config) this.config = data.config;
        if (data.state) this.state = data.state;
        if (typeof data.current_round_index === 'number') this.current_round_index = data.current_round_index;
        if (data.round_ends_at) this.round_ends_at = data.round_ends_at;
        if (data.round_started_at) this.round_started_at = data.round_started_at;
        if (data.players) this.players = new Map(data.players);
        if (data.teams) this.teams = new Map(data.teams);
        if (data.round2_matches) this.round2_matches = new Map(data.round2_matches);
        console.log(`Loaded ${this.players.size} players, ${this.teams.size} teams, ${this.round2_matches.size} matches from disk.`);
      }
    } catch (e) {
      console.warn('Could not load existing state, starting fresh:', e);
    }
  }

  resetAll() {
    this.players.clear();
    this.teams.clear();
    this.round2_matches.clear();
    this.state = 'LOBBY_TEAM_FORMATION';
    this.current_round_index = 0;
    this.round_ends_at = null;
    this.round_is_paused = false;
    this.paused_time_left_seconds = null;
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.saveToDisk();
  }

  // Balanced bucket role assignment
  assignBalancedRole(): string {
    const roles = this.config.roles;
    if (roles.length === 0) return 'wanderer';

    const roleCounts: Record<string, number> = {};
    for (const r of roles) {
      roleCounts[r.id] = 0;
    }

    for (const player of this.players.values()) {
      if (roleCounts[player.roleId] !== undefined) {
        roleCounts[player.roleId]++;
      }
    }

    // Find role with minimum count
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

  // Join or reconnect immortal session
  joinOrReconnectPlayer(playerId: string | undefined, name: string): Player {
    const now = Date.now();
    if (playerId && this.players.has(playerId)) {
      const existing = this.players.get(playerId)!;
      if (name && name.trim()) {
        existing.name = name.trim();
      }
      existing.last_seen_at = now;
      existing.is_online = true;
      this.saveToDisk();
      return existing;
    }

    // Create new player
    const id = playerId || `p_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const roleId = this.assignBalancedRole();
    const existingCodes = new Set(Array.from(this.players.values()).map(p => p.join_code));
    const join_code = generateJoinCode(existingCodes);

    const player: Player = {
      id,
      name: (name && name.trim()) || `Shade-${join_code}`,
      roleId,
      join_code,
      teamId: null,
      joined_at: now,
      last_seen_at: now,
      is_online: true,
    };

    this.players.set(id, player);
    this.saveToDisk();
    return player;
  }

  removePlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Remove from team if in one
    if (player.teamId) {
      const team = this.teams.get(player.teamId);
      if (team) {
        team.player_ids = team.player_ids.filter(id => id !== playerId);
        if (team.player_ids.length === 0) {
          this.teams.delete(team.id);
        }
      }
    }

    this.players.delete(playerId);
    this.saveToDisk();
    return true;
  }

  // Form a team using join codes
  formTeam(leaderPlayerId: string, joinCodes: string[], customName?: string): { success: boolean; team?: Team; error?: string } {
    const leader = this.players.get(leaderPlayerId);
    if (!leader) return { success: false, error: 'Leader player not found' };

    // Normalize join codes
    const cleanCodes = Array.from(new Set([
      leader.join_code.toUpperCase(),
      ...joinCodes.map(c => c.trim().toUpperCase()).filter(Boolean)
    ]));

    // Find players by code
    const matchedPlayers: Player[] = [];
    for (const code of cleanCodes) {
      const found = Array.from(this.players.values()).find(p => p.join_code.toUpperCase() === code);
      if (found) {
        matchedPlayers.push(found);
      } else {
        return { success: false, error: `Invalid beacon join code: "${code}"` };
      }
    }

    if (matchedPlayers.length < 2) {
      return { success: false, error: 'A crew requires at least 2 members.' };
    }

    // Check unique roles by default unless team size is larger than role pool
    const rolesSet = new Set(matchedPlayers.map(p => p.roleId));
    if (rolesSet.size !== matchedPlayers.length && matchedPlayers.length <= this.config.roles.length) {
      return { success: false, error: 'Each crew member must possess a unique Underworld Role!' };
    }

    // Detach from previous teams
    for (const p of matchedPlayers) {
      if (p.teamId) {
        const oldTeam = this.teams.get(p.teamId);
        if (oldTeam) {
          oldTeam.player_ids = oldTeam.player_ids.filter(id => id !== p.id);
          if (oldTeam.player_ids.length === 0) {
            this.teams.delete(oldTeam.id);
          }
        }
      }
    }

    const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const teamNum = this.teams.size + 1;
    const teamName = customName?.trim() || `Crew #${teamNum} • Tartarus Navigators`;

    // Pick codeword for Round 1
    const round1 = this.config.rounds[0];
    let assignedCodeword = DEFAULT_ROUND1_CODEWORDS[Math.floor(Math.random() * DEFAULT_ROUND1_CODEWORDS.length)];
    if (round1 && round1.data && 'codewords' in round1.data && round1.data.codewords.length > 0) {
      const words = round1.data.codewords;
      assignedCodeword = words[Math.floor(Math.random() * words.length)];
    }

    const team: Team = {
      id: teamId,
      name: teamName,
      player_ids: matchedPlayers.map(p => p.id),
      score: 0,
      assignedCodeword,
      round_submissions: {}
    };

    this.teams.set(teamId, team);

    // Update players
    for (const p of matchedPlayers) {
      p.teamId = teamId;
    }

    this.saveToDisk();
    return { success: true, team };
  }

  spawnDemoCrew(): { team: Team; players: Player[] } {
    const names = [
      { name: 'Orpheus', roleId: 'navigator' },
      { name: 'Elena', roleId: 'oracle' },
      { name: 'Marcus', roleId: 'scholar' },
      { name: 'Hesper', roleId: 'torchbearer' },
      { name: 'Damon', roleId: 'negotiator' },
    ];

    const teamCount = this.teams.size + 1;
    const teamId = `team_demo_${Date.now()}`;
    const round1 = this.config.rounds[0];
    const words = (round1?.data as any)?.codewords || DEFAULT_ROUND1_CODEWORDS;
    const assignedCodeword = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';

    const createdPlayers: Player[] = [];
    const existingCodes = new Set(Array.from(this.players.values()).map(p => p.join_code));

    for (const item of names) {
      const code = generateJoinCode(existingCodes);
      existingCodes.add(code);
      const pid = `p_demo_${Date.now()}_${item.name.toLowerCase()}`;
      const p: Player = {
        id: pid,
        name: item.name,
        roleId: item.roleId,
        join_code: code,
        teamId: teamId,
        joined_at: Date.now(),
        last_seen_at: Date.now(),
        is_online: true,
      };
      this.players.set(pid, p);
      createdPlayers.push(p);
    }

    const existingBattleCodes = new Set(Array.from(this.teams.values()).map(t => t.battle_code).filter(Boolean) as string[]);
    const battleCode = generateBattleCode(existingBattleCodes);

    const team: Team = {
      id: teamId,
      name: `Crew #${teamCount} • The Stygian Rowers`,
      player_ids: createdPlayers.map(p => p.id),
      score: 0,
      assignedCodeword,
      round_submissions: {},
      battle_code: battleCode,
    };

    this.teams.set(teamId, team);
    this.saveToDisk();
    return { team, players: createdPlayers };
  }

  renameTeam(teamId: string, newName: string): boolean {
    const team = this.teams.get(teamId);
    if (!team || !newName.trim()) return false;
    team.name = newName.trim();
    this.saveToDisk();
    return true;
  }

  deleteTeam(teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    for (const pid of team.player_ids) {
      const p = this.players.get(pid);
      if (p) p.teamId = null;
    }
    this.teams.delete(teamId);
    this.saveToDisk();
    return true;
  }

  movePlayerToTeam(playerId: string, targetTeamId: string | null): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    if (player.teamId) {
      const oldTeam = this.teams.get(player.teamId);
      if (oldTeam) {
        oldTeam.player_ids = oldTeam.player_ids.filter(id => id !== playerId);
        if (oldTeam.player_ids.length === 0) {
          this.teams.delete(oldTeam.id);
        }
      }
    }

    if (targetTeamId && this.teams.has(targetTeamId)) {
      const newTeam = this.teams.get(targetTeamId)!;
      if (!newTeam.player_ids.includes(playerId)) {
        newTeam.player_ids.push(playerId);
      }
      player.teamId = targetTeamId;
    } else {
      player.teamId = null;
    }

    this.saveToDisk();
    return true;
  }

  submitRoundAnswer(playerId: string, roundId: string, answer: string): { success: boolean; message: string; points?: number; isCorrect?: boolean } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, message: 'Player record not found.' };
    }

    let team: Team | undefined;
    if (player.teamId && this.teams.has(player.teamId)) {
      team = this.teams.get(player.teamId);
    } else {
      // Auto-create solo crew so solo testing or late players can submit seamlessly
      const teamId = `team_solo_${player.id}`;
      const round1 = this.config.rounds[0];
      const words = (round1?.data as any)?.codewords || DEFAULT_ROUND1_CODEWORDS;
      team = {
        id: teamId,
        name: `Solo Shade • ${player.name}`,
        player_ids: [player.id],
        score: 0,
        assignedCodeword: words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW',
        round_submissions: {},
      };
      this.teams.set(teamId, team);
      player.teamId = teamId;
    }

    const round = this.config.rounds.find(r => r.id === roundId);
    if (!round) {
      return { success: false, message: 'Invalid round' };
    }

    // Already submitted?
    if (team.round_submissions[roundId]?.completed) {
      return { success: true, message: 'Your crew has already completed this round!', points: team.round_submissions[roundId].pointsAwarded };
    }

    const cleanInput = answer.trim().toUpperCase();
    let isCorrect = false;
    let basePoints = 100;
    let speedBonusMax = 100;

    if (round.type === 'ASCII_SPLITTER') {
      const expected = (team.assignedCodeword || 'CRIMSON SHADOW').toUpperCase();
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
      const roundStartedAt = this.round_started_at || (this.round_ends_at ? Math.max(0, this.round_ends_at - round.durationSeconds * 1000) : now - 60000);
      solveTimeSeconds = Math.max(0, Math.floor((now - roundStartedAt) / 1000));
      const breakdown = calculateRound1Score(solveTimeSeconds, hintsCount);
      totalAwarded = breakdown.finalPoints;
    } else {
      let speedPoints = 0;
      if (this.round_ends_at && this.round_ends_at > now) {
        const remainingSecs = Math.max(0, (this.round_ends_at - now) / 1000);
        const frac = Math.min(1, remainingSecs / round.durationSeconds);
        speedPoints = Math.round(frac * speedBonusMax);
      }
      totalAwarded = basePoints + speedPoints;
    }

    team.score += totalAwarded;
    team.round_submissions[roundId] = {
      completed: true,
      completedAt: now,
      answerSubmitted: cleanInput,
      pointsAwarded: totalAwarded,
      isCorrect: true,
      hintsCount,
      solveTimeSeconds,
    };

    this.saveToDisk();
    return { success: true, message: `Codeword Accepted! +${totalAwarded} points awarded to ${team.name}!`, points: totalAwarded, isCorrect: true };
  }

  requestRoundHint(teamId: string, hintIndex: number): { success: boolean; hint?: string; hintsTaken?: number[]; error?: string } {
    const team = this.teams.get(teamId);
    if (!team) return { success: false, error: 'Crew not found' };

    const currentRound = this.config.rounds[this.current_round_index];
    const now = Date.now();
    const roundStartedAt = this.round_started_at || (this.round_ends_at ? Math.max(0, this.round_ends_at - (currentRound?.durationSeconds || 300) * 1000) : now - 120000);
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
    team.hints_taken = Array.from(existingHints).sort((a, b) => a - b);

    const slotMembers = team.player_ids.map((pid, idx) => {
      const p = this.players.get(pid);
      const role = this.config.roles.find(r => r.id === p?.roleId);
      return {
        slotIndex: idx,
        playerName: p?.name || `Shade #${idx + 1}`,
        roleName: role?.name || 'Shade',
        roleColor: role?.color || '#c4a45a',
      };
    });

    const hintText = generateHintText(hintIndex, team.player_ids.length || this.config.team_size || 5, slotMembers);
    this.saveToDisk();

    return {
      success: true,
      hint: hintText,
      hintsTaken: team.hints_taken,
    };
  }

  // Timer & state controls
  setGameState(state: GameState, roundIndex?: number) {
    this.state = state;
    if (typeof roundIndex === 'number') {
      this.current_round_index = roundIndex;
    }

    if (state === 'ROUND_ACTIVE') {
      const round = this.config.rounds[this.current_round_index];
      const duration = round ? round.durationSeconds : 300;
      this.round_ends_at = Date.now() + duration * 1000;
      this.round_started_at = Date.now();
      this.round_is_paused = false;
      this.paused_time_left_seconds = null;

      // Assign codewords for Round 1 if not already
      if (round?.type === 'ASCII_SPLITTER') {
        const words = (round.data as any).codewords || DEFAULT_ROUND1_CODEWORDS;
        for (const team of this.teams.values()) {
          const isMissingOrOld1Word = !team.assignedCodeword || !team.assignedCodeword.trim().includes(' ');
          if (isMissingOrOld1Word) {
            team.assignedCodeword = words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW';
          }
        }
      }
    } else {
      this.round_ends_at = null;
      this.round_is_paused = false;
    }

    this.saveToDisk();
  }

  adjustRoundTimer(secondsDelta: number) {
    if (!this.round_ends_at) {
      this.round_ends_at = Date.now() + Math.max(30, secondsDelta) * 1000;
    } else {
      const newEndsAt = this.round_ends_at + secondsDelta * 1000;
      // Don't let it go below now + 5 seconds
      this.round_ends_at = Math.max(Date.now() + 5000, newEndsAt);
    }
    this.saveToDisk();
  }

  togglePauseTimer() {
    const now = Date.now();
    if (!this.round_is_paused && this.round_ends_at) {
      this.round_is_paused = true;
      this.paused_time_left_seconds = Math.max(0, Math.round((this.round_ends_at - now) / 1000));
    } else if (this.round_is_paused && this.paused_time_left_seconds) {
      this.round_is_paused = false;
      this.round_ends_at = now + this.paused_time_left_seconds * 1000;
      this.paused_time_left_seconds = null;
    }
    this.saveToDisk();
  }

  adjustTeamScore(teamId: string, delta: number): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    team.score = Math.max(0, team.score + delta);
    this.saveToDisk();
    return true;
  }

  autoGroupRemainingPlayers(): number {
    const unassigned = Array.from(this.players.values()).filter(p => !p.teamId);
    if (unassigned.length === 0) return 0;

    let createdCount = 0;
    const targetSize = this.config.team_size || 5;

    for (let i = 0; i < unassigned.length; i += targetSize) {
      const chunk = unassigned.slice(i, i + targetSize);
      if (chunk.length === 0) break;

      const teamNum = this.teams.size + 1;
      const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const round1 = this.config.rounds[0];
      const words = (round1?.data as any)?.codewords || DEFAULT_ROUND1_CODEWORDS;

      const team: Team = {
        id: teamId,
        name: `Crew #${teamNum} • Tartarus Navigators`,
        player_ids: chunk.map(p => p.id),
        score: 0,
        assignedCodeword: words[Math.floor(Math.random() * words.length)] || 'CRIMSON SHADOW',
        round_submissions: {},
      };

      this.teams.set(teamId, team);
      for (const p of chunk) {
        p.teamId = teamId;
      }
      createdCount++;
    }

    this.saveToDisk();
    return createdCount;
  }

  // Build client sync payload
  buildSyncPayload(forPlayerId?: string): SyncPayload {
    const now = Date.now();
    const player = forPlayerId ? this.players.get(forPlayerId) || null : null;
    const team = player?.teamId ? this.teams.get(player.teamId) || null : null;

    // Ensure all teams have a battle_code
    const existingBattleCodes = new Set<string>();
    for (const t of this.teams.values()) {
      if (t.battle_code) existingBattleCodes.add(t.battle_code);
    }
    for (const t of this.teams.values()) {
      if (!t.battle_code) {
        t.battle_code = generateBattleCode(existingBattleCodes);
        existingBattleCodes.add(t.battle_code);
      }
    }

    // Process active matches whose timers have expired
    const allMatches = Array.from(this.round2_matches.values());
    for (const m of allMatches) {
      if (!m.completed && m.phase_ends_at && now >= m.phase_ends_at) {
        this.round2AdvancePhase(m.id);
      }
    }

    // Find player's match
    let playerMatch: Round2Match | null = null;
    if (team) {
      const teamMatches = Array.from(this.round2_matches.values()).filter(
        m => m.team_a_id === team.id || m.team_b_id === team.id
      );
      playerMatch = teamMatches.find(m => !m.completed) || teamMatches[teamMatches.length - 1] || null;
    }

    const sanitizedPlayerMatch = playerMatch ? sanitizeMatchForPlayer(playerMatch, player?.id, team?.id) : null;

    // Leaderboard sorted by score desc
    const teamsList = Array.from(this.teams.values())
      .map(t => {
        const members = t.player_ids.map(pid => {
          const p = this.players.get(pid);
          const role = this.config.roles.find(r => r.id === p?.roleId);
          return {
            id: pid,
            name: p?.name || 'Unknown Shade',
            roleName: role?.name || 'Wanderer',
            roleColor: role?.color || '#c4a45a',
          };
        });

        const curRound = this.config.rounds[this.current_round_index];
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
        };
      })
      .sort((a, b) => b.score - a.score);

    // Unassigned players list
    const unassigned = Array.from(this.players.values())
      .filter(p => !p.teamId)
      .map(p => {
        const role = this.config.roles.find(r => r.id === p.roleId);
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
      state: this.state,
      current_round_index: this.current_round_index,
      round_ends_at: this.round_ends_at,
      round_is_paused: this.round_is_paused,
      server_now: now,
      config: this.config,
      player,
      team,
      all_players_count: this.players.size,
      formed_teams_count: this.teams.size,
      round2_match: sanitizedPlayerMatch,
      round2_all_matches: Array.from(this.round2_matches.values()),
      teams_leaderboard: teamsList,
      unassigned_players: unassigned,
    };
  }

  // Round 2 methods
  round2PairByCode(myTeamId: string, opponentBattleCode: string): { success: boolean; match?: Round2Match; error?: string } {
    const cleanCode = opponentBattleCode.trim().toUpperCase();
    if (cleanCode.length !== 2) {
      return { success: false, error: 'Battle code must be a 2-digit number (e.g. 49)' };
    }

    const opponent = Array.from(this.teams.values()).find(t => t.battle_code === cleanCode);
    if (!opponent) {
      return { success: false, error: `No crew found with Battle Code [ ${cleanCode} ]` };
    }
    if (opponent.id === myTeamId) {
      return { success: false, error: 'Cannot pair with your own crew!' };
    }

    const existing = Array.from(this.round2_matches.values()).find(
      m => !m.completed && (m.team_a_id === myTeamId || m.team_b_id === myTeamId || m.team_a_id === opponent.id || m.team_b_id === opponent.id)
    );

    if (existing) {
      if (
        (existing.team_a_id === myTeamId && existing.team_b_id === opponent.id) ||
        (existing.team_a_id === opponent.id && existing.team_b_id === myTeamId)
      ) {
        return { success: true, match: existing };
      }
      return { success: false, error: 'One of the crews is already engaged in an active clash!' };
    }

    const config = this.config;
    const huddleSecs = config.round2?.phase_durations_seconds?.HUDDLE || DEFAULT_ROUND2_CONFIG.phase_durations_seconds.HUDDLE;
    const now = Date.now();

    const matchId = `r2m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const match: Round2Match = {
      id: matchId,
      session_id: 'main',
      team_a_id: myTeamId,
      team_b_id: opponent.id,
      current_clash: 1,
      current_phase: 'HUDDLE',
      phase_ends_at: now + huddleSecs * 1000,
      clash_data: [],
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.round2_matches.set(matchId, match);
    this.saveToDisk();
    return { success: true, match };
  }

  round2CastVote(matchId: string, playerId: string, teamId: string, vote: 'TRUCE' | 'AMBUSH'): { success: boolean; error?: string } {
    const match = this.round2_matches.get(matchId);
    if (!match) return { success: false, error: 'Match not found' };
    if (match.current_phase !== 'VOTE') {
      return { success: false, error: 'Voting is only allowed during the VOTE phase.' };
    }

    let curClash = match.clash_data.find(c => c.clash === match.current_clash);
    if (!curClash) {
      curClash = {
        clash: match.current_clash,
        team_a_votes: {},
        team_b_votes: {},
        team_a_stance: 'TRUCE',
        team_b_stance: 'TRUCE',
        team_a_pts: 0,
        team_b_pts: 0,
      };
      match.clash_data.push(curClash);
    }

    const isTeamA = match.team_a_id === teamId;
    const isTeamB = match.team_b_id === teamId;
    if (!isTeamA && !isTeamB) return { success: false, error: 'Your crew is not in this clash' };

    if (isTeamA) {
      if (curClash.team_a_votes[playerId]) return { success: false, error: 'Choice already recorded.' };
      curClash.team_a_votes[playerId] = vote;
    } else {
      if (curClash.team_b_votes[playerId]) return { success: false, error: 'Choice already recorded.' };
      curClash.team_b_votes[playerId] = vote;
    }

    match.updated_at = new Date().toISOString();

    const teamA = this.teams.get(match.team_a_id);
    const teamB = this.teams.get(match.team_b_id);
    const teamAMembers = teamA?.player_ids || [];
    const teamBMembers = teamB?.player_ids || [];

    const allAVoted = teamAMembers.length > 0 && teamAMembers.every(id => curClash!.team_a_votes[id]);
    const allBVoted = teamBMembers.length > 0 && teamBMembers.every(id => curClash!.team_b_votes[id]);

    if (allAVoted && allBVoted) {
      this.round2AdvancePhase(matchId, true);
    } else {
      this.saveToDisk();
    }

    return { success: true };
  }

  round2AdvancePhase(matchId: string, forceSkip: boolean = false): Round2Match | null {
    const match = this.round2_matches.get(matchId);
    if (!match) return null;
    const now = Date.now();
    if (!forceSkip && (!match.phase_ends_at || now < match.phase_ends_at || match.completed)) {
      return match;
    }

    const r2Config: Round2Config = this.config.round2 || DEFAULT_ROUND2_CONFIG;
    const durations = r2Config.phase_durations_seconds || DEFAULT_ROUND2_CONFIG.phase_durations_seconds;
    const numClashes = r2Config.num_clashes || 3;

    const teamA = this.teams.get(match.team_a_id);
    const teamB = this.teams.get(match.team_b_id);
    const teamAMembers = teamA?.player_ids || [];
    const teamBMembers = teamB?.player_ids || [];

    if (match.current_phase === 'HUDDLE') {
      match.current_phase = 'PARLEY';
      match.phase_ends_at = now + (durations.PARLEY || 40) * 1000;
    } else if (match.current_phase === 'PARLEY') {
      match.current_phase = 'VOTE';
      match.phase_ends_at = now + (durations.VOTE || 25) * 1000;
      let curClash = match.clash_data.find(c => c.clash === match.current_clash);
      if (!curClash) {
        match.clash_data.push({
          clash: match.current_clash,
          team_a_votes: {},
          team_b_votes: {},
          team_a_stance: 'TRUCE',
          team_b_stance: 'TRUCE',
          team_a_pts: 0,
          team_b_pts: 0,
        });
      }
    } else if (match.current_phase === 'VOTE') {
      match.current_phase = 'DEBRIEF';
      match.phase_ends_at = now + (durations.DEBRIEF || 40) * 1000;

      let curClash = match.clash_data.find(c => c.clash === match.current_clash);
      if (!curClash) {
        curClash = {
          clash: match.current_clash,
          team_a_votes: {},
          team_b_votes: {},
          team_a_stance: 'TRUCE',
          team_b_stance: 'TRUCE',
          team_a_pts: 0,
          team_b_pts: 0,
        };
        match.clash_data.push(curClash);
      }

      for (const pid of teamAMembers) {
        if (!curClash.team_a_votes[pid]) curClash.team_a_votes[pid] = 'ABSTAIN';
      }
      for (const pid of teamBMembers) {
        if (!curClash.team_b_votes[pid]) curClash.team_b_votes[pid] = 'ABSTAIN';
      }

      const stanceA = calculateTeamStance(curClash.team_a_votes, teamAMembers, this.players);
      const stanceB = calculateTeamStance(curClash.team_b_votes, teamBMembers, this.players);
      curClash.team_a_stance = stanceA;
      curClash.team_b_stance = stanceB;

      const { team_a_pts, team_b_pts } = calculateClashPoints(stanceA, stanceB, match.current_clash, r2Config.scoring_matrix);
      curClash.team_a_pts = team_a_pts;
      curClash.team_b_pts = team_b_pts;

      if (teamA) teamA.score += team_a_pts;
      if (teamB) teamB.score += team_b_pts;
    } else if (match.current_phase === 'DEBRIEF') {
      if (match.current_clash < numClashes) {
        match.current_clash += 1;
        match.current_phase = 'HUDDLE';
        match.phase_ends_at = now + (durations.HUDDLE || 50) * 1000;
      } else {
        match.completed = true;
        match.phase_ends_at = now;

        const nemesisResult = calculateNemesis(match.clash_data, match.team_a_id, match.team_b_id);
        if (nemesisResult.teamANemesis && teamA) teamA.nemesis_team_id = nemesisResult.teamANemesis;
        if (nemesisResult.teamBNemesis && teamB) teamB.nemesis_team_id = nemesisResult.teamBNemesis;

        const ptsA = match.clash_data.reduce((acc, c) => acc + (c.team_a_pts || 0), 0);
        const ptsB = match.clash_data.reduce((acc, c) => acc + (c.team_b_pts || 0), 0);
        if (teamA) {
          teamA.round_submissions['round-2'] = {
            completed: true,
            completedAt: now,
            answerSubmitted: 'Round 2 Complete',
            pointsAwarded: ptsA,
            isCorrect: true,
          };
        }
        if (teamB) {
          teamB.round_submissions['round-2'] = {
            completed: true,
            completedAt: now,
            answerSubmitted: 'Round 2 Complete',
            pointsAwarded: ptsB,
            isCorrect: true,
          };
        }
      }
    }

    match.updated_at = new Date().toISOString();
    this.saveToDisk();
    return match;
  }

  adminRound2AutoPair(): { success: boolean; pairedCount: number; error?: string } {
    const teams = Array.from(this.teams.values());
    if (teams.length < 2) return { success: false, pairedCount: 0, error: 'Need at least 2 formed crews to pair.' };

    const activeMatchedIds = new Set<string>();
    for (const m of this.round2_matches.values()) {
      if (!m.completed) {
        activeMatchedIds.add(m.team_a_id);
        activeMatchedIds.add(m.team_b_id);
      }
    }

    const unlinked = teams.filter(t => !activeMatchedIds.has(t.id));
    if (unlinked.length < 2) return { success: false, pairedCount: 0, error: 'Fewer than 2 unlinked crews available to pair.' };

    const config = this.config;
    const huddleSecs = config.round2?.phase_durations_seconds?.HUDDLE || DEFAULT_ROUND2_CONFIG.phase_durations_seconds.HUDDLE;
    const now = Date.now();
    let pairedCount = 0;

    for (let i = 0; i + 1 < unlinked.length; i += 2) {
      const matchId = `r2m_${Date.now()}_${i}`;
      this.round2_matches.set(matchId, {
        id: matchId,
        session_id: 'main',
        team_a_id: unlinked[i].id,
        team_b_id: unlinked[i + 1].id,
        current_clash: 1,
        current_phase: 'HUDDLE',
        phase_ends_at: now + huddleSecs * 1000,
        clash_data: [],
        completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      pairedCount++;
    }

    this.saveToDisk();
    return { success: true, pairedCount };
  }

  adminRound2ManualPair(teamAId: string, teamBId: string): { success: boolean; error?: string } {
    if (teamAId === teamBId) return { success: false, error: 'Cannot pair crew with itself.' };
    const config = this.config;
    const huddleSecs = config.round2?.phase_durations_seconds?.HUDDLE || DEFAULT_ROUND2_CONFIG.phase_durations_seconds.HUDDLE;
    const now = Date.now();
    const matchId = `r2m_${Date.now()}_manual`;
    this.round2_matches.set(matchId, {
      id: matchId,
      session_id: 'main',
      team_a_id: teamAId,
      team_b_id: teamBId,
      current_clash: 1,
      current_phase: 'HUDDLE',
      phase_ends_at: now + huddleSecs * 1000,
      clash_data: [],
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.saveToDisk();
    return { success: true };
  }

  adminRound2AdjustTimer(deltaSeconds: number): { success: boolean } {
    const now = Date.now();
    for (const m of this.round2_matches.values()) {
      if (!m.completed) {
        const curEndsAt = m.phase_ends_at || now;
        const base = curEndsAt < now ? now : curEndsAt;
        m.phase_ends_at = base + deltaSeconds * 1000;
        m.updated_at = new Date().toISOString();
      }
    }
    this.saveToDisk();
    return { success: true };
  }

  adminRound2SkipPhase(matchId?: string): { success: boolean } {
    if (matchId) {
      this.round2AdvancePhase(matchId, true);
    } else {
      for (const m of this.round2_matches.values()) {
        if (!m.completed) {
          this.round2AdvancePhase(m.id, true);
        }
      }
    }
    return { success: true };
  }

  adminRound2ResetMatches(): { success: boolean } {
    this.round2_matches.clear();
    for (const t of this.teams.values()) {
      t.nemesis_team_id = null;
      if (t.round_submissions['round-2']) {
        delete t.round_submissions['round-2'];
      }
    }
    this.saveToDisk();
    return { success: true };
  }

  adminRound2SaveDurations(durations: { HUDDLE: number; PARLEY: number; VOTE: number; DEBRIEF: number }): { success: boolean } {
    if (!this.config.round2) this.config.round2 = JSON.parse(JSON.stringify(DEFAULT_ROUND2_CONFIG));
    this.config.round2.phase_durations_seconds = durations;
    this.saveToDisk();
    return { success: true };
  }

  adminRound2SaveScoring(matrix: Record<string, Round2ScoringTier>): { success: boolean } {
    if (!this.config.round2) this.config.round2 = JSON.parse(JSON.stringify(DEFAULT_ROUND2_CONFIG));
    this.config.round2.scoring_matrix = matrix;
    this.saveToDisk();
    return { success: true };
  }
}

export const stateStore = new UnderworldStateStore();
