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
  slotWidth: 200, // default for 5 pieces; the real width is totalWidth / slotCount (crews of 3 to 7)
  line1Y: 195,
  horizonY: 300,
  line2Y: 445,
};

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

/** viewBox for piece `slot` of `slotCount`: equal, non-overlapping slices that tile 0..totalWidth. */
export function getSliceViewBox(slot: number, slotCount: number): { x: number; width: number; height: number } {
  const n = Math.max(1, Math.floor(slotCount));
  const i = Math.min(n - 1, Math.max(0, Math.floor(slot)));
  const width = TABLET_CONFIG.totalWidth / n;
  return { x: i * width, width, height: TABLET_CONFIG.totalHeight };
}
