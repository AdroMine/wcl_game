import pptxgen from "pptxgenjs";

const pres = new pptxgen();

// Presentation Setup
pres.layout = "LAYOUT_16x9";
pres.title = "Underworld: The Stygian Trials - Game Briefing";
pres.author = "Game Master Team";

// Color Palette
const COLORS = {
  bg: "0A0D14",
  cardBg: "151B2E",
  gold: "F59E0B",
  goldLight: "FEF3C7",
  text: "E2E8F0",
  muted: "94A3B8",
  cyan: "06B6D4",
  rose: "F43F5E",
  emerald: "10B981",
  purple: "A855F7"
};

// -------------------------------------------------------------
// SLIDE 1: GAME OVERVIEW & FLOW
// -------------------------------------------------------------
const slide1 = pres.addSlide();
slide1.background = { color: COLORS.bg };

// Header
slide1.addText("UNDERWORLD ENGINE • TEAM BRIEFING", {
  x: 0.8,
  y: 0.5,
  w: 8.0,
  h: 0.4,
  fontSize: 11,
  color: COLORS.gold,
  bold: true,
  charSpacing: 2
});

slide1.addText("ESCAPE FROM TARTARUS", {
  x: 0.8,
  y: 0.8,
  w: 11.0,
  h: 0.8,
  fontSize: 32,
  color: COLORS.goldLight,
  bold: true
});

slide1.addText("Complete Game Flow & 3-Round Journey", {
  x: 0.8,
  y: 1.5,
  w: 10.0,
  h: 0.4,
  fontSize: 14,
  color: COLORS.muted
});

// Flow Pipeline Boxes
const flowData = [
  { step: "0. LOBBY", title: "Crew Assembly", desc: "3-Emoji Keypad & 5 Roles" },
  { step: "1. ROUND 1", title: "Shattered Tablet", desc: "Physical Phone Alignment" },
  { step: "2. ROUND 2", title: "Shades in Mist", desc: "Social Dilemma & Bluffing" },
  { step: "3. ROUND 3", title: "Styx Escape", desc: "1,000m Vessel Royale" }
];

flowData.forEach((box, i) => {
  const x = 0.8 + i * 2.85;
  slide1.addShape(pres.ShapeType.roundRect, {
    x,
    y: 2.1,
    w: 2.65,
    h: 1.2,
    fill: { color: COLORS.cardBg },
    line: { color: COLORS.gold, width: 1.5 },
    rectRadius: 0.1
  });

  slide1.addText(box.step, {
    x: x + 0.1,
    y: 2.2,
    w: 2.45,
    h: 0.3,
    fontSize: 10,
    color: COLORS.gold,
    bold: true,
    align: "center"
  });

  slide1.addText(box.title, {
    x: x + 0.1,
    y: 2.5,
    w: 2.45,
    h: 0.35,
    fontSize: 13,
    color: COLORS.text,
    bold: true,
    align: "center"
  });

  slide1.addText(box.desc, {
    x: x + 0.1,
    y: 2.85,
    w: 2.45,
    h: 0.35,
    fontSize: 10,
    color: COLORS.muted,
    align: "center"
  });
});

// 2 Bottom Cards
// Card Left: The 5-Player Crew
slide1.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 3.6,
  w: 5.6,
  h: 3.2,
  fill: { color: COLORS.cardBg },
  line: { color: "334155", width: 1 },
  rectRadius: 0.1
});

slide1.addText("👥 The 5-Player Crews", {
  x: 1.0,
  y: 3.8,
  w: 5.2,
  h: 0.4,
  fontSize: 16,
  color: COLORS.goldLight,
  bold: true
});

slide1.addText([
  { text: "• 5 Crew Member Identities: ", options: { bold: true, color: COLORS.text } },
  { text: "Navigator, Oracle, Scholar, Torchbearer, Negotiator (roles serve as identity and tablet slots; no complex powers to memorize).\n\n", options: { color: COLORS.muted } },
  { text: "• 1-Tap Emoji Joining: ", options: { bold: true, color: COLORS.text } },
  { text: "One teammate creates the crew; others tap a 3-emoji code (e.g. Skull • Bolt • Shield) on screen.\n\n", options: { color: COLORS.muted } },
  { text: "• Frictionless: ", options: { bold: true, color: COLORS.text } },
  { text: "No app downloads, no typing, no camera permissions required.", options: { color: COLORS.muted } }
], {
  x: 1.0,
  y: 4.3,
  w: 5.2,
  h: 2.3,
  fontSize: 12,
  lineSpacingMultiple: 1.2
});

