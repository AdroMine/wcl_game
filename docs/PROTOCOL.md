# Wire protocol (server <-> web client)

The web client talks to the game server over plain HTTP. Phones never touch a database. Types live in
`shared/protocol.ts`, the only module both sides import; this document is the human-readable version.

- Protocol version: `PROTOCOL_VERSION = 1` (also in `GET /api/meta` as `protocol`).
- All bodies are JSON (UTF-8). Dynamic responses send `Cache-Control: no-store` (or `no-cache` for views with an ETag).
- The server never needs cookies; CORS is configured with `ALLOWED_ORIGIN` (comma separated list). Requests that carry
  an `Authorization` or `Content-Type: application/json` header trigger a preflight, which is answered. A command POST
  also works as `Content-Type: text/plain` (any content type is parsed as JSON), which avoids the preflight.
- Never put the token in a log line, an error report or a URL you share. (`/api/stream` and `/api/view` take it in
  the query string because `EventSource` cannot send headers; the server never logs request URLs.)

## Identity

There are no accounts. At first launch the browser invents a `playerId` and a `token`, stores both in `localStorage`
and sends them with everything:

- `playerId`: 6 to 64 characters of `[A-Za-z0-9_-]` (use a UUID without braces). Not a reserved JavaScript name.
- `token`: 22 to 128 characters, random, at least 128 bits (`randomToken()` in `shared/protocol.ts` makes 192 bits).

The server stores only `sha256(token)`. A `JOIN` for an unused `playerId` registers it; a `JOIN` (or any other
command) for an existing `playerId` with another token is refused with `401 UNAUTHORIZED`, so a stranger cannot take
over a player. If the client loses its token it must join as a new player.

The admin panel uses `Authorization: Bearer <ADMIN_TOKEN>` on `/api/admin/*`. Keep the admin token out of the
phone bundle; the host types it into the panel.

## Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | server status for operators and the swarm |
| `GET /api/meta` | none | static data, cacheable for 5 minutes (`Cache-Control: public, max-age=300`) |
| `POST /api/command` | player | send one command |
| `GET /api/stream?playerId&token` | player | Server-Sent Events: the player's view, pushed |
| `GET /api/view?playerId&token` | player | the same view by polling, with `ETag` / `304` |
| `GET /api/team-preview?code&playerId&token` | player | lobby preview of a team by emoji code |
| `GET /screen-view` (alias `/api/screen`) | none | public projector view (JSON, ETag) |
| `GET /api/screen/stream` | none | the projector view as SSE |
| `POST /api/admin/command` | admin | any `ADMIN_*` engine command |
| `GET /api/admin/view` | admin | full snapshot for the control panel (ETag / 304) |
| `GET /api/admin/backup` | admin | download the game state |
| `POST /api/admin/restore` | admin | upload a backup; the game comes back PAUSED |
| `POST /api/admin/resync` | admin | tell every client to reload |
| `POST /api/admin/notice` | admin | show (or clear) a one-line banner on every phone |
| `POST /api/admin/reset-metrics` | admin | reset the apply-time / lag statistics (used by the swarm) |

Unknown routes answer `404` with `{ ok:false, error:'BAD_REQUEST' }`. The server never answers 500 for bad input.

### `GET /health`

```json
{ "ok": true, "version": 1208, "sid": "z3IF1FeN", "phase": "R2_CLASH", "paused": false, "players": 200, "teams": 40,
  "clients": 200, "commandsPerSec": 3.2, "p99ApplyMs": 2.4, "eventLoopLagMs": 1.1, "heapUsedMB": 21.5, "rssMB": 118,
  "snapshotAgeSec": 2.1, "lastSnapshotOk": true, "maxViewBytes": 1833, "uptimeSec": 3600, "...": "more counters" }
```

No secrets. `eventLoopLagMs` is the worst p99 event-loop delay over the last minute, `p99ApplyMs` the p99 time the engine
needed to apply a command. `snapshotAgeSec` is `null` until the first snapshot was written; `lastSnapshotOk` is `false`
while any snapshot store is failing (the game keeps running).

### `GET /api/meta`

