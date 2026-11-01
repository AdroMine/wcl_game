# Phase 0 Audit: Underworld game (`AdroMine/wcl_game`)

Nov 1, 2026 · Phase 0 of `rebuild_plan.md` · status: **waiting for approval**

Audited commit: `502a6c1` (tagged `halloween-prod`, local tag only, not pushed). Line numbers refer to that commit.

## 0. Summary

- **Recommendation: Option B** (rebuild the core, keep the UI). The game logic in `src/lib/round*Engine.ts` is mostly pure and well tested, and no component imports Supabase directly. But `server/stateStore.ts` has no clock, mutates state while building reads, leaks the admin passcode, writes to disk on every change, and never got Round 3 or the emoji lobby. Option A would keep the weakest parts. Option C would throw away screens that are already decoupled behind one context.
- **What ran on Oct 31:** the Supabase path, every time. `isSupabaseConfigured` is hard-wired to `true`, so the Express server could never have served the live lobby, which uses emoji team codes the server doesn't implement.
- **The "client write avalanche" code path is real.** Every Round 2 phone calls `advance` with `forceSkip=true` when its own local timer hits 0. Every poll from every phone also advances every expired match in the game, using read-modify-write on stale rows. Concurrent votes overwrite each other in the same way.
- **Security problems that need fixing before Friday**, whatever we decide about the rebuild: the Supabase anon key is hard-coded in a public repo, the RLS policies let `anon` do anything, the admin passcode is `underworld` and ships in the JS bundle, and every phone receives every team's Round 1 answer.
- **Tests:** the 3 suites in `npm test` pass (311 checks). The 2 other suites write to the live production Supabase, so I did not run them. I ran the pure parts of one of them separately, and they pass.
- **17 places where the rules doc and the code disagree, or the rules say nothing** (section 7). Several of them block Round 2 and Round 3 engine work. I need your answers.

## 1. Tag

`git tag halloween-prod main` was created on your machine and points at `502a6c1`. Nothing else was modified. To publish it: `git push origin halloween-prod`.

Note: `main` includes two commits made during and after the event: `264fddc` at 21:22 UTC ("debounce and jitter realtime sync") and `502a6c1` at 23:07 UTC ("exponential backoff"). The build that was serving at 21:00 was probably `cb62ab4` (15:43). If exact forensics matter, check the Cloudflare deployment history and tag that commit too (for example `halloween-event-start`).

## 2. Repo checks

### 2.1 Which frontend path ran on Oct 31?

**The Supabase path, always.**

- `src/lib/supabase.ts:3-11`: the URL and anon key fall back to hard-coded literals (`https://gbvprlfovncxnsohowyf.supabase.co`, `sb_publishable_ozXd…`). So `isSupabaseConfigured` (`:13-18`) is `true` in every build, even with no `.env`.
- `src/lib/api.ts`: every exported function starts with `if (isSupabaseConfigured) return supabaseX(...)` (for example `:56`, `:92`, `:242`, `:516`). The `fetch('/api/...')` branch is dead code in production.
- `src/context/GameContext.tsx:230-283`: picks Supabase Realtime when configured, and local SSE (`connectSSE`) otherwise. Because of the hard-coded key, SSE never runs.
- **Was Express ever exercised for Rounds 2 and 3?** Round 2: only in local development, if anyone blanked the fallback key. The routes exist (`server/index.ts:340-422`). Round 3: **never**. `server/index.ts` has no `/round3/*` routes at all, while `api.ts:640-790` calls ten of them. The live lobby couldn't have run on Express either: `LobbyTeamFormation.tsx:45-47,131,167` uses `createTeam` / `previewTeamByEmoji` / `joinTeamByEmoji`, which call `/api/team/create`, `/team/preview`, `/team/join-emoji` and `/team/leave` (`api.ts:151,165,175,191`). None of these routes exists on the server. Neither does `/admin/round1/mark-solved` (`api.ts:426`).

### 2.2 Poll intervals and Realtime subscriptions

