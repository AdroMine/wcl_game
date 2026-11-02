# Solo testing: play the game alone before a live event

Two tools work together. `/solotester` gives you several independent phones on one screen. The `practice` swarm scenario fills the other crews with bots that play at a human pace. You drive the phases from `/admin`.

## /solotester

A grid of 3 to 6 phone frames (390 x 780, scaled to fit; the row scrolls sideways if the window is narrow). Each frame is the normal player app at `/?seat=K`, labelled "Seat K".

- Each seat is a separate player. With `?seat=K`, every `uw.*` localStorage key (identity, token, cached view, name, briefing flags, meta, clock offset) is stored as `uw.sK.*`. Without `seat` nothing changes. `seat` must be 1 to 9 digits.
- Buttons: seat count (3 to 6, remembered), Reset seats (forgets every seat's identity, then reloads the frames; confirm the dialog), Reload frames, links to `/admin` and `/screen` in new tabs.
- The page never handles the admin token and never changes game state. The Round 1 "fullscreen" is only a CSS overlay, so it works inside a frame (it fills that frame).
- After a game reset from `/admin`, seats show the Join screen again. Reset seats only matters if you want brand-new player IDs.

## Local flow

1. `npm run dev` (server on :3001, web on :5174).
2. Open `http://localhost:5174/solotester`. Join each seat and form your own crew (create in one seat, join by code in the others).
3. Open `http://localhost:5174/admin` and use the dev token `dev-admin-token-change-me`.
4. Start the bots (no admin token needed):

   ```
   npm run swarm -- --target http://localhost:3001 --scenario practice --crews 4 --bots-per-crew 3
   ```

5. Start the game from `/admin` and play. The bots follow every phase they see.

## What the practice bots do

They only join, form crews and play. They never press admin controls, and they do not reset the game unless you pass `--reset` (this one needs `--admin-token`). If the host resets the game, the bots join again on their own.

| Phase | Bot behaviour |
|---|---|
| Lobby | Bot 1 of each crew creates it, the others join by code. |
| Briefing steps | Nothing: no votes or answers. |
| Round 1 | About 80% of crews submit the codeword (read from their own tablet: line 1 + line 2) after a random delay; the rest run out the clock. |
| Round 2 pairing | Bot crews pair with each other in order (crew 1 types crew 2's code, and so on). With `--leave-rival-for-humans` (default `true`) the last bot crew never types a code and waits for you to enter its battle code. The script prints that crew's codes. An odd crew out also waits. |
| Round 2 clashes | Every bot votes TRUCE or AMBUSH (crew personality) at a random time inside the VOTE step. |
| Round 3 | Random vessel per bot, sometimes arms the leash if available. Sudden Death: random action. |

Options: `--crews <n>` (default 4), `--bots-per-crew <n>` (default 3; match your crew size if you want full crews), `--leave-rival-for-humans <true|false>`, `--reset`, `--seed <n>`. It prints one status line per phase step, runs until FINISHED, and stops on Ctrl+C. Bots must join in the lobby: start them before you start the game.

## Render flow

Same, with the Render URL:

```
npm run swarm -- --target https://<your-app>.onrender.com --scenario practice --crews 4 --bots-per-crew 3
```

Open `https://<your-app>.onrender.com/solotester` and `/admin` (real `ADMIN_TOKEN`).

**Never run this during a real game.** The bots become players in the live game and appear on the leaderboard and projector. Use `--reset` (or the admin reset) before the real event to clear them.
