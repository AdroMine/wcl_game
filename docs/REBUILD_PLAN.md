# Underworld Game: December Rebuild Plan and Claude Code Handoff

Nov 1, 2026 · @Areeb

## Context and how to use this doc

This is the plan and the handoff for rebuilding the Underworld game so that 200 players can play in December without repeating the Halloween failure. Export it as Markdown to `docs/REBUILD_PLAN.md` in the repo and give Claude Code the kickoff prompt from the last section.

**What the Supabase logs show about Oct 31 (times UTC, same as UK time that night):**

- Phones talked straight to Supabase. Every refresh was five unfiltered `select=*` reads (players, teams, game\_state, round2\_matches, round3\_session), and Realtime subscriptions were active.
- Joins started failing around 21:07. The database was restarted at 21:21, 21:49 and 22:05, and PostgREST at 21:28 and 22:09.
- Round 2 broke within about two minutes of starting: a plain read of `round2_matches` hit a statement timeout at 22:02, and PostgREST's 10-connection pool was exhausted at 22:05.
- After each restart the instance stayed slow (schema-cache loads took up to 29 seconds) while phones retried at once.

**What is not proven:** that 50 phones updating the same match rows at once caused the crash (no failed PATCH requests or Round 2 writes appear in the logs), and which resource ran out (CPU, memory or disk I/O). The Database reports in the Supabase dashboard for 21:00 to 22:10 would show it. This plan does not depend on settling that, because every suspected mechanism leaves the live path.

**Design goal:** load stays small and predictable, nothing external can take the game down, and every failure is recoverable during the event.

## Decision: rebuild the core, keep the product

Rebuild the server core and the client's data layer from scratch, and keep the game rules, content and visual components. This is a rewrite of the backbone, not a restart from zero.

- The failure was structural: game state lived in a hosted database that every phone read. The existing `server/stateStore.ts` mixes state, transitions and disk writes, has no clock, and lets clients trigger phase changes, so patching it keeps the weakest parts.
- What is worth keeping is game knowledge: the rules in `docs/GAME_MASTER_RULES_AND_DESIGN.md`, the scoring matrices, the team and role model, the React components and styling, and the existing tests as a behavioural spec.
- A full greenfield rewrite including every screen buys little. The screens are the part that worked, and the time is better spent on load testing and rehearsal.

| Option | What it means | Choose it when |
| --- | --- | --- |
| A. Refactor in place | Keep `stateStore`, add a tick loop, trim broadcasts, remove Supabase from the client | The Phase 0 audit finds `stateStore` small, pure and well tested |
| B. Rebuild core, keep UI (recommended) | New engine, protocol, server and client data layer; port rules and screens | Default |
| C. Full greenfield | New everything including the UI | The audit finds most components are entangled with Supabase context and would be rewritten anyway |

**The Phase 0 audit decides between A, B and C.** Claude Code records the choice and the evidence in `docs/AUDIT.md` before writing new code. If the event date leaves too little time for the phases below, cut scope using the cut line in the plan, never the verification gates.

## Target architecture

One always-on server process owns the entire game. Phones only send commands and render views, and the database is a backup the live game never reads.

&#91;embedded content: architecture · clients, one game server, a snapshot store\]

Commands enter at the left and views leave at the right. The scheduler and the snapshot writer attach to the engine, and the store is written to during play but only read when the server restarts.

1. **Single writer.** Only the server changes game state. Phones never touch Supabase or any database.
2. **Commands in, events out.** Every change is a command applied by a pure reducer: `(state, command, now) -> (state, events)`. The engine does no I/O and never calls `Date.now()`.
3. **The server owns time.** A scheduler moves phases at absolute deadlines. Clients receive `serverNow` and `phaseEndsAt`, show a countdown, and never trigger a transition. Round 2 runs on one global timeline, so every team is in the same phase at the same second and the host can announce once.
4. **Small views, built once.** Each phone receives a view of 4 KB or less (a proposed budget): shared phase info, its team, its private role and codes, and a short leaderboard. The server builds one view per team per version and reuses it, so cost grows with the number of teams (about 40), not players (200).
5. **Idempotent commands.** Each command carries a `commandId` and duplicates are ignored. Votes are keyed by (match, player) and joins by player ID, so a retry can never apply twice.
6. **Snapshot and recover.** Save the full state every few seconds when it changed, and at every phase change. On boot, restore the latest snapshot into a paused state and let an admin resume.
7. **Reconnection is the normal path.** Clients keep showing the last state, back off with random jitter, resync when the tab regains focus, and fall back to slow polling.

