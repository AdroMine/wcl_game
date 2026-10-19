import {
  generateBattleCode,
  calculateTeamStance,
  calculateClashPoints,
  calculateNemesis,
  sanitizeMatchForPlayer,
} from './src/lib/round2Engine';
import { DEFAULT_ROUND2_CONFIG } from './src/lib/defaultConfig';
import type { Player, Round2Match, Round2Vote } from './src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✓ ${msg}`);
}

console.log('=== RUNNING ROUND 2 ENGINE TESTS ===\n');

// 1. Battle code generation
const codes = new Set<string>();
for (let i = 0; i < 50; i++) {
  const code = generateBattleCode(codes);
  assert(/^\d{2}$/.test(code), `Battle code ${code} is 2 digits`);
  assert(!codes.has(code), `Battle code ${code} is unique`);
  codes.add(code);
}

// 2. Team Stance Calculation
const playersMap = new Map<string, Player>([
  ['p1', { id: 'p1', name: 'Alice', roleId: 'negotiator', join_code: 'A1', teamId: 't1', joined_at: 0, last_seen_at: 0, is_online: true }],
  ['p2', { id: 'p2', name: 'Bob', roleId: 'tactician', join_code: 'B2', teamId: 't1', joined_at: 0, last_seen_at: 0, is_online: true }],
  ['p3', { id: 'p3', name: 'Charlie', roleId: 'scout', join_code: 'C3', teamId: 't1', joined_at: 0, last_seen_at: 0, is_online: true }],
  ['p4', { id: 'p4', name: 'Diana', roleId: 'navigator', join_code: 'D4', teamId: 't1', joined_at: 0, last_seen_at: 0, is_online: true }],
  ['p5', { id: 'p5', name: 'Eve', roleId: 'lookout', join_code: 'E5', teamId: 't1', joined_at: 0, last_seen_at: 0, is_online: true }],
]);
const memberIds = ['p1', 'p2', 'p3', 'p4', 'p5'];

// 2a. Clear Truce Majority (3 Truce, 2 Ambush)
let votes: Record<string, Round2Vote> = { p1: 'TRUCE', p2: 'TRUCE', p3: 'TRUCE', p4: 'AMBUSH', p5: 'AMBUSH' };
let stance = calculateTeamStance(votes, memberIds, playersMap);
assert(stance === 'TRUCE', 'Majority Truce yields TRUCE stance');

// 2b. Clear Ambush Majority (1 Truce, 4 Ambush)
votes = { p1: 'TRUCE', p2: 'AMBUSH', p3: 'AMBUSH', p4: 'AMBUSH', p5: 'AMBUSH' };
stance = calculateTeamStance(votes, memberIds, playersMap);
assert(stance === 'AMBUSH', 'Majority Ambush yields AMBUSH stance');

// 2c. Abstains ignored (2 Ambush, 1 Truce, 2 Abstain)
votes = { p1: 'TRUCE', p2: 'AMBUSH', p3: 'AMBUSH', p4: 'ABSTAIN', p5: 'ABSTAIN' };
stance = calculateTeamStance(votes, memberIds, playersMap);
assert(stance === 'AMBUSH', '2 Ambush vs 1 Truce with 2 Abstains yields AMBUSH');

// 2d. Tie-Breaker: 2 Truce, 2 Ambush, Negotiator (p1) votes AMBUSH
votes = { p1: 'AMBUSH', p2: 'AMBUSH', p3: 'TRUCE', p4: 'TRUCE', p5: 'ABSTAIN' };
stance = calculateTeamStance(votes, memberIds, playersMap);
assert(stance === 'AMBUSH', 'Even tie broken by Negotiator vote AMBUSH yields AMBUSH');

// 2e. Tie-Breaker: 2 Truce, 2 Ambush, Negotiator (p1) votes TRUCE
votes = { p1: 'TRUCE', p2: 'AMBUSH', p3: 'AMBUSH', p4: 'TRUCE', p5: 'ABSTAIN' };
stance = calculateTeamStance(votes, memberIds, playersMap);
assert(stance === 'TRUCE', 'Even tie broken by Negotiator vote TRUCE yields TRUCE');

// 2f. Tie-Breaker: Even tie with Negotiator abstaining or missing -> Default to TRUCE
votes = { p1: 'ABSTAIN', p2: 'AMBUSH', p3: 'AMBUSH', p4: 'TRUCE', p5: 'TRUCE' };
stance = calculateTeamStance(votes, memberIds, playersMap);
assert(stance === 'TRUCE', 'Even tie with Negotiator abstaining defaults to TRUCE');

// 3. Scoring Matrix Escalation
const matrix = DEFAULT_ROUND2_CONFIG.scoring_matrix;

// Clash 1
let pts = calculateClashPoints('TRUCE', 'TRUCE', 1, matrix);
assert(pts.team_a_pts === 75 && pts.team_b_pts === 75, 'Clash 1 Both Truce yields 75/75');

pts = calculateClashPoints('AMBUSH', 'TRUCE', 1, matrix);
assert(pts.team_a_pts === 150 && pts.team_b_pts === 0, 'Clash 1 Ambush vs Truce yields 150/0');

pts = calculateClashPoints('AMBUSH', 'AMBUSH', 1, matrix);
assert(pts.team_a_pts === 15 && pts.team_b_pts === 15, 'Clash 1 Both Ambush yields 15/15');