Static content that must not be repeated in every view: protocol version, `limits`, `roles` (id, name, colour, icon name,
description), `emojiPool`, `teamSize` (`{min:3, target:5, max:6}`: the limits; the live crew size is `lobby.crewSize` in the lobby view), default `durations` (with `crewSize`), the three round briefings (`rounds[]`: title, subtitle,
story `sentences`, `rules`, `objective`, `briefingSeconds`), `r2Stakes` (points per clash: `{clash, bothTruce, ambushWin, truceLoss, bothAmbush}[]`), `r3` (`targetDistance`, `podiumSize`, `honourBonus`), `vessels`, `stances`, `sdActions`, `moralStatuses`, `hints`, `errors` (a
fallback message per error code) and `instructions` (the projector text per phase, keyed `PHASE` or `PHASE/STEP`).
Load it once at start. A phone plays the round briefing story while the view's `phase.step` is `BRIEFING` (see Views).

## Commands: `POST /api/command`

Body (at most 8 KB, otherwise `413`):

```json
{ "commandId": "p-<random>-17", "playerId": "…", "token": "…", "type": "R2_VOTE", "payload": { "vote": "TRUCE" } }
```

`commandId` is 1 to 128 characters of `[A-Za-z0-9_.:~-]`. **Generate a new id per user action and re-send the SAME id
when you retry** (timeout, dropped connection, 5xx). The server applies an id at most once, so a retry can never double
a vote or a join; a duplicate is answered `ok:true`. Never reuse an id for a different action.

Response:

```json
{ "ok": true, "v": 1209 }
{ "ok": false, "v": 1209, "error": "WRONG_PHASE" }
```

`v` is the state version after the command. HTTP status: `200` for every game-level answer (including `ok:false` with an
engine error code such as `ROLE_TAKEN`; those are normal and meant for the UI), `400 BAD_REQUEST` for a malformed body,
`401 UNAUTHORIZED` for an unknown player or a wrong token, `413 PAYLOAD_TOO_LARGE`, `429 RATE_LIMITED` (honour
`Retry-After`, then retry with the same `commandId`). `5xx` and network errors: retry with backoff and the same id.

Do not wait for the command response to update the screen: the new state arrives on the stream. Use the response only for
error messages.

### Player command types

Validated by hand in `shared/protocol.ts` (`validateCommandEnvelope`). Strings are trimmed, control and bidi characters
removed, whitespace collapsed and the length capped (truncated, not rejected). Unknown extra fields are rejected.

| `type` | `payload` | Notes |
| --- | --- | --- |
| `JOIN` | `{ name?: string }` (<= 24) | first call registers; later calls only update the name |
| `LEAVE_GAME` | `{}` | lobby only |
| `REROLL_ROLE` | `{}` | lobby only, before joining a team |
| `CREATE_TEAM` | `{ name?: string }` (<= 32) | lobby only |
| `JOIN_TEAM` | `{ code: string }` | the 3-emoji code, e.g. `"🔥💀⚡"`; `ROLE_TAKEN` / `TEAM_FULL` / `UNKNOWN_CODE` on failure |
| `LEAVE_TEAM` | `{}` | lobby only |
| `RENAME_TEAM` | `{ name: string }` | lobby only |
| `R1_SUBMIT` | `{ answer: string }` | `WRONG_ANSWER`, `ROUND_CLOSED` after the deadline |
| `R1_HINT` | `{ hint: 1 \| 2 \| 3 }` | `HINT_LOCKED` before it unlocks (2:00, 3:00, 4:00); costs 30 points |
| `R2_PAIR` | `{ code: "07" }` | the rival crew's 2-digit battle code (`OWN_CODE`, `UNKNOWN_CODE`, `ALREADY_PAIRED`) |
| `R2_VOTE` | `{ vote: "TRUCE" \| "AMBUSH" }` | during the VOTE step only; the first vote is final |
| `R3_VOTE` | `{ vessel: "ROWBOAT" \| "SAILBOAT" \| "GHOST_SHIP" }` | during the wave's VOTE step; the first vote is final |
| `R3_ARM_LEASH` | `{}` | Betrayed crews only (`r3.leash.available`); arms the Stygian Leash on the nemesis for this wave |
| `SD_VOTE` | `{ action: "SHIELDS" \| "RAM" \| "SAILS" }` | only the two crews in a Sudden Death standoff |

### Error codes