// Card Right: Ultimate Objective
slide1.addShape(pres.ShapeType.roundRect, {
  x: 6.7,
  y: 3.6,
  w: 5.8,
  h: 3.2,
  fill: { color: COLORS.cardBg },
  line: { color: "334155", width: 1 },
  rectRadius: 0.1
});

slide1.addText("🏆 The Grand Objective", {
  x: 6.9,
  y: 3.8,
  w: 5.4,
  h: 0.4,
  fontSize: 16,
  color: COLORS.goldLight,
  bold: true
});

slide1.addText([
  { text: "• Rounds 1 & 2 (Point Accumulation): ", options: { bold: true, color: COLORS.text } },
  { text: "Earn points through team physical coordination and tactical room psychology.\n\n", options: { color: COLORS.muted } },
  { text: "• Starting Head-Start: ", options: { bold: true, color: COLORS.text } },
  { text: "Cumulative points convert into a starting distance head-start on the River Styx in Round 3!\n\n", options: { color: COLORS.muted } },
  { text: "• Podium Victory: ", options: { bold: true, color: COLORS.text } },
  { text: "First 3 crews to cross the 1,000-meter portal win Gold, Silver, and Bronze medals.", options: { color: COLORS.gold } }
], {
  x: 6.9,
  y: 4.3,
  w: 5.4,
  h: 2.3,
  fontSize: 12,
  lineSpacingMultiple: 1.2
});

// -------------------------------------------------------------
// SLIDE 2: ROUND 1 — THE SHATTERED TABLET
// -------------------------------------------------------------
const slide2 = pres.addSlide();
slide2.background = { color: COLORS.bg };

slide2.addText("ROUND 1 • PHYSICAL COOPERATION PUZZLE", {
  x: 0.8,
  y: 0.5,
  w: 8.0,
  h: 0.4,
  fontSize: 11,
  color: COLORS.cyan,
  bold: true,
  charSpacing: 2
});

slide2.addText("THE SHATTERED TABLET", {
  x: 0.8,
  y: 0.8,
  w: 11.0,
  h: 0.8,
  fontSize: 32,
  color: COLORS.goldLight,
  bold: true
});

slide2.addText("Tomb Gate Alignment • Duration: ~5 Minutes", {
  x: 0.8,
  y: 1.5,
  w: 10.0,
  h: 0.4,
  fontSize: 14,
  color: COLORS.muted
});

// Card Left: Narrative & Mechanic
slide2.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 2.1,
  w: 5.6,
  h: 3.8,
  fill: { color: COLORS.cardBg },
  line: { color: COLORS.cyan, width: 1.5 },
  rectRadius: 0.1
});

slide2.addText("🧩 The Mechanic", {
  x: 1.0,
  y: 2.3,
  w: 5.2,
  h: 0.4,
  fontSize: 18,
  color: COLORS.goldLight,
  bold: true
});

slide2.addText([
  { text: "• The Setup: ", options: { bold: true, color: COLORS.text } },
  { text: "A locked ancient tomb door blocks Tartarus. A shattered stone tablet lies in front of you.\n\n", options: { color: COLORS.muted } },
  { text: "• 5 Slices across 5 Phones: ", options: { bold: true, color: COLORS.text } },
  { text: "The tablet is split into 5 vertical slices distributed across the crew's phones (Slots #1 to #5).\n\n", options: { color: COLORS.muted } },
  { text: "• Physical Arrangement: ", options: { bold: true, color: COLORS.text } },
  { text: "Players must physically place their 5 phones side-by-side in numerical order (#1 to #5) across the table.\n\n", options: { color: COLORS.muted } },
  { text: "• The Clue: ", options: { bold: true, color: COLORS.text } },
  { text: "Carved fracture lines align across screen borders to reveal a 2-word ancient codeword (e.g. CRIMSON SHADOW).", options: { color: COLORS.gold } }
], {
  x: 1.0,
  y: 2.8,
  w: 5.2,
  h: 2.9,
  fontSize: 12,
  lineSpacingMultiple: 1.15
});

