import {
  generateTeamEmojiCode,
  normalizeEmojiCode,
  normalizeEmojiChar,
  formatEmojiCodeLabels,
  parseEmojiCode,
  checkTeamRoleCompatibility,
} from './src/lib/teamCodeEngine';
import { TEAM_EMOJI_POOL, TEAM_EMOJI_LABELS } from './src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('====================================================');
console.log('TEST SUITE: EMOJI TEAM CODE ENGINE & ROLE CHECKS');
console.log('====================================================\n');

// Test 1: Pool validation
console.log('Test 1: Underworld 5-Emoji Pool & Labels');
assert(TEAM_EMOJI_POOL.length === 5, 'Pool contains exactly 5 emojis');
assert(TEAM_EMOJI_POOL.includes('🔥'), 'Pool contains Flame (Fire)');
assert(TEAM_EMOJI_POOL.includes('💀'), 'Pool contains Skull');
assert(TEAM_EMOJI_POOL.includes('⚡'), 'Pool contains Bolt (Lightning)');
assert(TEAM_EMOJI_POOL.includes('🌊'), 'Pool contains Wave');
assert(TEAM_EMOJI_POOL.includes('🛡️'), 'Pool contains Shield');
assert(TEAM_EMOJI_LABELS['🔥'] === 'Fire', 'Fire label is Fire');
assert(TEAM_EMOJI_LABELS['💀'] === 'Skull', 'Skull label is Skull');
assert(TEAM_EMOJI_LABELS['⚡'] === 'Bolt', 'Bolt label is Bolt');
assert(TEAM_EMOJI_LABELS['🌊'] === 'Wave', 'Wave label is Wave');
assert(TEAM_EMOJI_LABELS['🛡️'] === 'Shield', 'Shield label is Shield');

// Test 2: Normalization
console.log('\nTest 2: Normalization and Parsing');
const codeRaw = '💀⚡🛡️';
const parsed = parseEmojiCode(codeRaw);
assert(parsed.length === 3, 'Parsed 3 emojis from 💀⚡🛡️');
assert(parsed[0] === '💀', 'First emoji is Skull');
assert(parsed[1] === '⚡', 'Second emoji is Bolt');
assert(parsed[2] === '🛡️', 'Third emoji is Shield');

const norm1 = normalizeEmojiCode('⚡');
const norm2 = normalizeEmojiCode('⚡\uFE0F');
assert(norm1 === norm2, 'Unicode variation selector is normalized away');

// Test 3: Phonetic Labels
console.log('\nTest 3: Phonetic Label Formatting');
const label1 = formatEmojiCodeLabels('💀⚡🛡️');
assert(label1 === 'Skull • Bolt • Shield', `Expected 'Skull • Bolt • Shield', got '${label1}'`);
const label2 = formatEmojiCodeLabels('🔥🌊💀');
assert(label2 === 'Fire • Wave • Skull', `Expected 'Fire • Wave • Skull', got '${label2}'`);

// Test 4: Generation and Collision Avoidance
console.log('\nTest 4: Unique Code Generation');
const generated = new Set<string>();
for (let i = 0; i < 50; i++) {
  const code = generateTeamEmojiCode(generated);
  assert(code.length >= 3, `Generated code ${code} has length >= 3`);
  assert(!generated.has(normalizeEmojiCode(code)), `Code ${code} is unique and not in existing set`);
  generated.add(normalizeEmojiCode(code));
}
assert(generated.size === 50, 'Generated 50 unique emoji team codes without collision');

// Test 5: Role Compatibility Checks
console.log('\nTest 5: Team Role Compatibility Check');
const rolesMap: Record<string, string> = {
  navigator: 'Navigator',
  oracle: 'Oracle',
  scholar: 'Scholar',
  torchbearer: 'Torchbearer',
  negotiator: 'Negotiator',
};

const teamRoles1 = ['navigator', 'oracle', 'scholar'];
const check1 = checkTeamRoleCompatibility(teamRoles1, 'torchbearer', rolesMap);
assert(check1.compatible === true, 'Torchbearer is compatible with [navigator, oracle, scholar]');

const check2 = checkTeamRoleCompatibility(teamRoles1, 'oracle', rolesMap);
assert(check2.compatible === false, 'Duplicate Oracle is rejected');
assert(check2.conflictingRoleName === 'Oracle', `Conflicting role name is 'Oracle', got '${check2.conflictingRoleName}'`);

console.log('\n====================================================');
console.log('🎉 ALL EMOJI TEAM CODE TESTS PASSED!');
console.log('====================================================\n');
