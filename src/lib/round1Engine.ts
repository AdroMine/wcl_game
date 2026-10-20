// Round 1 (ASCII Splitter) Logic: Hints, Timer Thresholds & Dynamic Escalating Scoring

export interface Round1HintConfig {
  hintIndex: number; // 1, 2, or 3
  availableAfterSeconds: number; // 120 (2m), 180 (3m), 240 (4m)
  title: string;
  positionTarget: 'LEFT' | 'RIGHT' | 'CENTER';
  penaltyPoints: number; // 30 points deduction per hint
}

export const ROUND1_HINTS: Round1HintConfig[] = [
  {
    hintIndex: 1,
    availableAfterSeconds: 120, // 2 minutes in
    title: 'Left Edge Fragment',
    positionTarget: 'LEFT',
    penaltyPoints: 30,
  },
  {
    hintIndex: 2,
    availableAfterSeconds: 180, // 3 minutes in
    title: 'Right Edge Fragment',
    positionTarget: 'RIGHT',
    penaltyPoints: 30,
  },
  {
    hintIndex: 3,
    availableAfterSeconds: 240, // 4 minutes in
    title: 'Center Fragment',
    positionTarget: 'CENTER',
    penaltyPoints: 30,
  },
];

export interface PlayerSlotInfo {
  slotIndex: number; // 0-indexed
  playerName: string;
  roleName: string;
  roleColor?: string;
}

/**
 * Generate human-readable hint text identifying which player holds which totem position.
 */
export function generateHintText(
  hintIndex: number,
  teamSize: number,
  slotMembers: PlayerSlotInfo[]
): string {
  const safeSize = Math.max(1, teamSize);

  let targetSlot = 0;

  if (hintIndex === 1) {
    targetSlot = 0;
  } else if (hintIndex === 2) {
    targetSlot = safeSize - 1;
  } else {
    targetSlot = Math.floor(safeSize / 2);
  }

  const member = slotMembers.find(m => m.slotIndex === targetSlot);
  const nameLabel = member ? member.playerName : `Crew Shade #${targetSlot + 1}`;
  const roleLabel = member ? member.roleName : `Slot #${targetSlot + 1}`;

  if (hintIndex === 1) {
    return `🛡️ LEFT EDGE: "${nameLabel}" (${roleLabel}) holds the FAR LEFT piece of the ancient tablet. Place their phone on the left side of the table!`;
  } else if (hintIndex === 2) {
    return `⚓ RIGHT EDGE: "${nameLabel}" (${roleLabel}) holds the FAR RIGHT piece of the ancient tablet. Place their phone on the right side of the table!`;
  } else {
    return `👁️ CENTER PIECE: "${nameLabel}" (${roleLabel}) holds the CENTER piece of the tablet. Place their phone in the middle between left and right!`;
  }
}

export interface Round1ScoreBreakdown {
  elapsedSeconds: number;
  basePoints: number;
  hintPenalty: number;
  hintsTakenCount: number;
  finalPoints: number;
  speedTier: string;
  nextTierInSeconds: number;
}

/**
 * Dynamic Scoring for Round 1:
 * - More points the earlier you solve
 * - 30 points deduction for each hint taken
 * - 50 points guaranteed minimum for successful solve
 */
export function calculateRound1Score(
  elapsedSeconds: number,
  hintsTakenCount: number
): Round1ScoreBreakdown {
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));

  let basePoints = 100;
  let speedTier = 'Standard Solve';
  let nextTierInSeconds = 0;

  if (safeElapsed <= 60) {
    basePoints = 300;
    speedTier = '⚡ Legendary (Under 1m)';
    nextTierInSeconds = 60 - safeElapsed;
  } else if (safeElapsed <= 120) {
    basePoints = 250;
    speedTier = '⚡ Swift (Under 2m)';
    nextTierInSeconds = 120 - safeElapsed;
  } else if (safeElapsed <= 180) {
    basePoints = 200;
    speedTier = '🛡️ Steady (Under 3m)';
    nextTierInSeconds = 180 - safeElapsed;
  } else if (safeElapsed <= 240) {
    basePoints = 150;
    speedTier = '⏳ Methodical (Under 4m)';
    nextTierInSeconds = 240 - safeElapsed;
  } else {
    basePoints = 100;
    speedTier = '⌛ Standard Solve';
    nextTierInSeconds = 0;
  }

  const hintPenalty = hintsTakenCount * 30;
  const finalPoints = Math.max(50, basePoints - hintPenalty);

  return {
    elapsedSeconds: safeElapsed,
    basePoints,
    hintPenalty,
    hintsTakenCount,
    finalPoints,
    speedTier,
    nextTierInSeconds,
  };
}
