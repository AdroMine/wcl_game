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

## Verified on the organizer's Windows machine (Nov 1, Node 24.18)
- `npm install` and `npm run build` pass with no type errors; `npm run build:server`, `typecheck:server`, `check:web` pass.
- `npm test` 203/203 (the per-IP rate-limit test now starts its 400 requests in waves of 50: the Windows loopback accept queue refused ~170 of a single same-process burst). `npm run sim` and `npm run test:legacy` pass.
- Production build served locally (`NODE_ENV=production`, `STATIC_DIR=dist`): 200-bot `full-game --fast` swarm PASS, p99 apply 2.4 ms, max view 1.8 KB, ~31 MB traffic.
- `@supabase/supabase-js` uninstalled; the two legacy tests that imported deleted files are removed.

## NOT verified yet (do these first)
2. `npm run dev`, play a game in the browser (admin token in dev: `dev-admin-token-change-me`), check real Tailwind styling and lucide icon names.
3. `node tests/e2e/fullgame.e2e.mjs` with real Playwright.
5. Deploy per docs/RUNBOOK.md: new Supabase project for snapshots (supabase/snapshots.sql), Render free web service from render.yaml (serves API and dist/ together), then run the swarm against Render to decide free vs $7 Starter.
6. Friday Nov 6: first live test with real phones.

## Open items
- Admin view could flag Round 3 medal ties (equal points among same-wave crossers) so the host knows when to offer Sudden Death (manual only, two crews at a time).
- `// RULE-QUESTION:` comments in server/engine mark behaviour the rules doc does not cover; none block play.
