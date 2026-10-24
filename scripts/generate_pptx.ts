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
  slide.addText(tag, {
    x: 0.8,
    y: 0.45,
    w: 8.0,
    h: 0.28,
    fontSize: 10,
    color: tagColor,
    bold: true,
    charSpacing: 2
  });

  slide.addText(title, {
    x: 0.8,
    y: 0.72,
    w: 11.73,
    h: 0.55,
    fontSize: 26,
    color: C.goldLight,
    bold: true
  });

  slide.addText(subtitle, {
    x: 0.8,
    y: 1.28,
    w: 11.73,
    h: 0.32,
    fontSize: 12,
    color: C.muted
  });
}

// Helper: Standard Story Banner
function addStoryBanner(slide: any, storyText: string, borderColor: string = C.gold) {
  slide.addShape(pres.ShapeType.rect, {
    x: 0.8,
    y: 1.72,
    w: 11.73,
    h: 0.65,
    fill: { color: "182033" },
    line: { color: borderColor, width: 1.5 }
  });

  slide.addText(storyText, {
    x: 1.0,
    y: 1.77,
    w: 11.33,
    h: 0.55,
    fontSize: 11,
    color: C.goldLight,
    italic: true,
    valign: "middle"
  });
}

// -------------------------------------------------------------
// SLIDE 1: GAME OVERVIEW & FLOW
// Details on top, simple process boxes below
// -------------------------------------------------------------
const slide1 = pres.addSlide();
slide1.background = { color: C.bg };
addHeader(slide1, "UNDERWORLD ENGINE • TEAM BRIEFING", C.gold, "ESCAPE FROM TARTARUS", "Complete Game Overview & 3-Round Journey");