Engine codes (game rules): `INVALID_PAYLOAD UNKNOWN_COMMAND FORBIDDEN UNKNOWN_PLAYER UNKNOWN_TEAM NOT_IN_TEAM
ALREADY_IN_TEAM WRONG_PHASE PAUSED ALREADY_PAUSED NOT_PAUSED TEAM_FULL ROLE_TAKEN UNKNOWN_CODE INVALID_CODE OWN_CODE
ALREADY_PAIRED NO_CODES_LEFT WRONG_ANSWER HINT_LOCKED ROUND_CLOSED NOT_PLAYING VOTE_CLOSED ALREADY_ESCAPED NO_LEASH
INVALID_TARGET TARGET_ESCAPED NOT_TIMED NOT_DUE STALE INVALID_DURATION SAME_TEAM NOT_IN_DUEL NO_STANDOFF NOT_PAIRED`.

Transport codes: `BAD_REQUEST` (400, also unknown routes), `UNAUTHORIZED` (401; also admin disabled, 503),
`RATE_LIMITED` (429), `PAYLOAD_TOO_LARGE` (413). `ERROR_MESSAGES` in `shared/protocol.ts` (and `meta.errors`) has a
short English fallback text for each.

`PAUSED` means the host paused the game: show "Paused by the host", do not retry in a loop.
`UNAUTHORIZED` after the game was reset or the player removed: clear the stored identity and show the join screen.

Rate limits: 10 commands per second per player (burst 20), about 2 view polls per second per player, and a generous
per-IP bucket (about 600 requests per second, burst 1500) because a whole pub may share one IP.

## Views

One JSON object per player, at most **4096 bytes** (enforced and tested for a 200-player, 40-team game in every phase, and for 40 crews of 7 members; the largest real view is about 2.0 KB with ordinary names). It never contains token hashes, tokens, codewords, other players' private data,
other teams' votes before the reveal, or any teammate's individual vote.

```ts
interface View {
  sid: string;      // server instance id; if it changes the server restarted: accept any v
  v: number;        // state version, monotonic within one sid
  serverNow: number;// server clock (ms since epoch) when this view was sent
  phase: { name; step; clash; wave; endsAt: number|null; startedAt?: number /* BRIEFING only */; paused: boolean; pausedAt?; pausedRemainingMs? };
  me?: { id; name; role; joinedTeam: boolean; slot?; slotCount?; myVote? };
  team?: { id; name; emojiCode; battleCode; members: {name; role}[]; missingRoles: RoleId[]; score; rank };
  r1?: { tablet?: { line1; line2 }; solved; points; closed; hints: { index; unlocksAt; taken; text? }[] };
  r2?: { paired; rival?: {name; battleCode}; clashes: { clash; myStance; rivalStance; myPts; rivalPts; myVotes: string }[];
         votedCount?; votedBy?: boolean[]; teamSize; moral? };
  r3?: { distance; escaped; escapedRank?; activeCrews; escapedCount; sailboatCapacity; votedCount?; teamSize;
         honourable?: true; leash?: { available; targetName; armed }; fleet: [name, distance, escapedRank|0, vessel 'R'|'S'|'G'|''][];
         myPos?; lastWave?: { …; vessels: [code, crews, outcome, metres][]; leashes?: {…}[] }; sd?: {…}; podium?: string[] };
  lobby?: { players; teams; crewSize };   // LOBBY only; crewSize = max crew size N (3..6, default 5)
  board: [name, score][];       // top 10 teams
  boardTotal: number;           // number of teams
  notice?: string;              // admin banner
}
```

Key rules for the client:

- **`me` absent** = the server does not know this `playerId`/`token` pair (new device, game reset, or server lost the
  player): show the join screen. This is a normal 200 response, never an error.
- **Phase names**: `LOBBY R1_ACTIVE R1_RESULTS R2_PAIRING R2_CLASH R2_RESULTS R3_ACTIVE R3_RESULTS FINISHED`.
  Steps: `BRIEFING` (see below) at the start of `R1_ACTIVE`, of `R2_CLASH` (clash 1, before its huddle) and of `R3_ACTIVE` (wave 1, before its bluff); Round 1 then runs with `step: null`; Round 2 `HUDDLE PARLEY VOTE DEBRIEF` (clash 1..3); Round 3 `BLUFF VOTE REVEAL` (wave 1..n) and `SUDDEN_DEATH`.
