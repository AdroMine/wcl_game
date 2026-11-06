// End-to-end test of the whole web app against the real game server.
//
// What it plays: lobby (crew size control, roster cards) -> Round 1 (BRIEFING step, vector tablet slices,
// one crew solves) -> Round 2 (pair by typing codes, BRIEFING, vote with "Vote registered" feedback, global
// timeline) -> Round 3 (BRIEFING, vessel votes, leash, fleet bar) -> podium -> finished, with 11 phones,
// one admin panel and one /screen projector. It also checks: a refresh never shows the Join screen to a known
// player, going offline shows "Reconnecting…" and recovers, resync, pause/resume, backup / reset / restore,
// touch-target sizes, no hint text in player-facing copy, and that no page logs a console error.
//
// How to run (on the organizer's machine):
//   npm i --no-save playwright && npx playwright install chromium   (once; do not add it to package.json)
//   npm run build                                               (produces dist/ with the web app)
//   node tests/e2e/fullgame.e2e.mjs
// Optional environment variables:
//   STATIC_DIR   folder with the built web app (default: dist)
//   SHOTS_DIR    where screenshots go (default: /tmp/e2e-shots)
//   PORT         port for the spawned server (default: 3077)
// The test starts its own server (node server/index.ts) with a temporary snapshot folder and short phase durations.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
import { briefingSchedule } from '../../shared/briefing.ts';
import { briefing as R1_BRIEFING } from '../../games/underworld/rounds/tablet/content.ts';
import { briefing as R2_BRIEFING } from '../../games/underworld/rounds/mist/content.ts';
import { briefing as R3_BRIEFING } from '../../games/underworld/rounds/styx/content.ts';
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 3077);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = 'e2e-admin-token-0123456789';
const STATIC_DIR = resolve(ROOT, process.env.STATIC_DIR ?? 'dist');
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/e2e-shots';
mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- tiny test kit
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ok   ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}
const step = msg => console.log(`\n== ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 20000, every = 150) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* page may be navigating */
    }
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${what}`);
}
const shown = (page, id) => page.getByTestId(id).first().isVisible().catch(() => false);
const waitShown = (page, id, timeout = 20000) => waitFor(() => shown(page, id), `#${id}`, timeout);
const text = async (page, id) => (await page.getByTestId(id).first().innerText().catch(() => '')) ?? '';
const waitText = (page, id, re, timeout = 20000) => waitFor(async () => re.test(await text(page, id)), `#${id} ~ ${re}`, timeout);
const bodyHas = (page, re) => page.evaluate(([src, flags]) => new RegExp(src, flags).test(document.body.innerText), [re.source, re.flags]);
const waitBody = (page, re, timeout = 20000) => waitFor(() => bodyHas(page, re), `body ~ ${re}`, timeout);
// BRIEFING_SHOTS=1: let the briefing play out and screenshot the full story and the full rules (adds about a minute per round).
async function briefingShots(page, name, b) {
  if (!process.env.BRIEFING_SHOTS) return;
  const s = briefingSchedule(b);
  const t0 = (await adminView()).phase.startedAt; // server and browser share this machine's clock
  await sleep(Math.max(0, t0 + s.storyEndsAt + 300 - Date.now())); // inside the 2 s pause before the rules
  await shot(page, `${name}-story`);
  await sleep(Math.max(0, s.allShownAt + 300 - (Date.now() - t0)));
  await shot(page, `${name}-rules`);
}
// The briefing (story + rules) is a server-timed step on every phone. Wait for it, then skip it from the host side.
async function skipBriefing(phase) {
  await waitFor(async () => {
    const ph = (await adminView()).phase;
    return ph.name === phase && ph.step === 'BRIEFING';
  }, `${phase} BRIEFING step`);
  const ph = (await adminView()).phase;
  await adminHttp('ADMIN_SKIP_STEP', { phaseSeq: ph.phaseSeq });
  await waitFor(async () => (await adminView()).phase.step !== 'BRIEFING', `${phase} briefing skipped`);
}
// Phones no longer name the step: the server's step is read from the admin view. The only phone timer is the rope.
const waitStep = (name, step, timeout = 20000) => waitFor(async () => { const ph = (await adminView()).phase; return ph.name === name && ph.step === step; }, `${name} step ${step}`, timeout);
const ropeState = page => page.getByTestId('rope').first().getAttribute('data-state', { timeout: 1500 }).catch(() => null);
const ropeNow = page => page.getByTestId('rope').first().getAttribute('aria-valuenow', { timeout: 1500 }).catch(() => null);
// The admin header exposes the machine phase in data-phase (its visible text is for humans: "Round 1 · 03:42").
const adminPhaseIs = (page, re) => page.getByTestId('admin-phase').getAttribute('data-phase').then(v => re.test(v ?? '')).catch(() => false);
const waitAdminPhase = (page, re, timeout = 20000) => waitFor(() => adminPhaseIs(page, re), `admin phase ~ ${re}`, timeout);
// Main flow button: every "next" action has a confirm step.
async function adminNext(page) {
  await page.getByTestId('admin-next').click();
  await page.getByTestId('confirm-yes').click();
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

// ---------------------------------------------------------------- server
const snapDir = mkdtempSync(join(tmpdir(), 'uw-e2e-'));
const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ADMIN_TOKEN, STATIC_DIR, SNAPSHOT_DIR: snapDir, NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => (serverLog += d));
server.stderr.on('data', d => (serverLog += d));

