# Rule decisions

Organizer rulings (Areeb, Nov 1, 2026) where `GAME_MASTER_RULES_AND_DESIGN.md` contradicted itself or the Halloween code, or said nothing. **Where this file and the rules doc differ, this file wins.** Question numbers refer to `docs/AUDIT.md` section 7.

## Decided by the organizer

| # | Topic | Ruling |
| --- | --- | --- |
| Q1, Q2 | Tie-breaks | **No role breaks ties; roles have no gameplay effect.** Round 2: a tied team stance is **TRUCE**. Round 3: a tied vessel vote goes to the **safest tied vessel** (Rowboat, then Sailboat, then Ghost Ship). A team where nobody voted counts as a tie. |
| Q6 | Cerberus revenge | **Stygian Leash only.** A Betrayed crew may tether its nemesis once per game, choosing the target during the vote. Rival floats: rival −50 m, holder +50 m. Rival crashes (capsized Sailboat or collided Ghost Ship): rival −100 m, holder +100 m. Holder's own boat crashes that wave: the leash snaps, holder gains 0 m from it, the target is not penalised, and the leash is used up. The −150 m / +150 m "Treat Token" is dropped. |
| Q9 | Round 3 length | **Waves continue until 3 crews have escaped**, or every active crew has escaped. "4 scheduled waves" is the expected length, not a cap. The admin can end the round manually. |
| Q11 | Team size | **Crew size N is set by the admin in the lobby (`ADMIN_SET_CREW_SIZE`, 3 to 6, default 5; lobby only). Organizer ruling Nov 2: no crew may ever exceed 6 members.** Players create and join crews up to N. **Auto-group** builds as many NEW crews of N as it can; a remainder of 2 or more forms one smaller crew (which can be a crew of 2: 5 players with N=3 give 3+2, 8 with N=5 give 5+3); a single leftover player stays unassigned for the admin to place (10 players with N=3 give 3+3+3 and one left over). Auto-group never adds players to existing crews. The admin can add or move a player into any crew with room under 6, whatever N is (so a crew may exceed N, never 6; full crews answer `TEAM_FULL`). Crews of 2 play normally. The first min(N, 5) members have unique roles; extra members may repeat a role (roles have no gameplay effect). **Round 1 pieces always equal the actual member count:** a crew of 2, 3, 4, 5 or 6 gets exactly that many pieces, and if crew membership changes during Round 1 (admin add, move or remove) that crew's pieces are recomputed so every current member holds a distinct piece and none is missing. A disconnect does not change membership. |
| Q13 | Round 2 pairing | **Teams link by typing the rival's emoji crew code** (replaces the 2-digit code, see the Nov 5 ruling) on a two-step screen ("Your code" / "Enter rival's code"). The global clash clock starts for every match at once, when all teams are paired or when the admin forces the start. The admin can pair teams by hand. |
| Q5 | Same-wave crossings in Round 3 | **Keep the existing 4-priority ranking**: distance overshoot, then vessel boldness (Ghost Ship > Sailboat > Rowboat), then vote unanimity, then prior R1+R2 points. **Sudden Death runs only when the admin triggers it.** |
| Q4 | Sailboat capacity | **Keep the 30% rule, rounded down** as in the doc's example: max = floor(0.30 × active crews), so 7 crews → 2, 40 crews → 12. Every phone shows "Sailboat holds N crews this wave" during the wave. Too many boarders → all of them capsize (0 m). Ghost Ship: exactly 1 crew, else all boarders −50 m. |
| Q7 | Moral status | **Doc wording.** Honourable = both crews TRUCE in all 3 clashes → +75 m Winds of Olympus. Betrayed = rival ambushed you more often than you ambushed them (holds the Leash; nemesis = that rival). Aggressor = the reverse. Blood Feud = everything else, including all-mutual-ambush matches (no bonus). |
| Q12 | Round 1 deadline | **At 5:00 the round closes.** Later submissions are rejected and unsolved teams score 0 for Round 1. |

