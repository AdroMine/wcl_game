# Project Specification: Modular Mobile-First Pub Game Platform ("Underworld Engine")

## 1. Overview & Design Philosophy
Build a reusable, mobile-first, ultra-low-bandwidth multiplayer web application designed to facilitate live, collaborative in-person social games in crowded London pubs with poor cellular connectivity.
- **First Event Theme:** "A Journey into the Underworld" (Dark cinematic Greek mythology aesthetic: `#08090c` background, `#f4f0e8` ivory serif headers, `#c4a45a` gold accents).
- **Generic & Configurable:** All event theming, team sizes, role names/colors, and round sequences must be driven by a JSON/database configuration so the platform can be reused for future events by swapping configs and adding round components.
- **Mobile-First:** Designed exclusively for vertical smartphone screens (`max-width: 480px` centered container on desktop, not blocked on desktop).

## 2. Tech Stack & Low-Bandwidth Architecture
- **Framework:** Next.js (App Router) or Vite + React with TypeScript and Tailwind CSS.
- **Backend / Realtime State:** Supabase (Postgres + Supabase Realtime Broadcast/Postgres Changes) OR lightweight Node/Edge state store with Server-Sent Events (SSE) + automatic fallback to 10-second HTTP JSON polling if WebSocket disconnects.
- **Zero Heavy Assets:** Use pure CSS, inline SVGs, and ASCII art. Total initial JS/CSS payload must be minimal.
- **Low Internet Mode:** Include a persistent toggle in the top bar ("Low Data Mode") that strips all CSS animations, shadows, and web fonts, using pure high-contrast system UI and minimizing network heartbeats.

## 3. Session & Connection Resilience
- **No Auth Friction:** Players join by scanning a QR code, entering their Display Name, and immediately receiving a persistent `player_id` (UUID stored in `localStorage`).
- **Immortal Sessions:** A player MUST NEVER be kicked or lose their team/role due to internet disconnection, tab closing, or inactivity. Re-opening the URL automatically reconnects their `player_id` to their active server record.
- **Leaving:** Players can only leave by explicitly clicking a "Leave Game" button (with confirmation modal), or by being removed by the Admin.

## 4. Core Game States & Flow
The global `game_session` controls what every player sees on their screen:
1. `LOBBY_TEAM_FORMATION`:
   - Upon joining, the server assigns the player a Role using a balanced bucket algorithm (deals roles evenly from `config.roles`, e.g., 5 roles: Navigator, Oracle, Scholar, Torchbearer, Negotiator, each with a distinct high-contrast hex color).
   - Player screen displays a glowing color beacon card with their Role Name, a short 3-character `join_code` (e.g., `K9P`), and instructions to physically find players with the other roles.
   - **Team Assembly:** Any player can tap "Form Team" and enter the 3-character `join_code`s of their newfound teammates. (By default, requires unique roles up to `config.team_size`, unless overridden by Admin).
   - **Team Naming:** Once grouped, all members see a "Name Your Crew" input. Submitting locks the team in and shows their roster waiting for Round 1.
2. `ROUND_ACTIVE`:
   - Renders the current dynamically loaded Round Component (`rounds[current_round_index]`).
   - Displays a global server-synced countdown timer at the top (`round_ends_at - server_now`).
3. `ROUND_LEADERBOARD`:
   - Automatically displayed when a round ends (or triggered by Admin).

## 5. First Pluggable Game Module: `ASCII_SPLITTER` (The Multi-Phone Physical Puzzle)
Create a modular `rounds/` directory where each round type is a self-contained component. Implement `AsciiSplitterRound` as the flagship Round 1 module:
- **Concept:** A large multi-line ASCII art graphic (which spells out a secret 4-to-6 letter codeword when combined) is sliced into `N` fragments (where `N` = number of members in the team, e.g., 5 slices: vertical strips or 2D quadrants).
- **Asymmetric Distribution:** Each team member receives ONLY their specific slice of the ASCII art based on their team slot index.
- **iPhone & Android "Faux-Fullscreen" Alignment Mode:**
  - Because iOS Safari does not support `requestFullscreen()` on iPhone, implement a "Full Screen Alignment Mode" toggle that sets `position: fixed; inset: 0; z-index: 9999; background: #000; overflow: hidden;` and hides all browser/app UI chrome.
  - Request Screen Wake Lock (`navigator.wakeLock.request('screen')`) so phones do not dim while placed together on a pub table.
  - **Edge/Corner Anchor & Orientation Controls:** Provide floating, auto-fading controls allowing the player to:
    1. Snap their ASCII slice flush against the **Top, Bottom, Left, Right, Center, or any of the 4 Corners** of their physical screen (so phone bezels/notches don't block alignment).
    2. Rotate the ASCII slice (`0deg`, `90deg`, `180deg`, `270deg`).
    3. Adjust font-size scale (`-` / `+`) to match different phone screen sizes.
- **Codeword Submission:** Exiting Fullscreen Alignment Mode reveals an input box where any team member can submit the deciphered codeword. Correct submission awards speed-based points to the team and marks the round complete for that team.

## 6. Additional Pluggable Round Templates to Scaffold
Also scaffold clean, reusable templates for:
- `ASYMMETRIC_TEXT_PUZZLE`: Each role sees a different clue/rule on their phone (e.g., Role 1 has the map, Role 2 has the cipher key, Role 3 has the riddle) and must collaborate verbally to enter a single answer.
- `OFFLINE_TASK_TIMER`: Displays instructions and a timer for a purely physical/offline pub challenge, where either teams enter a verification code or Admin awards points directly.

## 7. Live Leaderboard Component
- Accessible at any time via a slide-up drawer/tab during rounds, and shown full-screen between rounds.
- **Fun & Celebratory UI:** Rank badges, animated position transitions, team names, role icons, and point deltas (`+150 pts`).
- **Strictly Server-Pushed:** Do NOT include a manual refresh button. Subscribe to realtime updates and display a live footer: `"Last updated: [timestamp] • Live Auto-Sync"`.

## 8. Admin Control Panel (`/admin`)
Protected by an admin passcode:
- **Game Configurator:** Set `team_size` (default 5), edit Role Names & Hex Colors, configure Round order, codewords, and default durations.
- **Player & Team Manager:**
  - View all unassigned players and formed teams.
  - **Role Switcher:** 1-tap dropdown to change any player's role (to help balance remaining players).
  - **Friend Grouping / Override:** Manually move any player into any team (even if roles duplicate or team size exceeds default) to cater to newcomer requests.
  - **Roster Cleanup:** Remove a player who left the venue, or manually add a player.
- **Live Round & Timer Controller:**
  - Start / End Round, switch active round, or trigger Leaderboard view.
  - **Dynamic Time Extension:** Instant `+1 Min`, `+2 Min`, `+5 Min`, and `-1 Min` buttons that immediately update `round_ends_at` and broadcast to all connected clients.
  - Manual score adjustment (`+` / `-` points per team for offline rounds).