**Transport.** Views stream to phones over Server-Sent Events (`GET /api/stream`, each event id is the state version); `GET /api/view` is the polling fallback and answers 304 when nothing changed; commands are plain `POST /api/command` requests. SSE suits this because pushes only go one way, browsers reconnect on their own, and it passes through proxies without special handling. Admin commands use a separate path guarded by an `ADMIN_TOKEN` environment variable that is never written into any payload.

**Deliberately left out:** Supabase Realtime, any polling of a database, Redis, queues and multiple server instances. One instance handles 200 players comfortably once views are small.

## Repository layout and contracts

The engine is pure and shared by nothing but the server, so it can be tested without a network; the protocol is the only code both sides import.

```text
shared/
  protocol.ts        zod schemas: Command, View, error codes, version constants
server/
  engine/            pure game logic: lobby, teams, rounds 1-3, admin overrides
  scheduler.ts       turns deadlines into system commands
  transport/         HTTP routes, SSE hub, view builder, rate limits
  persistence/       snapshot adapters (file, Supabase) and restore
  index.ts           wiring only
web/                 React app, ported from src/ (components and styling kept)
  game/useGame.ts    the one data hook: SSE, backoff, resync, session restore
tools/
  swarm/             200 bots with real SSE connections and chaos scenarios
tests/
  engine/            unit and golden tests ported from the existing suites
  sim/               deterministic whole-game simulation
docs/
  GAME_MASTER_RULES_AND_DESIGN.md   rules, the spec of record
  AUDIT.md  REBUILD_PLAN.md  RUNBOOK.md
```

**Contract sketch** (adjust names to the rules doc; the shapes matter, not the spelling):

```ts
// shared/protocol.ts
type Command = { commandId: string; playerId: string; token: string; type: string; payload: unknown };
type View = { version: number; serverNow: number; phase: PhaseInfo; me: Me; team: TeamView; board: BoardRow[]; notice?: string };

// server/engine
type Reduce = (s: GameState, c: Command, ctx: { now: number }) => { state: GameState; events: GameEvent[]; error?: ErrorCode };
type Due = (s: GameState, now: number) => Command[]; // system commands for every deadline that has passed
```

**Invariants every change must keep (each one is a test):**

- The reducer is deterministic: the same state, command and `now` give the same result. Randomness uses a seed stored in the state.
- Applying a `commandId` a second time changes nothing.
- State is plain JSON, and restoring a snapshot reproduces the same state.
- The scheduler advances each phase exactly once and never before its deadline.
- No view exceeds 4 KB, and a view never contains another player's private data or the admin token.
- Scoring matches the existing golden tests ported from `tests/`.
- The web app imports nothing from `@supabase/supabase-js`; a CI check fails the build if it does.

## Phased plan

Six phases, each ending in a gate that must pass before the next starts, and nothing ships until the swarm test passes on the real host. Sizes are rough guesses: S is a few hours of Claude Code work, M about a day, L several days.

&#91;embedded content: roadmap · 6 phases, 6 gates\]

Each diamond is a gate: the next phase does not start until it passes. The highlighted gate is the one that decides whether the game goes to the pub.

