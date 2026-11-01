# Handoff: state of the rebuild (Nov 1, 2026)

Read this first, then CLAUDE.md, docs/RULE_DECISIONS.md, docs/PROTOCOL.md and docs/RUNBOOK.md.

## Where things are
- Branch `rebuild` holds all the new work; `main` and the tag `halloween-prod` are the Halloween code, untouched.
- Phase 0 audit: docs/AUDIT.md (decision: option B). Rulings: docs/RULE_DECISIONS.md (overrides the rules doc).
- Engine: server/engine (pure reducer, all three rounds, admin). Server: server/ (node:http, SSE, per-team views, snapshots to file or Supabase). Protocol: shared/protocol.ts + docs/PROTOCOL.md. Web app: src/ rewired to src/game/useGame.tsx; old Supabase client removed. Load test: tools/swarm. Browser test: tests/e2e/fullgame.e2e.mjs.

## Verified (in a Linux sandbox without npm access)
- `npm test`: 203 tests pass. `npm run sim`: 200-player game, all invariants hold. `npm run typecheck:server` passes.
- Swarm, 200 bots, local: all 8 plan scenarios pass (join storm, round start, phase change, R2 vote burst, chaos restart, duplicates and slow readers, full game, 24-min soak). Max view 3-4 KB; about 40 MB of traffic per full game.
- Playwright full game with 11 phones + admin + /screen against an esbuild bundle (icons, confetti and QR were stubbed; Tailwind 4 used instead of 3).

## NOT verified yet (do these first)
1. `npm install`, then `npm run build` (tsc -b + vite). Fix any type errors in src/ (the client was never typechecked against real @types/react).
2. `npm run dev`, play a game in the browser (admin token in dev: `dev-admin-token-change-me`), check real Tailwind styling and lucide icon names.
3. `node tests/e2e/fullgame.e2e.mjs` with real Playwright.
4. Remove `@supabase/supabase-js` from package.json with `npm uninstall @supabase/supabase-js` (check:web already bans it in src/ and shared/). Legacy tests/test_hints_and_scoring.ts and tests/test_supabase_round2.ts import deleted files; delete or archive them.
5. Deploy per docs/RUNBOOK.md: new Supabase project for snapshots (supabase/snapshots.sql), Render free web service from render.yaml (serves API and dist/ together), then run the swarm against Render to decide free vs $7 Starter.
6. Friday Nov 6: first live test with real phones.

## Open items
- Admin view could flag Round 3 medal ties (equal points among same-wave crossers) so the host knows when to offer Sudden Death (manual only, two crews at a time).
- `// RULE-QUESTION:` comments in server/engine mark behaviour the rules doc does not cover; none block play.
