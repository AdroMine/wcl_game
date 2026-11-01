# Underworld game: rules for working in this repo

## What this is
A live party game for up to 200 players in about 40 teams of five. One Node server owns the whole game; phones are display-and-input terminals. This will be played in pubs with bad internet connection, so resilience and working in bad network connection is paramount. 

## Architecture rules (do not break)
- Only the server changes game state. The web app never imports @supabase/supabase-js and never talks to a database.
- All game logic lives in server/engine as pure functions: (state, command, ctx) returns (state, events). No I/O, no Date.now(), no Math.random(); time and the seeded RNG come from ctx.
- Clients never trigger phase changes. The scheduler advances phases at absolute deadlines; clients get serverNow and phaseEndsAt and only display a countdown.
- Every command carries a commandId and is idempotent. Votes are keyed by match and player; joins by player ID.
- Each phone gets one view of 4 KB or less, built once per team per version. A view never contains another player's private data or the admin token.
- State is plain JSON and must survive snapshot and restore unchanged. Snapshots are written every few seconds when dirty and at every phase change; the live game never reads the database.
- Broadcasts are coalesced: mark dirty, flush at most every 250 to 500 ms.
- Admin actions require the ADMIN_TOKEN environment variable, compared in constant time and never serialized.

## Environment constraints
- The engine, server, tests, simulator and swarm use only Node built-ins (node:http, node:test, node:crypto) and run on Node 22.18+ with native TypeScript type stripping. Keep it that way: no new runtime dependencies for the server without asking. The web app (src/) uses the existing npm dependencies.
- TypeScript in server/, shared/, tests/ and tools/ must be erasable syntax only: no enums, namespaces or parameter properties; `import type` for types; relative imports end in `.ts`.
- Requests are validated with hand-written validators in shared/protocol.ts (stands in for zod).

## Rule decisions
docs/RULE_DECISIONS.md records the organizer's rulings where the rules doc and the old code disagreed. It overrides the rules doc where they differ.

## Commands
- npm test: unit and golden tests
- npm run sim: deterministic 200-player simulation with fake time
- npm run swarm: 200 bots with real SSE against a running server (set TARGET_URL)
- npm run build: tsc then the web build; production runs node dist/server/index.js

## Definition of done for any change
Tests and the simulation pass; no invariant above is weakened; docs/RUNBOOK.md is updated if operator behaviour changed; the CI check that bans Supabase imports in web/ still passes.

## Do not
- Do not add Realtime, polling of a database, Redis, queues, or multiple server instances.
- Do not log tokens or passcodes.
- Do not change rules or scoring without asking; docs/GAME_MASTER_RULES_AND_DESIGN.md is the spec of record.
