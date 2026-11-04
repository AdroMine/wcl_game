// CI guard: the web app and the shared protocol must never touch Supabase.
// Fails when any file under src/, shared/ or games/ imports or even mentions "supabase" (case-insensitive).
// Plain Node, no dependencies: run with `npm run check:web`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'shared', 'games'];
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html)$/i;
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(p);
    } else if (EXT.test(name)) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/supabase/i.test(line)) offenders.push(`${relative(root, p)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
}

for (const d of DIRS) {
  try {
    walk(join(root, d));
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
}

if (offenders.length) {
  console.error('check:web FAILED: Supabase must not appear in src/, shared/ or games/:');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log('check:web OK: no Supabase references in src/, shared/ or games/');