| # | Phase (size) | Work | Done when |
| --- | --- | --- | --- |
| 1 | Audit and engine (L) | Tag current `main` as `halloween-prod`. Write `docs/AUDIT.md` answering the checks in the last-but-one section and recording the A/B/C decision. Port the rules into the pure engine, using the existing tests as golden tests: lobby, teams and roles, Round 1, Round 2 on a global timeline, Round 3, admin overrides. Build the deterministic simulator. | The simulator plays 200 players through all three rounds, all tests are green, the audit decision is recorded |
| 2 | Server and persistence (M) | zod protocol; command intake with dedupe; SSE hub with per-team views; broadcasts coalesced to at most one flush every 250 to 500 ms; scheduler; `/health`; admin auth from an environment token; snapshot writer and restore into a paused state, file adapter first and Supabase adapter second | A swarm smoke test passes on a laptop, and killing and restarting the server restores the game |
| 3 | Client data layer (M) | `useGame()` over SSE with version checks, jittered backoff, resync on focus and a polling fallback; session restore from `localStorage` with a "Reconnecting..." state; remove `@supabase/supabase-js` from the web app and add the CI check | A full game runs end to end on a local network with no Supabase |
| 4 | UX and screens (M) | Five role cards per team with a "Missing Role" badge; Round 2 split into "Your code" and "Enter opponent code", the "49" placeholder removed, large touch targets; a refresh never shows the join screen to a known player; a `/screen` projector view; admin panel with pause, skip phase, force resync, scores, backup download and restore | Feature freeze: you have played it on several real phones and signed off |
| 5 | Swarm and chaos (M) | 200 bots with real SSE connections; the scenarios in the verification section; metrics for event-loop lag, memory and view size | All scenarios green on the deployed host |
| 6 | Deploy and rehearsal (M) | Always-on host, separate static host, QR code with the public URL, snapshot table in Supabase, `docs/RUNBOOK.md`, a rehearsal with 15 to 20 real people on cellular data plus bots | The rehearsal passes with no intervention beyond the runbook |

**Cut line if time runs short, in this order:** the `/screen` projector view, then admin extras beyond pause, skip phase and backup, then Round 3 polish. Round 3 never ran at the event, so it still gets simulation and swarm coverage.

**Never cut:** the server-owned clock, per-team views, idempotent commands, snapshots, the swarm test and the rehearsal.

## Verification gates

Two automated layers and one human rehearsal decide whether the game ships. Every threshold here is a proposed starting point to tune after the first runs.

**Layer 1: deterministic simulation (runs in CI, in seconds).** The engine runs with a fake clock and a seeded random generator, with 200 simulated players playing all three rounds. It also runs property tests: random command orders, random duplicate commands, and a snapshot and restore at a random point, which must always end in the same final state. This layer checks the invariants in the contracts section.

**Layer 2: network swarm (run against the deployed server).** 200 bots hold real SSE connections and send real HTTP commands.

| Scenario | What it does | Pass when |
| --- | --- | --- |
| Join storm | All 200 join over about 60 seconds, retrying on timeout with the same player ID | 200 unique players, no duplicates, no lost joins |
| Round start | Every bot acts in the same instant | Each command applied exactly once; p99 server processing time under 50 ms, measured inside the server |
| Phase change | One deadline passes with all 200 connected | Every bot sees the new version within 2 seconds |
| Round 2 vote burst | All 200 vote within one second | Each vote counted once; every team's view consistent |
| Chaos restart | Kill the server mid-round and restart it | All bots reconnect with jitter and converge on one version; the game resumes from the admin |
| Duplicates and slow readers | Random duplicate commands; 10% of bots read slowly | Duplicates change nothing; memory stays flat; slow clients are dropped, not buffered |
| Soak | A full game at normal pace | Event-loop lag and memory stay flat |

The server exposes the numbers the swarm needs: connected clients, command rate, p99 apply time, event-loop lag, heap size, view size and snapshot age. The 50 ms figure is processing time inside the server, since a test machine's network latency would swamp it.

**Human rehearsal.** 15 to 20 real people on cellular data with bots filling the rest. They lock and unlock screens, refresh mid-round, toggle airplane mode and walk away from the Wi-Fi, because that is how a pub behaves.

## Hosting and deployment

Run one always-on game server, host the app bundle separately, and keep a laptop-plus-tunnel plan B ready.

