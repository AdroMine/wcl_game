// Round 1 tablet pieces. A crew of n members always holds exactly n pieces (slots 0..n-1, one per
// member, in join order). Leaf module (config and types only) so that common.ts can call it whenever
// crew membership changes while Round 1 is running.
import type { GameState, Team } from './types.ts';

export interface PlayerSlotInfo {
  slotIndex: number;
  playerName: string;
}

export function generateHintText(hintIndex: number, teamSize: number, slotMembers: PlayerSlotInfo[]): string {
  const safeSize = Math.max(1, teamSize);
  let targetSlot = 0;
  if (hintIndex === 1) targetSlot = 0;
  else if (hintIndex === 2) targetSlot = safeSize - 1;
  else targetSlot = Math.floor(safeSize / 2);

  const member = slotMembers.find(m => m.slotIndex === targetSlot);
  const nameLabel = member ? member.playerName : `Crew Shade #${targetSlot + 1}`;

  if (hintIndex === 1) {
    return `🛡️ LEFT EDGE: "${nameLabel}" holds the FAR LEFT piece of the ancient tablet. Place their phone on the left side of the table!`;
  } else if (hintIndex === 2) {
    return `⚓ RIGHT EDGE: "${nameLabel}" holds the FAR RIGHT piece of the ancient tablet. Place their phone on the right side of the table!`;
  }
  return `👁️ CENTER PIECE: "${nameLabel}" holds the CENTER piece of the tablet. Place their phone in the middle between left and right!`;
}

export function hintTextFor(d: GameState, t: Team, hintIndex: number): string {
  const r1 = t.r1!;
  const slotMembers: PlayerSlotInfo[] = [];
  for (const pid of Object.keys(r1.slots)) {
    const p = d.players[pid];
    if (!p) continue;
    slotMembers.push({ slotIndex: r1.slots[pid], playerName: p.name });
  }
  return generateHintText(hintIndex, r1.size, slotMembers);
}

/** Freeze one slot per member, in join order: slots 0..n-1, size = n. */
export function assignSlots(t: Team): { slots: Record<string, number>; size: number } {
  const slots: Record<string, number> = {};
  t.playerIds.forEach((pid, i) => {
    slots[pid] = i;
  });
  return { slots, size: t.playerIds.length };
}

/**
 * Crew membership changed. While Round 1 is running the crew's pieces are recomputed: slotCount =
 * the new member count and every current member holds a distinct slot, so no piece is missing or
 * duplicated. Hint texts that were already taken are rewritten for the new layout. Disconnects never
 * come through here (they do not change membership).
 */
export function resyncR1Slots(d: GameState, t: Team | undefined): void {
  if (!t || !t.r1 || d.phase !== 'R1_ACTIVE') return;
  const next = assignSlots(t);
  t.r1.slots = next.slots;
  t.r1.size = next.size;
  for (const idx of t.r1.hintsTaken) t.r1.hintTexts[String(idx)] = hintTextFor(d, t, idx);
}
