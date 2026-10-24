# Underworld: The Stygian Trials 🏛️⚡

A live, pub-scale interactive party game engine built with React, TypeScript, Vite, Express, and Supabase. Players navigate Tartarus and cross the River Styx across 3 high-intensity physical, psychological, and congestion-royale rounds.

---

## 📁 Repository Structure

```text
wcl_game_web/
├── docs/                                # 📚 Game Design, Lore & Presentations
│   ├── GAME_MASTER_RULES_AND_DESIGN.md  # Comprehensive Game Master reference guide
│   ├── presentation.html                # Reveal.js interactive browser briefing deck
│   ├── presentation.pptx                # PowerPoint 16:9 widescreen briefing deck
│   └── initial_dev_prompt.md            # Original project kick-off specification
│
├── tests/                               # 🧪 Automated Test Suites
│   ├── run_all.ts                       # Single-command runner (npm test)
│   ├── test_team_codes.ts               # 5-Emoji team creation & role checks
│   ├── test_round2.ts                   # Round 2 Prisoner's Dilemma logic
│   ├── test_round3.ts                   # Round 3 Stygian Leash & Congestion
│   ├── test_hints_and_scoring.ts        # Round 1 tablet scoring integration
│   └── test_supabase_round2.ts          # Round 2 Supabase cloud integration
│
├── scripts/                             # 🛠️ Migration & Generation Tooling
│   ├── generate_pptx.ts                 # Regenerates docs/presentation.pptx
│   ├── deploy_round3_schema.ts          # Supabase Round 3 schema migration
│   ├── deploy_atomic_join.ts            # Supabase team join migration
│   └── scratch/                         # Developer scratchpads
│
├── server/                              # 🖥️ Express Backend & Offline Local Store
│   ├── index.ts                         # Express WebSocket / HTTP server
│   ├── stateStore.ts                    # State persistence logic
│   └── server_state.json                # Local state store
│
└── src/                                 # ⚛️ React Application Frontend
    ├── components/                      # UI Views (Lobby, Rounds 1-3, Admin, Solo Tester)
    ├── context/                         # Game session context & state hooks
    ├── lib/                             # Core game engines, APIs, and Supabase client
    └── types.ts                         # Universal TypeScript domain interfaces
```

---

## 🚀 Quick Start

### 1. Development Server
Starts the local Express backend alongside the Vite frontend:
```bash
npm run dev
```
- **Player Interface**: `http://localhost:5173/`
- **Game Master Cockpit**: `http://localhost:5173/admin`
- **Solo Sandbox**: `http://localhost:5173/solotester` (or `/test`)

### 2. Running Tests
Run all unit and integration test suites:
```bash
npm test
```
Or run specific suites:
```bash
npm run test:teams   # Test 5-emoji keypad & role compatibility
npm run test:r2      # Test Round 2 Prisoner's Dilemma logic
npm run test:r3      # Test Round 3 Stygian Leash & vessel congestion
```

### 3. Production Build
```bash
npm run build
```

---

## 📖 Game Rules & Team Briefings
- 📄 **[Game Master Rules & Lore Manual](docs/GAME_MASTER_RULES_AND_DESIGN.md)**: Full operational reference covering all 3 rounds, scoring matrices, and sudden death.
- 🌐 **[Interactive Browser Briefing Deck](docs/presentation.html)**: 5-slide visual explainer with built-in presenter notes (Press `S`).
- 📊 **[PowerPoint Briefing Deck](docs/presentation.pptx)**: 16:9 widescreen slides for team alignment.