// Left Card: 5-Player Crews
slide1.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 1.8,
  w: 5.75,
  h: 3.8,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide1.addText("👥 The 5-Player Crews", {
  x: 1.05,
  y: 2.0,
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
  { text: "Roles serve as crew member identities and tablet puzzle slots. Players don't need to manage complicated abilities.\n\n", options: { color: C.muted } },
  { text: "• 1-Tap Emoji Joining: ", options: { bold: true, color: C.text } },
  { text: "One player creates the crew; teammates join by tapping 3 emojis on screen (e.g. Skull • Bolt • Shield).\n\n", options: { color: C.muted } },
  { text: "• Zero Friction: ", options: { bold: true, color: C.text } },
  { text: "No apps to download, no typing, no camera permissions required.", options: { color: C.emerald } }
], {
  x: 1.05,
  y: 2.5,
  w: 5.25,
  h: 2.9,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// Right Card: Ultimate Objective
slide1.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 1.8,
  w: 5.75,
  h: 3.8,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide1.addText("🏆 The Ultimate Objective", {
  x: 7.03,
  y: 2.0,
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
  { text: "• High Energy: ", options: { bold: true, color: C.text } },
  { text: "The whole experience runs in ~25-30 minutes of fast, social interaction.", options: { color: C.muted } }
], {
  x: 7.03,
  y: 2.5,
  w: 5.25,
  h: 2.9,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// Process Boxes Below Details (No Subtitles)
const flowBoxes = [
  "0. Lobby Assembly",
  "1. Shattered Tablet",
  "2. Shades in Mist",
  "3. Styx Escape"
];

flowBoxes.forEach((name, i) => {
  const x = 0.8 + i * 2.99;
  slide1.addShape(pres.ShapeType.roundRect, {
    x,
    y: 5.85,
    w: 2.75,
    h: 0.8,
    fill: { color: C.cardBg },
    line: { color: C.gold, width: 1.5 },
    rectRadius: 0.08
  });

  slide1.addText(name, {
    x: x + 0.1,
    y: 6.0,
    w: 2.55,
    h: 0.5,
    fontSize: 12,
    color: C.goldLight,
    bold: true,
    align: "center",
    valign: "middle"
  });
});

// -------------------------------------------------------------
// SLIDE 2: ROUND 1 — THE SHATTERED TABLET
// Story, Mechanics, Points (No Hints)
// -------------------------------------------------------------
const slide2 = pres.addSlide();
slide2.background = { color: C.bg };
addHeader(slide2, "ROUND 1 • PHYSICAL COOPERATION PUZZLE", C.cyan, "THE SHATTERED TABLET", "Tomb Gate Alignment • Duration: ~5 Minutes");
addStoryBanner(slide2, "🏛️ The Story: Walking through the dark expanse of Tartarus, your crew reaches a sealed ancient stone door. You need a codeword to pass. Pieces of a shattered ancient tablet lie on the ground before you.", C.cyan);

// Left Card: Mechanics
slide2.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 2.55,
  w: 5.75,
  h: 4.15,
  fill: { color: C.cardBg },
  line: { color: C.cyan, width: 1.5 },
  rectRadius: 0.08
});

slide2.addText("⚙️ Mechanics", {
  x: 1.05,
  y: 2.75,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide2.addText([
  { text: "• 5 Slices on 5 Phones: ", options: { bold: true, color: C.text } },
  { text: "The tablet is split into 5 vertical slices distributed across the crew's phones (#1 to #5).\n\n", options: { color: C.muted } },
  { text: "• Physical Phone Order: ", options: { bold: true, color: C.text } },
  { text: "Players physically place their 5 phones side-by-side in numerical order (#1 to #5) across the table.\n\n", options: { color: C.muted } },
  { text: "• The Codeword: ", options: { bold: true, color: C.text } },
  { text: "Golden carved fracture lines connect across phone borders to reveal a 2-word codeword (e.g. CRIMSON SHADOW).\n\n", options: { color: C.gold } },
  { text: "• Team Submission: ", options: { bold: true, color: C.text } },
  { text: "Any player in the crew can type and submit the answer on their screen.", options: { color: C.text } }
], {
  x: 1.05,
  y: 3.25,
  w: 5.25,
  h: 3.2,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// Right Card: Points & Winning Conditions
slide2.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 2.55,
  w: 5.75,
  h: 4.15,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide2.addText("🏆 Points & Winning Conditions", {
  x: 7.03,
  y: 2.75,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide2.addText([
  { text: "• Speed is Rewarded: ", options: { bold: true, color: C.text } },
  { text: "Faster team solves earn higher base points (Legendary → Swift → Steady).\n\n", options: { color: C.muted } },
  { text: "• Guaranteed Safety Floor: ", options: { bold: true, color: C.text } },
  { text: "A 50 PTS minimum floor ensures every crew passes through the tomb gate.\n\n", options: { color: C.emerald } },
  { text: "• Round Completion: ", options: { bold: true, color: C.text } },
  { text: "The round ends when all crews submit the code or the timer concludes.\n\n", options: { color: C.muted } },
  { text: "💡 Facilitator Prompt: ", options: { bold: true, color: C.gold } },
  { text: "\"Don't stay seated staring at your own screen—stand up, place your 5 phones in order 1 to 5, and read the tablet together!\"", options: { color: C.goldLight } }
], {
  x: 7.03,
  y: 3.25,
  w: 5.25,
  h: 3.2,
  fontSize: 11.5,
  lineSpacingMultiple: 1.15
});

// -------------------------------------------------------------
// SLIDE 3: ROUND 2 — SHADES IN THE MIST
// Story, Mechanics, Points Difference (No R3 legacy mentions)
// -------------------------------------------------------------
const slide3 = pres.addSlide();
slide3.background = { color: C.bg };
addHeader(slide3, "ROUND 2 • PRISONER'S DILEMMA", C.rose, "SHADES IN THE MIST", "Prisoner's Dilemma • 3 Clashes • Face-to-Face Negotiation");
addStoryBanner(slide3, "🏛️ The Story: You escape through the tomb door into a vast cavern hall as thick Stygian mist rolls in. Another crew of shades emerges from the shadows. Are they trustworthy friends or treacherous enemies?", C.rose);

// Left Card: Mechanics
slide3.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 2.55,
  w: 5.75,
  h: 4.15,
  fill: { color: C.cardBg },
  line: { color: C.rose, width: 1.5 },
  rectRadius: 0.08
});

slide3.addText("⚙️ Mechanics (Each Clash)", {
  x: 1.05,
  y: 2.75,
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
  { text: "Talk with the other team across the room (bluffing is 100% permitted!).\n\n", options: { color: C.muted } },
  { text: "3. Secret Blind Vote (25s): ", options: { bold: true, color: C.text } },
  { text: "Every player secretly votes on phone. Majority rules (Negotiator breaks ties).\n\n", options: { color: C.muted } },
  { text: "4. The Reveal (40s): ", options: { bold: true, color: C.text } },
  { text: "Both tables' choices unmask simultaneously on screen!", options: { color: C.gold } }
], {
  x: 1.05,
  y: 3.25,
  w: 5.25,
  h: 3.2,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// Right Card: Points Difference
slide3.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 2.55,
  w: 5.75,
  h: 4.15,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide3.addText("🏆 Points Difference", {
  x: 7.03,
  y: 2.75,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide3.addText([
  { text: "Points Outcomes (Stakes DOUBLE in Clash 2, TRIPLE in Clash 3!):\n\n", options: { bold: true, color: C.gold } },
  { text: "🤝 Mutual Truce (Cooperation):\n", options: { bold: true, color: C.emerald } },
  { text: "Both teams play peaceful → Both win solid, steady points (+75 / +150 / +225 PTS).\n\n", options: { color: C.muted } },
  { text: "🗡️ The Backstab (Betrayal):\n", options: { bold: true, color: C.rose } },
  { text: "Ambush beats Truce → Betrayer steals maximum points (+150 / +300 / +450 PTS); peaceful victim gets 0 PTS!\n\n", options: { color: C.muted } },
  { text: "💥 Mutual Brawl (Conflict):\n", options: { bold: true, color: C.gold } },
  { text: "Both teams attack → Both walk away with scraps (+15 / +30 / +45 PTS).\n\n", options: { color: C.muted } },
  { text: "⚠️ Key Tension: Promises across the room are non-binding. Will you build trust or cash in on a backstab?", options: { color: C.goldLight, italic: true } }
], {
  x: 7.03,
  y: 3.25,
  w: 5.25,
  h: 3.2,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// -------------------------------------------------------------
// SLIDE 4: ROUND 3 — ESCAPE FROM TARTARUS
// Story, Mechanics, Points & Winning Conditions
// -------------------------------------------------------------
const slide4 = pres.addSlide();
slide4.background = { color: C.bg };
addHeader(slide4, "ROUND 3 • ESCAPE ROYALE", C.purple, "ESCAPE FROM TARTARUS", "River Styx Congestion Race • 1,000m to the Exit Portal");
addStoryBanner(slide4, "🏛️ The Story: Cerberus is howling in the shadows behind you, and the exit portal across the wide River Styx is slowly starting to close. Can your crew reach the portal before it seals forever?", C.purple);

// Left Card: 3 Vessels Mechanics
slide4.addShape(pres.ShapeType.roundRect, {
  x: 0.8,
  y: 2.55,
  w: 5.75,
  h: 4.15,
  fill: { color: C.cardBg },
  line: { color: C.purple, width: 1.5 },
  rectRadius: 0.08
});

slide4.addText("⚙️ Mechanics: The 3 Vessels", {
  x: 1.05,
  y: 2.75,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide4.addText([
  { text: "Each wave, your crew secretly votes for one vessel:\n\n", options: { color: C.muted } },
  { text: "🚣 The Rowboat (Safe):\n", options: { bold: true, color: C.emerald } },
  { text: "• Unlimited capacity. Always advances +150m. Never capsizes.\n\n", options: { color: C.muted } },
  { text: "⛵ The Sailboat (Speed vs Crowds):\n", options: { bold: true, color: C.gold } },
  { text: "• Max 30% fleet capacity. Advances +300m, but CAPSIZES (0m) if overcrowded!\n\n", options: { color: C.muted } },
  { text: "⚡ The Ghost Ship (Solo Gamble):\n", options: { bold: true, color: C.purple } },
  { text: "• Exactly 1 crew. Mythic surge (+450m)! But COLLIDES (-50m) if 2+ crews board.", options: { color: C.muted } }
], {
  x: 1.05,
  y: 3.25,
  w: 5.25,
  h: 3.2,
  fontSize: 11,
  lineSpacingMultiple: 1.15
});

// Right Card: Winning Conditions
slide4.addShape(pres.ShapeType.roundRect, {
  x: 6.78,
  y: 2.55,
  w: 5.75,
  h: 4.15,
  fill: { color: C.cardBg },
  line: { color: C.cardBorder, width: 1 },
  rectRadius: 0.08
});

slide4.addText("🏆 Winning Conditions", {
  x: 7.03,
  y: 2.75,
  w: 5.25,
  h: 0.4,
  fontSize: 16,
  color: C.goldLight,
  bold: true
});

slide4.addText([
  { text: "• Starting Head-Start: ", options: { bold: true, color: C.text } },
  { text: "Total points accumulated in Rounds 1 & 2 convert directly into starting river meters.\n\n", options: { color: C.muted } },
  { text: "• The Victory Gate: ", options: { bold: true, color: C.text } },
  { text: "First 3 crews to reach 1,000 meters win Gold, Silver & Bronze medals!\n\n", options: { color: C.gold } },
  { text: "• Cerberus Revenge: ", options: { bold: true, color: C.text } },
  { text: "Crews betrayed in R2 can guess their nemesis's vessel to drag them back -150m and surge +150m!\n\n", options: { color: C.rose } },
  { text: "• Sudden Death Standoff: ", options: { bold: true, color: C.text } },
  { text: "Tie-breaker duel (Shields vs Ram vs Sails) if crews cross the portal simultaneously.", options: { color: C.muted } }
], {
  x: 7.03,
  y: 3.25,
  w: 5.25,
  h: 3.2,
  fontSize: 11,
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
    { text: "Align 5 phones physically (#1 to #5) on table to connect carved fracture lines.", options: { color: C.muted } },
    { text: "Fast solve = top points. 50 PTS safety floor. No elimination.", options: { color: C.muted } },
    { text: "Codeword entered or timer expires.", options: { color: C.emerald } }
  ],
  [
    { text: "2. Shades in Mist\n(~8 min)", options: { bold: true, color: C.text } },
    { text: "Prisoner's Dilemma: Face rival table across 3 clashes. Talk across room & vote secretly.", options: { color: C.muted } },
    { text: "Truce = steady points. Backstab = huge points or 0. Stakes triple in Clash 3.", options: { color: C.muted } },
    { text: "All 3 clashes resolved.", options: { color: C.emerald } }
  ],
  [
    { text: "3. Styx Escape\n(~8 min)", options: { bold: true, color: C.text } },
    { text: "Congestion race: Pick vessels (Rowboat: safe, Sailboat: 30% cap, Ghost: solo).", options: { color: C.muted } },
    { text: "Points become starting meters. Avoid congestion and unleash Cerberus revenge.", options: { color: C.muted } },
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

// Save presentation (with fallback if open in PowerPoint)
pres.writeFile({ fileName: "presentation.pptx" })
  .then(() => {
    console.log("Successfully generated presentation.pptx!");
  })
  .catch(async (err: any) => {
    if (err.code === "EBUSY") {
      console.warn("Notice: presentation.pptx is currently open in PowerPoint. Writing to presentation_updated.pptx...");
      await pres.writeFile({ fileName: "presentation_updated.pptx" });
      console.log("Successfully generated presentation_updated.pptx!");
    } else {
      throw err;
    }
  });