## Kept from the existing code (the doc says nothing)

- Players who don't vote count as ABSTAIN, and abstentions are ignored when counting a majority.
- A crew's distance never drops below 0 m.
- Each hint costs 30 points and only counts if the team took it. Hints unlock 2:00, 3:00 and 4:00 after the round starts. Round 1 has a 50-point floor for any solve.
- Round 1 speed tiers are based on whole seconds elapsed: ≤60 s → 300, ≤120 → 250, ≤180 → 200, ≤240 → 150, otherwise 100.
- Round 3 head-start = min(200 m, floor(R1+R2 points / 5)), plus 75 m if Honourable.

## Organizer ruling, Nov 4 2026: shorter timings, no sub-phases

- **Round 2: one 60 s step per clash.** Each clash is a single `VOTE` step (60 s) in which crews talk to their own crew and the rival AND vote; voting is open from the first second. First vote is final; majority, tie (Truce) and scoring rules are unchanged. It is followed by the `DEBRIEF` reveal (15 s). Clash 1 still opens with the `BRIEFING` step. `HUDDLE` and `PARLEY` are no longer used. `R2_DURATIONS = { VOTE: 60, DEBRIEF: 15 }` (games/underworld/rounds/mist/content.ts), so a clash lasts 75 s.
- **Round 3: Bluff and Vote merge into one "Decide" step.** Per wave: `VOTE` (40 s, shortened from 75 s by the organizer on Nov 5; talk, bluff, vote and arm the Leash, all open from the first second) then `REVEAL` (25 s). `BLUFF` is no longer used. `R3_DURATIONS = { VOTE: 40, REVEAL: 25 }`. Wave 1 still opens with the `BRIEFING` step. Capacity, leash, escapes and Sudden Death are unchanged.
- **Old snapshots.** `HUDDLE`, `PARLEY` and `BLUFF` stay in the `StepName` type (deprecated) only so older code and snapshots still load. On restore (`normalizeRestoredState`, which runs before the restored game is paused) a game sitting in `HUDDLE` or `PARLEY` moves to that clash's `VOTE` step and one in `BLUFF` to that wave's `VOTE` step (also a Sudden Death `returnTo`). `endsAt` becomes the old step's `endsAt` plus one full new VOTE length (the old step's remaining time plus a fresh VOTE), so nobody loses voting time; recorded votes are kept. Old duration keys convert to the new shape: old default lengths (50/40/25/40 and 55/20/25) become the new defaults; lengths the host had customised are kept (new VOTE = old talk steps + old VOTE, DEBRIEF and REVEAL unchanged).
- Scoring is unchanged. `ADMIN_SET_DURATIONS` takes `r2: {VOTE, DEBRIEF}` and `r3: {VOTE, REVEAL}`.

## Confirmed later (Nov 3): admin controls

- **Game flow and roster only.** The admin has no manual score, distance, honour or solved changes, and cannot rename crews (organizer, Nov 3). `ADMIN_ADJUST_SCORE`, `ADMIN_ADJUST_DISTANCE`, `ADMIN_TOGGLE_HONOUR`, `ADMIN_MARK_R1_SOLVED` and `ADMIN_RENAME_TEAM` are removed. The admin can still pause, skip, adjust timers, pair crews, move or remove players, disband a crew in the lobby, set crew size, trigger Sudden Death and end Round 3. The admin panel is designed for a phone.

## Confirmed later (Nov 2): UI restore

