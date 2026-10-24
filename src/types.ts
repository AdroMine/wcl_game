export type GameState = 'LOBBY_TEAM_FORMATION' | 'ROUND_ACTIVE' | 'ROUND_LEADERBOARD';

export type RoundType = 'ASCII_SPLITTER' | 'ASYMMETRIC_TEXT_PUZZLE' | 'OFFLINE_TASK_TIMER' | 'PRISONERS_DILEMMA' | 'ODYSSEY_ESCAPE_ROYALE';

export type Round2Phase = 'HUDDLE' | 'PARLEY' | 'VOTE' | 'DEBRIEF';
export type Round2Vote = 'TRUCE' | 'AMBUSH' | 'ABSTAIN' | 'LOCKED';
export type Round2Stance = 'TRUCE' | 'AMBUSH';

export interface Round2ScoringTier {
  both_truce: number;
  ambush_win: number;
  truce_loss: number;
  both_ambush: number;
}

export interface Round2Config {
  num_clashes: number;
  phase_durations_seconds: {
    HUDDLE: number;
    PARLEY: number;
    VOTE: number;
    DEBRIEF: number;
  };
  scoring_matrix: Record<string, Round2ScoringTier>;
}

export interface Round2ClashData {
  clash: number; // 1, 2, or 3
  team_a_votes: Record<string, Round2Vote>;
  team_b_votes: Record<string, Round2Vote>;
  team_a_stance: Round2Stance;
  team_b_stance: Round2Stance;
  team_a_pts: number;
  team_b_pts: number;
}

export interface Round2Match {
  id: string;
  session_id: string;
  team_a_id: string;
  team_b_id: string;
  current_clash: number;
  current_phase: Round2Phase;
  phase_ends_at: number; // epoch ms
  clash_data: Round2ClashData[];
  completed: boolean;
  created_at?: string;
  updated_at?: string;
}

// --------------------------------------------------------------------------
// ROUND 3: THE ODYSSEY ESCAPE ROYALE
// --------------------------------------------------------------------------
export type Round3Phase = 'BLUFF' | 'VOTE' | 'REVEAL' | 'COMPLETED';
export type Round3Vessel = 'ROWBOAT' | 'SAILBOAT' | 'GHOST_SHIP';
export type Round3SuddenDeathAction = 'SHIELDS' | 'RAM' | 'SAILS';

export interface Round3VesselConfig {
  name: string;
  icon: string;
  risk_label: string;
  capacity_rule: 'UNLIMITED' | 'MAX_PERCENT' | 'EXACTLY_ONE';
  capacity_percent?: number;
  distance_success: number;
  distance_fail: number;
  desc: string;
}

export interface Round3VengeanceConfig {
  anchor_siphon_meters: number; // default: 50 (if target floats, target loses 50m, hunter gains 50m)
  wreck_bonus_meters: number;   // default: 100 (if target crashes, target loses 100m, hunter gains 100m)
  cerberus_penalty_meters?: number; // legacy backwards compat
  cerberus_bonus_meters?: number;   // legacy backwards compat
}

export interface Round3HonorConfig {
  honor_bonus_meters: number; // default: 75 (Winds of Olympus bonus for 3 mutual truces)
}

export type Round2MoralLegacy = 'HONOURABLE' | 'BETRAYED' | 'AGGRESSOR' | 'MUTUAL_BRAWL' | 'PENDING';

export interface TeamMoralReport {
  status: Round2MoralLegacy;
  label: string;
  shortBadge: string;
  badgeClass: string;
  rivalTeamId?: string | null;
  rivalTeamName?: string | null;
  mutualTruceCount: number;
  myAmbushCount: number;
  enemyAmbushCount: number;
  mutualAmbushCount: number;
}

export interface Round3Config {
  target_distance_meters: number;
  headstart_point_divisor: number;
  max_headstart_meters: number;
  num_scheduled_waves: number;
  wave_phase_durations: {
    BLUFF: number;
    VOTE: number;
    REVEAL: number;
  };
  vessels: Record<Round3Vessel, Round3VesselConfig>;
  vengeance: Round3VengeanceConfig;
  honor: Round3HonorConfig;
}

export interface Round3TeamState {
  team_id: string;
  current_distance_meters: number;
  has_escaped: boolean;
  escape_rank: number | null; // 1 for Gold, 2 for Silver, 3 for Bronze
  escaped_in_wave: number | null;
  cerberus_used: boolean;
  honor_bonus_granted?: boolean; // True if Winds of Olympus awarded (+75m)
  honor_bonus_meters?: number;   // e.g. 75
}

export interface Round3TeamWaveVote {
  team_id: string;
  player_votes: Record<string, Round3Vessel | 'ABSTAIN'>;
  resolved_vessel: Round3Vessel;
  cerberus_target_team_id?: string | null;
  cerberus_guessed_vessel?: Round3Vessel | null;
  meters_gained: number;
  created_at?: string;
}

export interface Round3CerberusEvent {
  attacker_team_id: string;
  attacker_team_name: string;
  target_team_id: string;
  target_team_name: string;
  attacker_vessel?: Round3Vessel;
  target_vessel?: Round3Vessel;
  attacker_crashed?: boolean;
  target_crashed?: boolean;
  leash_snapped?: boolean;
  event_type?: 'ANCHOR_SIPHON' | 'WRECK_DRAG' | 'LEASH_SNAPPED';
  guessed_vessel?: Round3Vessel; // legacy compat
  actual_vessel?: Round3Vessel;  // legacy compat
  success: boolean;
  attacker_bonus: number;
  target_penalty: number;
}

