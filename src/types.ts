export type GameState = 'LOBBY_TEAM_FORMATION' | 'ROUND_ACTIVE' | 'ROUND_LEADERBOARD';

export type RoundType = 'ASCII_SPLITTER' | 'ASYMMETRIC_TEXT_PUZZLE' | 'OFFLINE_TASK_TIMER' | 'PRISONERS_DILEMMA';

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

export interface Team {
  id: string;
  name: string;
  player_ids: string[];
  score: number;
  assignedCodeword?: string; // specific word assigned for ASCII splitter
  round_submissions: Record<string, RoundSubmission>;
  battle_code?: string; // 2-digit battle code (e.g. "49")
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
  teams_leaderboard: {
    id: string;
    name: string;
    score: number;
    player_count: number;
    battle_code?: string;
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