- **BRIEFING** is a server-timed story step. `phase.startedAt` and `phase.endsAt` are absolute server times (use the same
  `offset = serverNow - Date.now()` as for countdowns): animate the briefing from `(now + offset - startedAt)`, so a refreshed or
  late phone resumes at the right point. Its length is `meta.rounds[i].briefingSeconds` = `ceil(sentences * 2.8 + 3 + (rules + 1) * 2 + 3)`.
  While it runs the server refuses `R1_SUBMIT`, `R1_HINT`, `R2_VOTE`, `R3_VOTE` and `R3_ARM_LEASH` with `WRONG_PHASE`, and the round's
  real clock has not started: the Round 1 5:00 deadline, hint unlocks and speed tiers, the Round 2 clash timers and the Round 3 wave timers
  all start when the briefing ends (the next view has the next step and a fresh `endsAt`). During the Round 1 briefing
  `r1.hints[].unlocksAt` is already the projected time (briefing end + 120/180/240 s). The briefing is skipped by the admin's *skip step*
  and is paused and resumed like any step. `phase.startedAt` is absent outside the briefing.
- **Clocks**: the client never changes phase by itself. Keep `offset = serverNow - Date.now()` from the latest view (or the
  `X-Server-Now` header on `/api/view` answers, including `304`) and show `endsAt - (Date.now() + offset)`. While
  `phase.paused` the clock is frozen: show `pausedRemainingMs`, and use `pausedAt` instead of "now" for R1 hint timers.
- **R1**: `r1.tablet` (own crew only, only while `R1_ACTIVE`, including the briefing) is the crew's codeword split into the two tablet lines; draw the vector tablet from it and show piece `me.slot` of `me.slotCount` (0-based, left to right). `slotCount` always equals the crew's current member count and each member holds a distinct slot; if crew membership changes during Round 1 (admin add, move, remove) the slots are recomputed and the view changes. A disconnect never changes membership. The old ASCII `me.slice` / `me.sliceFmt` fields no longer exist.
  `r1.hints[].unlocksAt` is an absolute server time; a hint is takeable when `now + offset >= unlocksAt`. `text` appears
  once the team took it. `team.members[0]` is the team's first member (slot 0).
- **R2**: `team.battleCode` is "Your code"; the player types the rival's code into `R2_PAIR`. `r2.clashes` lists only
  resolved clashes (stances appear at DEBRIEF). `clashes[].myVotes` reveals, once the clash is scored, how each teammate voted: one character per entry of `team.members` in the same order (`T` truce, `A` ambush, `-` did not vote). During VOTE, `votedCount` of `teamSize` teammates have voted and `votedBy` says who (a boolean per entry of `team.members`, never what they voted); `me.myVote` is
  the player's own vote. `r2.rival.battleCode` is the rival crew's code. The points at stake per clash are static: `meta.r2Stakes`. `r2.moral` is one of `HONOURABLE BETRAYED AGGRESSOR BLOOD_FEUD NONE` from R2_RESULTS on.
- **R3**: `fleet` is the first 8 crews on the river (escaped crews first); the vessel letter is filled only from the REVEAL
  step. `r3.lastWave` is this crew's own outcome of the last resolved wave plus the all-crews summary: `vessels` has three rows in the order Rowboat, Sailboat, Ghost Ship, each `[code 'R'|'S'|'G', crews that boarded, outcome 'SAFE'|'CAPSIZED'|'COLLIDED'|'UNBOARDED', metres per boarding crew]` (e.g. `['S', 2, 'CAPSIZED', 0]`), and `leashes` lists every leash event of that wave involving this crew (`kind` `ANCHOR_SIPHON`, `WRECK_DRAG` or `LEASH_SNAPPED`, `delta` for this crew, `otherName`, `role` `holder` or `target`). `r3.honourable` is `true` when the crew holds the Honourable head start (`meta.r3.honourBonus` metres, "Winds of Olympus"); absent otherwise. `r3.leash` exists only for the Betrayed crew
  that still holds the leash. `r3.sd` describes a Sudden Death standoff (`mine` = this crew is in it). `r3.podium` lists
  Gold, Silver, Bronze crew names.
- Static texts (role names and colours, round titles and briefings, vessel descriptions, instruction lines) are NOT in
  views: use `GET /api/meta`.