// Card Right: Scoring & Hints
slide2.addShape(pres.ShapeType.roundRect, {
  x: 6.7,
  y: 2.1,
  w: 5.8,
  h: 3.8,
  fill: { color: COLORS.cardBg },
  line: { color: "334155", width: 1 },
  rectRadius: 0.1
});

slide2.addText("⏱️ Points & Progressive Hints", {
  x: 6.9,
  y: 2.3,
  w: 5.4,
  h: 0.4,
  fontSize: 18,
  color: COLORS.goldLight,
  bold: true
});

slide2.addText([
  { text: "• Speed is Rewarded: ", options: { bold: true, color: COLORS.text } },
  { text: "Fastest solves earn maximum points (Legendary: 300 PTS, Swift: 250 PTS, Steady: 200 PTS).\n\n", options: { color: COLORS.muted } },
  { text: "• Anyone Can Submit: ", options: { bold: true, color: COLORS.text } },
  { text: "Any player in the crew can type and submit the codeword once solved.\n\n", options: { color: COLORS.muted } },
  { text: "• Stuck? Timed Hints: ", options: { bold: true, color: COLORS.text } },
  { text: "Hints unlock at 2m, 3m, and 4m pinpointing who holds the left (#1), right (#5), and center (#3) pieces (-30 PTS penalty each).\n\n", options: { color: COLORS.muted } },
  { text: "• Guaranteed Safety Floor: ", options: { bold: true, color: COLORS.text } },
  { text: "50 PTS minimum floor ensures every crew passes through the door.", options: { color: COLORS.emerald } }
], {
  x: 6.9,
  y: 2.8,
  w: 5.4,
  h: 2.9,
  fontSize: 12,
  lineSpacingMultiple: 1.15
});

// Bottom callout
slide2.addShape(pres.ShapeType.rect, {
  x: 0.8,
  y: 6.1,
  w: 11.7,
  h: 0.7,
  fill: { color: "1E293B" },
  line: { color: COLORS.cyan, width: 1 }
});

slide2.addText("💡 Facilitator Cue: \"Don't stay seated staring at your own screen—stand up, place your 5 phones in order 1 to 5, and read the tablet together!\"", {
  x: 1.0,
  y: 6.25,
  w: 11.3,
  h: 0.4,
  fontSize: 11,
  color: COLORS.goldLight,
  bold: true
});

// -------------------------------------------------------------
// SLIDE 3: ROUND 2 — SHADES IN THE MIST
// -------------------------------------------------------------
const slide3 = pres.addSlide();
slide3.background = { color: COLORS.bg };

slide3.addText("ROUND 2 • SOCIAL DILEMMA & BLUFFING", {
  x: 0.8,
  y: 0.5,
  w: 8.0,
  h: 0.4,
  fontSize: 11,
  color: COLORS.rose,
  bold: true,
  charSpacing: 2
});

slide3.addText("SHADES IN THE MIST", {
  x: 0.8,
  y: 0.8,
  w: 11.0,
  h: 0.8,
  fontSize: 32,
  color: COLORS.goldLight,
  bold: true
});

slide3.addText("3 Clashes vs Rival Table • Face-to-Face Negotiation", {
  x: 0.8,
  y: 1.5,
  w: 10.0,
  h: 0.4,
  fontSize: 14,
  color: COLORS.muted
});

// Left: 4 Phases of Clash
slide3.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 2.1,
  w: 5.6,
  h: 4.6,
  fill: { color: COLORS.cardBg },
  line: { color: COLORS.rose, width: 1.5 },
  rectRadius: 0.1
});

slide3.addText("⚔️ How Each Clash Runs", {
  x: 1.0,
  y: 2.3,
  w: 5.2,
  h: 0.4,
  fontSize: 18,
  color: COLORS.goldLight,
  bold: true
});

