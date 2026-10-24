import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const suites = [
  { name: 'Team Codes & Roles', file: 'test_team_codes.ts' },
  { name: 'Round 2 (Prisoner\'s Dilemma)', file: 'test_round2.ts' },
  { name: 'Round 3 (Odyssey Escape Royale)', file: 'test_round3.ts' },
];

console.log('\n🏛️  RUNNING UNDERWORLD ENGINE TEST SUITE');
console.log('====================================================\n');

let allPassed = true;

for (const suite of suites) {
  console.log(`▶ Running Suite: ${suite.name} (${suite.file})...`);
  const relativePath = path.join('tests', suite.file);
  const result = spawnSync(`npx tsx "${relativePath}"`, {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`\n❌ Suite FAILED: ${suite.name}\n`);
    allPassed = false;
    break;
  }
  console.log(`\n✔ Suite PASSED: ${suite.name}\n----------------------------------------------------\n`);
}

if (!allPassed) {
  console.error('💥 Test suite execution failed!');
  process.exit(1);
} else {
  console.log('🎉 ALL ENGINE TEST SUITES PASSED SUCCESSFULLY!\n');
}
