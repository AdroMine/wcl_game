import { TEAM_EMOJI_POOL, TEAM_EMOJI_LABELS, type TeamEmoji } from '../types';

/**
 * Standardize an emoji character by stripping Unicode variation selectors (\uFE0F)
 * so that '⚡' and '⚡️', or '🛡' and '🛡️' compare identically across iOS and Android.
 */
export function normalizeEmojiChar(char: string): string {
  return char.replace(/\uFE0F/g, '').trim();
}

/**
 * Normalize an entire 3-emoji code string.
 */
export function normalizeEmojiCode(code: string): string {
  if (!code) return '';
  // Split by code points to correctly handle multi-byte emojis
  const chars = Array.from(code).filter(c => c.trim().length > 0 && c !== '\uFE0F');
  return chars.join('');
}

/**
 * Parse a raw emoji code string into an array of recognized TeamEmoji chars.
 */
export function parseEmojiCode(code: string): TeamEmoji[] {
  if (!code) return [];
  const normalized = normalizeEmojiCode(code);
  const result: TeamEmoji[] = [];
  
  for (const char of Array.from(normalized)) {
    const matched = TEAM_EMOJI_POOL.find(e => normalizeEmojiChar(e) === normalizeEmojiChar(char));
    if (matched) {
      result.push(matched);
    }
  }
  return result;
}

/**
 * Format a 3-emoji code into its phonetically sharp verbal labels:
 * e.g. "💀⚡🛡️" -> "Skull • Bolt • Shield"
 */
export function formatEmojiCodeLabels(code: string): string {
  const emojis = parseEmojiCode(code);
  if (emojis.length === 0) return '';
  return emojis.map(e => TEAM_EMOJI_LABELS[e] || e).join(' • ');
}

/**
 * Generate a unique 3-emoji team code from the 5 Tartarus Underworld emojis:
 * { 🔥 Fire, 💀 Skull, ⚡ Bolt, 🌊 Wave, 🛡️ Shield }
 * 5^3 = 125 unique combinations.
 */
export function generateTeamEmojiCode(existingCodes: Set<string>): string {
  const normalizedExisting = new Set(Array.from(existingCodes).map(normalizeEmojiCode));

  // Up to 1000 attempts to find an unused 3-emoji combination
  for (let attempt = 0; attempt < 1000; attempt++) {
    const e1 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
    const e2 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
    const e3 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
    const candidate = `${e1}${e2}${e3}`;
    const norm = normalizeEmojiCode(candidate);
    if (!normalizedExisting.has(norm)) {
      return candidate;
    }
  }

  // Fallback: If all 125 3-emoji codes are saturated (>600 players in one room),
  // expand to 4 emojis to provide 5^4 = 625 combinations
  const e1 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
  const e2 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
  const e3 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
  const e4 = TEAM_EMOJI_POOL[Math.floor(Math.random() * TEAM_EMOJI_POOL.length)];
  return `${e1}${e2}${e3}${e4}`;
}

/**
 * Check if a player's role is compatible with a team's existing roster:
 * Teams require unique roles among members.
 */
export function checkTeamRoleCompatibility(
  existingRoleIds: string[],
  playerRoleId: string,
  roleNameMap: Record<string, string> = {}
): { compatible: boolean; conflictingRoleName?: string } {
  if (!playerRoleId) return { compatible: true };
  const hasConflict = existingRoleIds.includes(playerRoleId);
  if (hasConflict) {
    const roleName = roleNameMap[playerRoleId] || 'this role';
    return {
      compatible: false,
      conflictingRoleName: roleName,
    };
  }
  return { compatible: true };
}
