import { GameConfig, GameState, Player, Team, SyncPayload } from '../src/types';
import { DEFAULT_CONFIG } from '../src/lib/defaultConfig';
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
  round_is_paused: boolean = false;
  paused_time_left_seconds: number | null = null;
  
  players: Map<string, Player> = new Map();
  teams: Map<string, Team> = new Map();

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
        round_is_paused: this.round_is_paused,
        paused_time_left_seconds: this.paused_time_left_seconds,
        players: Array.from(this.players.entries()),
        teams: Array.from(this.teams.entries()),
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
        if (data.players) this.players = new Map(data.players);
        if (data.teams) this.teams = new Map(data.teams);
        console.log(`Loaded ${this.players.size} players and ${this.teams.size} teams from disk.`);
      }
    } catch (e) {
      console.warn('Could not load existing state, starting fresh:', e);
    }
  }

  resetAll() {
    this.players.clear();
    this.teams.clear();
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
    let assignedCodeword = "ORACLE";
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

    const teamId = `team_demo_${Date.now()}`;
    const round1 = this.config.rounds[0];
    const words = (round1?.data as any)?.codewords || ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];
    const assignedCodeword = words[Math.floor(Math.random() * words.length)] || 'ORACLE';

    const createdPlayers: Player[] = [];
    const existingCodes = new Set(Array.from(this.players.values()).map(p => p.join_code));

    for (const item of names) {
      const code = generateJoinCode(existingCodes);
      existingCodes.add(code);
      const pid = `p_demo_${item.name.toLowerCase()}`;
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

    const team: Team = {
      id: teamId,
      name: 'The Stygian Rowers (Demo Crew)',
      player_ids: createdPlayers.map(p => p.id),
      score: 0,
      assignedCodeword,
      round_submissions: {},
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
      const words = (round1?.data as any)?.codewords || ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];
      team = {
        id: teamId,
        name: `Solo Shade • ${player.name}`,
        player_ids: [player.id],
        score: 0,
        assignedCodeword: words[Math.floor(Math.random() * words.length)],
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

    // Calculate speed bonus
    let speedPoints = 0;
    const now = Date.now();
    if (this.round_ends_at && this.round_ends_at > now) {
      const remainingSecs = Math.max(0, (this.round_ends_at - now) / 1000);
      const frac = Math.min(1, remainingSecs / round.durationSeconds);
      speedPoints = Math.round(frac * speedBonusMax);
    }

    const totalAwarded = basePoints + speedPoints;
    team.score += totalAwarded;
    team.round_submissions[roundId] = {
      completed: true,
      completedAt: now,
      answerSubmitted: cleanInput,
      pointsAwarded: totalAwarded,
      isCorrect: true,
    };

    this.saveToDisk();
    return { success: true, message: `Codeword Accepted! +${totalAwarded} points awarded to ${team.name}!`, points: totalAwarded, isCorrect: true };
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
      this.round_is_paused = false;
      this.paused_time_left_seconds = null;

      // Assign codewords for Round 1 if not already
      if (round?.type === 'ASCII_SPLITTER') {
        const words = (round.data as any).codewords || ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];
        for (const team of this.teams.values()) {
          if (!team.assignedCodeword) {
            team.assignedCodeword = words[Math.floor(Math.random() * words.length)];
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
      const words = (round1?.data as any)?.codewords || ['ORACLE', 'SIRENS', 'PORTAL', 'CHARON', 'VOYAGE'];

      const team: Team = {
        id: teamId,
        name: `Crew #${teamNum} • Tartarus Navigators`,
        player_ids: chunk.map(p => p.id),
        score: 0,
        assignedCodeword: words[Math.floor(Math.random() * words.length)],
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

    // Leaderboard sorted by score desc
    const teamsList = Array.from(this.teams.values())
      .map(t => {
        const members = t.player_ids.map(pid => {
          const p = this.players.get(pid);
          const role = this.config.roles.find(r => r.id === p?.roleId);
          return {
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
      teams_leaderboard: teamsList,
      unassigned_players: unassigned,
    };
  }
}

export const stateStore = new UnderworldStateStore();
