# Rule decisions

Organizer rulings (Areeb, Nov 1, 2026) where `GAME_MASTER_RULES_AND_DESIGN.md` contradicted itself or the Halloween code, or said nothing. **Where this file and the rules doc differ, this file wins.** Question numbers refer to `docs/AUDIT.md` section 7.

## Decided by the organizer

| # | Topic | Ruling |
| --- | --- | --- |
| Q1, Q2 | Tie-breaks | **No role breaks ties; roles have no gameplay effect.** Round 2: a tied team stance is **TRUCE**. Round 3: a tied vessel vote goes to the **safest tied vessel** (Rowboat, then Sailboat, then Ghost Ship). A team where nobody voted counts as a tie. |
| Q6 | Cerberus revenge | **Stygian Leash only.** A Betrayed crew may tether its nemesis once per game, choosing the target during the vote. Rival floats: rival −50 m, holder +50 m. Rival crashes (capsized Sailboat or collided Ghost Ship): rival −100 m, holder +100 m. Holder's own boat crashes that wave: the leash snaps, holder gains 0 m from it, the target is not penalised, and the leash is used up. The −150 m / +150 m "Treat Token" is dropped. |
| Q9 | Round 3 length | **Waves continue until 3 crews have escaped**, or every active crew has escaped. "4 scheduled waves" is the expected length, not a cap. The admin can end the round manually. |
| Q11 | Team size | **3 to 6 members, target 5.** The first five members have unique roles; a sixth member repeats a role. Round 1 slices = team size. The admin can auto-group stragglers and move players. |
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

## Confirmed later (Nov 1)

- **No Round 3 escape points.** The old code's 500/350/200/100 escape bonus is not part of the game; Round 3 changes metres only.
- **Sailboat minimum of 1:** max(1, floor(0.30 × active crews)).
- **Unpaired crews** when the admin force-starts Round 2 sit out with 0 points. The admin can still pair them by hand or auto-pair before starting.
- **Sudden Death is manual only.** It never starts automatically. When crews are tied for a medal, the host explains the rules and starts the duel from the admin panel. Ties among 3 crews are settled with successive two-crew duels started by the host.
- The unused round types `ASYMMETRIC_TEXT_PUZZLE` and `OFFLINE_TASK_TIMER` are not ported.
- The admin can still edit phase durations. Scoring values are fixed in code.
