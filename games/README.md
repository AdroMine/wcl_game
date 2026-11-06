# Game disks

A **disk** is one game. Each folder under `games/` holds everything that is specific to that game, so the site can host different games (for example a Christmas game) later.

## What lives where

```
games/
  underworld/
    game.ts                 game-level: title, round titles, roles, crew emblems, lobby and finish lines
    art.ts                  URLs of the generated illustrations in art/ (lobby, round scenes, end, Wrap emblems); art/ is owned by the organizer; the web app preloads the next picture per phase
    analysis.ts             shared pure helpers for export and recap (clash outcomes, decoded Round 3 votes, final ranking)
    export.ts               end-of-game data export: buildGameExport (JSON) and buildGameCsv, called by GET /api/admin/export.json and .csv
    recap.ts                "Underworld Wrapped": buildRecap(state), crew-level recap data served by GET /api/recap once FINISHED
    recapContent.ts         editable words of the recap: title, award names and blurbs, the front page text (FRONT_PAGE), the "Christmas game is coming" teaser
    recap/ui/               React for the recap, one lazy chunk loaded only at FINISHED: FrontPage ("The Underworld Times" card), WrappedCards (the phone "Underworld Wrap" overlay: swipeable crew, Round 2, room and award cards), FrontPagePanel (admin and /front-page), WrappedPreview (test hooks), useRecap
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

- `game.ts`, every `content.ts`, `analysis.ts`, `export.ts`, `recap.ts` and `recapContent.ts` run on the Node server. They may not import React, and they use only erasable TypeScript with relative imports that end in `.ts`.
- Everything under `ui/` is React for the Vite web build. It follows the web app's import style and may import from `src/` and `shared/`.
- Nothing in `games/` may mention Supabase (`npm run check:web` scans it).

## How to edit text

Open the round's `content.ts`. The comment at the top says what each field is.

- Story lines, rule boxes and the goal box are the `briefing` object. The length of the briefing follows the word count automatically (`shared/briefing.ts`), so you never set a time by hand.
- Projector lines are the `instructions` objects, keyed `PHASE` or `PHASE/STEP`.
- Numbers (scoring, hint costs, race distances) are rules: do not change them without the organizer (`docs/GAME_MASTER_RULES_AND_DESIGN.md`).

Restart the server after an edit (and rebuild the web app if you changed something in `ui/`).

## Recap and export live in the disk

`recap.ts` and `export.ts` are pure functions of the final `GameState` (no clock, no randomness, no I/O). `game.ts` lists them (`GAME.recap`, `GAME.exportJson`, `GAME.exportCsv`), `server/content.ts` hands them to `server/transport/http.ts`, and the generic endpoints know nothing about the Underworld. They import only types from the engine (the engine imports this disk, so a value import back would be a cycle). The engine records what they need in the state: `teams[id].r1.wrong` and `r3.voteLog` (see docs/PROTOCOL.md). To change a recap sentence, award or the teaser, edit `recapContent.ts` (words) or `recap.ts` (how the numbers and awards are computed); restart the server. A different game brings its own `recap.ts`, `export.ts` and `recap/ui`.

## What is still shared (step 1 only moved content)

- The engine logic stays in `server/engine` (`round1.ts`, `round2.ts`, `round3.ts`, phases, reducer). It reads its constants through `server/engine/config.ts`, which re-exports them from `games/underworld/`.
- Game-agnostic limits stay in `server/engine/config.ts` (crew size limits, deadline minimum, name lengths).
- The protocol (`shared/protocol.ts`) and `/api/meta` still have the Underworld's shape (vessels, stances, moral statuses). `server/content.ts` assembles them from the active disk, which is hard-wired to `games/underworld/game.ts`.
- `RoundContainer.tsx` still picks the three round screens by round number.
- Step 2 (later) will define a generic round-module interface so a disk can bring its own rounds, engine logic and meta shape.