| Where | What | Load effect |
| --- | --- | --- |
| `GameContext.tsx:232-252` | One channel with `postgres_changes` on `game_state`, `teams`, `players` and `round2_matches`, `event: '*'` | **Fan-out amplification:** any write by any player makes every phone run a full sync (5 reads) |
| `GameContext.tsx:255-258` | `setInterval` heartbeat sync every 15 s (30 s in low-data mode) | 5 reads per phone per 15 s with no events at all |
| `GameContext.tsx:220`, `:316-506` | Initial `runPoll()`, plus `await runPoll()` after **every** action | Every vote costs the voter one more full sync |
| `GameContext.tsx:223-228` | Full sync on `visibilitychange` (screen unlock) | Synchronized when the host says "look at your phones" |
| `GameContext.tsx:194-212` | SSE fallback polling every 12 s / 25 s (dead in prod) | n/a |
| `GameContext.tsx:306` | 500 ms countdown tick (local only) | none |
| `ShadesInTheMistRound.tsx:51-76` | 500 ms tick that **calls `advanceRound2`** when the local timer hits 0 | Client-triggered phase change (see 2.4) |
| `RoundContainer.tsx:54`, `RoundBriefingModal.tsx:209,247`, `SoloTesterWorkbench.tsx:113` | UI-only timers | none |
| `server/index.ts:35-43` | 15 s SSE keep-alive ping | fine |

"Full sync" means `fetchFullSyncPayloadFromSupabase` (`supabaseService.ts:385-620`): five unfiltered reads in parallel (`:388-394`), plus **writes during the read**. It back-fills battle codes (`:452-458`), emoji codes (`:473-480`) and codewords, and that codeword choice is random on each phone (`:557-566`). It also advances expired Round 2 matches (`:501-506`) and Round 3 waves (`:519-536`). With 50 phones, one vote led to roughly 50 × 5 reads plus whatever writes the readers made.

### 2.3 Does `buildSyncPayload` include `admin_passcode` or other private data?

**Yes.** `server/stateStore.ts:671-771`:

- `config: this.config` (`:761`) includes `admin_passcode: "underworld"` (`defaultConfig.ts:93`, also saved in `server/server_state.json:11`). I measured it: the payload for any player contains the passcode.
- `round2_all_matches: Array.from(this.round2_matches.values())` (`:767`) contains **every player's raw vote for every match**, with no masking. The masked copy (`round2_match`, `:766`) is pointless next to it.
- `unassigned_players` (`:740-753`) exposes every unassigned player's `join_code` to every phone.
- `team` (`:763`) includes `assignedCodeword`, the full Round 1 answer, sent to all five phones, each of which is supposed to hold only one slice.
- `buildSyncPayload` also **mutates state**: it assigns battle codes (`:677-686`) and advances expired matches (`:689-694`).

The Supabase path is worse: `teams_leaderboard[].assignedCodeword` (`supabaseService.ts:579`) sends **every team's Round 1 answer to every phone**. `config` and the raw `round2_all_matches` (`:609,615`) are sent too.

Size, measured by running `stateStore` with 35 teams and 175 players: **26.5 KB per player**, and 32 KB once Round 2 is paired, against a 4 KB budget. One broadcast to 200 clients is about 6.4 MB.

Related admin exposure: `VITE_ADMIN_PASSCODE` (`.env.example:4`, read at `supabaseService.ts:190-199`) is a `VITE_` variable, so Vite inlines it into the public bundle. Admin checks run in the browser, so anyone with the anon key can call the "admin" functions directly. `POST /api/admin/config` (`server/index.ts:323-331`) lets an admin replace the whole config, passcode included. The passcode is compared with `===` (`:217,226`).

### 2.4 What does `round2AdvancePhase(matchId, true)` do, and can a burst skip phases?

`stateStore.ts:878-988`. The second argument `forceSkip` bypasses **both** guards on `:882`: the deadline check (`now < phase_ends_at`) and the `completed` check. Each call moves the match one step: HUDDLE → PARLEY → VOTE → DEBRIEF (scores the clash, `:913-948`) → next clash HUDDLE, or completion.

**Yes, a burst skips phases.** `POST /api/round2/advance` is unauthenticated and always passes `true` (`server/index.ts:368-374`). Node handles the requests one after another, so *k* calls in the same second advance *k* phases. If a burst crosses VOTE → DEBRIEF, it scores the clash with every vote missing set to ABSTAIN, which resolves to TRUCE/TRUCE (`:931-946`). On a completed match it re-runs completion and rewrites `nemesis_team_id` and `round_submissions['round-2']` (`:954-981`).

