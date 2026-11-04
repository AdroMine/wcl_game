# Game disks

A **disk** is one game. Each folder under `games/` holds everything that is specific to that game, so the site can host different games (for example a Christmas game) later.

## What lives where

```
games/
  underworld/
    game.ts                 game-level: title, round titles, roles, crew emblems, lobby and finish lines
    rounds/
      tablet/   Round 1: The Shattered Tablet
        content.ts          story, rules, goal, codewords, hint cost and timing, projector lines
        ui/                 the React screen of the round (phones)
      mist/     Round 2: Shades in the Mist
        content.ts          story, rules, goal, clash scoring, stances, moral legacies, projector lines
        ui/
      styx/     Round 3: Escape from Tartarus
        content.ts          story, rules, goal, race numbers, vessels, sudden-death moves, projector lines
        ui/
```

- `game.ts` and every `content.ts` run on the Node server. They may not import React, and they use only erasable TypeScript with relative imports that end in `.ts`.
- Everything under `ui/` is React for the Vite web build. It follows the web app's import style and may import from `src/` and `shared/`.
- Nothing in `games/` may mention Supabase (`npm run check:web` scans it).

## How to edit text

Open the round's `content.ts`. The comment at the top says what each field is.

- Story lines, rule boxes and the goal box are the `briefing` object. The length of the briefing follows the word count automatically (`shared/briefing.ts`), so you never set a time by hand.
- Projector lines are the `instructions` objects, keyed `PHASE` or `PHASE/STEP`.
- Numbers (scoring, hint costs, race distances) are rules: do not change them without the organizer (`docs/GAME_MASTER_RULES_AND_DESIGN.md`).

Restart the server after an edit (and rebuild the web app if you changed something in `ui/`).

## What is still shared (step 1 only moved content)

- The engine logic stays in `server/engine` (`round1.ts`, `round2.ts`, `round3.ts`, phases, reducer). It reads its constants through `server/engine/config.ts`, which re-exports them from `games/underworld/`.
- Game-agnostic limits stay in `server/engine/config.ts` (crew size limits, deadline minimum, name lengths).
- The protocol (`shared/protocol.ts`) and `/api/meta` still have the Underworld's shape (vessels, stances, moral statuses). `server/content.ts` assembles them from the active disk, which is hard-wired to `games/underworld/game.ts`.
- `RoundContainer.tsx` still picks the three round screens by round number.
- Step 2 (later) will define a generic round-module interface so a disk can bring its own rounds, engine logic and meta shape.