### `GET /api/stream`: Server-Sent Events

`GET /api/stream?playerId=…&token=…` answers `200 text/event-stream` with `Cache-Control: no-cache, no-transform` and
`X-Accel-Buffering: no`.

- First line: `retry: <ms>` with a jittered 2000 to 5000 (EventSource uses it as the reconnect delay).
- Immediately after: the full view as an unnamed event: `id: <v>` and `data: <view JSON>`.
- Then a new event only when **this player's view content changed** (the server compares a hash of the view without `v` and
  `serverNow`), at most one flush every 300 ms. Idle connections get a `: ping` comment every 15 s.
- `event: resync` (data `{sid, v}`): the host pressed "force resync". Close the stream, wait a random 0 to 2 s, reload the
  view (reconnect) and replace local state. Fresh views follow on the new connection.
- An unknown or wrong credential still gets `200` and views without `me`. Join with `POST /api/command` and the same stream
  switches to the player's view without reconnecting.
- A player may have several tabs; each gets updates. The server keeps at most 4 connections per player (oldest dropped).
- Slow readers are cut off: a connection that cannot accept data for 10 s, or has more than 64 KB queued, is destroyed.
  Just reconnect.

### `GET /api/view`: polling fallback

Returns the same JSON. The response has `ETag` (a hash of the content without `v`/`serverNow`) and `X-Server-Now`. Send
`If-None-Match: <etag>` and the server answers `304` with no body when nothing changed. Poll every 3 to 5 s (jittered)
only while the stream is down. About 2 requests per second per player are allowed.

### `GET /api/team-preview?code=…&playerId=…&token=…`

Lobby preview of a team by its emoji code (URL-encode the emoji):

```json
{ "ok": true, "team": { "name": "Crew 3", "emojiCode": "🔥💀⚡", "memberCount": 2, "maxMembers": 5, "isFull": false,
  "leaderName": "Ada", "members": [{ "name": "Ada", "role": "oracle" }], "missingRoles": ["navigator", "scholar"],
  "hasRoleConflict": true, "conflictingRole": "oracle" } }
```

`401` without valid credentials, `404 UNKNOWN_CODE`, `400 INVALID_CODE`. No player or team ids are returned.

### `GET /screen-view`: projector

```ts
interface ScreenView { sid; v; serverNow; phase; title: string; instruction: string; board: [name, score][];
                       fleet?: [name, distance, escapedRank|0, vessel][]; podium?: string[];
                       counts: { players; teams }; joinUrl?: string; notice?: string }
```

Public, no private data. Poll it (ETag / 304) or stream it from `GET /api/screen/stream` (same SSE rules, no
credentials). `fleet` lists every crew in Round 3. `joinUrl` is `PUBLIC_URL` for the QR code.

## Admin

All admin calls need `Authorization: Bearer <ADMIN_TOKEN>`. Wrong or missing token: `401` (`503` if the server has no
admin token). Repeated failures from one IP are rate limited (`429`); once limited, tokens are not even checked.