The client trigger is `ShadesInTheMistRound.tsx:57-70`. Every phone in the match calls `advanceRound2` when **its own** `Date.now()` passes `phase_ends_at`. That is raw device time, not corrected by `serverTimeOffset` (`:58`). It then waits 3 s before it may fire again. A phone whose clock runs fast advances the match early for everyone.

In production (Supabase) the equivalent is `supabaseRound2AdvancePhase` (`supabaseService.ts:1908-1925`), also with `forceSkip=true`, running `processMatchPhaseAdvance` (`:202-383`). Concurrent callers read the same stale row, so they tend to **collapse** onto the same next phase instead of skipping. But team scores are written as absolute values computed from a stale read (`:296-305`), so concurrent advances **lose or overwrite score updates**. On top of that, every phone's poll advances every expired match in the game (`:501-506`).

Related: votes are read-modify-write on the whole `clash_data` JSON (`supabaseService.ts:1831-1874`). Two teammates voting in the same ~100 ms both read the old array and the last write wins, so **the other vote is lost** and later counted as ABSTAIN. The logs can't show this, because each write succeeds.

### 2.5 Is `saveToDisk()` synchronous, and how often is it called?

**Synchronous.** `fs.writeFileSync` of pretty-printed JSON (`JSON.stringify(data, null, 2)`) at `stateStore.ts:70-88`. It has **28 call sites** in `stateStore.ts` and 3 in `server/index.ts`: once per mutation, so once per vote, join, hint and so on. It is also called from `round2AdvancePhase` inside `buildSyncPayload`. At 175 players the file is 91 KB. It writes into the source tree (`server/server_state.json`, `:31-35`), which is lost on any ephemeral host. `loadFromDisk` (`:90-108`) silently drops `round_is_paused` and `paused_time_left_seconds`, so a paused game resumes after a restart.

### 2.6 Does `join_player_atomic` take a table-level lock?

**Not a table lock, but a global one.** `scripts/deploy_atomic_join.ts:46`: `PERFORM pg_advisory_xact_lock(424242)` is one advisory lock shared by every new join and every role re-roll (`:99`). It is held until the transaction ends. Inside the lock it runs a `LEFT JOIN players … GROUP BY` over the whole table (`:50-55`) and an unbounded `LOOP` of random codes with `NOT EXISTS` lookups on `join_code` (`:58-64`). There is no index on `join_code` in the repo. So joins are fully serialized behind a full-table scan. When the instance slowed, every join queued behind the lock, which is consistent with the run of 522s on `/rpc/join_player_atomic` from 21:07.

The client then **falls back to a direct insert** when the RPC errors or times out (`supabaseService.ts:637-700`). If the RPC actually committed and only the response timed out, the retry inserts the same id again, which matches the `23505 players_pkey` errors in `supabase_logs.csv`. Lessons for the engine: no global lock, no scan per join, and a join keyed by a client-generated player id that is idempotent by construction.

### 2.7 Which tests pass, and what do they assert?

See section 3.

### 2.8 Production schema vs code

- **The repo has no migrations for the core tables** (`players`, `teams`, `game_state`, `round2_matches`, `round_submissions`). Their shape exists only in the live project. Only Round 3 (`scripts/deploy_round3_schema.ts:9-45`) and the two RPCs are scripted.
- **`teams.emoji_code` doesn't exist.** The code works around it by storing the code in `round_submissions._emoji_code` (`supabaseService.ts:136,465,477,897,1696`). The log has `42703 column teams.emoji_code does not exist` at 2026-10-31 23:07:13 UTC. No query at HEAD selects that column, so it was probably a manual query or an older build.
- Other workarounds hidden in JSON: `round_submissions._active_hints` for hints (`:135`), and `config.round_started_at` inside `game_state.config` (`:604-606`).
- The RPC writes a `last_seen` column (`deploy_atomic_join.ts:37,69`) that the TypeScript model never reads.
- **RLS is effectively off:** `FOR ALL TO anon … USING (true) WITH CHECK (true)` (`deploy_round3_schema.ts:55,60,65`). The core tables are presumably the same, since the anon client deletes rows during reset (`supabaseService.ts:1535-1551`). Together with the anon key in a public repo, **anyone can read or wipe the game database.**
- `round_submissions` is referenced as a table (`:1505,1535`) and also as a JSON column on `teams`.

For the rebuild, none of this matters except for the new `snapshots` table, which should be the **only** table and writable only with the service key.

### 2.9 What does Round 3 need that Rounds 1 and 2 don't?