- **Server-timed briefing step.** Round 1, Round 2 (before clash 1's vote, once the global clash clock starts) and Round 3 (before wave 1's vote) each open with a `BRIEFING` step whose length is computed from the word count of the round's story and rules (`briefingSchedule` in shared/briefing.ts: reading time per line, a 2 s pause before the rules, then reading time per rule box), so trimming the text shortens it. During the briefing no answers, hints or votes are accepted (`WRONG_PHASE`), and the round's real clock (the Round 1 5:00 deadline, hint unlocks and speed tiers, the Round 2 clash timers, the Round 3 wave timers) starts only when the briefing ends. **Skip step** skips the briefing. Scoring values and rules are unchanged; only the moment the clock starts moved.
- **Round 1 tablet.** Phones receive the crew's own codeword split into two lines (they draw their piece themselves). Only a crew's own phones get it, and only during Round 1.
- **Round 2 and Round 3 screens.** Phones show which teammates have voted in the current clash (never what they voted) and, once a clash is scored, how each teammate voted. Round 3 phones show the last wave's all-crews summary and whether the crew is Honourable. No scoring or rules changed.

## Confirmed later (Nov 1)

- **No Round 3 escape points.** The old code's 500/350/200/100 escape bonus is not part of the game; Round 3 changes metres only.
- **Sailboat minimum of 1:** max(1, floor(0.30 × active crews)).
- **Unpaired crews (Nov 3, 2026, organizer's ruling; replaces the earlier "sit out with 0 points").** A crew with no rival when the clashes start (an odd crew left over, or crews left unpaired when the admin force-starts) automatically receives the mutual-Truce points for every clash (`both_truce`: 75, 150, 225), credited as each clash resolves at the end of its VOTE step. At the end of Round 2 it is Honourable (the +75 m Round 3 head start), as recompense for the round it could not play; it has no rival, so no nemesis and no leash. It casts no votes. The admin can still pair crews by hand or auto-pair before starting. Stored in `r2.bye` (teamId to points per clash).
- **Sudden Death is manual only.** It never starts automatically. When crews are tied for a medal, the host explains the rules and starts the duel from the admin panel. Ties among 3 crews are settled with successive two-crew duels started by the host.
- The unused round types `ASYMMETRIC_TEXT_PUZZLE` and `OFFLINE_TASK_TIMER` are not ported.
- The admin can still edit phase durations. Scoring values are fixed in code.

## Organizer ruling, Nov 5 2026

- **Crew codes use 4 emojis, not 5.** The pool is Fire, Skull, Bolt, Wave (the shield is dropped). Codes stay 3 symbols (64 combinations); the existing 4-symbol fallback covers overflow. Snapshots whose codes contain the old shield still restore and still match on join and pairing (the shield is a legacy-accepted emblem kept apart from the generation pool).
- **Round 2 pairing uses the crew's emoji code**, not the 2-digit battle code (replaces Q13's 2-digit code). `R2_PAIR { code }` takes the rival's emoji code, normalized like `JOIN_TEAM`; errors are unchanged (`UNKNOWN_CODE`, `OWN_CODE`, `ALREADY_PAIRED`). Battle codes are no longer generated; `Team.battleCode` stays optional so old snapshots restore. The per-team view carries the rival's emoji code as `r2.rival.code`; a phone's own code is `team.emojiCode`. Joining a crew is lobby-only, so showing a code during Round 2 reveals nothing exploitable.
- **Round 3 early reveal.** During an R3 `VOTE` step, once every current member of every crew still racing (not escaped) has cast a vessel vote, the step's deadline moves to now + 2 s (never later than the existing deadline; not while paused). Revenge (Leash) can still be armed until that deadline. Round 2 is unchanged.
- **Briefing texts rewritten** (shorter, see `games/underworld/rounds/*/content.ts`). Player-facing wording: "Stygian Leash" is now **Revenge**; engine identifiers (`leash`, `R3_ARM_LEASH`, `LEASH_*`) are unchanged.

## Organizer ruling, Nov 5 2026 (later): no roles

- **Roles are removed completely.** They had no gameplay effect; players now team up with whoever they want. There is no role on a player, no role card, no re-roll (`REROLL_ROLE` is gone), no `ROLE_TAKEN` error, no role column in the export, and auto-group no longer balances by role. Q1's "no role breaks ties" and Q11's sentence about unique roles are superseded (there is simply nothing to break ties with). Old snapshots that contain a player `role` are not supported.
