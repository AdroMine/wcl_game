// Ported from src/lib/teamCodeEngine.ts. Randomness now comes from the seeded RNG in state.
import { TEAM_EMOJI_LABELS, TEAM_EMOJI_POOL } from './config.ts';
import { rngInt, rngPick } from './rng.ts';
import type { GameState } from './types.ts';

export function normalizeEmojiChar(char: string): string {
  return char.replace(/️/g, '').trim();
}

export function normalizeEmojiCode(code: string): string {
  if (!code) return '';
  const chars = Array.from(code).filter(c => c.trim().length > 0 && c !== '️');
  return chars.join('');
}

export function parseEmojiCode(code: string): string[] {
  if (!code) return [];
  const normalized = normalizeEmojiCode(code);
  const result: string[] = [];
  for (const char of Array.from(normalized)) {
    const matched = TEAM_EMOJI_POOL.find(e => normalizeEmojiChar(e) === normalizeEmojiChar(char));
    if (matched) result.push(matched);
  }
  return result;
}

export function formatEmojiCodeLabels(code: string): string {
  const emojis = parseEmojiCode(code);
  if (emojis.length === 0) return '';
  return emojis.map(e => TEAM_EMOJI_LABELS[e] || e).join(' • ');
}

/**
 * Generate a unique 3-emoji team code from the 5-emoji pool (125 combinations).
 * If all 125 are taken, expands to 4 emojis (old behaviour).
 */
export function generateTeamEmojiCode(d: Pick<GameState, 'rng'>, existingCodes: Set<string>): string {
  const existing = new Set(Array.from(existingCodes).map(normalizeEmojiCode));
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = `${rngPick(d, TEAM_EMOJI_POOL)}${rngPick(d, TEAM_EMOJI_POOL)}${rngPick(d, TEAM_EMOJI_POOL)}`;
    if (!existing.has(normalizeEmojiCode(candidate))) return candidate;
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = `${rngPick(d, TEAM_EMOJI_POOL)}${rngPick(d, TEAM_EMOJI_POOL)}${rngPick(d, TEAM_EMOJI_POOL)}${rngPick(d, TEAM_EMOJI_POOL)}`;
    if (!existing.has(normalizeEmojiCode(candidate))) return candidate;
  }
  return '';
}

/** Unique 2-digit battle code "10".."99"; returns null if all 90 are used. */
export function generateBattleCode(d: Pick<GameState, 'rng'>, existingCodes: Set<string>): string | null {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = String(10 + rngInt(d, 90));
    if (!existingCodes.has(code)) return code;
  }
  for (let n = 10; n <= 99; n++) {
    if (!existingCodes.has(String(n))) return String(n);
  }
  return null;
}

export function checkTeamRoleCompatibility(
  existingRoleIds: string[],
  playerRoleId: string,
  roleNameMap: Record<string, string> = {},
): { compatible: boolean; conflictingRoleName?: string } {
  if (!playerRoleId) return { compatible: true };
  if (existingRoleIds.includes(playerRoleId)) {
    return { compatible: false, conflictingRoleName: roleNameMap[playerRoleId] || 'this role' };
  }
  return { compatible: true };
}