- `POST /api/admin/command` with `{ "type": "ADMIN_START_GAME", "payload": {}, "commandId"?: "…" }`; answers like a player
  command. The commandId is optional (random if omitted; pass one to make a retry safe). Types: `ADMIN_START_GAME`,
  `ADMIN_START_R2`, `ADMIN_R2_FORCE_START`, `ADMIN_START_R3`, `ADMIN_END_R3`, `ADMIN_FINISH`, `ADMIN_PAUSE`, `ADMIN_RESUME`,
  `ADMIN_SKIP_STEP` (`{phaseSeq?}`; also skips a BRIEFING and starts the round's clock), `ADMIN_ADJUST_DEADLINE` (`{seconds}`), `ADMIN_ADJUST_SCORE` (`{teamId, delta}`),
  `ADMIN_ADJUST_DISTANCE`, `ADMIN_TOGGLE_HONOUR`, `ADMIN_MOVE_PLAYER` (`{playerId, teamId|null}`), `ADMIN_REMOVE_PLAYER`,
  `ADMIN_ADD_PLAYER`, `ADMIN_DELETE_TEAM`, `ADMIN_RENAME_TEAM`, `ADMIN_AUTO_GROUP`, `ADMIN_SET_DURATIONS`,
  `ADMIN_SET_CREW_SIZE` (`{size: 3..6}`, lobby only, otherwise `WRONG_PHASE`; default 5; validated in `shared/protocol.ts`; sets the maximum crew size N for creating and joining crews, auto-group builds crews of N and adds 1-2 leftovers to existing crews, admin add/move allow N + 1),
  `ADMIN_RESET_GAME`, `ADMIN_TRIGGER_SUDDEN_DEATH` (`{teamA, teamB}`), `ADMIN_MARK_R1_SOLVED` (`{teamId}`),
  `ADMIN_R2_PAIR` (`{teamA, teamB}`), `ADMIN_R2_UNPAIR` (`{teamId}`), `ADMIN_R2_AUTO_PAIR`. Payload details are in
  `server/engine/admin.ts`.
- `GET /api/admin/view`: `{ serverNow, metrics, sid, v, phase (with `startedAt`), config (includes `crewSize`), crewSize, notice, counts, players[], teams[], matches[],
  unpairedTeamIds, moral, r3 }`. Includes team ids, codewords and per-team state (admin only; no token hashes). The `ETag`
  covers everything except `serverNow` and `metrics`, so polling it with `If-None-Match` is cheap; use `/health` for the live
  status strip.
- `GET /api/admin/backup`: `{ "format": 1, "savedAt": <ms>, "version": n, "state": {…} }` as a download.
- `POST /api/admin/restore`: body is that envelope, or the bare state object. The state is validated and every view is
  dry-run rendered before anything changes; then it replaces the live state, **PAUSED** (the clock is frozen at `savedAt`),
  the version moves forward, every client is told to resync and a snapshot is written. Answer `{ok, v, phase, paused:true}` or
  `400` with the reason. Press Resume (`ADMIN_RESUME`) when ready.
- `POST /api/admin/resync` answers `{ok, notified}`: sends `event: resync` to every connected client and pushes fresh views.
- `POST /api/admin/notice` with `{ "text": "Back in two minutes" }` (empty or `null` clears it): shown in `view.notice`
  on every phone and the projector.

## Reconnection expectations (what `useGame()` must do)

1. Keep the last view on screen when the connection drops; show a small "Reconnecting..." badge. Never blank the screen.
2. Use `EventSource` (or a fetch-streaming equivalent). On error or close, reconnect after the server's `retry` hint with
   exponential backoff (x2 per failure, cap 30 s) and **full jitter** (random between 50% and 100% of the delay).
3. After about 3 failed stream attempts fall back to polling `GET /api/view` with `If-None-Match` every 3 to 5 s
   (jittered) and keep trying the stream in between; go back to the stream as soon as it delivers an event.
4. Resync on `visibilitychange` (tab becomes visible), `online`, and `pageshow`: open a fresh stream or poll once
   immediately. Phones suspend background tabs, so a stream is often dead without noticing.
5. Version rule: apply a view if `sid` differs from the last one seen, or if `v` is not lower than the last applied `v`
   (equal `v` with different content is fine, e.g. after `resync`). A different `sid` means the server restarted from a
   snapshot and may be at a lower version.
6. Resend commands that got no answer with the same `commandId` (up to 5 attempts, exponential backoff). Keep the pending
   command id in memory so a button tapped twice sends two different actions only if the user meant it.
7. On `event: resync`: close the stream, wait a random 0 to 2000 ms, reconnect and replace state.
8. Restore the session on page load from `localStorage` (`playerId`, `token`) and open the stream straight away; show the
   join screen only when a view arrives without `me`. A refresh must never show the join screen to a known player.
9. After a server restart the game is **paused** (`phase.paused`) until the host resumes. Show "Paused" and keep the
   connection; the votes that were cast in the last seconds before the crash may be gone (`me.myVote` empty): let the player
   vote again once the game resumes.

## Server environment (summary)

`PORT` (3001), `NODE_ENV`, `ADMIN_TOKEN` (required in production, at least 16 characters), `PUBLIC_URL`, `ALLOWED_ORIGIN`,
`SNAPSHOT_STORE` (`file` or `supabase`), `SNAPSHOT_DIR` (`./data`), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `STATIC_DIR`,
`TRUST_PROXY`. See `.env.server.example`. Snapshots: every 5 s when something changed and immediately at every phase change;
on boot the newest snapshot is restored PAUSED.
