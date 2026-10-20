import type { GameConfig, Round2Config } from '../types';

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
      type: "OFFLINE_TASK_TIMER",
      title: "Round 3: Charon's Physical Trial",
      subtitle: "An in-person physical challenge at the pub table. Complete it before the sands of time empty!",
      durationSeconds: 240,
      data: {
        prompt: "Stack 5 beer coasters / drink mats vertically on the pub table, or place all phones in a circle touching corners while singing a 10-second sea shanty to summon Charon!",
        rules: [
          "Every member of the crew must participate physically.",
          "Once completed, show the bartender/Admin or enter the secret Pub Rune Code below.",
          "Verification Code is announced live in the pub by the Game Master."
        ],
        verificationCode: "OBOLUS",
        points: 250
      }
    }
  ]
};
