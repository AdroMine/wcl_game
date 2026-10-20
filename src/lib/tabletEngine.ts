// ============================================================================
// ANCIENT SHATTERED TABLET ENGINE (Round 1: 2-Line Vector Reconstruction)
// ============================================================================
// Renders a unified ancient tomb tablet engraved with a 2-word incantation,
// shattered into N vertical fragments (slots 1 to N, arranged Left to Right).
// Features:
// - Mathematical SVG slicing: Sub-pixel vector precision across screens
// - Glowing Central Horizon: Unbroken rune line that proves alignment
// - Interlocking Seam Notches: Glowing diamonds bisected at screen edges
// - Orientation Anchors: Distinctive Crest (Top) and Base (Bottom) markers
// ============================================================================

export interface TabletDimensions {
  totalWidth: number;
  totalHeight: number;
  slotWidth: number;
  line1Y: number;
  horizonY: number;
  line2Y: number;
}

export const TABLET_CONFIG: TabletDimensions = {
  totalWidth: 1000,
  totalHeight: 600,
  slotWidth: 200, // 1000 / 5 = 200 for 5-player teams
  line1Y: 195,
  horizonY: 300,
  line2Y: 445,
};

export const DEFAULT_ROUND1_CODEWORDS = [
  'CRIMSON SHADOW',
  'MIDNIGHT BELL',
  'OBSIDIAN GATE',
  'SILENT SPECTER',
  'ANCIENT CURSE',
  'HOLLOW GRAVE',
  'PHANTOM WRATH',
  'BLOOD MOON',
  'BURNING ALTAR',
  'EMERALD TOMB',
];

/**
 * Calculate dynamic SVG textLength and fontSize so words distribute equally
 * across all 5 phone screens from far left (Slot 0) to far right (Slot 4),
 * ensuring the outer phones never end up blank.
 */
export function getTabletTextMetrics(word: string): { fontSize: number; textLength: number } {
  const len = (word || '').trim().length;
  if (len <= 4) {
    return { fontSize: 115, textLength: 760 };
  } else if (len <= 6) {
    return { fontSize: 108, textLength: 820 };
  } else if (len <= 7) {
    return { fontSize: 100, textLength: 850 };
  } else {
    return { fontSize: 90, textLength: 880 };
  }
}

/**
 * Split a codeword into Line 1 (Word 1) and Line 2 (Word 2).
 */
export function parseTabletCodeword(codeword: string): { line1: string; line2: string } {
  const clean = (codeword || 'CRIMSON SHADOW').trim().toUpperCase();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return {
      line1: parts[0],
      line2: parts.slice(1).join(' '),
    };
  }
  // Single word fallback: split in half
  const mid = Math.ceil(clean.length / 2);
  return {
    line1: clean.slice(0, mid),
    line2: clean.slice(mid),
  };
}

/**
 * Slot positions from Left to Right.
 */
export function getSlotPositionLabel(slotIndex: number, teamSize: number): string {
  const safeSize = Math.max(1, teamSize);
  if (slotIndex === 0) return 'FAR LEFT FRAGMENT';
  if (slotIndex === safeSize - 1) return 'FAR RIGHT FRAGMENT';
  if (slotIndex === Math.floor(safeSize / 2)) return 'CENTER FRAGMENT';
  if (slotIndex < Math.floor(safeSize / 2)) return `LEFT-CENTER (#${slotIndex + 1})`;
  return `RIGHT-CENTER (#${slotIndex + 1})`;
}

/**
 * Generate human-readable hint text identifying player slot on the table.
 */
export function generateTabletHintText(
  hintIndex: number,
  teamSize: number,
  slotMembers: { slotIndex: number; playerName: string; roleName: string }[]
): string {
  const safeSize = Math.max(1, teamSize);
  let targetSlot = 0;

  if (hintIndex === 1) {
    targetSlot = 0; // Far left
  } else if (hintIndex === 2) {
    targetSlot = safeSize - 1; // Far right
  } else {
    targetSlot = Math.floor(safeSize / 2); // Center
  }

  const member = slotMembers.find(m => m.slotIndex === targetSlot);
  const nameLabel = member ? member.playerName : `Crew Member #${targetSlot + 1}`;
  const roleLabel = member ? member.roleName : `Slot #${targetSlot + 1}`;

  if (hintIndex === 1) {
    return `🛡️ LEFT EDGE: "${nameLabel}" (${roleLabel}) holds the FAR LEFT piece of the ancient tablet. Place their phone on the left side of the table!`;
  } else if (hintIndex === 2) {
    return `⚓ RIGHT EDGE: "${nameLabel}" (${roleLabel}) holds the FAR RIGHT piece of the ancient tablet. Place their phone on the right side of the table!`;
  } else {
    return `👁️ CENTER PIECE: "${nameLabel}" (${roleLabel}) holds the CENTER piece of the tablet. Place their phone in the middle between left and right!`;
  }
}
