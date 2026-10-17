export type GameState = 'LOBBY_TEAM_FORMATION' | 'ROUND_ACTIVE' | 'ROUND_LEADERBOARD';

export type RoundType = 'ASCII_SPLITTER' | 'ASYMMETRIC_TEXT_PUZZLE' | 'OFFLINE_TASK_TIMER';

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
  data: AsciiSplitterData | AsymmetricPuzzleData | OfflineTaskData;
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
}

export interface Team {
  id: string;
  name: string;
  player_ids: string[];
  score: number;
  assignedCodeword?: string; // specific word assigned for ASCII splitter
  round_submissions: Record<string, RoundSubmission>;
}

export interface SyncPayload {
  state: GameState;
  current_round_index: number;
  round_ends_at: number | null;
  round_is_paused: boolean;
  server_now: number;
  config: GameConfig;
  player: Player | null;
  team: Team | null;
  all_players_count: number;
  formed_teams_count: number;
  teams_leaderboard: {
    id: string;
    name: string;
    score: number;
    player_count: number;
    members: { name: string; roleName: string; roleColor: string }[];
    recentDelta?: number;
    roundCompleted?: boolean;
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
