// Complete 7-row ASCII font dictionary for full uppercase A-Z and 0-9
export const ASCII_FONT_7ROW: Record<string, string[]> = {
  A: [
    " █████ ",
    "██   ██",
    "██   ██",
    "███████",
    "██   ██",
    "██   ██",
    "██   ██"
  ],
  B: [
    "██████ ",
    "██   ██",
    "██   ██",
    "██████ ",
    "██   ██",
    "██   ██",
    "██████ "
  ],
  C: [
    " █████ ",
    "██   ██",
    "██     ",
    "██     ",
    "██     ",
    "██   ██",
    " █████ "
  ],
  D: [
    "██████ ",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    "██████ "
  ],
  E: [
    "███████",
    "██     ",
    "██     ",
    "█████  ",
    "██     ",
    "██     ",
    "███████"
  ],
  F: [
    "███████",
    "██     ",
    "██     ",
    "█████  ",
    "██     ",
    "██     ",
    "██     "
  ],
  G: [
    " ██████ ",
    "██      ",
    "██      ",
    "██   ███",
    "██    ██",
    "██    ██",
    " ██████ "
  ],
  H: [
    "██   ██",
    "██   ██",
    "██   ██",
    "███████",
    "██   ██",
    "██   ██",
    "██   ██"
  ],
  I: [
    "█████",
    "  ██ ",
    "  ██ ",
    "  ██ ",
    "  ██ ",
    "  ██ ",
    "█████"
  ],
  J: [
    "    ███",
    "     ██",
    "     ██",
    "     ██",
    "     ██",
    "██   ██",
    " █████ "
  ],
  K: [
    "██   ██",
    "██  ██ ",
    "██ ██  ",
    "████   ",
    "██ ██  ",
    "██  ██ ",
    "██   ██"
  ],
  L: [
    "██     ",
    "██     ",
    "██     ",
    "██     ",
    "██     ",
    "██     ",
    "███████"
  ],
  M: [
    "██   ██",
    "███ ███",
    "██ █ ██",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██"
  ],
  N: [
    "███   ██",
    "████  ██",
    "██ ██ ██",
    "██  ████",
    "██   ███",
    "██    ██",
    "██    ██"
  ],
  O: [
    " █████ ",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    " █████ "
  ],
  P: [
    "██████ ",
    "██   ██",
    "██   ██",
    "██████ ",
    "██     ",
    "██     ",
    "██     "
  ],
  Q: [
    " █████  ",
    "██   ██ ",
    "██   ██ ",
    "██   ██ ",
    "██ █ ██ ",
    "██  ███ ",
    " ████ ██"
  ],
  R: [
    "██████ ",
    "██   ██",
    "██   ██",
    "██████ ",
    "██   ██",
    "██   ██",
    "██   ██"
  ],
  S: [
    "███████",
    "██     ",
    "██     ",
    "███████",
    "     ██",
    "     ██",
    "███████"
  ],
  T: [
    "████████",
    "   ██   ",
    "   ██   ",
    "   ██   ",
    "   ██   ",
    "   ██   ",
    "   ██   "
  ],
  U: [
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    "██   ██",
    " █████ "
  ],
  V: [
    "██    ██",
    "██    ██",
    "██    ██",
    "██    ██",
    " ██  ██ ",
    "  ████  ",
    "   ██   "
  ],
  W: [
    "██     ██",
    "██     ██",
    "██  █  ██",
    "██ █ █ ██",
    "██ █ █ ██",
    "███   ███",
    "██     ██"
  ],
  X: [
    "██   ██",
    " ██ ██ ",
    "  ███  ",
    "   █   ",
    "  ███  ",
    " ██ ██ ",
    "██   ██"
  ],
  Y: [
    "██    ██",
    " ██  ██ ",
    "  ████  ",
    "   ██   ",
    "   ██   ",
    "   ██   ",
    "   ██   "
  ],
  Z: [
    "███████",
    "     ██",
    "    ██ ",
    "   ██  ",
    "  ██   ",
    " ██    ",
    "███████"
  ],
  " ": [
    "   ",
    "   ",
    "   ",
    "   ",
    "   ",
    "   ",
    "   "
  ]
};

// Render any word into a 7-row ASCII matrix
export function renderWordToAscii(word: string): string[] {
  const letters = word.toUpperCase().split("");
  const rows: string[] = Array(7).fill("");
  for (let r = 0; r < 7; r++) {
    rows[r] = letters.map(char => ASCII_FONT_7ROW[char]?.[r] || "       ").join(" ");
  }
  return rows;
}

// Slice dynamically for ANY team size (e.g. 3, 4, 5, 6, 7 players)
export function getPlayerAsciiSlice(
  word: string,
  playerSlotIndex: number, // 0 to teamSize - 1
  teamSize: number,
  mode: "HORIZONTAL" | "VERTICAL" = "HORIZONTAL"
): string[] {
  const safeTeamSize = Math.max(1, teamSize);
  const safeSlot = Math.max(0, Math.min(playerSlotIndex, safeTeamSize - 1));
  const fullRows = renderWordToAscii(word); // 7 rows high

  // Double each row vertically to make it 14 rows tall for bold legibility on phones
  const tallRows = fullRows.flatMap(r => [r, r]); // 14 rows high

  if (mode === "HORIZONTAL") {
    const totalRows = tallRows.length; // 14
    const sliceHeight = Math.max(2, Math.ceil(totalRows / safeTeamSize));
    const startRow = Math.min(
      totalRows - sliceHeight,
      Math.floor((safeSlot * totalRows) / safeTeamSize)
    );
    const endRow = Math.min(totalRows, startRow + sliceHeight);

    return tallRows
      .slice(startRow, endRow)
      .map(line => `├ ${line} ┤`);
  } else {
    // VERTICAL slicing: slice columns across teamSize players
    const totalCols = tallRows[0].length;
    const sliceWidth = Math.max(4, Math.ceil(totalCols / safeTeamSize));
    const startCol = Math.min(
      totalCols - sliceWidth,
      Math.floor((safeSlot * totalCols) / safeTeamSize)
    );
    const endCol = Math.min(totalCols, startCol + sliceWidth);

    return tallRows.map(line => line.slice(startCol, endCol));
  }
}

// Mythic nautical / underworld decorative header and footer borders for totem stacking
export const MYTHIC_DECORATIVE_BORDERS = {
  topCap: [
    "╔═══════════════════════════════════════╗",
    "║  ~ ✦ ~ THE UNDERWORLD VAULT ~ ✦ ~    ║",
    "╚═══════════════════════════════════════╝"
  ],
  bottomBase: [
    "╔═══════════════════════════════════════╗",
    "║  ✦ REST IN SHADOWS • REVEAL THE PATH ✦ ║",
    "╚═══════════════════════════════════════╝"
  ]
};
