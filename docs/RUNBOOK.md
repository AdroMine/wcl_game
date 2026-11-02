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

```bash
npm run swarm -- --target https://<your-app>.onrender.com --admin-token <ADMIN_TOKEN> --scenario join-storm
npm run swarm -- --target https://<your-app>.onrender.com --admin-token <ADMIN_TOKEN> --scenario full-game --fast
npm run swarm -- --target https://<your-app>.onrender.com --admin-token <ADMIN_TOKEN> --scenario r2-vote-burst
```

- Each scenario prints PASS or FAIL and server metrics.
- If p99 apply time or event-loop lag fails on the free plan, switch to Starter and rerun.
- The swarm resets and drives the game, so **never run it during a real game**. Reset the game from `/admin` afterwards.
- One full 200-bot game uses about 40 MB of Render bandwidth. The free workspace includes 5 GB a month.

## 3. Event day

**Before players arrive:**
- 15 minutes early: open `/health`, then `/admin` (log in) and `/screen` on the projector. Keep `/admin` open all night.
- Confirm that `/health` shows `snapshotAgeSec` under 10 once the game has changed, and that `lastSnapshotOk` is `true`.
- Snapshots are written to Supabase automatically (every few seconds when the game changed, and at every phase change). For an extra copy, run `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-host>/api/admin/backup -o backup.json` before the game starts and after each round. The admin page has no backup or restore buttons.

**Running the game:**
1. Lobby: players scan the QR code, enter a name, and create or join a crew by tapping the crew's 3 emojis. Set the **crew size** (3 to 6, default 5) in `/admin` before players form crews; it is the maximum crew size, and phones show it. **Auto-group** builds crews of that size and adds 1 or 2 stragglers to existing crews (a few crews may have one extra). Crew size can only be changed in the lobby.
2. **Start Round 1.** A short briefing (about 26 s, the story plays on every phone) comes first; the 5:00 clock starts when it ends, and **Skip step** skips the briefing. At 5:00 the round closes and unsolved crews score 0. If you add, move or remove a player while Round 1 runs, that crew's tablet pieces are recomputed so each member still holds one piece.
3. **Next**: Round 1 results.
4. **Next**: Round 2 pairing. Each crew types its rival's 2-digit code. The clash clock starts for everyone at once when all crews are paired. Otherwise, use **Force-start clashes**; unpaired crews sit out.
5. Round 2 starts with a briefing (about 26 s, no votes), then runs on its own: 3 clashes × Huddle 50 s / Dialogue 40 s / Vote 25 s / Reveal 40 s. Announce each step from the projector; every crew is on the same step.
6. **Next**: Round 2 results, then **Next** to start Round 3 (a briefing of about 28 s plays before wave 1). Waves repeat until 3 crews escape. Use **End Round 3** if needed and **Sudden death** for a standoff.

**When something goes wrong:**

| Situation | Do this |
| --- | --- |
| Server restarts (Render, a crash, a deploy) | Wait for it to return. The game restores **paused**. Check the snapshot age in `/admin`, then press **Resume**. Phones reconnect on their own, so do not ask players to refresh. |
| Phones show "Reconnecting…" for more than about 30 seconds | Check `/health` and the venue network. Pause the game from `/admin` and announce it on the microphone. |
| A step or phase is stuck | **Skip step**, or adjust the timer ±30 s. |
| Wrong score or distance | Adjust it in `/admin`. If the state itself is broken, restore the last good backup with curl (see **Restoring a backup**, below). It comes back paused. |
| Some phones look out of date | **Resync all** in `/admin`. |
| Render is down | Plan B, below. |
| Everything fails | Paper scoring sheet; run the remaining rounds by hand. |

**Restoring a backup** (the `/admin` page has no backup or restore buttons; use the existing endpoints):
```bash
# take a backup (GET /api/admin/backup)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-host>/api/admin/backup -o backup.json
# restore it (POST /api/admin/restore); the game comes back PAUSED, then press Resume in /admin
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary @backup.json https://<your-host>/api/admin/restore
```
Phase durations are no longer editable from `/admin`; the server defaults apply.

**Plan B (laptop):**
1. On the laptop, run `npm run build && npm run build:server`.
2. Start the server with `NODE_ENV=production ADMIN_TOKEN=… STATIC_DIR=dist node dist-server/server/index.js`. On Windows PowerShell, set the variables first with `$env:NODE_ENV='production'`, and so on.
3. Restore the latest backup with curl (see **Restoring a backup**, below).
4. Expose the laptop with `cloudflared tunnel --url http://localhost:3001` and show the new link and QR on the projector.

## 4. Never
- Never put `ADMIN_TOKEN` or the Supabase secret key in the web app, in git, or in a chat.
- Never run the swarm against a server while a real game is on.
