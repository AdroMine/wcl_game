import pptxgen from "pptxgenjs";

const pres = new pptxgen();

// Modern 16:9 Widescreen Standard (13.333" x 7.5")
pres.defineLayout({ name: "WIDESCREEN_16_9", width: 13.333, height: 7.5 });
pres.layout = "WIDESCREEN_16_9";

pres.title = "Underworld: The Stygian Trials - Team Briefing";
pres.author = "Game Master Team";

// Theme Colors
const C = {
  bg: "0A0D14",
  cardBg: "141A2A",
  cardBorder: "334155",
  gold: "F59E0B",
  goldLight: "FEF3C7",
  text: "E2E8F0",
  muted: "94A3B8",
  cyan: "06B6D4",
  rose: "F43F5E",
  emerald: "10B981",
  purple: "A855F7"
};

// Helper: Standard Slide Header
function addHeader(slide: any, tag: string, tagColor: string, title: string, subtitle: string) {
  // Tag
  slide.addText(tag, {
    x: 0.8,
    y: 0.45,
    w: 8.0,
    h: 0.3,
    fontSize: 10,
    color: tagColor,
    bold: true,
    charSpacing: 2
  });

  // Title
  slide.addText(title, {
    x: 0.8,
    y: 0.75,
    w: 11.7,
    h: 0.6,
    fontSize: 26,
    color: C.goldLight,
    bold: true
  });

  // Subtitle
  slide.addText(subtitle, {
    x: 0.8,
    y: 1.35,
    w: 11.7,
    h: 0.35,
    fontSize: 12,
    color: C.muted
  });
}

// -------------------------------------------------------------
// SLIDE 1: GAME OVERVIEW & FLOW
// -------------------------------------------------------------
const slide1 = pres.addSlide();
slide1.background = { color: C.bg };
addHeader(slide1, "UNDERWORLD ENGINE • TEAM BRIEFING", C.gold, "ESCAPE FROM TARTARUS", "Complete Game Overview & 3-Round Journey");

// 4 Pipeline Boxes
const flowData = [
  { step: "0. LOBBY", title: "Crew Assembly", desc: "3-Emoji Keypad & Roles" },
  { step: "1. ROUND 1", title: "Shattered Tablet", desc: "Physical Phone Puzzle" },
  { step: "2. ROUND 2", title: "Shades in Mist", desc: "Social Dilemma & Bluffing" },
  { step: "3. ROUND 3", title: "Styx Escape", desc: "1,000m Vessel Royale" }
];

flowData.forEach((box, i) => {
  const x = 0.8 + i * 2.99;
  slide1.addShape(pres.ShapeType.roundRect, {
    x,
    y: 1.85,
    w: 2.75,
    h: 1.1,
    fill: { color: C.cardBg },
    line: { color: C.gold, width: 1.5 },
    rectRadius: 0.08
  });

  slide1.addText(box.step, {
    x: x + 0.1,
    y: 1.95,
    w: 2.55,
    h: 0.25,
    fontSize: 9,
    color: C.gold,
    bold: true,
    align: "center"
  });

  slide1.addText(box.title, {
    x: x + 0.1,
    y: 2.2,
    w: 2.55,
    h: 0.35,
    fontSize: 13,
    color: C.text,
    bold: true,
    align: "center"
  });

  slide1.addText(box.desc, {
    x: x + 0.1,
    y: 2.55,
    w: 2.55,
    h: 0.3,
    fontSize: 9.5,
    color: C.muted,
    align: "center"
  });
});

