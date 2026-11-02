# Rule decisions

Organizer rulings (Areeb, Nov 1, 2026) where `GAME_MASTER_RULES_AND_DESIGN.md` contradicted itself or the Halloween code, or said nothing. **Where this file and the rules doc differ, this file wins.** Question numbers refer to `docs/AUDIT.md` section 7.

## Decided by the organizer

| # | Topic | Ruling |
| --- | --- | --- |
| Q1, Q2 | Tie-breaks | **No role breaks ties; roles have no gameplay effect.** Round 2: a tied team stance is **TRUCE**. Round 3: a tied vessel vote goes to the **safest tied vessel** (Rowboat, then Sailboat, then Ghost Ship). A team where nobody voted counts as a tie. |
| Q6 | Cerberus revenge | **Stygian Leash only.** A Betrayed crew may tether its nemesis once per game, choosing the target during the vote. Rival floats: rival −50 m, holder +50 m. Rival crashes (capsized Sailboat or collided Ghost Ship): rival −100 m, holder +100 m. Holder's own boat crashes that wave: the leash snaps, holder gains 0 m from it, the target is not penalised, and the leash is used up. The −150 m / +150 m "Treat Token" is dropped. |
| Q9 | Round 3 length | **Waves continue until 3 crews have escaped**, or every active crew has escaped. "4 scheduled waves" is the expected length, not a cap. The admin can end the round manually. |
| Q11 | Team size | **Crew size N is set by the admin in the lobby (`ADMIN_SET_CREW_SIZE`, 3 to 6, default 5; lobby only). Organizer ruling Nov 2: no crew may ever exceed 6 members.** Players create and join crews up to N. **Auto-group** builds as many NEW crews of N as it can; a remainder of 2 or more forms one smaller crew (which can be a crew of 2: 5 players with N=3 give 3+2, 8 with N=5 give 5+3); a single leftover player stays unassigned for the admin to place (10 players with N=3 give 3+3+3 and one left over). Auto-group never adds players to existing crews. The admin can add or move a player into any crew with room under 6, whatever N is (so a crew may exceed N, never 6; full crews answer `TEAM_FULL`). Crews of 2 play normally. The first min(N, 5) members have unique roles; extra members may repeat a role (roles have no gameplay effect). **Round 1 pieces always equal the actual member count:** a crew of 2, 3, 4, 5 or 6 gets exactly that many pieces, and if crew membership changes during Round 1 (admin add, move or remove) that crew's pieces are recomputed so every current member holds a distinct piece and none is missing. A disconnect does not change membership. |
| Q13 | Round 2 pairing | **Teams link by typing the rival's 2-digit code** on a two-step screen ("Your code" / "Enter rival's code", no placeholder digits). The global clash clock starts for every match at once, when all teams are paired or when the admin forces the start. The admin can pair teams by hand. |
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

## Confirmed later (Nov 2): UI restore

- **Server-timed briefing step.** Round 1, Round 2 (before clash 1's huddle, once the global clash clock starts) and Round 3 (before wave 1's Bluff) each open with a `BRIEFING` step whose length is computed from the round's story and rules: `ceil(sentences * 2.8 + 3 + (rules + 1) * 2 + 3)` seconds (26 s, 26 s and 28 s with the current text). During the briefing no answers, hints or votes are accepted (`WRONG_PHASE`), and the round's real clock (the Round 1 5:00 deadline, hint unlocks and speed tiers, the Round 2 clash timers, the Round 3 wave timers) starts only when the briefing ends. **Skip step** skips the briefing. Scoring values and rules are unchanged; only the moment the clock starts moved.
- **Round 1 tablet.** Phones receive the crew's own codeword split into two lines (they draw their piece themselves). Only a crew's own phones get it, and only during Round 1.
- **Round 2 and Round 3 screens.** Phones show which teammates have voted in the current clash (never what they voted) and, once a clash is scored, how each teammate voted. Round 3 phones show the last wave's all-crews summary and whether the crew is Honourable. No scoring or rules changed.

## Confirmed later (Nov 1)

- **No Round 3 escape points.** The old code's 500/350/200/100 escape bonus is not part of the game; Round 3 changes metres only.
- **Sailboat minimum of 1:** max(1, floor(0.30 × active crews)).
- **Unpaired crews** when the admin force-starts Round 2 sit out with 0 points. The admin can still pair them by hand or auto-pair before starting.
- **Sudden Death is manual only.** It never starts automatically. When crews are tied for a medal, the host explains the rules and starts the duel from the admin panel. Ties among 3 crews are settled with successive two-crew duels started by the host.
- The unused round types `ASYMMETRIC_TEXT_PUZZLE` and `OFFLINE_TASK_TIMER` are not ported.
- The admin can still edit phase durations. Scoring values are fixed in code.
