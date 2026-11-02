// Swarm CLI: 200 bots with real SSE connections against a running server.
//
//   node tools/swarm/swarm.ts --target http://127.0.0.1:3001 --admin-token <t> --bots 200 --scenario join-storm
//   node tools/swarm/swarm.ts --spawn-server --scenario all --fast
//
// Exit code: 0 all scenarios passed, 1 a scenario failed, 2 usage error or nothing could run.
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { SpawnedServer } from './context.ts';
import type { ScenarioResult, SwarmOptions } from './context.ts';
import { SCENARIOS, runScenario } from './scenarios.ts';
import type { ScenarioName } from './scenarios.ts';
import { runPractice } from './practice.ts';

function usage(): never {
  console.error(`usage: node tools/swarm/swarm.ts [options]

  --target <url>         server to test (default $TARGET_URL or http://127.0.0.1:3001)
  --admin-token <t>      ADMIN_TOKEN of that server (default $ADMIN_TOKEN)
  --spawn-server         start the server as a child process on a free port (needed for chaos-restart)
  --bots <n>             number of bots (default 200)
  --scenario <name|all>  ${SCENARIOS.join(' | ')}  (default all)
  --fast                 short phase durations (full-game always uses them); soak uses normal pace without it
  --join-seconds <n>     spread of the join storm (default 60)
  --dup-rate <0..1>      chance a command is sent again with the same commandId (default 0.1)
  --abort-rate <0..1>    chance a request is abandoned right after sending (lost response) (default 0.02)
  --scenario practice    bots fill the other crews while YOU drive /admin and play seats (needs no admin token):
                           --crews <n> (default 4)  --bots-per-crew <n> (default 3)  --leave-rival-for-humans <true|false> (default true)
                           --reset (reset the game first; needs the admin token)
  --seed <n>           random seed (default 1)
  --json <file>          also write the results as JSON
  --verbose              progress logging`);
  process.exit(2);
}

type Parsed =
  | { opts: SwarmOptions; scenarios: ScenarioName[]; practice?: undefined }
  | { opts: null; scenarios: ScenarioName[]; practice: Parameters<typeof runPractice>[0] };

function parse(argv: string[]): Parsed {
  const a: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) usage();
    const key = k.slice(2);
    if (['fast', 'spawn-server', 'verbose', 'help', 'reset'].includes(key)) a[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined) usage();
      a[key] = v;
    }
  }
  if (a.help) usage();
  const num = (k: string, d: number) => (a[k] === undefined ? d : Number(a[k]));
  const scen = String(a.scenario ?? 'all');
  if (scen === 'practice') {
    return {
      opts: null,
      scenarios: [],
      practice: {
        target: String(a.target ?? process.env.TARGET_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, ''),
        crews: num('crews', 4),
        botsPerCrew: num('bots-per-crew', 3),
        leaveRivalForHumans: String(a['leave-rival-for-humans'] ?? 'true') !== 'false',
        reset: a.reset === true,
        adminToken: String(a['admin-token'] ?? process.env.ADMIN_TOKEN ?? ''),
        seed: num('seed', 1),
        verbose: a.verbose === true,
      },
    };
  }
  const scenarios = scen === 'all' ? [...SCENARIOS] : scen.split(',').map(s => s.trim());
  for (const s of scenarios) if (!(SCENARIOS as readonly string[]).includes(s)) {
    console.error(`unknown scenario: ${s}`);
    usage();
  }
  const spawnServer = a['spawn-server'] === true;
  const opts: SwarmOptions = {
    target: String(a.target ?? process.env.TARGET_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, ''),
    adminToken: String(a['admin-token'] ?? process.env.ADMIN_TOKEN ?? (spawnServer ? randomBytes(18).toString('base64url') : '')),
    bots: num('bots', 200),
    fast: a.fast === true,
    joinSeconds: num('join-seconds', 60),
    seed: num('seed', 1),
    dupRate: num('dup-rate', 0.1),
    abortRate: num('abort-rate', 0.02),
    spawn: spawnServer,
    verbose: a.verbose === true,
    json: a.json ? String(a.json) : undefined,
  };
  if (!opts.adminToken) {
    console.error('--admin-token (or $ADMIN_TOKEN) is required unless --spawn-server is used');
    usage();
  }
  return { opts, scenarios: scenarios as ScenarioName[] };
}

function print(res: ScenarioResult): void {
  const tag = res.skipped ? 'SKIPPED' : res.pass ? 'PASS' : 'FAIL';
  console.log(`\n=== ${res.name}: ${tag} (${res.durationSec}s) ===`);
  for (const c of res.checks) console.log(`  [${c.pass ? 'ok' : 'FAIL'}] ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  const keys = Object.keys(res.numbers);
  if (keys.length) console.log(`  numbers: ${keys.map(k => `${k}=${res.numbers[k]}`).join(', ')}`);
  for (const n of res.notes) console.log(`  note: ${n}`);
}

async function main(): Promise<number> {
  const parsed = parse(process.argv.slice(2));
  if (parsed.practice) return runPractice(parsed.practice);
  const { opts, scenarios } = parsed;
  let spawned: SpawnedServer | null = null;
  const results: ScenarioResult[] = [];
  try {
    if (opts.spawn) {
      spawned = new SpawnedServer(opts.adminToken);
      await spawned.init();
      await spawned.start();
      console.log(`spawned server on ${spawned.url} (snapshots in ${spawned.dir})`);
    } else {
      const h = await fetch(`${opts.target}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!h?.ok) {
        console.error(`cannot reach ${opts.target}/health: start the server first or use --spawn-server`);
        return 2;
      }
    }
    console.log(`swarm: ${opts.bots} bots, target ${spawned?.url ?? opts.target}, scenarios: ${scenarios.join(', ')}${opts.fast ? ', fast' : ''}`);
    for (const s of scenarios) {
      // every scenario starts from a clean game on the same server
      const res = await runScenario(s, opts, spawned);
      results.push(res);
      print(res);
    }
  } finally {
    await spawned?.cleanup();
  }

  console.log('\n' + '-'.repeat(100));
  console.log('scenario'.padEnd(26) + 'result'.padEnd(9) + 'secs'.padEnd(8) + 'key numbers');
  for (const r of results) {
    const n = r.numbers;
    const key = ['p99ApplyMs', 'maxEventLoopLagMs', 'maxViewBytes', 'bytesReceivedTotalMB', 'deadlineLatencyP99ms', 'burstToViewP99ms', 'reconnectP99ms', 'gameMinutes']
      .filter(k => n[k] !== undefined)
      .map(k => `${k}=${n[k]}`)
      .join(' ');
    console.log(r.name.padEnd(26) + (r.skipped ? 'SKIPPED' : r.pass ? 'PASS' : 'FAIL').padEnd(9) + String(r.durationSec).padEnd(8) + key);
  }
  if (opts.json) await writeFile(opts.json, JSON.stringify(results, null, 2));
  const ran = results.filter(r => !r.skipped);
  if (ran.length === 0) return 2;
  return ran.every(r => r.pass) ? 0 : 1;
}

main().then(
  code => process.exit(code),
  e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