- **No server implementation at all.** It exists only as client-side Supabase code (`supabaseService.ts:2117-2833`) and the pure `round3Engine.ts`. Phones initialize the session (`:519-521`) and advance waves (`:522-536`) during their polls.
- **Global cross-team resolution.** Congestion (`round3Engine.ts:310-480`) needs every team's vessel choice at once: sailboat capacity is a percentage of the active fleet, and the ghost ship only works for exactly one crew. Round 2 matches are independent pairs; Round 3 is one global state machine.
- **Carry-over inputs:** cumulative points from R1 and R2 (head-start), Round 2 moral status (honour bonus, Cerberus eligibility and target), and the nemesis link.
- **Targeted actions with private intent:** the Stygian Leash target is chosen during VOTE and must stay hidden until REVEAL. It can be used once per game, and can snap back on the user.
- **A dynamic sub-phase:** the Sudden Death standoff (40 s, rock-paper-scissors) is inserted on demand, and the podium (gold, silver, bronze) has an end condition.
- **Bigger views:** every phone needs the fleet's distances (a 40-row river). That fits the 4 KB budget only as compact rows (`[teamIdx, meters, escapedRank]`).
- **Open rule gaps** (section 7: Q4 to Q9) sit almost entirely in Round 3.

## 3. Existing tests

Run in a clean clone of `502a6c1` (Linux, Node 22, `tsx`). Your local `node_modules` was installed on Windows (`@esbuild/win32-x64` only), so it can't run in a Linux shell. A full `npm ci`, `tsc -b` and `vite build` **were not verified**, because the npm registry is blocked from my sandboxes. Run `npm ci && npm run build` once on your machine to confirm.

| Suite | In `npm test`? | Result | What it asserts |
| --- | --- | --- | --- |
| `tests/test_team_codes.ts` | yes | **PASS** (122 checks) | 5-emoji pool and labels; parse and normalize (variation selector stripped); label formatting; 50 unique generated 3-emoji codes; duplicate-role rejection naming the conflicting role |
| `tests/test_round2.ts` | yes | **PASS** (124 checks) | 50 unique 2-digit battle codes; stance by majority, ABSTAIN ignored, 2–2 tie broken by **Negotiator**, tie with Negotiator abstaining → TRUCE; full 3×3 scoring matrix (75/150/15, 150/300/30, 225/450/45); nemesis outcomes (NEMESIS/CUNNING, ALLIES, RIVALS); vote masking in VOTE phase (own vote visible, teammates `LOCKED`, opponents hidden) |
| `tests/test_round3.ts` | yes | **PASS** (65 checks) | Head-start `min(200, floor(pts/5))`; vessel majority with Negotiator tie-break, empty → ROWBOAT; unanimity ratio; boldness rank; 4-priority crossing sort; sailboat capsizes when `count > ceil(n × 0.30)`; ghost ship solo +450 / collision −50; Leash: anchor siphon −50/+50, wreck drag −100/+100, snap-back 0; distance floor 0 m; podium gold/silver/bronze; sudden death RPS and deadlock; honour requires 3 mutual truces; +75 m Winds |
| `tests/test_hints_and_scoring.ts` | no | Sections 1–4 **PASS** (run in isolation); section 5 **not run** | Hint unlock at 120/180/240 s; hint text names LEFT/RIGHT/CENTER holders; R1 score 45 s → 300, 90 s → 250, 140 s+1 hint → 170, 210 s+2 → 90, 320 s+3 → 50 floor; ASCII slicing gives 5 uniform slices. Section 5 **writes to the live production Supabase** (sets state, spawns a crew, edits config) |
| `tests/test_supabase_round2.ts` | no | **Not run** | Entirely against live Supabase: pairing, voting, advance, timers, reset. Destructive (resets all matches). Superseded by the engine |

The golden values to port are the scoring tables, stance and tie-break rules, nemesis and honour rules, congestion thresholds, Leash amounts, head-start formula, hint timings and podium order. Every one of them has to be checked against the rules doc first (section 7). For example, the sailboat `ceil` rule contradicts the doc's own example.

## 4. Decision: Option B

