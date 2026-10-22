import type { GameConfig, Round2Config, Round3Config } from '../types';

export const DEFAULT_ROUND3_CONFIG: Round3Config = {
  target_distance_meters: 1000,
  headstart_point_divisor: 5,
  max_headstart_meters: 200,
  num_scheduled_waves: 4,
  wave_phase_durations: {
    BLUFF: 55,
    VOTE: 20,
    REVEAL: 25,
  },
  vessels: {
    ROWBOAT: {
      name: "The Rowboat",
      icon: "🚣",
      risk_label: "SAFE",
      capacity_rule: "UNLIMITED",
      distance_success: 150,
      distance_fail: 150,
      desc: "Steady oars. Never capsizes. Reliable +150m.",
    },
    SAILBOAT: {
      name: "The Sailboat",
      icon: "⛵",
      risk_label: "BALANCED",
      capacity_rule: "MAX_PERCENT",
      capacity_percent: 0.30,
      distance_success: 300,
      distance_fail: 0,
      desc: "Fast winds (+300m), but capsizes (0m) if >30% of active crews board!",
    },
    GHOST_SHIP: {
      name: "The Ghost Ship",
      icon: "⚡",
      risk_label: "SOLO GAMBLE",
      capacity_rule: "EXACTLY_ONE",
      distance_success: 450,
      distance_fail: -50,
      desc: "Mythic phantom vessel (+450m). Succeeds ONLY if 1 crew boards! 2+ crews collide (-50m).",
    },
  },
  vengeance: {
    cerberus_penalty_meters: -150,
    cerberus_bonus_meters: 150,
  },
};

export const DEFAULT_ROUND2_CONFIG: Round2Config = {
  num_clashes: 3,
  phase_durations_seconds: {
    HUDDLE: 50,
    PARLEY: 40,
    VOTE: 25,
    DEBRIEF: 40,
  },
  scoring_matrix: {
    "1": {
      both_truce: 75,
      ambush_win: 150,
      truce_loss: 0,
      both_ambush: 15,
    },
    "2": {
      both_truce: 150,
      ambush_win: 300,
      truce_loss: 0,
      both_ambush: 30,
    },
    "3": {
      both_truce: 225,
      ambush_win: 450,
      truce_loss: 0,
      both_ambush: 45,
    },
  },
};

export const DEFAULT_CONFIG: GameConfig = {
  theme: {
    title: "A Journey into the Underworld",
    subtitle: "Underworld Engine • Mobile Pub Game Platform",
    primaryBg: "#08090c",
    ivory: "#f4f0e8",
    gold: "#c4a45a",
  },
  team_size: 5,
  admin_passcode: "underworld",
  round2: DEFAULT_ROUND2_CONFIG,
  round3: DEFAULT_ROUND3_CONFIG,
  roles: [
    {
      id: "navigator",
      name: "Navigator",
      color: "#38bdf8",
      icon: "compass",
      description: "Charts subterranean currents and celestial markers in the Stygian mist."
    },
    {
      id: "oracle",
      name: "Oracle",
      color: "#c084fc",
      icon: "eye",
      description: "Deciphers echoes, prophetic portents, and spectral whispers."
    },
    {
      id: "scholar",
      name: "Scholar",
      color: "#34d399",
      icon: "book",
      description: "Knows ancient ciphers, Greek tablets, and forbidden cartography."
    },
    {
      id: "torchbearer",
      name: "Torchbearer",
      color: "#fb923c",
      icon: "flame",
      description: "Wields the sacred eternal flame through the cavernous gloom."
    },
    {
      id: "negotiator",
      name: "Negotiator",
      color: "#f43f5e",
      icon: "shield",
      description: "Strikes pacts with shade sentinels and Charon's ferrymen."
    }
  ],
  rounds: [
    {
      id: "round-1",
      type: "ASCII_SPLITTER",
      title: "Round 1: The Shattered Tablet",
      subtitle: "Align all 5 phone screens side-by-side to reconstruct the broken stone tablet and unlock the ancient tomb door.",
      durationSeconds: 300,
      data: {
        codewords: ["CRIMSON SHADOW", "MIDNIGHT BELL", "OBSIDIAN GATE", "SILENT SPECTER", "ANCIENT CURSE", "HOLLOW GRAVE", "PHANTOM WRATH", "BLOOD MOON"],
        mode: "HORIZONTAL",
        pointsBase: 100,
        pointsSpeedBonusMax: 100,
      }
    },
    {
      id: "round-2",
      type: "PRISONERS_DILEMMA",
      title: "Round 2: Shades in the Mist",
      subtitle: "3-Clash Prisoner's Dilemma. Face your rivals, negotiate in the mist, and choose between honor or betrayal.",
      durationSeconds: 465,
      data: {}
    },
    {
      id: "round-3",
      type: "ODYSSEY_ESCAPE_ROYALE",
      title: "Round 3: Escape from Tartarus (The Final Round)",
      subtitle: "Simultaneous room-wide Battle Royale & Minority Congestion Game. Coordinate your crew, bluff your rivals, and cross the 1,000m London Portal before the Underworld seals!",
      durationSeconds: 400,
      data: {}
    }
  ]
};
