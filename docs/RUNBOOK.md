# Runbook: Underworld game

One Node server owns the whole game. Phones only send commands and display what the server sends. The server also serves the web app, so there is one URL for everything.

| URL | Who uses it |
| --- | --- |
| `/` | Players (the QR code points here) |
| `/admin` | Host. Needs the `ADMIN_TOKEN`. |
| `/screen` | Projector or TV: phase, countdown, instructions, leaderboard |
| `/health` | Quick status check: connected phones, lag, memory, snapshot age |

## 1. Run it locally (Windows, macOS or Linux)

```bash
npm install                 # once, after pulling the rebuild branch
npm test                    # engine + server tests
npm run sim                 # 200-player simulated game, must print "all invariants hold"
npm run build               # web app (tsc + vite); fix any type errors it reports
npm run dev                 # server on :3001 + vite on :5174 (proxied)
```

- Open `http://localhost:5174/admin` and use the development admin token `dev-admin-token-change-me`. It works only when `NODE_ENV` is not `production`.
- To play from phones on the same Wi-Fi, use `http://<your-laptop-ip>:5174/`.
- Optional browser end-to-end test: `npm i -D playwright && npx playwright install chromium && npm run build && node tests/e2e/fullgame.e2e.mjs`.

## 2. One-time setup

### 2a. Old Supabase project (Halloween)
- Pause it in the Supabase dashboard. It stays restorable for 90 days.
- If nothing else needs the personal access token in your `.env` (`SUPABASE_ACCESS_TOKEN`), revoke it under Account → Access Tokens.

### 2b. New Supabase project, for backups only
1. Create a new free project, for example `underworld-snapshots`.
2. In the SQL editor, run `supabase/snapshots.sql`. It creates one table with row-level security on and no policies, so only the secret key can reach it.
3. Copy the project URL and a **secret** key from Project Settings → API keys. Never use a publishable key here; this key lives only on the server.

### 2c. Render (game server + web app)
1. Push the `rebuild` branch to GitHub.
2. In Render, choose New → Blueprint, pick the repo and branch. `render.yaml` creates one free web service.
3. Set these environment variables:

| Variable | Value |
| --- | --- |
| `ADMIN_TOKEN` | A long random string (at least 16 characters). Keep it in a password manager. |
| `PUBLIC_URL` | The Render URL, for example `https://underworld-game-server.onrender.com` (used for the QR code) |
| `ALLOWED_ORIGIN` | The same URL |
| `SUPABASE_URL` and `SUPABASE_SECRET_KEY` | From step 2b |

4. Deploy, then open `<PUBLIC_URL>/health` and check that it returns `"ok": true`.

**About the free plan:** it sleeps after 15 minutes without traffic and takes about a minute to wake. It can restart at any time and lose its disk, which is why backups go to Supabase. An open `/admin` page pings the server every 3 minutes to keep it awake.

To upgrade, change `plan: free` to `plan: starter` in `render.yaml`, or change it in the dashboard. Starter is about $7/month, billed per second, and you can stop it at any time.

### 2d. Load test the deployed server (decides free vs paid)

Put the token in the `ADMIN_TOKEN` environment variable first. Never pass it as `--admin-token`: npm prints the whole command line, token included.

```bash
export ADMIN_TOKEN="$(cat ~/.underworld-admin-token)"   # PowerShell: $env:ADMIN_TOKEN = (Get-Content -Raw ~/.underworld-admin-token).Trim()
npm run swarm -- --target https://<your-app>.onrender.com --scenario join-storm
npm run swarm -- --target https://<your-app>.onrender.com --scenario full-game --fast
npm run swarm -- --target https://<your-app>.onrender.com --scenario r2-vote-burst
npm run swarm -- --target https://<your-app>.onrender.com --scenario bad-wifi
```

- Each scenario prints PASS or FAIL and server metrics.
- `bad-wifi` plays a whole game the way a pub would: about 15% of phones lose signal for 5 to 60 s (some across a phase change), 5% refresh the page, a few leave for good (including a whole crew in Round 2 and one in Round 3), some crews skip a vote, the host removes a player in Rounds 2 and 3 and a few players join late. It checks that every phone catches up within 10 s of getting signal back (prints p50/p95/max), that refreshed phones keep their seat, that every clash and wave still ends on its deadline with the default result (Truce, Rowboat) for crews that did not vote, and that the game reaches the podium. It never restarts the server; `--seed <n>` repeats the same chaos plan.
- p99 apply time must stay under 250 ms against a hosted server (50 ms locally). On the free plan (0.1 CPU) Render pauses the process for 100-200 ms at a time, which players do not notice but which can fail this bar; Starter or above should pass it comfortably.
- The swarm resets and drives the game, so **never run it during a real game**. Reset the game from `/admin` afterwards.
- One full 200-bot game uses about 40 MB of Render bandwidth. The free workspace includes 5 GB a month.