slide3.addText([
  { text: "Your crew faces an opposing table across 3 escalating clashes:\n\n", options: { color: COLORS.muted } },
  { text: "1. Private Huddle (50s): ", options: { bold: true, color: COLORS.text } },
  { text: "Whisper at your table. Decide your true stance: Truce or Ambush?\n\n", options: { color: COLORS.muted } },
  { text: "2. The Dialogue (40s): ", options: { bold: true, color: COLORS.text } },
  { text: "Turn to the rival table. Look them in the eyes and negotiate your pact across the room. (Bluffing is 100% permitted!).\n\n", options: { color: COLORS.muted } },
  { text: "3. Secret Blind Vote (25s): ", options: { bold: true, color: COLORS.text } },
  { text: "Every player secretly votes on their phone. Majority rules (Negotiator breaks 2-2 ties).\n\n", options: { color: COLORS.muted } },
  { text: "4. The Reveal (40s): ", options: { bold: true, color: COLORS.text } },
  { text: "Both tables' decisions are unmasked simultaneously on screen!", options: { color: COLORS.gold } }
], {
  x: 1.0,
  y: 2.8,
  w: 5.2,
  h: 3.7,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// Right: Points Matrix & Legacy
slide3.addShape(pres.ShapeType.roundRect, {
  x: 6.7,
  y: 2.1,
  w: 5.8,
  h: 4.6,
  fill: { color: COLORS.cardBg },
  line: { color: "334155", width: 1 },
  rectRadius: 0.1
});

slide3.addText("⚖️ The Stances & Moral Legacy", {
  x: 6.9,
  y: 2.3,
  w: 5.4,
  h: 0.4,
  fontSize: 18,
  color: COLORS.goldLight,
  bold: true
});

slide3.addText([
  { text: "Point Outcomes (Stakes DOUBLE in Clash 2, TRIPLE in Clash 3!):\n\n", options: { bold: true, color: COLORS.gold } },
  { text: "🤝 Mutual Truce (Truce vs Truce):\n", options: { bold: true, color: COLORS.emerald } },
  { text: "Both teams play honorably $\\rightarrow$ Both win solid, safe points.\n\n", options: { color: COLORS.muted } },
  { text: "🗡️ The Backstab (Ambush vs Truce):\n", options: { bold: true, color: COLORS.rose } },
  { text: "The betrayer steals massive points; the peaceful victim gets 0!\n\n", options: { color: COLORS.muted } },
  { text: "💥 Mutual Brawl (Ambush vs Ambush):\n", options: { bold: true, color: COLORS.amber } },
  { text: "Both tables try to backstab $\\rightarrow$ Both walk away with crumbs.\n\n", options: { color: COLORS.muted } },
  { text: "🕊️ Moral Legacy in Round 3:\n", options: { bold: true, color: COLORS.goldLight } },
  { text: "• Honourable (3 Truces): Athena grants +75m headstart in Round 3!\n• Betrayed: Crew gets a Cerberus revenge token to strike their nemesis!", options: { color: COLORS.text } }
], {
  x: 6.9,
  y: 2.8,
  w: 5.4,
  h: 3.7,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// -------------------------------------------------------------
// SLIDE 4: ROUND 3 — ESCAPE FROM TARTARUS
// -------------------------------------------------------------
const slide4 = pres.addSlide();
slide4.background = { color: COLORS.bg };

slide4.addText("ROUND 3 • THE CLIMAX & ESCAPE ROYALE", {
  x: 0.8,
  y: 0.5,
  w: 8.0,
  h: 0.4,
  fontSize: 11,
  color: COLORS.gold,
  bold: true,
  charSpacing: 2
});

slide4.addText("ESCAPE FROM TARTARUS", {
  x: 0.8,
  y: 0.8,
  w: 11.0,
  h: 0.8,
  fontSize: 32,
  color: COLORS.goldLight,
  bold: true
});

slide4.addText("River Styx Congestion Race • 1,000m to the Portal", {
  x: 0.8,
  y: 1.5,
  w: 10.0,
  h: 0.4,
  fontSize: 14,
  color: COLORS.muted
});

// 3 Vessels Boxes
const vessels = [
  {
    icon: "🚣",
    name: "The Rowboat",
    tag: "SAFE & STEADY",
    color: COLORS.emerald,
    cap: "Unlimited Capacity",
    outcome: "+150m ALWAYS",
    desc: "Never capsizes. Reliable progress while rival crews greedily crash."
  },
  {
    icon: "⛵",
    name: "The Sailboat",
    tag: "SPEED VS CROWDS",
    color: COLORS.gold,
    cap: "Max 30% of Fleet",
    outcome: "+300m or CAPSIZE (0m)",
    desc: "Fast surge! But if too many crews board, the vessel capsizes."
  },
  {
    icon: "⚡",
    name: "The Ghost Ship",
    tag: "SOLO GAMBLE",
    color: COLORS.purple,
    cap: "EXACTLY 1 Crew Only",
    outcome: "+450m or CRASH (-50m)",
    desc: "Mythic leap! But if 2 or more crews choose it, they collide (-50m)."
  }
];

vessels.forEach((v, i) => {
  const x = 0.8 + i * 3.85;
  slide4.addShape(pres.ShapeType.roundRect, {
    x,
    y: 2.1,
    w: 3.65,
    h: 2.6,
    fill: { color: COLORS.cardBg },
    line: { color: v.color, width: 1.5 },
    rectRadius: 0.1
  });

  slide4.addText(`${v.icon} ${v.name}`, {
    x: x + 0.15,
    y: 2.25,
    w: 3.35,
    h: 0.35,
    fontSize: 16,
    color: v.color,
    bold: true
  });

  slide4.addText(v.tag, {
    x: x + 0.15,
    y: 2.6,
    w: 3.35,
    h: 0.25,
    fontSize: 9,
    color: COLORS.muted,
    bold: true
  });

  slide4.addText([
    { text: `• ${v.cap}\n`, options: { bold: true, color: COLORS.text } },
    { text: `• Outcome: `, options: { bold: true, color: COLORS.text } },
    { text: `${v.outcome}\n\n`, options: { bold: true, color: v.color } },
    { text: v.desc, options: { color: COLORS.muted } }
  ], {
    x: x + 0.15,
    y: 2.9,
    w: 3.35,
    h: 1.6,
    fontSize: 10,
    lineSpacingMultiple: 1.15
  });
});

// Bottom 2 Info Panels
slide4.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 4.9,
  w: 5.6,
  h: 1.9,
  fill: { color: COLORS.cardBg },
  line: { color: "334155", width: 1 },
  rectRadius: 0.1
});

slide4.addText("🏁 Deciding the Winners", {
  x: 1.0,
  y: 5.05,
  w: 5.2,
  h: 0.35,
  fontSize: 14,
  color: COLORS.goldLight,
  bold: true
});

slide4.addText([
  { text: "• Starting Line: ", options: { bold: true, color: COLORS.text } },
  { text: "Total points from R1 & R2 convert into starting meters (+75m if honorable).\n", options: { color: COLORS.muted } },
  { text: "• The Victory Gate: ", options: { bold: true, color: COLORS.text } },
  { text: "First 3 crews to reach 1,000m win Gold, Silver & Bronze medals!\n", options: { color: COLORS.gold } },
  { text: "• Sudden Death: ", options: { bold: true, color: COLORS.text } },
  { text: "Tie-breaker standoff (Shields vs Ram vs Sails) if crews cross together.", options: { color: COLORS.muted } }
], {
  x: 1.0,
  y: 5.4,
  w: 5.2,
  h: 1.3,
  fontSize: 10,
  lineSpacingMultiple: 1.15
});

slide4.addShape(pres.ShapeType.roundRect, {
  x: 6.7,
  y: 4.9,
  w: 5.8,
  h: 1.9,
  fill: { color: COLORS.cardBg },
  line: { color: "334155", width: 1 },
  rectRadius: 0.1
});

slide4.addText("🐕 Cerberus Revenge Attack", {
  x: 6.9,
  y: 5.05,
  w: 5.4,
  h: 0.35,
  fontSize: 14,
  color: COLORS.goldLight,
  bold: true
});

slide4.addText([
  { text: "• Revenge for Betrayal: ", options: { bold: true, color: COLORS.text } },
  { text: "Teams backstabbed in Round 2 hold a Cerberus honey-cake treat.\n", options: { color: COLORS.muted } },
  { text: "• The Interception: ", options: { bold: true, color: COLORS.text } },
  { text: "Guess which boat your nemesis will take. If you predict correctly:\n", options: { color: COLORS.muted } },
  { text: "  ➔ Nemesis dragged back -150m!\n  ➔ Your crew surges forward +150m!", options: { bold: true, color: COLORS.rose } }
], {
  x: 6.9,
  y: 5.4,
  w: 5.4,
  h: 1.3,
  fontSize: 10,
  lineSpacingMultiple: 1.15
});

// -------------------------------------------------------------
// SLIDE 5: FACILITATOR CHEATSHEET
// -------------------------------------------------------------
const slide5 = pres.addSlide();
slide5.background = { color: COLORS.bg };

slide5.addText("FACILITATOR CHEATSHEET • AT A GLANCE", {
  x: 0.8,
  y: 0.5,
  w: 8.0,
  h: 0.4,
  fontSize: 11,
  color: COLORS.gold,
  bold: true,
  charSpacing: 2
});

slide5.addText("SESSION RUNNING GUIDE", {
  x: 0.8,
  y: 0.8,
  w: 11.0,
  h: 0.8,
  fontSize: 32,
  color: COLORS.goldLight,
  bold: true
});

slide5.addText("Total Event Runtime: ~25 - 30 Minutes", {
  x: 0.8,
  y: 1.5,
  w: 10.0,
  h: 0.4,
  fontSize: 14,
  color: COLORS.muted
});

// Summary Table
const tableRows = [
  [
    { text: "ROUND", options: { bold: true, color: COLORS.gold, fill: { color: "1E293B" } } },
    { text: "CORE ACTIVITY", options: { bold: true, color: COLORS.gold, fill: { color: "1E293B" } } },
    { text: "HOW POINTS / PROGRESS WORK", options: { bold: true, color: COLORS.gold, fill: { color: "1E293B" } } },
    { text: "ROUND COMPLETION", options: { bold: true, color: COLORS.gold, fill: { color: "1E293B" } } }
  ],
  [
    { text: "1. Shattered Tablet\n(~5 min)", options: { bold: true, color: COLORS.text } },
    { text: "Physically place 5 phones side-by-side in order (#1 to #5) to read codeword.", options: { color: COLORS.muted } },
    { text: "Fast solve = top points (300). Hints cost -30 PTS each. 50 PTS floor.", options: { color: COLORS.muted } },
    { text: "Correct 2-word codeword entered or timer expires.", options: { color: COLORS.emerald } }
  ],
  [
    { text: "2. Shades in Mist\n(~8 min)", options: { bold: true, color: COLORS.text } },
    { text: "Face rival table across 3 clashes. Negotiate in person, vote secretly.", options: { color: COLORS.muted } },
    { text: "Truce = safe points. Backstab = huge points or 0. Stakes triple in Clash 3.", options: { color: COLORS.muted } },
    { text: "All 3 clashes resolved. Determines R3 headstart & revenge tokens.", options: { color: COLORS.emerald } }
  ],
  [
    { text: "3. Styx Escape\n(~8 min)", options: { bold: true, color: COLORS.text } },
    { text: "Pick vessels secretly (Rowboat: safe, Sailboat: 30% cap, Ghost Ship: solo).", options: { color: COLORS.muted } },
    { text: "Points become river meters. Avoid capsizing and unleash Cerberus revenge.", options: { color: COLORS.muted } },
    { text: "Top 3 crews cross 1,000m to take Gold, Silver & Bronze medals!", options: { color: COLORS.gold } }
  ]
];

slide5.addTable(tableRows, {
  x: 0.8,
  y: 2.1,
  w: 11.7,
  h: 3.8,
  fontSize: 10,
  border: { type: "solid", pt: 1, color: "334155" },
  fill: { color: COLORS.cardBg },
  align: "left",
  valign: "middle"
});

// Bottom bar
slide5.addShape(pres.ShapeType.rect, {
  x: 0.8,
  y: 6.2,
  w: 11.7,
  h: 0.6,
  fill: { color: "1E293B" },
  line: { color: COLORS.gold, width: 1 }
});

slide5.addText("🎮 Host Operations: Game Master advances rounds at /admin • Players play at / • Solo sandbox at /test", {
  x: 1.0,
  y: 6.32,
  w: 11.3,
  h: 0.35,
  fontSize: 11,
  color: COLORS.goldLight,
  bold: true,
  align: "center"
});

// Save Presentation
pres.writeFile({ fileName: "presentation.pptx" }).then(() => {
  console.log("Successfully generated presentation.pptx!");
});