// Clash 2
pts = calculateClashPoints('TRUCE', 'TRUCE', 2, matrix);
assert(pts.team_a_pts === 150 && pts.team_b_pts === 150, 'Clash 2 Both Truce yields 150/150');

pts = calculateClashPoints('TRUCE', 'AMBUSH', 2, matrix);
assert(pts.team_a_pts === 0 && pts.team_b_pts === 300, 'Clash 2 Truce vs Ambush yields 0/300');

pts = calculateClashPoints('AMBUSH', 'AMBUSH', 2, matrix);
assert(pts.team_a_pts === 30 && pts.team_b_pts === 30, 'Clash 2 Both Ambush yields 30/30');

// Clash 3
pts = calculateClashPoints('TRUCE', 'TRUCE', 3, matrix);
assert(pts.team_a_pts === 225 && pts.team_b_pts === 225, 'Clash 3 Both Truce yields 225/225');

pts = calculateClashPoints('AMBUSH', 'TRUCE', 3, matrix);
assert(pts.team_a_pts === 450 && pts.team_b_pts === 0, 'Clash 3 Ambush vs Truce yields 450/0');

pts = calculateClashPoints('AMBUSH', 'AMBUSH', 3, matrix);
assert(pts.team_a_pts === 45 && pts.team_b_pts === 45, 'Clash 3 Both Ambush yields 45/45');

// 4. Nemesis Calculation
// 4a. Team B ambushes Team A 2 times, Team A ambushes Team B 0 times
let nem = calculateNemesis(
  [
    { clash: 1, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'AMBUSH', team_a_pts: 0, team_b_pts: 150 },
    { clash: 2, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'AMBUSH', team_a_pts: 0, team_b_pts: 300 },
    { clash: 3, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'TRUCE', team_a_pts: 225, team_b_pts: 225 },
  ],
  'team_alpha',
  'team_beta'
);
assert(nem.teamANemesis === 'team_beta', 'Team A has Nemesis team_beta');
assert(nem.statusA === 'NEMESIS', 'Team A status is NEMESIS');
assert(nem.statusB === 'CUNNING', 'Team B status is CUNNING');

// 4b. Both teams 0 ambushes -> Honorable Allies
nem = calculateNemesis(
  [
    { clash: 1, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'TRUCE', team_a_pts: 75, team_b_pts: 75 },
    { clash: 2, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'TRUCE', team_a_pts: 150, team_b_pts: 150 },
    { clash: 3, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'TRUCE', team_a_pts: 225, team_b_pts: 225 },
  ],
  'team_alpha',
  'team_beta'
);
assert(nem.statusA === 'ALLIES' && nem.statusB === 'ALLIES', '0 ambushes across 3 clashes yields ALLIES');

// 4c. Both teams 1 ambush -> Even Rivals
nem = calculateNemesis(
  [
    { clash: 1, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'AMBUSH', team_b_stance: 'TRUCE', team_a_pts: 150, team_b_pts: 0 },
    { clash: 2, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'AMBUSH', team_a_pts: 0, team_b_pts: 300 },
    { clash: 3, team_a_votes: {}, team_b_votes: {}, team_a_stance: 'TRUCE', team_b_stance: 'TRUCE', team_a_pts: 225, team_b_pts: 225 },
  ],
  'team_alpha',
  'team_beta'
);
assert(nem.statusA === 'RIVALS' && nem.statusB === 'RIVALS', 'Equal ambushes (>0) yields RIVALS');

// 5. Sanitization / Ballot Masking
const sampleMatch: Round2Match = {
  id: 'm1',
  session_id: 'sess_1',
  team_a_id: 'team_alpha',
  team_b_id: 'team_beta',
  current_clash: 2,
  current_phase: 'VOTE',
  phase_ends_at: Date.now() + 25000,
  clash_data: [
    {
      clash: 1,
      team_a_votes: { p1: 'TRUCE', p2: 'TRUCE' },
      team_b_votes: { p6: 'AMBUSH', p7: 'AMBUSH' },
      team_a_stance: 'TRUCE',
      team_b_stance: 'AMBUSH',
      team_a_pts: 0,
      team_b_pts: 150,
    },
    {
      clash: 2,
      team_a_votes: { p1: 'TRUCE', p2: 'AMBUSH', p3: 'TRUCE' },
      team_b_votes: { p6: 'AMBUSH', p7: 'TRUCE' },
      team_a_stance: 'TRUCE',
      team_b_stance: 'AMBUSH',
      team_a_pts: 0,
      team_b_pts: 300,
    },
  ],
  completed: false,
};

// Player p1 on team_alpha
const sanitized = sanitizeMatchForPlayer(sampleMatch, 'p1', 'team_alpha');
const clash2 = sanitized.clash_data[1];
assert(clash2.team_a_votes['p1'] === 'TRUCE', 'Player p1 sees their own vote choice');
assert(clash2.team_a_votes['p2'] === 'LOCKED', 'Teammate p2 vote is masked as LOCKED');
assert(clash2.team_a_votes['p3'] === 'LOCKED', 'Teammate p3 vote is masked as LOCKED');
assert(Object.keys(clash2.team_b_votes).length === 0, 'Opponent team_beta votes are completely hidden');

console.log('\n ALL ROUND 2 ENGINE TESTS PASSED SUCCESSFULLY!');