export interface Round3WaveReport {
  wave_number: number;
  rowboat_teams: string[];
  sailboat_teams: string[];
  ghost_ship_teams: string[];
  sailboat_capsized: boolean;
  ghost_ship_collided: boolean;
  ghost_ship_solo_team_id: string | null;
  cerberus_events: Round3CerberusEvent[];
  team_outcomes: Record<string, {
    vessel: Round3Vessel;
    base_meters: number;
    cerberus_delta: number;
    total_meters_gained: number;
    new_total_distance: number;
    just_escaped: boolean;
    escape_rank?: number | null;
  }>;
}

export interface Round3SuddenDeathState {
  is_active: boolean;
  phase: 'PARLEY' | 'VOTE' | 'REVEAL';
  phase_ends_at: number;
  teams: [string, string]; // [TeamAId, TeamBId]
  player_votes: {
    team_a: Record<string, Round3SuddenDeathAction>;
    team_b: Record<string, Round3SuddenDeathAction>;
  };
  stances: {
    team_a?: Round3SuddenDeathAction;
    team_b?: Round3SuddenDeathAction;
  };
  winner_team_id?: string | null;
  resolution_text?: string | null;
}

export interface Round3Session {
  id: string;
  session_id: string;
  current_wave: number;
  current_phase: Round3Phase;
  phase_ends_at: number; // epoch ms
  team_states: Record<string, Round3TeamState>;
  wave_votes: Record<number, Record<string, Round3TeamWaveVote>>;
  wave_reports: Record<number, Round3WaveReport>;
  is_sudden_death: boolean;
  sudden_death_state?: Round3SuddenDeathState | null;
  podium: {
    gold_team_id: string | null;
    silver_team_id: string | null;
    bronze_team_id: string | null;
  };
  updated_at?: string;
}

export interface RoleConfig {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
}

export interface AsciiSplitterData {
  codewords: string[];
  mode: 'HORIZONTAL' | 'VERTICAL';
  pointsBase: number;
  pointsSpeedBonusMax: number;
}

export interface AsymmetricRoleClue {
  roleId: string;
  title: string;
  clue: string;
  detail: string;
}

export interface AsymmetricPuzzleData {
  themeTitle: string;
  narrative: string;
  answerCodeword: string;
  roleClues: AsymmetricRoleClue[];
  points: number;
}

export interface OfflineTaskData {
  prompt: string;
  rules: string[];
  verificationCode?: string;
  points: number;
}

export interface RoundConfig {
  id: string;
  type: RoundType;
  title: string;
  subtitle: string;
  durationSeconds: number;
  data: AsciiSplitterData | AsymmetricPuzzleData | OfflineTaskData | Record<string, any>;
}

export interface GameTheme {
  title: string;
  subtitle: string;
  primaryBg: string;
  ivory: string;
  gold: string;
}

export interface GameConfig {
  theme: GameTheme;
  team_size: number;
  admin_passcode: string;
  roles: RoleConfig[];
  rounds: RoundConfig[];
  round2?: Round2Config;
  round3?: Round3Config;
}

export interface Player {
  id: string;
  name: string;
  roleId: string;
  join_code: string; // 3-char unique code (e.g. "K9P")
  teamId: string | null;
  joined_at: number;
  last_seen_at: number;
  is_online: boolean;
}

export interface RoundSubmission {
  completed: boolean;
  completedAt: number;
  answerSubmitted: string;
  pointsAwarded: number;
  isCorrect: boolean;
  hintsCount?: number;
  solveTimeSeconds?: number;
}

// --------------------------------------------------------------------------
// EMOJI TEAM CODES
// --------------------------------------------------------------------------
export const TEAM_EMOJI_POOL = ['🔥', '💀', '⚡', '🌊', '🛡️'] as const;
export type TeamEmoji = typeof TEAM_EMOJI_POOL[number];

export const TEAM_EMOJI_LABELS: Record<TeamEmoji, string> = {
  '🔥': 'Fire',
  '💀': 'Skull',
  '⚡': 'Bolt',
  '🌊': 'Wave',
  '🛡️': 'Shield',
};

export interface TeamMemberPreview {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  roleColor?: string;
}

export interface TeamPreviewInfo {
  id: string;
  name: string;
  emojiCode: string;
  memberCount: number;
  maxMembers: number;
  isFull: boolean;
  leaderName: string;
  members: TeamMemberPreview[];
  hasRoleConflict: boolean;
  conflictingRoleName?: string;
}

export interface Team {
  id: string;
  name: string;
  player_ids: string[];
  score: number;
  assignedCodeword?: string; // specific word assigned for ASCII splitter
  round_submissions: Record<string, RoundSubmission>;
  battle_code?: string; // 2-digit battle code (e.g. "49")
  emoji_code?: string; // 3-emoji team code (e.g. "💀⚡🛡️")
  nemesis_team_id?: string | null;
  hints_taken?: number[]; // indices of hints taken [1, 2, 3]
}

export interface SyncPayload {
  state: GameState;
  current_round_index: number;
  round_ends_at: number | null;
  round_started_at?: number | null;
  round_is_paused: boolean;
  server_now: number;
  config: GameConfig;
  player: Player | null;
  team: Team | null;
  all_players_count: number;
  formed_teams_count: number;
  round2_match?: Round2Match | null;
  round2_all_matches?: Round2Match[];
  round3_session?: Round3Session | null;
  teams_leaderboard: {
    id: string;
    name: string;
    score: number;
    player_count: number;
    battle_code?: string;
    emoji_code?: string;
    nemesis_team_id?: string | null;
    members: { id?: string; name: string; roleName: string; roleColor: string }[];
    recentDelta?: number;
    roundCompleted?: boolean;
    assignedCodeword?: string;
  }[];
  unassigned_players?: {
    id: string;
    name: string;
    roleId: string;
    roleName: string;
    roleColor: string;
    join_code: string;
    is_online: boolean;
  }[];
}