## 3. Event day

**Before players arrive:**
- 15 minutes early: open `/health`, then `/admin` (log in) and `/screen` on the projector. Keep `/admin` open all night.
- Confirm that `/health` shows `snapshotAgeSec` under 10 once the game has changed, and that `lastSnapshotOk` is `true`.
- Snapshots are written to Supabase automatically (every few seconds when the game changed, and at every phase change). For an extra copy, run `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-host>/api/admin/backup -o backup.json` before the game starts and after each round. The admin page has no backup or restore buttons.

**The admin panel** is built for a phone. The top bar always shows the phase and countdown, the venue counts, the phones connected and one server light (OK, Slow, Not reachable; **Server details** shows the raw numbers), plus the main flow button, **Skip**, and **Pause/Resume**. Below it: timer adjust (-30 s, -15 s, +15 s, +30 s, +1 min), **Join QR**, **Standings** (private), **Resync** and **Reset game** (type RESET). Tabs: **Live game** (one card for the current phase), **Crews & roster**, **Announcements**. The admin has game-flow and roster controls only; it cannot change scores, distances, honour or solved flags, and cannot rename crews.

**Running the game:**
1. Lobby: players scan the QR code, enter a name, and create or join a crew by tapping the crew's 3 emojis. Set the **crew size** (3 to 6, default 5) in `/admin` before players form crews; it is the maximum crew size for players, and phones show it. **Auto-group** builds new crews of that size; a remainder of 2 or more forms one smaller crew (a crew of 2 is possible), and a single leftover player stays unassigned for you to place with Move player (you can put anyone into any crew that has fewer than 6 members; no crew can exceed 6). Auto-group never adds players to existing crews. Crew size can only be changed in the lobby.
2. **Start Round 1.** A short briefing (about 43 s, the story plays on every phone) comes first; the 5:00 clock starts when it ends, and **Skip step** skips the briefing. At 5:00 the round closes and unsolved crews score 0. If you add, move or remove a player while Round 1 runs, that crew's tablet pieces are recomputed so each member still holds one piece.
3. **Next**: Round 1 results.
4. **Next**: Round 2 pairing. Each crew types its rival's crew code (the 3 emojis shown on the rival's phones and in the admin panel); the crew's own code is on its own screen. The clash clock starts for everyone at once when all crews are paired. Otherwise, use **Force-start clashes**; unpaired crews get the mutual-Truce points for every clash (75, 150, 225) automatically and count as Honourable (+75 m in Round 3).
5. Round 2 starts with a briefing (about 55 s, no votes), then runs on its own: 3 clashes, each one 60 s step where crews talk AND vote (voting is open the whole time, first vote is final) followed by a 15 s Reveal. There is no separate huddle or dialogue step any more (organizer ruling, Nov 4 2026). Announce each clash from the projector; every crew is on the same step.
6. **Next**: Round 2 results, then **Next** to start Round 3 (a briefing of about 62 s plays before wave 1). Each wave is one 40 s Decide step (crews talk, bluff, vote and arm the Leash; voting is open from the first second) followed by a 25 s Reveal. When every member of every crew still racing has voted, the vote closes 2 s later instead of waiting out the clock. Waves repeat until 3 crews escape. Use **End Round 3** if needed and **Trigger Sudden Death** (Live game tab, Round 3) for a standoff. The standoff lasts 40 s; then every phone shows a 12 s reveal (each crew's maneuver, then the winner on the what-beats-what triangle) before the game returns to where it was. **Skip** during the standoff jumps to the reveal; **Skip** again ends the reveal.

**At the end of the night (the front page, Underworld Wrapped and the game data):**
1. **Next** from Round 3 results presses **Finish game**. The projector (`/screen`) keeps showing the final standings and podium; it no longer shows a recap slideshow.
2. **Screenshot the front page** and post it (WhatsApp, the group chat). Every phone shows "The Underworld Times" at the top of the recap, under the final rank, with the hint "Screenshot this and share it": the medals (Gold, Silver, Bronze with the wave or Sudden Death), the Round 2 clash tiles, the Round 3 river tiles and the most treacherous crew. The host can open the same card in `/admin` (Live game tab, **Final standings** card, **Front page**, **Open the front page**); it is only available after **Finish game** and says so before. Below the front page each phone shows its own crew's cards (rank and awards, how often you betrayed, your boats and rank journey, your tablet time), then the award cards and the teaser. The words of the front page (title, kicker, headline phrases, dek, "NEXT EDITION" line) are in `games/underworld/recapContent.ts`. Phones fetch the recap once from `GET /api/recap` (it answers 404 until the game is Finished); a phone with bad signal shows a placeholder, retries by itself (with a Try again button) and keeps a copy once it has it. The recap code is a separate chunk that only loads at Finished. For a design check without a player session use `/front-page` and `/wrapped-preview?crew=N` once the game is Finished.
3. **Download the game data** before you press **Reset game**: in `/admin`, the **Final standings** card (Round 3 results and Finished) and **Server details** have **JSON** and **CSV** buttons. JSON is for analysis (crews and members, Round 1 results with wrong guesses, every Round 2 clash with each member's vote, every Round 3 wave with each member's vessel vote, Sudden Death, the phase timeline, the final standings). CSV has one row per vote or action for a spreadsheet. Both are admin-only downloads, work in any phase (partial data before the end), contain no token hashes, and the token is sent in the request header, not the address. From a terminal: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-host>/api/admin/export.json -o game.json` (or `export.csv`). Keep the file: it holds player names.
4. The recap is rebuilt from the game state, so it comes back after a server restart or a restored backup. **Reset game** removes it (phones and the projector return to the lobby).

**When something goes wrong:**

| Situation | Do this |
| --- | --- |
| Server restarts (Render, a crash, a deploy) | Wait for it to return. The game restores **paused**. Check the snapshot age in `/admin`, then press **Resume**. Phones reconnect on their own, so do not ask players to refresh. |
| Phones show "Reconnecting…" for more than about 30 seconds | Check `/health` and the venue network. Pause the game from `/admin` and announce it on the microphone. |
| A step or phase is stuck | **Skip step**, or adjust the timer ±30 s. |
| Wrong score or distance | There is no manual adjust: the admin panel cannot change scores, distances, honour bonuses or solved flags, and cannot rename crews. Scores come only from play. Only if the state itself is broken, restore the last good backup with curl (see **Restoring a backup**, below). It comes back paused. |
| Some phones look out of date | **Resync** in `/admin`. |
| `/admin` itself looks old after a deploy | Reload the page once. The service worker loads HTML from the network first (and keeps a copy for offline use), so a normal reload gets the new version. |
| Render is down | Plan B, below. |
| Everything fails | Paper scoring sheet; run the remaining rounds by hand. |

**Restoring a backup** (the `/admin` page has no backup or restore buttons; use the existing endpoints):
```bash
# take a backup (GET /api/admin/backup)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-host>/api/admin/backup -o backup.json
# restore it (POST /api/admin/restore); the game comes back PAUSED, then press Resume in /admin
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary @backup.json https://<your-host>/api/admin/restore
```
Phase durations are no longer editable from `/admin`; the server defaults apply (Round 2: VOTE 60 s, DEBRIEF 15 s; Round 3: VOTE 40 s, REVEAL 25 s). A backup or snapshot taken before the Nov 4 timing ruling still restores: a game sitting in Huddle, Dialogue or Bluff resumes in that clash's or wave's VOTE step with the old step's remaining time plus a full VOTE, and the old duration keys are converted (see `docs/RULE_DECISIONS.md`).

**Plan B (laptop):**
1. On the laptop, run `npm run build && npm run build:server`.
2. Start the server with `NODE_ENV=production ADMIN_TOKEN=… STATIC_DIR=dist node dist-server/server/index.js`. On Windows PowerShell, set the variables first with `$env:NODE_ENV='production'`, and so on.
3. Restore the latest backup with curl (see **Restoring a backup**, below).
4. Expose the laptop with `cloudflared tunnel --url http://localhost:3001` and show the new link and QR on the projector.

## 4. Never
- Never put `ADMIN_TOKEN` or the Supabase secret key in the web app, in git, or in a chat.
- Never run the swarm against a server while a real game is on.