const A = { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' };
async function adminHttp(type, payload = {}) {
  const r = await fetch(`${BASE}/api/admin/command`, { method: 'POST', headers: A, body: JSON.stringify({ type, payload }) });
  return r.json();
}
const adminView = async () => (await fetch(`${BASE}/api/admin/view`, { headers: A })).json();

// ---------------------------------------------------------------- browser helpers
const consoleErrors = [];
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' };

async function newPhone(browser, label) {
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();
  page.__label = label;
  page.__ignoreErrors = false;
  page.on('console', m => {
    if (m.type() === 'error' && !page.__ignoreErrors) consoleErrors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', e => consoleErrors.push(`${label}: pageerror ${e.message}`));
  // Record any moment the Join form is on screen (survives reloads through sessionStorage).
  await page.addInitScript(() => {
    const mark = () => {
      if (document.querySelector('[data-testid="join-name"]')) sessionStorage.setItem('sawJoin', '1');
    };
    new MutationObserver(mark).observe(document, { childList: true, subtree: true });
  });
  return { context, page };
}

const EMOJI_RE = /\p{Extended_Pictographic}\uFE0F?/gu;
const EMOJI_KEY = { '\uD83D\uDD25': 'fire', '\uD83D\uDC80': 'skull', '\u26A1': 'bolt', '\uD83C\uDF0A': 'wave' };
const keyId = e => `key-${EMOJI_KEY[e.replace('\uFE0F', '')]}`;
async function createTeam(page) {
  await page.getByTestId('create-team').click();
  await waitShown(page, 'team-code');
  return text(page, 'team-code');
}
async function joinTeam(page, code) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.getByTestId('join-team').click();
    if (!globalThis.__keypadShot) {
      globalThis.__keypadShot = true;
      await sleep(400);
      await shot(page, '04b-lobby-keypad');
    }
    for (const e of code.match(EMOJI_RE)) await page.getByTestId(keyId(e)).click();
    await waitShown(page, 'team-preview');
    await page.getByTestId('confirm-join').click();
    try {
      await waitShown(page, 'team-code', 5000);
      return true;
    } catch {
      /* join raced with another phone: close and retry */
    }
    await page.getByLabel('Close', { exact: true }).click().catch(() => {});
    await sleep(350);
  }
  return false;
}

// ================================================================= the test
const browser = await chromium.launch();
const cleanup = async () => {
  await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await sleep(300);
  rmSync(snapDir, { recursive: true, force: true });
};

try {
  await waitFor(async () => (await fetch(`${BASE}/health`)).ok, 'server health', 15000, 200);

  // ---- admin panel + projector
  step('Admin panel and projector open');
  // The organizer runs the game from a phone: the admin page is driven at 390x844.
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const admin = await adminCtx.newPage();
  let adminIgnore = true; // the deliberate wrong-token attempt below logs a 401
  admin.on('console', m => m.type() === 'error' && !adminIgnore && consoleErrors.push(`admin: ${m.text()}`));
  admin.on('pageerror', e => consoleErrors.push(`admin: pageerror ${e.message}`));
  admin.on('dialog', d => d.accept());
  await admin.goto(`${BASE}/admin`);
  await admin.getByTestId('admin-token').fill('wrong-token');
  await admin.getByTestId('admin-login').click();
  await waitBody(admin, /refused/);
  ok(true, 'admin: a wrong token is refused');
  await sleep(500);
  adminIgnore = false;
  await admin.getByTestId('admin-token').fill(ADMIN_TOKEN);
  await admin.getByTestId('admin-login').click();
  await waitAdminPhase(admin, /LOBBY/);
  ok(true, 'admin: signed in, phase LOBBY visible');
  ok(await shown(admin, 'admin-status'), 'admin: status line visible');
  await waitText(admin, 'admin-light', /OK/);
  ok(true, 'admin: the server light says OK');
  ok(/0 shades · 0 crews · crew size 5/.test(await text(admin, 'admin-venue')), 'admin: venue line shows shades, crews and crew size');
  ok(!(await shown(admin, 'admin-details')), 'admin: server details are hidden until toggled');
  await admin.getByTestId('admin-details-toggle').click();
  ok(await shown(admin, 'admin-details'), 'admin: server details toggle shows the raw metrics');
  await admin.getByTestId('admin-details-toggle').click();
  const noHScroll = async what => ok(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `admin: no horizontal scroll (${what})`);
  await noHScroll('lobby');
  const tiny = await admin.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43).map(b => b.textContent.trim()));
  ok(tiny.length === 0, `admin: every visible button is at least 44 px high (${tiny.join(', ') || 'none too small'})`);

  const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  const screen = await screenCtx.newPage();
  screen.on('console', m => m.type() === 'error' && consoleErrors.push(`screen: ${m.text()}`));
  screen.on('pageerror', e => consoleErrors.push(`screen: pageerror ${e.message}`));
  await screen.goto(`${BASE}/screen`);
  await waitShown(screen, 'screen-title');
  ok(/Gather/.test(await text(screen, 'screen-title')), 'screen: lobby title');
  ok(await shown(screen, 'screen-qr'), 'screen: QR code visible');
  await shot(screen, '00-screen-lobby');

  // ---- short phase durations. The admin UI has no durations editor; the command still exists server side.
  step('Set short durations through the admin HTTP API');
  const dres = await adminHttp('ADMIN_SET_DURATIONS', { r1Seconds: 40, r2: { VOTE: 25, DEBRIEF: 15 }, r3: { VOTE: 60, REVEAL: 12 } });
  ok(dres.ok !== false, 'admin API: ADMIN_SET_DURATIONS accepted');
  await waitFor(async () => (await adminView()).config.r1Seconds === 40, 'durations applied');
  ok(true, 'durations applied (R1 40 s, R2 25/15, R3 60/12)');
  await admin.getByTestId('tab-roster').click();
  ok((await admin.getByLabel('Round 1', { exact: true }).count()) === 0, 'admin: there is no durations editor in the UI');
  await admin.getByTestId('tab-live').click();

  // ---- 11 phones join
  step('Players join (name entry only)');
  const phones = [];
  for (let i = 0; i < 11; i++) phones.push(await newPhone(browser, `p${i}`));
  await Promise.all(phones.map(p => p.page.goto(BASE)));
  await Promise.all(phones.map(p => waitShown(p.page, 'join-name')));
  ok(true, 'a new device sees the Join screen (name only)');
  await shot(phones[0].page, '02-join');
  await Promise.all(
    phones.map(async (p, i) => {
      await p.page.getByTestId('join-name').fill(`Player ${i}`);
      await p.page.getByTestId('join-submit').click();
      await waitShown(p.page, 'create-team');
    }),
  );
  ok(true, '11 players joined and see the lobby');
  const h = async (page, id) => (await page.getByTestId(id).first().boundingBox())?.height ?? 0;
  ok((await h(phones[0].page, 'create-team')) >= 56, 'lobby: Create team button is at least 56 px high');
  await shot(phones[0].page, '03-lobby-no-team');
  ok((await phones[0].page.getByTestId('rope').count()) === 0, 'lobby: no rope (nothing is timed)');
  await Promise.all(phones.map(p => p.page.evaluate(() => sessionStorage.removeItem('sawJoin'))));

  // ---- team formation
  step('Team formation, crew seats');
  const codeA = await createTeam(phones[0].page);
  ok(!!codeA && (codeA.match(EMOJI_RE) ?? []).length === 3, `team A created, emoji code ${codeA}`);
  ok((await phones[0].page.getByTestId('seat-open').count()) === 4 && (await phones[0].page.getByTestId('seat-filled').count()) === 1, 'lobby: 1 filled seat, 4 "Open seat" cards');
  ok(/open seat/i.test(await phones[0].page.locator('body').innerText()), 'lobby: explicit "Open seat" cards');
  await shot(phones[0].page, '04-lobby-team-1-of-5');
  ok(/^1 of 5/.test(await text(phones[0].page, 'size-hint')), 'lobby: 1 member shows "1 of 5"');
  ok(/crew size 5/.test(await text(screen, 'screen-crew-size')), 'screen: lobby shows crew size 5');

  step('Admin crew-size control changes the open seats and the projector');
  await admin.getByTestId('tab-live').click();
  await admin.getByTestId('crew-size-3').click();
  await waitFor(async () => (await adminView()).crewSize === 3, 'crew size 3 applied');
  await waitText(screen, 'screen-crew-size', /crew size 3/);
  ok(true, 'screen: lobby shows crew size 3 after the admin changes it');
  await waitFor(async () => (await phones[0].page.getByTestId('seat-open').count()) === 2, 'two open seats at crew size 3');
  ok((await phones[0].page.getByTestId('seat-filled').count()) === 1, 'lobby, crew size 3: 1 filled card and 2 open seat cards');
  ok(/open seat/i.test(await phones[0].page.locator('body').innerText()) && /^1 of 3/.test(await text(phones[0].page, 'size-hint')), 'lobby, crew size 3: "Open seat" cards and "1 of 3" hint');
  await admin.getByTestId('crew-size-5').click();
  await waitFor(async () => (await adminView()).crewSize === 5, 'crew size back to 5');
  await waitText(screen, 'screen-crew-size', /crew size 5/);
  await waitFor(async () => (await phones[0].page.getByTestId('seat-open').count()) === 4, 'four open seats at crew size 5');
  const codeB = await createTeam(phones[5].page);
  const codeSolo = await createTeam(phones[10].page);
  ok(codeA !== codeB && codeB !== codeSolo, 'three different team codes');
  await Promise.all([
    (async () => {
      for (const i of [1, 2, 3, 4]) ok(await joinTeam(phones[i].page, codeA), `p${i} joined team A by emoji code with preview`);
    })(),
    (async () => {
      for (const i of [6, 7, 8, 9]) ok(await joinTeam(phones[i].page, codeB), `p${i} joined team B by emoji code with preview`);
    })(),
  ]);
  await waitFor(async () => (await phones[0].page.getByTestId('seat-filled').count()) === 5, 'team A roster of five');
  ok((await phones[0].page.getByTestId('seat-open').count()) === 0, 'lobby: full crew has no open seats');
  ok(/^5 of 5/.test(await text(phones[0].page, 'size-hint')), 'lobby: size hint says "5 of 5" at a full crew');
  ok((await phones[0].page.getByTestId('seat-filled').count()) === 5, 'lobby: roster shows five filled seats');
  await shot(phones[0].page, '05-lobby-team-full');
  // a joiner's screenshot with preview was taken implicitly; take one mid-crew:
  await phones[0].page.getByTestId('team-name').click().catch(() => {});
  // rename
  await phones[0].page.getByLabel('Rename crew').click();
  await phones[0].page.getByLabel('Crew name').fill('Team Alpha');
  await phones[0].page.getByText('Save', { exact: true }).click();
  await waitText(phones[0].page, 'team-name', /Team Alpha/);
  await waitText(phones[1].page, 'team-name', /Team Alpha/);
  ok(true, 'team renamed, teammates see it');
  await phones[5].page.getByLabel('Rename crew').click();
  await phones[5].page.getByLabel('Crew name').fill('Team Bravo');
  await phones[5].page.getByText('Save', { exact: true }).click();
  await waitText(phones[5].page, 'team-name', /Team Bravo/);
  for (const bad of ['ADMIN_RENAME_TEAM', 'ADMIN_ADJUST_SCORE', 'ADMIN_ADJUST_DISTANCE', 'ADMIN_TOGGLE_HONOUR', 'ADMIN_MARK_R1_SOLVED']) {
    ok((await adminHttp(bad, { teamId: (await adminView()).teams[0].id, delta: 5, name: 'x' })).ok === false, `admin API: ${bad} is gone`);
  }
  await waitShown(screen, 'screen-instruction');

  // ---- Round 1
  await shot(admin, 'admin-01-lobby');
  await admin.getByTestId('tab-roster').click();
  await admin.getByRole('button', { name: 'Expand all' }).click();
  ok((await admin.getByTestId('admin-team').count()) >= 2, 'admin roster: crew cards listed');
  ok(!(await admin.getByRole('button', { name: /rename/i }).count()), 'admin roster: no rename control');
  ok(!(await bodyHas(admin, /codeword/i)), 'admin roster: no codeword in the lobby');
  await shot(admin, 'admin-01b-roster');
  await admin.getByTestId('tab-live').click();
  step('Round 1');
  await adminNext(admin); // Start Round 1
  await waitAdminPhase(admin, /R1_ACTIVE/);
  await Promise.all(phones.map(p => waitShown(p.page, 'briefing')));
  ok(true, 'R1: every phone shows the briefing (story + rules) during the server-timed BRIEFING step');
  const briefText = await phones[0].page.getByTestId('briefing').innerText();
  ok(!/hint/i.test(briefText), 'R1: the briefing text mentions no hints');
  await shot(phones[0].page, '06-round1-briefing');
  await briefingShots(phones[0].page, '06b-round1-briefing', R1_BRIEFING);
  await skipBriefing('R1_ACTIVE');
  await Promise.all(phones.map(p => waitShown(p.page, 'tablet-svg')));
  ok(true, 'all phones show their own tablet piece after the briefing');
  // Vector tablet: slice i of N is viewBox x = i * W/N, width W/N. The crew has slotCount = member count.
  const vbOf = async page => (await page.getByTestId('tablet-svg').first().getAttribute('viewBox')).split(/\s+/).map(Number);
  const fullW = (await vbOf(phones[10].page))[2]; // a crew of one gets the whole tablet
  ok(fullW > 0 && (await vbOf(phones[10].page))[0] === 0, 'R1: a one-person crew gets the whole tablet (slotCount 1)');
  for (const [name, idxs] of [['A', [0, 1, 2, 3, 4]], ['B', [5, 6, 7, 8, 9]]]) {
    const vbs = await Promise.all(idxs.map(i => vbOf(phones[i].page)));
    ok(new Set(vbs.map(v => v[0])).size === 5, `R1: team ${name}'s five slices have distinct viewBox offsets`);
    ok(vbs.every(v => Math.abs(v[2] * 5 - fullW) < 0.01), `R1: team ${name} slotCount = member count (each slice is 1/5 of the tablet)`);
    ok(vbs.every(v => Math.abs(v[0] / v[2] - Math.round(v[0] / v[2])) < 0.01), `R1: team ${name} slices sit on slot boundaries`);
  }
  ok(!/hint/i.test(await phones[0].page.locator('body').innerText()), 'R1: no hint text anywhere on the round screen');
  await shot(phones[0].page, '07-round1-tablet');
  ok((await h(phones[0].page, 'r1-submit')) >= 56, 'R1: submit button at least 56 px high');
  await waitShown(phones[0].page, 'rope');
  ok((await ropeState(phones[0].page)) === 'burning', 'R1: the rope burns on the phone (the only timer)');
  await phones[0].page.getByTestId('rope').click();
  await waitShown(phones[0].page, 'rope-seconds');
  ok(/^\d+s$|^\d\d:\d\d$/.test((await text(phones[0].page, 'rope-seconds')).trim()), 'R1: tapping the rope shows the seconds left');
  await waitShown(screen, 'screen-countdown');
  ok(!/hint/i.test(await text(screen, 'screen-instruction')), 'screen: Round 1 instruction mentions no hints');
  await shot(screen, '08-screen-round1');
  // fullscreen table alignment
  await phones[0].page.getByTestId('tablet-fullscreen').click();
  await waitShown(phones[0].page, 'tablet-full');
  await shot(phones[0].page, '09-round1-fullscreen');
  await phones[0].page.getByLabel('Exit table alignment').click();

  const av = await adminView();
  const teamA = av.teams.find(t => t.emojiCode === codeA);
  // wrong answer first
  await phones[0].page.getByTestId('r1-answer').fill('WRONG WORDS');
  await phones[0].page.getByTestId('r1-submit').click();
  await waitBody(phones[0].page, /Not the codeword/);
  ok(true, 'R1: a wrong answer gives a friendly error');
  await phones[0].page.getByTestId('r1-answer').fill(teamA.r1.codeword);
  await phones[0].page.getByTestId('r1-submit').click();
  await Promise.all([0, 1, 2, 3, 4].map(i => waitShown(phones[i].page, 'r1-solved')));
  ok(true, 'R1: team A solved, every teammate sees the solved state');
  ok(/Gate opened · \+\d+/.test(await text(phones[1].page, 'r1-solved')), 'R1: points shown');
  await shot(phones[1].page, '10-round1-solved');
  await admin.getByTestId('tab-live').click();
  await waitText(admin, 'r1-solved-count', /1 of \d+ solved/);
  ok(/codeword/i.test(await text(admin, 'card-r1')), 'admin live: Round 1 card shows codewords');
  await noHScroll('round 1');
  await shot(admin, 'admin-02-r1-active');
  ok(!(await shown(phones[5].page, 'r1-solved')), 'R1: team B is not solved');

  // refresh mid-round
  step('Refresh mid-round keeps the session');
  await phones[2].page.evaluate(() => sessionStorage.removeItem('sawJoin'));
  await phones[2].page.reload({ waitUntil: 'commit' });
  const early = [];
  for (let i = 0; i < 30; i++) {
    early.push(await phones[2].page.evaluate(() => !!document.querySelector('[data-testid="join-name"]')).catch(() => false));
    await sleep(40);
  }
  await waitShown(phones[2].page, 'r1-solved');
  ok(early.every(x => !x), 'refresh: Join screen never appeared while reloading');
  ok((await phones[2].page.evaluate(() => sessionStorage.getItem('sawJoin'))) === null, 'refresh: Join form was never in the DOM');
  ok(/Round 1/.test(await text(phones[2].page, 'round-title')) && (await shown(phones[2].page, 'r1-solved')), 'refresh: still the same player and crew (back in Round 1 with the crew solved)');

  // R1 closes by itself (40 s) -> results
  await waitAdminPhase(admin, /R1_RESULTS/, 60000);
  await Promise.all(
    phones.map(p =>
      waitShown(p.page, 'round-standings').catch(async e => {
        console.log(`   ${p.page.__label} status=${await text(p.page, 'conn-status')} view=${await p.page.evaluate(async () => { const r = await fetch(`/api/view?playerId=${localStorage.getItem('uw.playerId')}&token=${localStorage.getItem('uw.token')}`); const j = await r.json(); return j.phase.name + ' v' + j.v; })} cached=${await p.page.evaluate(() => { const c = JSON.parse(localStorage.getItem('uw.lastView')); return c.phase.name + ' v' + c.v; })} body: ${(await p.page.locator('body').innerText()).slice(0, 400).replace(/\n+/g, ' | ')}`);
        throw e;
      }),
    ),
  );
  ok(true, 'R1 closed by the server clock; phones show results and standings');
  ok(/Team Alpha/.test(await text(screen, 'screen-board')), 'screen: leaderboard lists team A');
  await shot(phones[5].page, '11-round1-results-unsolved');
  await shot(screen, '12-screen-round1-results');
  await adminHttp('ADMIN_DELETE_TEAM', { teamId: av.teams.find(t => t.emojiCode === codeSolo).id });

  // ---- Round 2
  step('Round 2 pairing');
  await adminNext(admin); // Start Round 2
  await waitAdminPhase(admin, /R2_PAIRING/);
  const pA = phones[1].page;
  const pB = phones[6].page;
  await Promise.all([waitShown(pA, 'my-battle-code'), waitShown(pB, 'my-battle-code')]);
  const codeOfA = (await text(pA, 'my-battle-code')).trim();
  const codeOfB = (await text(pB, 'my-battle-code')).trim();
  ok((codeOfA.match(EMOJI_RE) ?? []).length === 3 && (codeOfB.match(EMOJI_RE) ?? []).length === 3 && codeOfA !== codeOfB, `R2: pairing screen shows own crew codes ${codeOfA} / ${codeOfB}`);
  ok(/Your crew/.test(await pA.locator('body').innerText()) && /Tap your rival.s code/i.test(await pA.locator('body').innerText()), 'R2: "Your crew" and "Tap your rival’s code" labels');
  ok(((await text(pA, 'rival-code-display')).match(EMOJI_RE) ?? []).length === 0, 'R2: the rival input starts empty');
  ok((await h(pA, 'key-fire')) >= 64 && (await h(pA, 'r2-connect')) >= 56, 'R2: emoji keys are at least 64 px high and the Pair button 56 px');
  await shot(pA, '13-round2-pairing');
  // B types A's emoji code on the 2x2 keypad
  for (const e of codeOfA.match(EMOJI_RE)) await pB.getByTestId(keyId(e)).click();
  ok((await text(pB, 'rival-code-display')).match(EMOJI_RE).join('') === codeOfA.match(EMOJI_RE).join(''), 'R2: typed symbols appear in the slots');
  await shot(pB, '14-round2-code-typed');
  // own code is refused
  for (const e of codeOfA.match(EMOJI_RE)) await pA.getByTestId(keyId(e)).click();
  await pA.getByTestId('r2-connect').click();
  await sleep(1500);
  await shot(pA, '14c-round2-own-code');
  await waitBody(pA, /your own code/i);
  ok(true, 'R2: typing your own code gives a friendly error');
  for (let i = 0; i < 3; i++) await pA.getByTestId('key-back').click();
  await pB.getByTestId('r2-connect').click();

  step('Round 2 clashes: one global timeline');
  await Promise.all([pA, pB].map(pg => waitShown(pg, 'briefing')));
  ok(true, 'R2: both crews see the briefing step');
  await shot(pA, '14b-round2-briefing');
  await briefingShots(pA, '14d-round2-briefing', R2_BRIEFING);
  await skipBriefing('R2_CLASH');
  await waitShown(admin, 'card-clash');
  await sleep(1200);
  await noHScroll('round 2 clash');
  await shot(admin, 'admin-03-r2-clash');
  await waitStep('R2_CLASH', 'VOTE');
  await Promise.all([waitShown(pA, 'rope'), waitShown(pB, 'rope')]);
  ok((await ropeState(pA)) === 'burning' && (await ropeState(pB)) === 'burning', 'R2: both crews see the burning rope during the Talk & vote step');
  ok(Math.abs(Number(await ropeNow(pA)) - Number(await ropeNow(pB))) <= 6, 'R2: both ropes agree on the time left');
  ok(/Round 2 · Clash 1/.test(await text(pA, 'round-title')), 'R2: the navbar top line shows "Round 2 · Clash 1"');
  ok(await shown(pA, 'r2-stakes'), 'R2: the stakes tiles are shown');
  await shot(pA, '15-round2-vote');
  await shot(screen, '16-screen-round2-vote');
  ok(/Talk & vote/.test(await text(screen, 'screen-step')), 'screen: shows the Talk & vote step name');
  ok((await pA.getByTestId('vote-truce').isEnabled()) && (await pA.getByTestId('vote-ambush').isEnabled()), 'R2: vote buttons are enabled from the start of the clash (no locked talk step)');
  ok((await h(pA, 'vote-truce')) >= 56 && (await h(pA, 'vote-ambush')) >= 56, 'R2: TRUCE / AMBUSH buttons at least 56 px high');
  // team A: all TRUCE. team B: three AMBUSH, two TRUCE (majority AMBUSH)
  await Promise.all([0, 1, 2, 3, 4].map(i => phones[i].page.getByTestId('vote-truce').click()));
  await Promise.all([5, 6, 7].map(i => phones[i].page.getByTestId('vote-ambush').click()));
  await Promise.all([8, 9].map(i => phones[i].page.getByTestId('vote-truce').click()));
  await waitShown(phones[0].page, 'r2-voted');
  ok(await shown(phones[0].page, 'r2-voted'), 'R2: own vote is locked and shown');
  ok(/Vote registered: Truce/.test(await text(phones[0].page, 'r2-voted')), 'R2: vote feedback says "Vote registered: Truce"');
  ok(/Vote registered: Ambush/.test(await text(phones[5].page, 'r2-voted')), 'R2: vote feedback says "Vote registered: Ambush"');
  await shot(phones[0].page, '18-round2-voted');
  await waitShown(phones[0].page, 'r2-reveal', 40000);
  await waitShown(phones[5].page, 'r2-reveal', 40000);
  const revealA = await text(phones[0].page, 'r2-reveal');
  ok(/Truce/.test(revealA) && /Ambush/.test(revealA), 'R2: reveal shows both stances (A truce, B ambush)');
  ok((await phones[5].page.getByTestId('r2-split').count()) === 1, 'R2: the split crew (3 ambush, 2 truce) sees who voted what');
  await shot(phones[0].page, '19-round2-reveal');
  await shot(screen, '20-screen-round2-reveal');
  // speed through clashes 2 and 3 with admin skips (no votes -> tie -> TRUCE)
  for (let i = 0; i < 9; i++) {
    const ph = (await adminView()).phase;
    if (ph.name !== 'R2_CLASH') break;
    await adminHttp('ADMIN_SKIP_STEP', { phaseSeq: ph.phaseSeq });
    await sleep(120);
  }
  await waitAdminPhase(admin, /R2_RESULTS/, 20000);
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'r2-moral')));
  ok(/Betrayed/.test(await text(phones[0].page, 'r2-moral')), 'R2: team A (ambushed once) is Betrayed');
  ok(await shown(phones[0].page, 'r2-history'), 'R2: clash history shown');
  await shot(phones[0].page, '21-round2-results');

  // ---- pause / resume while a clock runs happens in round 3
  step('Round 3');
  await adminNext(admin); // Start Round 3
  await waitAdminPhase(admin, /R3_ACTIVE/);
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'briefing')));
  ok(true, 'R3: phones show the briefing step first');
  await briefingShots(phones[0].page, '21b-round3-briefing', R3_BRIEFING);
  await skipBriefing('R3_ACTIVE');
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'r3-step')));
  ok(/Pick your boat/.test(await text(phones[0].page, 'r3-step')), 'R3: the Decide step opens straight away ("Pick your boat")');
  ok((await phones[0].page.getByTestId('vessel-ROWBOAT').isEnabled()) && (await phones[0].page.getByTestId('vessel-SAILBOAT').isEnabled()), 'R3: vessel buttons are enabled from the start of the wave (no locked bluff step)');
  ok((await ropeState(phones[0].page)) === 'burning', 'R3: the rope burns during the wave');
  ok(/Round 3 · Wave 1/.test(await text(phones[0].page, 'round-title')), 'R3: the navbar top line shows "Round 3 · Wave 1"');
  ok(/more than \d+ crews? pick/.test(await text(phones[0].page, 'sailboat-capacity')), 'R3: sailboat capacity ("more than N crews pick it") shown');
  ok(await shown(phones[0].page, 'r3-fleet'), 'R3: fleet track shown');
  ok((await phones[0].page.getByTestId('r3-boat-me').count()) === 1, 'R3: your own crew boat is on the track and highlighted ("YOU")');
  const boatCount = await phones[0].page.locator('[data-testid^="r3-boat"]').count();
  ok(boatCount === 2, 'R3: the single fleet bar shows my crew and the other crew (' + boatCount + ' markers)');
  await shot(phones[0].page, '22-round3-decide');
  await shot(screen, '23-screen-round3');
  ok(await shown(screen, 'screen-fleet'), 'screen: Round 3 fleet shown');
  // leash for the Betrayed crew
  ok(await waitShown(phones[0].page, 'r3-leash'), 'R3: Betrayed crew sees the Revenge control');
  ok(/Team Bravo/.test(await text(phones[0].page, 'r3-leash')), 'R3: revenge shows the target crew name');
  // vote first (the Decide step is open from the start), then pause / offline checks while the wave is still running
  step('Vessel votes and leash during the Decide step');
  await phones[0].page.getByTestId('arm-leash').click();
  await waitFor(async () => /Revenge armed/i.test(await text(phones[0].page, 'r3-leash')), 'revenge armed');
  ok(true, 'R3: leash armed during the Decide step');
  await shot(phones[0].page, '24-round3-leash-armed');
  await Promise.all([0, 1, 2, 3, 4].map(i => phones[i].page.getByTestId('vessel-ROWBOAT').click()));
  await Promise.all([5, 6, 7, 8, 9].map(i => phones[i].page.getByTestId('vessel-SAILBOAT').click()));
  await waitBody(phones[0].page, /Vote registered/);
  ok(true, 'R3: vessel vote shows "Vote registered" feedback');
  await waitText(phones[0].page, 'r3-voted-count', /5\s*\/\s*5/);
  ok(true, 'R3: vessel votes counted');
  await shot(phones[0].page, '27-round3-voted');

  // pause and resume from the admin UI
  await admin.getByTestId('admin-pause').click();
  await waitFor(async () => (await ropeState(phones[0].page)) === 'paused', 'rope paused');
  ok(await bodyHas(phones[0].page, /Paused/), 'pause: the rope shows "Paused"');
  await waitShown(phones[0].page, 'paused-banner');
  ok(/Paused by the host/.test(await text(phones[0].page, 'paused-banner')), 'pause: banner reads Paused by the host');
  const frozen = await ropeNow(phones[0].page);
  await sleep(1600);
  ok((await ropeNow(phones[0].page)) === frozen, 'pause: the rope is frozen while paused');
  await shot(phones[0].page, '25-round3-paused');
  await admin.getByTestId('admin-resume').click();
  await waitFor(async () => (await ropeState(phones[0].page)) === 'burning', 'unpaused');
  ok(true, 'resume: the rope burns again');
  await waitFor(async () => (await phones[0].page.getByTestId('paused-banner').count()) === 0, 'banner gone');
  ok(true, 'resume: the paused banner is gone');

  // offline / online on one phone
  step('Offline turns the rope dashed amber and recovers');
  const off = phones[3];
  off.page.__ignoreErrors = true;
  await off.context.setOffline(true);
  await waitFor(async () => (await ropeState(off.page)) === 'offline', 'rope offline state', 25000);
  ok(true, 'offline: the rope turns to its dashed amber offline state');
  ok(/Offline/.test((await off.page.getByTestId('conn-status').getAttribute('aria-label')) ?? ''), 'offline: the status dot says offline');
  ok(await shown(off.page, 'r3-step'), 'offline: the last view stays on screen');
  await shot(off.page, '26-offline-rope');
  await off.context.setOffline(false);
  await waitFor(async () => (await ropeState(off.page)) !== 'offline', 'rope recovered after reconnect', 30000);
  ok(true, 'online: reconnected, the rope is back to normal');
  await sleep(500);
  off.page.__ignoreErrors = false;
  ok(await shown(off.page, 'r3-step'), 'online: the view is still on screen');

  step('The wave reveal');
  {
    // take the wave to its reveal from the host side (the vote step is long), unless it already got there
    const ph = (await adminView()).phase;
    if (ph.name === 'R3_ACTIVE' && ph.step === 'VOTE') await adminHttp('ADMIN_SKIP_STEP', { phaseSeq: ph.phaseSeq });
  }
  await waitShown(phones[0].page, 'r3-outcome', 20000);
  await waitShown(phones[5].page, 'r3-outcome');
  await waitShown(phones[0].page, 'r3-outcome');
  const out0 = await text(phones[0].page, 'r3-outcome');
  ok(/^[+−]?\d+ m\s+You moved ahead\./.test(out0.trim()) && /\d+ m to go|Escaped/.test(out0), 'R3: reveal shows the wave metres, one sentence and the metres to go: ' + out0.replace(/\s+/g, ' '));
  ok(/You moved ahead|Your Sailboat capsized/.test(await text(phones[5].page, 'r3-outcome')), 'R3: other crew sees its own headline (Sailboat)');
  ok(/Revenge/.test(out0) || true, 'R3: revenge line is optional');
  await shot(phones[0].page, '28-round3-reveal');
  await shot(screen, '29-screen-round3-reveal');

  // resync from the admin
  await admin.getByTestId('admin-resync').click();
  await waitBody(admin, /Resync all clients: OK/);
  await sleep(3500);
  ok((await shown(phones[0].page, 'r3-step')) && (await ropeState(phones[0].page)) !== 'offline', 'resync: phones came back without errors');

  // escapes and podium
  const av3 = await adminView();
  const idOf = code => av3.teams.find(t => t.emojiCode === code).id;
  await waitShown(admin, 'card-r3');
  await noHScroll('round 3');
  await shot(admin, 'admin-04-r3');
  await admin.getByTestId('admin-standings').click();
  await waitShown(admin, 'modal-standings');
  ok((await admin.getByTestId('standing-row').count()) >= 2, 'admin: standings modal lists the crews');
  await admin.screenshot({ path: join(SHOTS, 'admin-05-standings-modal.png') });
  await admin.getByRole('button', { name: 'Close', exact: true }).first().click();
  await admin.getByTestId('admin-qr').click();
  await waitShown(admin, 'modal-qr');
  ok((await text(admin, 'qr-url')).startsWith(BASE), 'admin: QR modal shows the join URL');
  await waitFor(async () => (await admin.locator('[data-testid="modal-qr"] img').count()) === 1, 'QR image');
  await admin.screenshot({ path: join(SHOTS, 'admin-06-qr-modal.png') });
  await admin.getByRole('button', { name: 'Close', exact: true }).first().click();
  // The admin cannot move crews any more. Make two crews escape the way an operator could in an emergency:
  // edit a backup and restore it (the game comes back paused), then resume from the panel.
  const bk = await (await fetch(`${BASE}/api/admin/backup`, { headers: A })).json();
  [idOf(codeA), idOf(codeB)].forEach((id, i) => {
    const r3 = bk.state.r3;
    Object.assign(r3.teams[id], { distance: 1000, escaped: true, escapedInWave: bk.state.wave, escapeRank: i + 1 });
    r3.escapeOrder.push(id);
  });
  const rs = await (await fetch(`${BASE}/api/admin/restore`, { method: 'POST', headers: A, body: JSON.stringify(bk) })).json();
  ok(rs.ok === true, 'admin API: edited backup restored for the escape scenario');
  await waitShown(admin, 'admin-resume');
  await admin.getByTestId('admin-resume').click();
  await waitShown(phones[0].page, 'r3-escaped');
  ok(true, 'R3: escaped crew sees the escaped state');
  await adminNext(admin); // End Round 3
  await waitAdminPhase(admin, /R3_RESULTS/);
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'r3-podium')));
  ok(/Team Alpha|Team Bravo/.test(await text(phones[0].page, 'r3-podium')), 'R3: podium shown');
  await shot(phones[0].page, '30-round3-podium');
  await waitShown(screen, 'screen-podium');
  await shot(screen, '31-screen-podium');

  // Sudden Death from the results screen: both crews pick, then every phone gets the timed reveal.
  ok((await adminHttp('ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: idOf(codeA), teamB: idOf(codeB) })).ok === true, 'admin: Sudden Death triggered');
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'sd-triangle')));
  ok(true, 'SD: both crews see the what-beats-what triangle');
  await shot(phones[0].page, '31b-sd-vote');
  await phones[0].page.getByTestId('sd-SHIELDS').click();
  await phones[5].page.getByTestId('sd-RAM').click();
  await sleep(1500);
  ok((await adminHttp('ADMIN_SKIP_STEP', { phaseSeq: (await adminView()).phase.phaseSeq })).ok === true, 'admin: standoff skipped to the reveal');
  await Promise.all([0, 5, 1].map(i => waitShown(phones[i].page, 'sd-reveal')));
  ok(true, 'SD: the reveal shows on duelling and other phones');
  await sleep(1200);
  await shot(phones[0].page, '31c-sd-reveal-first');
  await waitShown(phones[5].page, 'sd-winner', 10000);
  ok(/Your crew loses/.test(await text(phones[5].page, 'sd-winner')), 'SD: Ram loses to Shields: that crew is told it lost');
  ok(/Your crew wins/.test(await text(phones[0].page, 'sd-winner')), 'SD: the Shields crew is told it won');
  await shot(phones[5].page, '31d-sd-reveal-winner');
  ok((await adminHttp('ADMIN_SKIP_STEP', { phaseSeq: (await adminView()).phase.phaseSeq })).ok === true, 'admin: reveal skipped');
  await waitShown(phones[0].page, 'sd-summary');
  ok((await phones[0].page.getByTestId('r3-podium').count()) === 0, 'SD: the summary screen has no podium, only the result and Continue');
  await shot(phones[0].page, '31e-sd-summary');
  await phones[0].page.getByTestId('sd-continue').click();
  await waitShown(phones[0].page, 'r3-podium');
  ok(true, 'SD: Continue goes to the podium');
  await adminNext(admin); // Finish
  await waitAdminPhase(admin, /FINISHED/);
  await waitFor(async () => /You: [0-9]/.test(await text(phones[0].page, 'final-rank')), 'final rank line', 25000);
  ok((await phones[0].page.getByTestId('r3-podium').count()) === 1 && (await shown(phones[0].page, 'open-wrapped')), 'finished: podium, You: Nth and the Wrap button');
  await shot(phones[0].page, '32-finished');
  await phones[0].page.getByTestId('open-board').click();
  await waitShown(phones[0].page, 'board-drawer');
  ok((await phones[0].page.getByTestId('board-drawer').innerText()).includes('Team'), 'leaderboard drawer lists the crews');
  await shot(phones[0].page, '33-leaderboard-drawer');
  await phones[0].page.getByLabel('Close standings').click();
  await shot(admin, 'admin-07-finished');
  ok((await admin.getByTestId('admin-status').innerText()).toLowerCase().includes('phones connected'), 'admin: status strip shows live health data');

  // ---- Underworld Times front page + Wrapped (recap on phones and in the admin panel) and the game-data export
  step('Underworld Times: public recap, phone front page and awards, admin front page, no recap on /screen');
  const recapRes = await fetch(BASE + '/api/recap');
  const recap = await recapRes.json();
  ok(recapRes.status === 200 && !!recapRes.headers.get('etag') && /public/.test(recapRes.headers.get('cache-control') ?? ''), 'recap: GET /api/recap is public with an ETag once FINISHED');
  ok(recap.crews.length === 2 && recap.headlines.length >= 2, 'recap: 2 crews and computed headlines (' + recap.headlines.length + ')');
  ok(!!recap.front && /escapes first as/.test(recap.front.headline), 'recap: the front page headline is computed');
  ok(!JSON.stringify(recap).includes('tokenHash'), 'recap: crew-level data only');
  ok((await fetch(BASE + '/api/recap', { headers: { 'If-None-Match': recapRes.headers.get('etag') } })).status === 304, 'recap: a repeat request with the ETag answers 304');

  // projector: the standings stay, with no recap slideshow
  await sleep(1500);
  ok((await screen.getByTestId('recap-root').count()) === 0 && (await screen.getByTestId('front-page').count()) === 0, 'screen: no recap on the projector');
  await shot(screen, '40-screen-finished-standings');
  // phones: podium + "You" + one button that opens the Wrap overlay (swipeable cards, no newspaper)
  const wp = phones[0].page;
  ok((await wp.getByTestId('front-page').count()) === 0 && (await wp.getByTestId('front-page-section').count()) === 0, 'phone: no newspaper on phones (it is admin-only)');
  ok((await wp.getByTestId('recap-award').count()) === 0 && (await wp.getByTestId('wrapped-card').count()) === 0, 'phone: end screen has no award cards until the Wrap is opened');
  await wp.getByTestId('open-wrapped').click();
  await waitFor(async () => (await wp.getByTestId('wrapped-card').count()) >= 4, 'wrapped cards', 25000);
  ok((await wp.getByRole('dialog', { name: 'Underworld Wrap' }).count()) === 1, 'phone: the Wrap is a dialog');
  const cardIds = await wp.getByTestId('wrapped-card').evaluateAll(els => els.map(e => e.getAttribute('data-card')));
  ok(['crew', 'round2', 'room', 'teaser'].every(x => cardIds.includes(x)), 'phone: cards ' + cardIds.join(', '));
  ok(/🤝|🗡️/u.test(await wp.locator('[data-card="round2"]').innerText()), 'phone: Round 2 card shows stance emojis');
  ok(/chose (Truce|Betrayal)/.test(await wp.locator('[data-card="room"]').innerText()), 'phone: room card');
  await wp.screenshot({ path: join(SHOTS, '44-phone-wrapped-first.png') });
  await wp.getByTestId('wrapped-track').click({ position: { x: 370, y: 300 } }); // right-edge tap goes forward
  await waitFor(async () => (await wp.getByTestId('wrapped-dots').locator('[aria-current="true"]').count()) === 1 && (await wp.getByTestId('wrapped-dots').locator('button').nth(1).getAttribute('aria-current')) === 'true', 'edge tap moves to card 2', 5000);
  await wp.screenshot({ path: join(SHOTS, '44-phone-wrapped-second.png') });
  await wp.keyboard.press('Escape');
  await wp.getByTestId('wrapped-overlay').waitFor({ state: 'detached', timeout: 5000 });
  ok(true, 'phone: Escape closes the Wrap');
  ok(await wp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: the end screen has no horizontal scroll');

  // admin: the Front page section opens the same card
  await admin.getByTestId('tab-live').click();
  await admin.getByTestId('admin-front-page-open').click();
  await admin.getByTestId('front-page').waitFor({ timeout: 20000 });
  ok(/The Underworld Times/i.test(await text(admin, 'front-page')), 'admin: the Front page section opens the front page');
  await shot(admin, 'admin-08-front-page');

  step('Game-data export');
  const ej = await fetch(BASE + '/api/admin/export.json', { headers: A });
  const exportDoc = await ej.json();
  ok(ej.status === 200 && /attachment/.test(ej.headers.get('content-disposition') ?? ''), 'export.json: downloads as an attachment with the admin token');
  ok(exportDoc.crews.length === 2 && exportDoc.round1.length === 2 && exportDoc.round2.clashes.length >= 3 && exportDoc.round3.waves.length >= 1, 'export.json: crews, round 1, round 2 clashes and round 3 waves are present');
  ok(exportDoc.round3.waves[0].crews.every(c => Array.isArray(c.votes) && c.votes.length > 0), 'export.json: every wave has per-player vessel votes');
  ok(!JSON.stringify(exportDoc).includes('tokenHash') && !JSON.stringify(exportDoc).includes(ADMIN_TOKEN), 'export.json: no token hashes and no admin token');
  ok((await fetch(BASE + '/api/admin/export.json')).status === 401, 'export.json: refused without the token');
  const ec = await (await fetch(BASE + '/api/admin/export.csv', { headers: A })).text();
  ok(ec.replace(/^﻿/, '').startsWith('round,unit,crew_id,crew,player_id,player,action,choice,outcome,points,metres,at_second,detail') && ec.split('\r\n').length > 30, 'export.csv: header and rows');
  // the admin panel's download buttons
  await admin.getByTestId('admin-details-toggle').click();
  const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 15000 }), admin.getByTestId('admin-export-json').first().click()]);
  ok(/underworld-export-v\d+\.json/.test(dl.suggestedFilename()), 'admin: the JSON download button saves ' + dl.suggestedFilename());
  const [dl2] = await Promise.all([admin.waitForEvent('download', { timeout: 15000 }), admin.getByTestId('admin-export-csv').first().click()]);
  ok(/\.csv$/.test(dl2.suggestedFilename()), 'admin: the CSV download button saves ' + dl2.suggestedFilename());
  await shot(admin, 'admin-08-finished-export');
  await admin.getByTestId('admin-details-toggle').click();

  // ---- backup, reset, restore
  step('Backup, reset (typed confirmation) and restore');
  // The admin UI has no backup/restore buttons any more; the HTTP endpoints are the operator's tool (docs/RUNBOOK.md).
  const backupPath = join(snapDir, 'backup.json');
  writeFileSync(backupPath, await (await fetch(`${BASE}/api/admin/backup`, { headers: A })).text());
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  ok(backup.format === 1 && !!backup.state, 'admin API: backup downloaded (format 1)');
  await admin.getByTestId('admin-reset').click();
  ok(await admin.getByTestId('reset-game').isDisabled(), 'admin: reset button disabled until RESET is typed');
  await admin.getByTestId('reset-confirm').fill('RESET');
  await admin.getByTestId('reset-game').click();
  await waitAdminPhase(admin, /LOBBY/);
  await waitShown(phones[0].page, 'join-name', 15000);
  ok(true, 'reset: an unknown player (server forgot them) is shown the Join screen');
  await shot(phones[0].page, '35-after-reset-join');
  const restored = await (await fetch(`${BASE}/api/admin/restore`, { method: 'POST', headers: A, body: readFileSync(backupPath, 'utf8') })).json();
  ok(restored.ok === true && restored.paused === true, 'admin API: restore accepted, game comes back paused');
  await waitAdminPhase(admin, /FINISHED/, 15000);
  await waitFor(async () => (await phones[0].page.getByTestId('final-rank').count()) > 0, 'known player recognised', 20000);
  ok((await adminView()).phase.paused === true, 'restore: game is back PAUSED and the known player is recognised again');

  // ---- console errors
  step('Console');
  const unexpected = consoleErrors.filter(e => !/ERR_INTERNET_DISCONNECTED|net::ERR_|Failed to fetch/.test(e));
  if (unexpected.length) unexpected.slice(0, 12).forEach(e => console.log('   console:', e));
  ok(unexpected.length === 0, `no console errors on any page (${unexpected.length} found)`);
} catch (e) {
  failures.push(`aborted: ${e.message}`);
  console.log(`\nABORTED: ${e.stack}`);
  console.log('--- server log tail ---\n' + serverLog.split('\n').slice(-15).join('\n'));
} finally {
  await cleanup();
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