// Left Card: 5-Player Crews
slide1.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 3.2,
  w: 5.75,
  h: 3.65,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide1.addText("👥 The 5-Player Crews", {
  x: 1.05,
  y: 3.4,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide1.addText([
  { text: "• 5 Distinct Roles: ", options: { bold: true, color: C.text } },
  { text: "Navigator, Oracle, Scholar, Torchbearer, Negotiator.\n\n", options: { color: C.muted } },
  { text: "• Simple Identity (No Complex Powers): ", options: { bold: true, color: C.text } },
  { text: "Roles serve as crew member identities and tablet puzzle slots. Players don't need to learn complicated abilities.\n\n", options: { color: C.muted } },
  { text: "• 1-Tap Emoji Joining: ", options: { bold: true, color: C.text } },
  { text: "One player creates the crew; teammates join by tapping 3 emojis on screen (e.g. Skull • Bolt • Shield).\n\n", options: { color: C.muted } },
  { text: "• Zero Friction: ", options: { bold: true, color: C.text } },
  { text: "No app to download, no typing, no camera permissions.", options: { color: C.emerald } }
], {
  x: 1.05,
  y: 3.9,
  w: 5.25,
  h: 2.8,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// Right Card: Ultimate Objective
slide1.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 3.2,
  w: 5.75,
  h: 3.65,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide1.addText("🏆 The Ultimate Objective", {
  x: 7.03,
  y: 3.4,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide1.addText([
  { text: "• Rounds 1 & 2 (Points Pool): ", options: { bold: true, color: C.text } },
  { text: "Earn points through team physical coordination and tactical room psychology.\n\n", options: { color: C.muted } },
  { text: "• Starting Head-Start: ", options: { bold: true, color: C.text } },
  { text: "Cumulative points convert directly into starting distance meters on the River Styx in Round 3!\n\n", options: { color: C.muted } },
  { text: "• Podium Victory: ", options: { bold: true, color: C.text } },
  { text: "First 3 crews to cross the 1,000-meter exit portal win Gold, Silver, and Bronze medals.\n\n", options: { color: C.gold } },
  { text: "• Fast & Social: ", options: { bold: true, color: C.text } },
  { text: "The whole experience runs in ~25-30 minutes of high-energy pub interaction.", options: { color: C.muted } }
], {
  x: 7.03,
  y: 3.9,
  w: 5.25,
  h: 2.8,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// -------------------------------------------------------------
// SLIDE 2: ROUND 1 — THE SHATTERED TABLET
// -------------------------------------------------------------
const slide2 = pres.addSlide();
slide2.background = { color: C.bg };
addHeader(slide2, "ROUND 1 • PHYSICAL COOPERATION PUZZLE", C.cyan, "THE SHATTERED TABLET", "Tomb Gate Alignment • Duration: ~5 Minutes");

// Left Card: Mechanic
slide2.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 1.85,
  w: 5.75,
  h: 4.25,
  fill: { color: C.cardBg },
  line: { color: C.cyan, width: 1.5 },
  rectRadius: 0.08
});

slide2.addText("🧩 The Story & Mechanic", {
  x: 1.05,
  y: 2.05,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide2.addText([
  { text: "• The Setup: ", options: { bold: true, color: C.text } },
  { text: "A locked ancient tomb door blocks Tartarus. A shattered stone tablet lies in front of you.\n\n", options: { color: C.muted } },
  { text: "• 5 Slices on 5 Phones: ", options: { bold: true, color: C.text } },
  { text: "The tablet is split into 5 vertical slices distributed across the crew's phones (#1 to #5).\n\n", options: { color: C.muted } },
  { text: "• Physical Arrangement: ", options: { bold: true, color: C.text } },
  { text: "Players must physically place their 5 phones side-by-side in numerical order (#1 to #5) across the table.\n\n", options: { color: C.muted } },
  { text: "• The Clue: ", options: { bold: true, color: C.text } },
  { text: "Golden fracture lines connect across phone borders to reveal a 2-word codeword (e.g. CRIMSON SHADOW).", options: { color: C.gold } }
], {
  x: 1.05,
  y: 2.55,
  w: 5.25,
  h: 3.3,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// Right Card: Scoring & Hints
slide2.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 1.85,
  w: 5.75,
  h: 4.25,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide2.addText("⏱️ Points & Progressive Hints", {
  x: 7.03,
  y: 2.05,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide2.addText([
  { text: "• Speed is Rewarded: ", options: { bold: true, color: C.text } },
  { text: "Faster team solves earn higher base points (Legendary $\\rightarrow$ Swift $\\rightarrow$ Steady).\n\n", options: { color: C.muted } },
  { text: "• Any Player Can Submit: ", options: { bold: true, color: C.text } },
  { text: "Once solved, any teammate can type and submit the codeword on their screen.\n\n", options: { color: C.muted } },
  { text: "• Progressive Hints: ", options: { bold: true, color: C.text } },
  { text: "Hints unlock at 2m, 3m, and 4m pinpointing who holds the left (#1), right (#5), and center (#3) pieces (-30 PTS penalty each).\n\n", options: { color: C.muted } },
  { text: "• Safety Net: ", options: { bold: true, color: C.text } },
  { text: "50 PTS guaranteed floor ensures every crew passes through the door.", options: { color: C.emerald } }
], {
  x: 7.03,
  y: 2.55,
  w: 5.25,
  h: 3.3,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// Bottom Callout
slide2.addShape(pres.ShapeType.rect, {
  x: 0.8,
  y: 6.3,
  w: 11.73,
  h: 0.65,
  fill: { color: "1E293B" },
  line: { color: C.cyan, width: 1 }
});

slide2.addText("💡 Facilitator Cue: \"Don't stay seated staring at your own screen—stand up, place your 5 phones in order 1 to 5, and read the tablet together!\"", {
  x: 1.0,
  y: 6.42,
  w: 11.33,
  h: 0.4,
  fontSize: 11,
  color: C.goldLight,
  bold: true,
  align: "center"
});

// -------------------------------------------------------------
// SLIDE 3: ROUND 2 — SHADES IN THE MIST
// -------------------------------------------------------------
const slide3 = pres.addSlide();
slide3.background = { color: C.bg };
addHeader(slide3, "ROUND 2 • SOCIAL DILEMMA & BLUFFING", C.rose, "SHADES IN THE MIST", "3 Clashes vs Rival Table • Face-to-Face Negotiation • Bluffing Allowed");

// Left Card: 4 Phases
slide3.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 1.85,
  w: 5.75,
  h: 4.25,
  fill: { color: C.cardBg },
  line: { color: C.rose, width: 1.5 },
  rectRadius: 0.08
});

slide3.addText("⚔️ How Each Clash Runs", {
  x: 1.05,
  y: 2.05,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide3.addText([
  { text: "Your crew faces a rival table across 3 escalating clashes:\n\n", options: { color: C.muted } },
  { text: "1. Private Huddle (50s): ", options: { bold: true, color: C.text } },
  { text: "Whisper at your table. Decide your true stance: Truce or Ambush?\n\n", options: { color: C.muted } },
  { text: "2. The Dialogue (40s): ", options: { bold: true, color: C.text } },
  { text: "Turn to rival table. Look them in the eyes and negotiate across the room. (Bluffing is 100% permitted!).\n\n", options: { color: C.muted } },
  { text: "3. Secret Blind Vote (25s): ", options: { bold: true, color: C.text } },
  { text: "Every player secretly votes on phone. Majority rules (Negotiator breaks ties).\n\n", options: { color: C.muted } },
  { text: "4. The Reveal (40s): ", options: { bold: true, color: C.text } },
  { text: "Both tables' choices unmask simultaneously on screen!", options: { color: C.gold } }
], {
  x: 1.05,
  y: 2.55,
  w: 5.25,
  h: 3.3,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// Right Card: Points & Legacy
slide3.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 1.85,
  w: 5.75,
  h: 4.25,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide3.addText("⚖️ The Stances & Moral Legacy", {
  x: 7.03,
  y: 2.05,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide3.addText([
  { text: "Point Outcomes (Stakes DOUBLE in Clash 2, TRIPLE in Clash 3!):\n\n", options: { bold: true, color: C.gold } },
  { text: "🤝 Mutual Truce: ", options: { bold: true, color: C.emerald } },
  { text: "Both crews play peaceful $\\rightarrow$ Both win solid, steady points.\n\n", options: { color: C.muted } },
  { text: "🗡️ The Backstab: ", options: { bold: true, color: C.rose } },
  { text: "Ambush beats Truce $\\rightarrow$ Betrayer steals massive points; victim gets 0!\n\n", options: { color: C.muted } },
  { text: "💥 Mutual Brawl: ", options: { bold: true, color: C.gold } },
  { text: "Both crews attack $\\rightarrow$ Both walk away with scraps.\n\n", options: { color: C.muted } },
  { text: "🕊️ Moral Legacy in Round 3:\n", options: { bold: true, color: C.goldLight } },
  { text: "• Honourable (3 Truces): Athena grants +75m headstart in Round 3!\n• Betrayed: Crew gets a Cerberus revenge token to strike their nemesis!", options: { color: C.text } }
], {
  x: 7.03,
  y: 2.55,
  w: 5.25,
  h: 3.3,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// Bottom Callout
slide3.addShape(pres.ShapeType.rect, {
  x: 0.8,
  y: 6.3,
  w: 11.73,
  h: 0.65,
  fill: { color: "1E293B" },
  line: { color: C.rose, width: 1 }
});

slide3.addText("💡 Facilitator Cue: \"Promises made across the room are not binding. Will you build trust, or cash in on a brutal backstab?\"", {
  x: 1.0,
  y: 6.42,
  w: 11.33,
  h: 0.4,
  fontSize: 11,
  color: C.goldLight,
  bold: true,
  align: "center"
});

// -------------------------------------------------------------
// SLIDE 4: ROUND 3 — ESCAPE FROM TARTARUS
// -------------------------------------------------------------
const slide4 = pres.addSlide();
slide4.background = { color: C.bg };
addHeader(slide4, "ROUND 3 • THE CLIMAX & ESCAPE ROYALE", C.purple, "ESCAPE FROM TARTARUS", "River Styx Congestion Race • 1,000m to the Exit Portal");

// 3 Vessels
const vessels = [
  {
    icon: "🚣",
    name: "The Rowboat",
    tag: "SAFE & STEADY",
    color: C.emerald,
    cap: "Unlimited Capacity",
    outcome: "+150m ALWAYS",
    desc: "Never capsizes. Reliable steady progress while rivals greedily crash."
  },
  {
    icon: "⛵",
    name: "The Sailboat",
    tag: "SPEED VS CROWDS",
    color: C.gold,
    cap: "Max 30% of Fleet",
    outcome: "+300m or CAPSIZE (0m)",
    desc: "Fast surge! But if too many crews board, the vessel capsizes into the river."
  },
  {
    icon: "⚡",
    name: "The Ghost Ship",
    tag: "SOLO GAMBLE",
    color: C.purple,
    cap: "EXACTLY 1 Crew Only",
    outcome: "+450m or CRASH (-50m)",
    desc: "Mythic leap! But if 2 or more crews choose it, they collide (-50m penalty)."
  }
];

vessels.forEach((v, i) => {
  const x = 0.8 + i * 4.02;
  slide4.addShape(pres.ShapeType.roundRect, {
    x,
    y: 1.85,
    w: 3.69,
    h: 2.35,
    fill: { color: C.cardBg },
    line: { color: v.color, width: 1.5 },
    rectRadius: 0.08
  });

  slide4.addText(`${v.icon} ${v.name}`, {
    x: x + 0.15,
    y: 1.95,
    w: 3.39,
    h: 0.35,
    fontSize: 15,
    color: v.color,
    bold: true
  });

  slide4.addText(v.tag, {
    x: x + 0.15,
    y: 2.3,
    w: 3.39,
    h: 0.2,
    fontSize: 8.5,
    color: C.muted,
    bold: true
  });

  slide4.addText([
    { text: `• ${v.cap}\n`, options: { bold: true, color: C.text } },
    { text: `• Advance: `, options: { bold: true, color: C.text } },
    { text: `${v.outcome}\n\n`, options: { bold: true, color: v.color } },
    { text: v.desc, options: { color: C.muted } }
  ], {
    x: x + 0.15,
    y: 2.55,
    w: 3.39,
    h: 1.5,
    fontSize: 9.5,
    lineSpacingMultiple: 1.15
  });
});

// 2 Bottom Panels
slide4.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 4.4,
  w: 5.75,
  h: 2.5,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide4.addText("🏁 Deciding the Winners", {
  x: 1.05,
  y: 4.55,
  w: 5.25,
  h: 0.35,
  fontSize: 14,
  color: C.goldLight,
  bold: true
});

slide4.addText([
  { text: "• Starting Head-Start: ", options: { bold: true, color: C.text } },
  { text: "Points from R1 & R2 convert into starting meters (+75m honor bonus).\n\n", options: { color: C.muted } },
  { text: "• Podium Victory: ", options: { bold: true, color: C.text } },
  { text: "First 3 crews across the 1,000m line win Gold, Silver & Bronze medals!\n\n", options: { color: C.gold } },
  { text: "• Sudden Death: ", options: { bold: true, color: C.text } },
  { text: "Tie-breaker duel (Shields vs Ram vs Sails) if crews cross together.", options: { color: C.muted } }
], {
  x: 1.05,
  y: 4.95,
  w: 5.25,
  h: 1.8,
  fontSize: 10.5,
  lineSpacingMultiple: 1.15
});

slide4.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 4.4,
  w: 5.75,
  h: 2.5,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide4.addText("🐕 Cerberus Revenge Attack", {
  x: 7.03,
  y: 4.55,
  w: 5.25,
  h: 0.35,
  fontSize: 14,
  color: C.goldLight,
  bold: true
});

slide4.addText([
  { text: "• Retaliation for Betrayal: ", options: { bold: true, color: C.text } },
  { text: "Teams backstabbed in Round 2 hold a Cerberus honey-cake treat.\n\n", options: { color: C.muted } },
  { text: "• The Interception: ", options: { bold: true, color: C.text } },
  { text: "Guess which boat your nemesis will pick this wave. If correct:\n", options: { color: C.muted } },
  { text: "  ➔ Nemesis dragged back -150m!\n  ➔ Your crew surges forward +150m!", options: { bold: true, color: C.rose } }
], {
  x: 7.03,
  y: 4.95,
  w: 5.25,
  h: 1.8,
  fontSize: 10.5,
  lineSpacingMultiple: 1.15
});

// -------------------------------------------------------------
// SLIDE 5: FACILITATOR CHEATSHEET
// -------------------------------------------------------------
const slide5 = pres.addSlide();
slide5.background = { color: C.bg };
addHeader(slide5, "FACILITATOR CHEATSHEET • AT A GLANCE", C.gold, "SESSION RUNNING GUIDE", "Total Event Runtime: ~25 - 30 Minutes");

const tableRows = [
  [
    { text: "ROUND", options: { bold: true, color: C.gold, fill: { color: "1E293B" } } },
    { text: "CORE ACTIVITY", options: { bold: true, color: C.gold, fill: { color: "1E293B" } } },
    { text: "HOW POINTS / PROGRESS WORK", options: { bold: true, color: C.gold, fill: { color: "1E293B" } } },
    { text: "COMPLETION", options: { bold: true, color: C.gold, fill: { color: "1E293B" } } }
  ],
  [
    { text: "1. Shattered Tablet\n(~5 min)", options: { bold: true, color: C.text } },
    { text: "Place 5 phones side-by-side in order (#1 to #5) across the table to connect carved lines.", options: { color: C.muted } },
    { text: "Fast solve = top points (up to 300). Progressive hints cost -30 PTS each. 50 PTS floor.", options: { color: C.muted } },
    { text: "2-word codeword entered or timer expires.", options: { color: C.emerald } }
  ],
  [
    { text: "2. Shades in Mist\n(~8 min)", options: { bold: true, color: C.text } },
    { text: "Face rival table across 3 clashes. Whisper in huddle, negotiate across room, vote secretly.", options: { color: C.muted } },
    { text: "Truce = steady points. Backstab = massive points or 0. Stakes triple in Clash 3.", options: { color: C.muted } },
    { text: "All 3 clashes resolved. Sets R3 headstart & revenge tokens.", options: { color: C.emerald } }
  ],
  [
    { text: "3. Styx Escape\n(~8 min)", options: { bold: true, color: C.text } },
    { text: "Pick vessels secretly (Rowboat: safe, Sailboat: 30% cap, Ghost Ship: solo).", options: { color: C.muted } },
    { text: "Points become river meters. Avoid congestion and unleash Cerberus revenge.", options: { color: C.muted } },
    { text: "Top 3 crews cross 1,000m to win Gold, Silver & Bronze medals!", options: { color: C.gold } }
  ]
];

slide5.addTable(tableRows, {
  x: 0.8,
  y: 1.85,
  w: 11.73,
  h: 4.1,
  fontSize: 10.5,
  border: { type: "solid", pt: 1, color: C.cardBorder },
  fill: { color: C.cardBg },
  align: "left",
  valign: "middle"
});

slide5.addShape(pres.ShapeType.rect, {
  x: 0.8,
  y: 6.2,
  w: 11.73,
  h: 0.65,
  fill: { color: "1E293B" },
  line: { color: C.gold, width: 1 }
});

slide5.addText("🎮 Host Operations: Game Master advances rounds at /admin • Players play at / • Solo sandbox at /test", {
  x: 1.0,
  y: 6.35,
  w: 11.33,
  h: 0.35,
  fontSize: 11,
  color: C.goldLight,
  bold: true,
  align: "center"
});

// Save presentation
pres.writeFile({ fileName: "presentation.pptx" }).then(() => {
  console.log("Successfully generated calibrated presentation.pptx!");
});