| Component | Where | Notes |
| --- | --- | --- |
| App bundle (static) | Render static site or Cloudflare Pages | Scanning the QR code hits this host, not the game server |
| Game server | A paid always-on Render instance (about $7/month, approximate; confirm on Render's pricing page) or a small VPS | One instance, no spin-down; reads `PORT`; serves `/health` |
| Snapshots | A `snapshots` table in Supabase: id, created\_at, version, state as jsonb; prune to the latest 50 | Written during play, read only on boot |
| Plan B | The same server build on a laptop behind a Cloudflare Tunnel | State on local disk; depends on laptop power and a hotspot |

**Why not the free tier.** Per [Render's free-tier docs](https://render.com/docs/free), a free web service spins down after 15 minutes without inbound traffic, takes up to a minute to wake, has an ephemeral filesystem, and may be restarted at any time. Each of those breaks a live event.

**Environment variables:** `PORT`, `ADMIN_TOKEN`, `PUBLIC_URL` (used for the QR code), `ALLOWED_ORIGIN` (the static host only), `SNAPSHOT_STORE` (`file` or `supabase`), and for Supabase `SUPABASE_URL` and a server-side service key that never reaches the browser.

**Runtime API address.** The web app reads its API base URL from `/config.json` at load, so switching to plan B means editing one file, not rebuilding.

**Build and run.** Compile with `tsc` and run `node dist/server/index.js` in production, not `tsx`. `/health` returns the state version, connected clients, event-loop lag and snapshot age.

**Before the event:** confirm the Supabase project is awake (free projects can pause after inactivity; check the current rule), and download a backup of the game state.

## Event-day operations

Make trouble visible before players see it, and give admins a safe manual override for every automatic behavior.

**Admin panel.** A status strip shows connected phones, event-loop lag, memory, snapshot age and state version. Controls: pause and resume, skip phase, adjust timer, adjust score, move or remove a player, auto-pair teams for Round 2, force every client to resync, and download or restore a backup.

**Projector view (`/screen`).** Shows the current phase, countdown, leaderboard and the instruction text for the phase, so the host announces from one source. This fixes the Halloween problem where teams sat in different phases and the microphone announcement fit nobody.

**Runbook (also saved as `docs/RUNBOOK.md`):**

| Situation | Do this |
| --- | --- |
| Server crashes or restarts | Wait for it to return. State restores as paused; check the snapshot age, then press Resume. Phones reconnect on their own, so do not ask players to refresh |
| Phones show "Reconnecting..." for more than about 30 seconds | Check `/health` and the venue network, and announce a pause on the microphone |
| Hosting provider is down | Start plan B on the laptop, restore the latest backup, edit `/config.json` to the tunnel address, and show the new link on the projector |
| A match or phase is stuck | Skip the phase or adjust the timer; if the state itself is wrong, restore the last good snapshot |
| Everything fails | Switch to the paper scoring sheet and run the remaining rounds by hand |

**Checklists:**

- [ ] One week before: full rehearsal with real devices, then feature freeze
- [ ] Two days before: final dry run on the production host
- [ ] One day before: hosting warm, Supabase project awake, backup downloaded, runbook printed, laptop charged and plan B tested
- [ ] Event day: open the admin panel 15 minutes early, confirm `/health`, confirm the QR code points at `PUBLIC_URL`

## Open questions and checks before building

Claude Code answers the repo checks in Phase 0 and reports before writing any new code; the organizer answers the questions below.

**Repo checks (record the answers in `docs/AUDIT.md`):**

- [ ] Which frontend path ran on Oct 31? The logs show direct Supabase REST calls. Find how `src/lib` chooses between Supabase and the `/api/*` server, and whether the Express server was ever exercised for Rounds 2 and 3.
- [ ] Where are the poll intervals and Realtime subscriptions? Search for `setInterval`, `.channel(` and `postgres_changes`.
- [ ] Does `buildSyncPayload` include `admin_passcode` or any other private data?
- [ ] What does the second argument of `round2AdvancePhase(matchId, true)` do, and can a burst of calls skip phases?
- [ ] Is `saveToDisk()` synchronous, and how often is it called?
- [ ] Does `join_player_atomic` (see `scripts/deploy_atomic_join.ts`) take a table-level lock? Joins move into the engine, but the answer shows what to avoid.
- [ ] Which tests pass today, and what do they assert? They become the golden tests.
- [ ] Compare the production schema with the code (`teams.emoji_code` was missing on Oct 31).
- [ ] What does Round 3 need that Rounds 1 and 2 do not? It has never run live.

**Questions for the organizer:**

- [ ] What is the event date, so the phases can be scheduled backwards from it?
- [ ] What network will players use at the venue: pub Wi-Fi, cellular, or a mix?
- [ ] Is 200 players in about 40 teams of five the real target, and is that the maximum?
- [ ] Is a projector or TV available for `/screen`?
- [ ] Is a small monthly hosting cost acceptable?
- [ ] Are there rule changes for December, and do the 3-character join codes and 5-emoji team codes stay?

**Optional, to confirm the Oct 31 root cause:** the Supabase Database reports (CPU, memory, disk I/O) for 21:00 to 22:10 UTC on Oct 31.

## Claude Code kickoff prompt and CLAUDE.md

Paste the prompt into Claude Code at the repo root, and save the second block as `CLAUDE.md`. The prompt stops after Phase 0 on purpose, so you review the audit before any rebuild starts.

**Kickoff prompt**

```markdown
You are rebuilding the server core and the client data layer of the Underworld game (repo AdroMine/wcl_game) for a live pub event with 200 players in December.

Background: on Oct 31 the game failed with 50 players because every phone read and wrote a hosted Supabase database (five unfiltered select=* reads per refresh, Realtime subscriptions, a join RPC) and clients triggered phase changes themselves. The new design is one always-on Node server that owns all state in memory, the clock, and per-team views streamed over SSE. Phones only send idempotent commands and render views. Supabase becomes a write-only snapshot backup.

Read first: docs/REBUILD_PLAN.md (the plan), docs/GAME_MASTER_RULES_AND_DESIGN.md (the rules, the spec of record), server/index.ts, server/stateStore.ts, src/lib, src/context, tests/ and scripts/.

Task for this session, Phase 0 only:
1. Tag current main as halloween-prod. Do not modify it afterwards.
2. Write docs/AUDIT.md answering every repo check listed in the plan's section Open questions and checks, with file paths and line references.
3. Run the existing tests and record which pass and what they assert.
4. Recommend option A, B or C from the plan's Decision section, with evidence, and list which components and logic you would keep.
5. Propose the concrete file list for Phase 1 and any risks you found.

Stop after step 5 and wait for my approval. Do not write engine or server code yet, and do not delete anything.

Rules for all later phases: follow CLAUDE.md; work phase by phase and stop at each gate in the plan; keep commits small with clear messages; write the tests first for engine behaviour; if the rules doc and the existing code disagree, ask me instead of guessing; never invent game rules.
```

**CLAUDE.md**

```markdown
# Underworld game: rules for working in this repo

## What this is
A live party game for up to 200 players in about 40 teams of five. One Node server owns the whole game; phones are display-and-input terminals.

## Architecture rules (do not break)
- Only the server changes game state. The web app never imports @supabase/supabase-js and never talks to a database.
- All game logic lives in server/engine as pure functions: (state, command, ctx) returns (state, events). No I/O, no Date.now(), no Math.random(); time and the seeded RNG come from ctx.
- Clients never trigger phase changes. The scheduler advances phases at absolute deadlines; clients get serverNow and phaseEndsAt and only display a countdown.
- Every command carries a commandId and is idempotent. Votes are keyed by match and player; joins by player ID.
- Each phone gets one view of 4 KB or less, built once per team per version. A view never contains another player's private data or the admin token.
- State is plain JSON and must survive snapshot and restore unchanged. Snapshots are written every few seconds when dirty and at every phase change; the live game never reads the database.
- Broadcasts are coalesced: mark dirty, flush at most every 250 to 500 ms.
- Admin actions require the ADMIN_TOKEN environment variable, compared in constant time and never serialized.

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
```