| Evidence | Points to |
| --- | --- |
| `stateStore.ts` is 1,109 lines: state, transitions, disk I/O, `Date.now()` and `Math.random()` all mixed together; no clock (phases advance only when a client calls or someone reconnects); reads mutate state; no Round 3; no emoji lobby; no tests | Against **A** |
| Express implements 33 of the 48 routes the client calls; the 15 missing are the whole emoji lobby, all of Round 3 and R1 mark-solved (section 2.1) | Against **A** |
| No component imports Supabase. Data reaches the UI only through `GameContext` (`useGameSession`, 14 files) and `api.ts` (only `AdminControlPanel` and `SoloTesterWorkbench`) | Against **C** |
| Components read a small set of payload fields: `teams_leaderboard` (21 uses), `config` (18), `state` (7), `round_ends_at`, `round2_all_matches`, `round_started_at`, `round_is_paused`, `round3_session`, `current_round_index`, `server_now`, `unassigned_players` | A `useGame()` hook can provide a compatible shape: **B is a re-plumb, not a redesign** |
| Rule logic in `src/lib/round{1,2,3}Engine.ts`, `teamCodeEngine.ts`, `asciiEngine.ts` and `tabletEngine.ts` is already pure apart from `Math.random` and default `Date.now` | Port it into the engine: **B** |

**Keep and port into `server/engine` (with tests first):**

- `round1Engine.ts`: `ROUND1_HINTS`, `generateHintText`, `calculateRound1Score`
- `round2Engine.ts`: `calculateTeamStance`, `calculateClashPoints`, `calculateNemesis` (after Q7), masking rules (as view rules), `generateBattleCode` (seeded RNG)
- `round3Engine.ts`: all exports (`calculateHeadstartMeters`, `checkRound2MutualHonor`, `calculateRound3StartingDistance`, `evaluateTeamRound2MoralStatus`, `resolveTeamVesselChoice`, `calculateVoteUnanimity`, `sortCrossingCandidates`, `evaluateWaveCongestion`, `resolveSuddenDeath`), pending Q4 to Q9
- `teamCodeEngine.ts` (all), `tabletEngine.ts` (codeword list), `asciiEngine.ts` (slicing has to move to the server so that each phone receives only its own slice)
- `defaultConfig.ts` values, minus `admin_passcode`; the `types.ts` domain model as a starting point

**Keep and rewire in the UI** (switch from `useGameSession` to `useGame`):

- `LobbyTeamFormation`, `rounds/AsciiSplitterRound`, `rounds/ShadesInTheMistRound` (delete the advance trigger at `:51-76` and the `placeholder="49"` at `:226`), `rounds/OdysseyEscapeRoyaleRound`, `RoundBriefingModal`, `RoundContainer`, `LeaderboardDrawer`, `Navbar`, `JoinModal`, `App.tsx` (`:76` shows the join screen whenever `player` is null, which is the refresh bug), `index.css`, `App.css`, Tailwind config, assets
- `AdminControlPanel.tsx` (95 KB) is the biggest port: it makes 23 direct admin calls through `api.ts`. Keep the layout and replace the actions.

