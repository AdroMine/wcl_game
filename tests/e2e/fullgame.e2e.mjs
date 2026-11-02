// End-to-end test of the whole web app against the real game server.
//
// What it plays: lobby (crew size control, roster cards) -> Round 1 (BRIEFING step, vector tablet slices,
// one crew solves) -> Round 2 (pair by typing codes, BRIEFING, vote with "Vote registered" feedback, global
// timeline) -> Round 3 (BRIEFING, vessel votes, leash, fleet track lanes) -> podium -> finished, with 11 phones,
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
// The Round 2 step is shown by the highlighted segment of the phase bar ("Huddle", "Dialogue", "Vote", "Debrief").
const r2StepOf = page => page.getByTestId('r2-phasebar').evaluate(el => ([...el.children].find(c => /font-black/.test(c.className))?.textContent ?? '').replace(/PHASE d/i, '').trim()).catch(() => '');
const waitR2Step = (page, re, timeout = 20000) => waitFor(async () => re.test(await r2StepOf(page)), `R2 step ~ ${re}`, timeout);
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
async function createTeam(page) {
  await page.getByTestId('create-team').click();
  await waitShown(page, 'team-code');
  return text(page, 'team-code');
}
async function joinTeam(page, code) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.getByTestId('join-team').click();
    for (const e of code.match(EMOJI_RE)) await page.getByTestId(`emoji-${e}`).click();
    await waitShown(page, 'team-preview');
    const conflict = /already have/.test(await text(page, 'team-preview'));
    if (!conflict) {
      await page.getByTestId('confirm-join').click();
      try {
        await waitShown(page, 'team-code', 5000);
        return true;
      } catch {
        /* role taken in a race: close and retry */
      }
    }
    await page.getByLabel('Close', { exact: true }).click().catch(() => {});
    await page.getByTestId('reroll').click();
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
  const adminCtx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
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
  await waitText(admin, 'admin-phase', /LOBBY/);
  ok(true, 'admin: signed in, phase LOBBY visible');
  ok(await shown(admin, 'admin-status'), 'admin: status strip visible');

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
  const dres = await adminHttp('ADMIN_SET_DURATIONS', { r1Seconds: 40, r2: { HUDDLE: 8, PARLEY: 6, VOTE: 14, DEBRIEF: 8 }, r3: { BLUFF: 12, VOTE: 14, REVEAL: 8 } });
  ok(dres.ok !== false, 'admin API: ADMIN_SET_DURATIONS accepted');
  await waitFor(async () => (await adminView()).config.r1Seconds === 40, 'durations applied');
  ok(true, 'durations applied (R1 40 s, R2 8/6/14/8, R3 12/14/8)');
  await admin.getByTestId('tab-settings').click();
  ok((await admin.getByLabel('Round 1', { exact: true }).count()) === 0, 'admin: there is no durations editor in the UI');
  await shot(admin, '01-admin-settings');
  await admin.getByTestId('tab-game').click();

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
  await Promise.all(phones.map(p => p.page.evaluate(() => sessionStorage.removeItem('sawJoin'))));

  // ---- team formation
  step('Team formation, role cards, Missing Role badges');
  const codeA = await createTeam(phones[0].page);
  ok(!!codeA && (codeA.match(EMOJI_RE) ?? []).length === 3, `team A created, emoji code ${codeA}`);
  ok((await phones[0].page.getByTestId('role-card-missing').count()) === 4 && (await phones[0].page.getByTestId('role-card-filled').count()) === 1, 'lobby: 1 filled role card, 4 "Missing Role" cards');
  ok(/missing role/i.test(await phones[0].page.locator('body').innerText()), 'lobby: explicit "Missing Role" badge text');
  await shot(phones[0].page, '04-lobby-team-1-of-5');
  ok(/Need at least 3/.test(await text(phones[0].page, 'size-hint')), 'lobby: 1 member shows "Need at least 3"');
  ok(/crew size 5/.test(await text(screen, 'screen-crew-size')), 'screen: lobby shows crew size 5');

  step('Admin crew-size control changes the roster cards and the projector');
  await admin.getByTestId('tab-teams').click();
  await admin.getByTestId('crew-size-3').click();
  await waitFor(async () => (await adminView()).crewSize === 3, 'crew size 3 applied');
  await waitText(screen, 'screen-crew-size', /crew size 3/);
  ok(true, 'screen: lobby shows crew size 3 after the admin changes it');
  await waitFor(async () => (await phones[0].page.getByTestId('role-card-missing').count()) === 2, 'two open seats at crew size 3');
  ok((await phones[0].page.getByTestId('role-card-filled').count()) === 1, 'lobby, crew size 3: 1 filled card and 2 open seat cards (no named missing roles)');
  ok(/open seat/i.test(await phones[0].page.locator('body').innerText()) && /of 3 shades/i.test(await phones[0].page.locator('body').innerText()), 'lobby, crew size 3: "Open seat" cards and "of 3 Shades" header');
  await admin.getByTestId('crew-size-5').click();
  await waitFor(async () => (await adminView()).crewSize === 5, 'crew size back to 5');
  await waitText(screen, 'screen-crew-size', /crew size 5/);
  await waitFor(async () => (await phones[0].page.getByTestId('role-card-missing').count()) === 4, 'four missing roles at crew size 5');
  await admin.getByTestId('tab-game').click();
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
  await waitFor(async () => (await phones[0].page.getByTestId('role-card-filled').count()) === 5, 'team A roster of five');
  ok((await phones[0].page.getByTestId('role-card-missing').count()) === 0, 'lobby: full crew has no Missing Role cards');
  ok(/Crew full/.test(await text(phones[0].page, 'size-hint')), 'lobby: size hint says "Crew full" at five of five');
  ok(/5 of 5 shades/i.test(await phones[0].page.locator('body').innerText()), 'lobby: roster header counts "5 of 5 Shades"');
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
  await adminHttp('ADMIN_RENAME_TEAM', { teamId: (await adminView()).teams[1].id, name: 'Team Bravo' });
  await waitShown(screen, 'screen-instruction');

  // ---- Round 1
  step('Round 1');
  await admin.getByTestId('admin-next').click(); // Start Round 1
  await waitText(admin, 'admin-phase', /R1_ACTIVE/);
  await Promise.all(phones.map(p => waitShown(p.page, 'briefing')));
  ok(true, 'R1: every phone shows the briefing (story + rules) during the server-timed BRIEFING step');
  const briefText = await phones[0].page.getByTestId('briefing').innerText();
  ok(!/hint/i.test(briefText), 'R1: the briefing text mentions no hints');
  await shot(phones[0].page, '06-round1-briefing');
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
  await waitText(phones[0].page, 'countdown', /^\d\d:\d\d/);
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
  ok(/\+\d+ PTS/.test(await text(phones[1].page, 'r1-solved')), 'R1: points shown');
  await shot(phones[1].page, '10-round1-solved');
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
  ok(/Player 2|Team Alpha/.test(await phones[2].page.locator('body').innerText()), 'refresh: still the same player and crew');

  // R1 closes by itself (40 s) -> results
  await waitText(admin, 'admin-phase', /R1_RESULTS/, 60000);
  await Promise.all(
    phones.map(p =>
      waitBody(p.page, /standings/i).catch(async e => {
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
  await admin.getByTestId('admin-next').click(); // Start Round 2
  await waitText(admin, 'admin-phase', /R2_PAIRING/);
  const pA = phones[1].page;
  const pB = phones[6].page;
  await Promise.all([waitShown(pA, 'my-battle-code'), waitShown(pB, 'my-battle-code')]);
  const codeOfA = (await text(pA, 'my-battle-code')).trim();
  const codeOfB = (await text(pB, 'my-battle-code')).trim();
  ok(/^\d\d$/.test(codeOfA) && /^\d\d$/.test(codeOfB) && codeOfA !== codeOfB, `R2: two-step screen shows own codes ${codeOfA} / ${codeOfB}`);
  ok(/Step 1: Your code/i.test(await pA.locator('body').innerText()) && /Step 2: Enter rival/i.test(await pA.locator('body').innerText()), 'R2: "Step 1: Your code" and "Step 2: Enter rival\'s code" labels');
  ok(!/\d/.test(await text(pA, 'rival-code-display')), 'R2: the rival input shows no placeholder digits');
  ok(!/placeholder/.test(await pA.locator('input').evaluateAll(els => els.map(e => e.outerHTML).join('')).catch(() => '')), 'R2: no input element with a placeholder on the pairing screen');
  ok((await h(pA, 'key-5')) >= 56 && (await h(pA, 'r2-connect')) >= 56, 'R2: keypad keys and link button are at least 56 px high');
  await shot(pA, '13-round2-pairing');
  // B types A's code on the numeric keypad
  for (const d of codeOfA) await pB.getByTestId(`key-${d}`).click();
  ok((await text(pB, 'rival-code-display')).replace(/\s/g, '') === codeOfA, 'R2: typed digits appear in the boxes');
  await shot(pB, '14-round2-code-typed');
  // own code is refused
  await pA.getByTestId(`key-${codeOfA[0]}`).click();
  await pA.getByTestId(`key-${codeOfA[1]}`).click();
  await pA.getByTestId('r2-connect').click();
  await waitBody(pA, /your own code/i);
  ok(true, 'R2: typing your own code gives a friendly error');
  await pA.getByText('Clear', { exact: true }).click();
  await pB.getByTestId('r2-connect').click();

  step('Round 2 clashes: one global timeline');
  await Promise.all([pA, pB].map(pg => waitShown(pg, 'briefing')));
  ok(true, 'R2: both crews see the briefing step');
  await shot(pA, '14b-round2-briefing');
  await skipBriefing('R2_CLASH');
  await Promise.all([waitShown(pA, 'r2-step'), waitShown(pB, 'r2-step')]);
  await waitR2Step(pA, /huddle/i);
  const stepA = await r2StepOf(pA);
  const stepB = await r2StepOf(pB);
  ok(stepA === stepB, `R2: both crews are in the same step (${stepA.trim()})`);
  const clockA = await text(pA, 'countdown');
  const clockB = await text(pB, 'countdown');
  ok(Math.abs(Number(clockA.slice(3, 5)) - Number(clockB.slice(3, 5))) <= 1, `R2: countdowns agree (${clockA} / ${clockB})`);
  ok(/Clash 1 of 3/i.test(await pA.locator('body').innerText()), 'R2: clash number shown');
  await shot(pA, '15-round2-huddle');
  await shot(screen, '16-screen-round2-huddle');
  ok(/Huddle/.test(await text(screen, 'screen-step')), 'screen: shows the same step name');
  await waitR2Step(pA, /dialogue/i);
  ok(/dialogue/i.test(await r2StepOf(pB)), 'R2: PARLEY is called "Dialogue" on both crews');
  await shot(pA, '17-round2-dialogue');
  await waitR2Step(pA, /vote/i);
  ok((await h(pA, 'vote-truce')) >= 56 && (await h(pA, 'vote-ambush')) >= 56, 'R2: TRUCE / AMBUSH buttons at least 56 px high');
  // team A: all TRUCE. team B: three AMBUSH, two TRUCE (majority AMBUSH)
  await Promise.all([0, 1, 2, 3, 4].map(i => phones[i].page.getByTestId('vote-truce').click()));
  await Promise.all([5, 6, 7].map(i => phones[i].page.getByTestId('vote-ambush').click()));
  await Promise.all([8, 9].map(i => phones[i].page.getByTestId('vote-truce').click()));
  await waitBody(phones[0].page, /5 of 5 voted/);
  ok(true, 'R2: "5 of 5 voted" shown');
  ok(await shown(phones[0].page, 'r2-voted'), 'R2: own vote is locked and shown');
  ok(/Vote registered: Truce/.test(await text(phones[0].page, 'r2-voted')), 'R2: vote feedback says "Vote registered: Truce"');
  ok(/Vote registered: Ambush/.test(await text(phones[5].page, 'r2-voted')), 'R2: vote feedback says "Vote registered: Ambush"');
  await shot(phones[0].page, '18-round2-voted');
  await waitShown(phones[0].page, 'r2-reveal', 25000);
  await waitShown(phones[5].page, 'r2-reveal', 25000);
  const revealA = await text(phones[0].page, 'r2-reveal');
  ok(/Truce/.test(revealA) && /Ambush/.test(revealA), 'R2: reveal shows both stances (A truce, B ambush)');
  await shot(phones[0].page, '19-round2-reveal');
  await shot(screen, '20-screen-round2-reveal');
  // speed through clashes 2 and 3 with admin skips (no votes -> tie -> TRUCE)
  for (let i = 0; i < 9; i++) {
    const ph = (await adminView()).phase;
    if (ph.name !== 'R2_CLASH') break;
    await adminHttp('ADMIN_SKIP_STEP', { phaseSeq: ph.phaseSeq });
    await sleep(120);
  }
  await waitText(admin, 'admin-phase', /R2_RESULTS/, 20000);
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'r2-moral')));
  ok(/Betrayed/.test(await text(phones[0].page, 'r2-moral')), 'R2: team A (ambushed once) is Betrayed');
  ok(await shown(phones[0].page, 'r2-history'), 'R2: clash history shown');
  await shot(phones[0].page, '21-round2-results');

  // ---- pause / resume while a clock runs happens in round 3
  step('Round 3');
  await admin.getByTestId('admin-next').click(); // Start Round 3
  await waitText(admin, 'admin-phase', /R3_ACTIVE/);
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'briefing')));
  ok(true, 'R3: phones show the briefing step first');
  await skipBriefing('R3_ACTIVE');
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'r3-step')));
  ok(/Sailboat holds \d+ crews? this wave/.test(await text(phones[0].page, 'sailboat-capacity')), 'R3: "Sailboat holds N crews this wave" shown');
  ok(await shown(phones[0].page, 'r3-fleet'), 'R3: fleet track shown');
  ok((await phones[0].page.getByTestId('r3-boat-me').count()) === 1, 'R3: your own crew boat is on the track and highlighted ("YOU")');
  const lanes = await phones[0].page.locator('[data-testid^="r3-boat"]').evaluateAll(els => els.map(e => e.getAttribute('data-lane')));
  ok(lanes.length === 2 && new Set(lanes).size === lanes.length, `R3: two boats at the same distance sit in different lanes (${lanes.join(',')})`);
  await shot(phones[0].page, '22-round3-bluff');
  await shot(screen, '23-screen-round3');
  ok(await shown(screen, 'screen-fleet'), 'screen: Round 3 fleet shown');
  // leash for the Betrayed crew
  ok(await waitShown(phones[0].page, 'r3-leash'), 'R3: Betrayed crew sees the Stygian Leash control');
  ok(/Team Bravo/.test(await text(phones[0].page, 'r3-leash')), 'R3: leash shows the target crew name');
  // pause and resume from the admin UI
  await admin.getByTestId('admin-pause').click();
  await waitBody(phones[0].page, /Paused by the host/);
  const frozen = await text(phones[0].page, 'countdown');
  await sleep(1600);
  ok((await text(phones[0].page, 'countdown')) === frozen, 'pause: phone countdown is frozen while paused');
  await shot(phones[0].page, '25-round3-paused');
  await admin.getByTestId('admin-resume').click();
  await waitFor(async () => !(await bodyHas(phones[0].page, /Paused by the host/)), 'unpaused');
  ok(true, 'resume: banner gone');

  // offline / online on one phone
  step('Offline shows Reconnecting… and recovers');
  const off = phones[3];
  off.page.__ignoreErrors = true;
  await off.context.setOffline(true);
  await waitShown(off.page, 'reconnecting-banner', 15000);
  ok(/Reconnecting…/.test(await text(off.page, 'reconnecting-banner')), 'offline: banner says "Reconnecting…"');
  ok(await shown(off.page, 'r3-step'), 'offline: the last view stays on screen');
  await shot(off.page, '26-offline-reconnecting');
  await off.context.setOffline(false);
  await waitFor(async () => !(await shown(off.page, 'reconnecting-banner')), 'banner gone after reconnect', 30000);
  ok(true, 'online: reconnected, banner gone');
  await sleep(500);
  off.page.__ignoreErrors = false;
  ok((await text(off.page, 'r3-step')) === (await text(phones[0].page, 'r3-step')), 'online: back in sync with the other phones');

  step('Vessel votes, leash and the wave');
  await waitText(phones[0].page, 'r3-step', /Vote/, 30000);
  await phones[0].page.getByTestId('arm-leash').click();
  await waitFor(async () => /armed/i.test(await text(phones[0].page, 'r3-leash')), 'leash armed');
  ok(true, 'R3: leash armed during the vote step');
  await shot(phones[0].page, '24-round3-leash-armed');
  await Promise.all([0, 1, 2, 3, 4].map(i => phones[i].page.getByTestId('vessel-ROWBOAT').click()));
  await Promise.all([5, 6, 7, 8, 9].map(i => phones[i].page.getByTestId('vessel-SAILBOAT').click()));
  await waitBody(phones[0].page, /Vote registered/);
  ok(true, 'R3: vessel vote shows "Vote registered" feedback');
  await waitText(phones[0].page, 'r3-voted-count', /5\s*\/\s*5/);
  ok(true, 'R3: vessel votes counted');
  await shot(phones[0].page, '27-round3-voted');
  await waitText(phones[0].page, 'r3-step', /Surge Report/, 30000);
  await waitShown(phones[0].page, 'r3-lastwave');
  await waitShown(phones[5].page, 'r3-lastwave');
  const lw = await text(phones[0].page, 'r3-lastwave');
  ok(/Rowboat/.test(lw) && /m/.test(lw), 'R3: wave result for own crew (vessel and metres)');
  ok(/Sailboat/.test(await text(phones[5].page, 'r3-lastwave')), 'R3: other crew sees its own result (Sailboat)');
  await shot(phones[0].page, '28-round3-reveal');
  await shot(screen, '29-screen-round3-reveal');

  // resync from the admin
  await admin.getByTestId('admin-resync').click();
  await waitBody(admin, /Resync all clients: OK/);
  await sleep(3500);
  ok(await shown(phones[0].page, 'r3-step') && !(await shown(phones[0].page, 'reconnecting-banner')), 'resync: phones came back without errors');

  // escapes and podium
  const av3 = await adminView();
  const idOf = code => av3.teams.find(t => t.emojiCode === code).id;
  await adminHttp('ADMIN_ADJUST_DISTANCE', { teamId: idOf(codeA), delta: 1500 });
  await adminHttp('ADMIN_ADJUST_DISTANCE', { teamId: idOf(codeB), delta: 1500 });
  await waitShown(phones[0].page, 'r3-escaped');
  ok(true, 'R3: escaped crew sees the escaped state');
  await admin.getByRole('button', { name: 'End Round 3' }).click();
  await waitText(admin, 'admin-phase', /R3_RESULTS/);
  await Promise.all([0, 5].map(i => waitShown(phones[i].page, 'r3-podium')));
  ok(/Team Alpha|Team Bravo/.test(await text(phones[0].page, 'r3-podium')), 'R3: podium shown');
  await shot(phones[0].page, '30-round3-podium');
  await waitShown(screen, 'screen-podium');
  await shot(screen, '31-screen-podium');
  await admin.getByTestId('admin-next').click(); // Finish
  await waitText(admin, 'admin-phase', /FINISHED/);
  await waitShown(phones[0].page, 'final-rank');
  ok(/rank \d of 2/.test(await text(phones[0].page, 'final-rank')), 'finished: final rank shown');
  await shot(phones[0].page, '32-finished');
  await phones[0].page.getByTestId('open-board').click();
  await waitShown(phones[0].page, 'board-drawer');
  ok((await phones[0].page.getByTestId('board-drawer').innerText()).includes('Team'), 'leaderboard drawer lists the crews');
  await shot(phones[0].page, '33-leaderboard-drawer');
  await phones[0].page.getByLabel('Close standings').click();
  await shot(admin, '34-admin-finished');
  ok((await admin.getByTestId('admin-status').innerText()).toLowerCase().includes('phones connected'), 'admin: status strip shows live health data');

  // ---- backup, reset, restore
  step('Backup, reset (typed confirmation) and restore');
  // The admin UI has no backup/restore buttons any more; the HTTP endpoints are the operator's tool (docs/RUNBOOK.md).
  const backupPath = join(snapDir, 'backup.json');
  writeFileSync(backupPath, await (await fetch(`${BASE}/api/admin/backup`, { headers: A })).text());
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  ok(backup.format === 1 && !!backup.state, 'admin API: backup downloaded (format 1)');
  await admin.getByTestId('tab-settings').click();
  ok(await admin.getByTestId('reset-game').isDisabled(), 'admin: reset button disabled until RESET is typed');
  await admin.getByTestId('reset-confirm').fill('RESET');
  await admin.getByTestId('reset-game').click();
  await waitText(admin, 'admin-phase', /LOBBY/);
  await waitShown(phones[0].page, 'join-name', 15000);
  ok(true, 'reset: an unknown player (server forgot them) is shown the Join screen');
  await shot(phones[0].page, '35-after-reset-join');
  const restored = await (await fetch(`${BASE}/api/admin/restore`, { method: 'POST', headers: A, body: readFileSync(backupPath, 'utf8') })).json();
  ok(restored.ok === true && restored.paused === true, 'admin API: restore accepted, game comes back paused');
  await waitText(admin, 'admin-phase', /FINISHED/, 15000);
  await waitShown(phones[0].page, 'final-rank', 20000);
  ok(await bodyHas(phones[0].page, /Paused by the host/), 'restore: game is back PAUSED and the known player is recognised again');

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