**Replace (don't delete until Phase 3 passes):**

- `server/index.ts`, `server/stateStore.ts`, `server/server_state.json`, `src/lib/api.ts`, `src/lib/supabase.ts`, `src/lib/supabaseService.ts` (2,833 lines), `src/context/GameContext.tsx`, `scripts/deploy_*.ts`, `tests/test_supabase_round2.ts`
- Decide later: `SoloTesterWorkbench.tsx` (66 KB, impersonation plus admin; replaced by the simulator and swarm), and the unused round types `ASYMMETRIC_TEXT_PUZZLE` / `OFFLINE_TASK_TIMER`

## 5. Proposed Phase 1 file list (engine and simulator only)

No new runtime dependencies. Tests use Node's built-in `node:test` through `tsx`, so nothing needs installing. zod arrives in Phase 2 with the protocol.

```text
server/engine/
  types.ts        GameState (plain JSON), Command union, GameEvent, ErrorCode, Ctx {now, rng}
  rng.ts          seeded PRNG (mulberry32); seed and cursor stored in state
  ids.ts          deterministic ids from a counter in state (no Date.now ids)
  config.ts       rule constants ported from defaultConfig (no passcode)
  reduce.ts       reduce(state, cmd, ctx) → {state, events, error}; commandId dedupe (bounded LRU in state)
  due.ts          due(state, now) → system commands for passed deadlines (exactly once)
  phases.ts       global phase machine with absolute deadlines; pause/resume shifts deadlines
  lobby.ts        join (by client player id), rename, leave, role assignment, emoji team create/join/leave
  round1.ts       codeword assignment, per-player slice index, hints, submit, scoring
  round2.ts       pairing (code and admin auto-pair), global clash timeline, votes keyed (match, clash, player), stance, scoring, moral status
  round3.ts       start distances, waves, votes and Leash, congestion, podium, sudden death
  admin.ts        pause/resume, skip phase, adjust timer/score/distance, move/remove player, auto-pair, reset
  index.ts        public exports
tests/engine/
  teamCodes.test.ts   lobby.test.ts   round1.test.ts   round2.test.ts   round3.test.ts   admin.test.ts
  invariants.test.ts  determinism, double commandId is a no-op, JSON round-trip, due() fires once and never early
  golden/             tables ported from tests/test_*.ts (after section 7 is settled)
tests/sim/
  simulate.ts         200 players, 40 teams, fake clock, all three rounds, seeded
  property.test.ts    random command order, random duplicates, snapshot/restore at random points → same final state
tsconfig.server.json  strict, no DOM, covers server/ and tests/
package.json          scripts: "test" (engine + legacy suites), "sim"
docs/AUDIT.md         this file
docs/REBUILD_PLAN.md  copy of rebuild_plan.md (the plan references this path; root file left in place)
```

`src/` stays untouched in Phase 1.

## 6. Risks

1. **The public database is open now.** The anon key is in a public GitHub repo, RLS allows everything, and the admin passcode is in the bundle. The Halloween deploy at `wcl-game.adro-mine.workers.dev` is presumably still live and still polling. Before Friday: take the old frontend offline or show a static "back soon" page, set the Supabase tables to read-only for `anon` (or pause the project), and rotate the passcode. This is a dashboard change and needs no code.
2. **Rule gaps block engine work.** Round 2 tie-breaks and moral status, and most of Round 3, can't be written test-first until section 7 is answered. Lobby and Round 1 are almost unblocked.
3. **Round 1 secrecy:** today every phone can see the full codeword. The new view must send only that player's slice, so slicing moves to the server and the payload grows by one slice (about 0.5 KB).
4. **Round 3 has never run live** and is the most complex part. It needs the most simulation coverage, and it's the first thing to simplify if time runs short (cut line).
5. **Conflicting source docs.** `retrospective_after_halloween.md` picks the Render **free** tier with a 3-minute keep-alive ping and round-end-only snapshots, and lists different role names (Cartographer, Alchemist). `rebuild_plan.md` rejects the free tier and asks for snapshots every few seconds. Both docs give different figures for the database connection limit (15 vs 10). I'm following `rebuild_plan.md` unless you say otherwise.
6. **Pub networks:** captive portals and some proxies break long-lived SSE. The polling fallback and resync on focus are not optional.
7. **Clock skew:** phones currently compare deadlines with raw device time. The new protocol must send `serverNow` and the client must use an offset.
8. **Date-based ids collide:** spawning 40 demo crews in a tight loop produced only 35 teams (`stateStore.ts:339,350` use `Date.now()` ids). The engine uses counters.
9. **Tooling:** there's no CI, `node_modules` is Windows-only, and the build is unverified here. CI (tests, sim, the ban on Supabase imports) should start in Phase 1, not Phase 3.
10. **Time:** a full Phase 1 (L) plus Phase 2 (M) won't be done by Friday Nov 6. See the schedule in section 8.
11. **Housekeeping:** `CLAUDE.md` is wrapped in a ```` ```markdown ```` fence (lines 1 and 30). `CLAUDE.md`, `rebuild_plan.md` and the retrospective are untracked, and the Supabase log CSVs (1.2 MB) are untracked in the repo root. Decide whether to commit them or move them to `docs/incident-2026-10-31/`.

## 7. Questions on the rules (please answer; I won't guess)

| # | Topic | Rules doc says | Code does |
| --- | --- | --- | --- |
| Q1 | Tie-break role | Roles list: **Navigator** "breaks ties in Round 2 & 3", Negotiator "breaks voting deadlocks"; R2 and R3 sections: **Negotiator**; also "the roles don't have any importance" | Negotiator (`round2Engine.ts:47-57`, `round3Engine.ts:218-229`) |
| Q2 | Tie with tie-breaker absent or abstaining | silent | R2 → TRUCE, R3 → ROWBOAT |
| Q3 | Players who don't vote | silent | Counted as ABSTAIN and ignored; a team with nobody voting → TRUCE / ROWBOAT |
| Q4 | Sailboat capacity rounding | "Max 30% … e.g. max 2 crews in a 7-crew room" (2.1 → **2**, floor) | `Math.ceil` → **3** in a 7-crew room (`round3Engine.ts:355`) |
| Q5 | Two crews crossing in the same wave | Sudden Death standoff | 4-priority sort (overshoot, boldness, unanimity, prior points) (`:284-303`); when does sudden death trigger? |
| Q6 | Cerberus amounts | R2 table: Treat Token **−150 / +150**; R3 section: Leash **−50/+50** (float), **−100/+100** (wreck) | Config holds both (`defaultConfig.ts:43-48`); tests assert the Leash values |
| Q7 | Moral categories | Honourable = TRUCE in all 3 clashes on both sides; Blood Feud = "traded ambushes equally" | `calculateNemesis` returns **ALLIES** whenever neither side made a one-sided ambush, **including 3 mutual AMBUSHes** (`round2Engine.ts:141-149`); `round3Engine` requires 3 mutual truces. Which one sets the nemesis link? |
| Q8 | Distance floor | silent | Clamped at 0 m (`round3Engine.ts:464`) |
| Q9 | Nobody reaches 1,000 m after 4 waves, or fewer than 3 do | silent | ? |
| Q10 | Team code | Flowchart: "Emoji Keypad: Flame, Skull, Bolt, Wave, Shield"; plan asks about "5-emoji team codes" | **3** emojis from a 5-key pool (125 codes) |
| Q11 | Team size | "exactly 5 unique roles" | Allows 2 or more members; unique roles only while size ≤ 5; what happens with 203 players, or a team of 4? |
| Q12 | Round 1 after the timer | Tier "4:01+ → 100" | `durationSeconds: 300`, but submit doesn't check the deadline. Can teams solve after 5:00? What do unsolved teams get? |
| Q13 | Round 2 pairing | "matched against an opponent crew" | Teams type a 2-digit code, or the admin auto-pairs. With one global timeline, pairing must finish before clash 1. Is auto-pair by the admin acceptable? What about an odd number of teams? |
| Q14 | R1 slices for a team of 4 or 6 | 5 slices | Slices = team size |
| Q15 | Runtime editing of scoring and durations | n/a | The admin can edit the matrix and durations live. Keep that, or fix the rules in code? |
| Q16 | Unused round types | n/a | `ASYMMETRIC_TEXT_PUZZLE`, `OFFLINE_TASK_TIMER`: drop them? |
| Q17 | Phase name | "The Dialogue (40s)" | `PARLEY` (cosmetic; I'll use the doc's wording in the UI) |

## 8. Proposed schedule (needs your approval)

The plan's phases are horizontal: all rounds in the engine, then the server, then the client. With a pub night every Friday, **vertical slices** give a real test each week while keeping every gate. Each Friday tests only what has passed the swarm on the real host. Anything else stays off, or runs on paper.

| Date | Slice to test live | Gate before it goes in front of people |
| --- | --- | --- |
| **Fri Nov 6** | Lobby (join, emoji teams, 5 role cards, refresh without the join screen) and **Round 1** on the new server | Engine tests for lobby and R1; join-storm and round-start swarm (200 bots) on the paid host; kill/restart restores. If it isn't green by Thursday evening, run a bots-plus-staff test only |
| Fri Nov 13 | + **Round 2** on the global timeline, new two-step code screen | R2 golden tests; vote-burst and phase-change swarm; Q1 to Q3, Q7 and Q13 answered |
| Fri Nov 20 | + **Round 3** | R3 golden tests, 200-player sim; chaos-restart and slow-reader swarm; Q4 to Q9 answered |
| Fri Nov 27 | Full game, admin essentials (pause, skip, backup/restore), `/screen` if time allows | Soak; runbook draft |
| Fri Dec 4 | **Feature freeze** and dress rehearsal on the production host (15 to 20 people on cellular, airplane mode, refreshes) | Rehearsal passes with only the runbook |
| December event | (date to confirm) | Plan checklists |

Needed from you to unblock Nov 6: approval of B and of this schedule; the event date; paid hosting OK (about $7/month, to confirm); Q10 to Q12 for the lobby and Round 1; and the go-ahead to lock down the old Supabase project.
