import {
  ROUND1_HINTS,
  generateHintText,
  calculateRound1Score,
  PlayerSlotInfo,
} from './src/lib/round1Engine';
import { getAllAsciiSlices } from './src/lib/asciiEngine';
import {
  supabaseRequestRoundHint,
  supabaseSubmitRoundAnswer,
  supabaseAdminSetState,
  supabaseAdminSpawnDemoCrew,
  fetchFullSyncPayloadFromSupabase,
} from './src/lib/supabaseService';
import { supabase } from './src/lib/supabase';

async function runTests() {
  console.log('=== RUNNING ROUND 1 HINTS & SCORING TESTS ===\n');

  // 1. Verify Hint Configurations
  console.log('1. Checking Hint Configs:');
  if (ROUND1_HINTS.length !== 3) throw new Error('Expected 3 hints');
  if (ROUND1_HINTS[0].availableAfterSeconds !== 120) throw new Error('Hint 1 must be available at 120s');
  if (ROUND1_HINTS[1].availableAfterSeconds !== 180) throw new Error('Hint 2 must be available at 180s');
  if (ROUND1_HINTS[2].availableAfterSeconds !== 240) throw new Error('Hint 3 must be available at 240s');
  console.log('✓ All 3 hint time intervals confirmed (2m, 3m, 4m)\n');

  // 2. Verify Hint Text Generation
  console.log('2. Testing Hint Text Generator:');
  const slotMembers: PlayerSlotInfo[] = [
    { slotIndex: 0, playerName: 'Orpheus', roleName: 'Navigator', roleColor: '#e5cb87' },
    { slotIndex: 1, playerName: 'Elena', roleName: 'Oracle', roleColor: '#38bdf8' },
    { slotIndex: 2, playerName: 'Marcus', roleName: 'Scholar', roleColor: '#fb7185' },
    { slotIndex: 3, playerName: 'Hesper', roleName: 'Torchbearer', roleColor: '#34d399' },
    { slotIndex: 4, playerName: 'Damon', roleName: 'Negotiator', roleColor: '#c084fc' },
  ];

  const hint1Text = generateHintText(1, 5, slotMembers);
  console.log('Hint 1:', hint1Text);
  if (!hint1Text.includes('Orpheus') || !hint1Text.includes('TOP')) {
    throw new Error('Hint 1 must reveal Slot 0 / Orpheus as TOP');
  }

  const hint2Text = generateHintText(2, 5, slotMembers);
  console.log('Hint 2:', hint2Text);
  if (!hint2Text.includes('Damon') || !hint2Text.includes('BOTTOM')) {
    throw new Error('Hint 2 must reveal Slot 4 / Damon as BOTTOM');
  }

  const hint3Text = generateHintText(3, 5, slotMembers);
  console.log('Hint 3:', hint3Text);
  if (!hint3Text.includes('Marcus') || !hint3Text.includes('MIDDLE')) {
    throw new Error('Hint 3 must reveal Slot 2 / Marcus as MIDDLE');
  }
  console.log('✓ All position hint texts accurately identify Top, Bottom, and Middle players!\n');

  // 3. Verify Dynamic Scoring Formula
  console.log('3. Testing Escalating Dynamic Scoring Curve:');
  // 45s, 0 hints -> 300 pts
  const s1 = calculateRound1Score(45, 0);
  console.log('45s, 0 hints:', s1);
  if (s1.finalPoints !== 300) throw new Error(`Expected 300 pts, got ${s1.finalPoints}`);

  // 90s, 0 hints -> 250 pts
  const s2 = calculateRound1Score(90, 0);
  console.log('90s, 0 hints:', s2);
  if (s2.finalPoints !== 250) throw new Error(`Expected 250 pts, got ${s2.finalPoints}`);

  // 140s, 1 hint -> 200 base - 30 = 170 pts
  const s3 = calculateRound1Score(140, 1);
  console.log('140s, 1 hint:', s3);
  if (s3.finalPoints !== 170) throw new Error(`Expected 170 pts, got ${s3.finalPoints}`);

  // 210s, 2 hints -> 150 base - 60 = 90 pts
  const s4 = calculateRound1Score(210, 2);
  console.log('210s, 2 hints:', s4);
  if (s4.finalPoints !== 90) throw new Error(`Expected 90 pts, got ${s4.finalPoints}`);

  // 320s, 3 hints -> 100 base - 90 = 10, floored to 50 pts minimum
  const s5 = calculateRound1Score(320, 3);
  console.log('320s, 3 hints:', s5);
  if (s5.finalPoints !== 50) throw new Error(`Expected 50 pts minimum floor, got ${s5.finalPoints}`);
  console.log('✓ Dynamic escalating scoring curve verified!\n');

  // 4. Verify ASCII Edge-to-Edge Totem Slicing
  console.log('4. Testing Vector Totem Slicing for various words:');
  for (const word of ['ORACLE', 'CERBERUS', 'CHARON', 'HYDRA', 'MINOTAUR']) {
    const slices = getAllAsciiSlices(word, 5, 'HORIZONTAL');
    if (slices.length !== 5) throw new Error(`Expected 5 slices for ${word}`);
    const lineLen = slices[0][0].length;
    for (const slice of slices) {
      if (slice.length !== 3) throw new Error(`Expected 3 rows per slice for ${word}`);
      for (const line of slice) {
        if (line.length !== lineLen) throw new Error(`Inconsistent row lengths in ${word}`);
      }
    }
  }
  console.log('✓ All words resampled into uniform columns with zero row gaps!\n');

  // 5. Test Supabase Database Integration (Hints + Submission)
  console.log('5. Testing Supabase Database Hint Integration:');
  await supabaseAdminSetState('ROUND_ACTIVE', 0);
  await supabaseAdminSpawnDemoCrew();
  const { data: teams } = await supabase.from('teams').select('*').order('created_at', { ascending: false }).limit(1);
  const rawTeam = teams![0];
  const team = {
    id: rawTeam.id,
    name: rawTeam.name,
    assignedCodeword: rawTeam.assigned_codeword || 'ORACLE',
    player_ids: rawTeam.player_ids || [],
  };
  console.log('Spawned test crew:', team.name, 'Codeword:', team.assignedCodeword);

  // First confirm that Hint 1 is locked when round just started
  const lockedHintReq = await supabaseRequestRoundHint(team.id, 1);
  console.log('Immediate Hint 1 Request (should be locked):', lockedHintReq);
  if (lockedHintReq.success) throw new Error('Hint 1 should have been locked at 0s elapsed!');

  // Now simulate 130 seconds elapsed so Hint 1 unlocks
  const { data: stateRows } = await supabase.from('game_state').select('*').limit(1);
  const curState = stateRows![0];
  const updatedConfig = { ...(curState.config || {}), round_started_at: Date.now() - 130 * 1000 };
  await supabase.from('game_state').update({ config: updatedConfig }).eq('id', curState.id);

  // Request Hint 1 now that 130s has passed
  const hintReq = await supabaseRequestRoundHint(team.id, 1);
  console.log('Requested Hint 1 after 130s elapsed:', hintReq);
  if (!hintReq.success) throw new Error(`Failed to request hint: ${hintReq.error}`);
  if (!hintReq.hint?.includes('holds the TOP slice')) throw new Error('Hint text missing expected top layer content');

  // Submit correct codeword
  const leaderPlayerId = team.player_ids[0];
  const submitRes = await supabaseSubmitRoundAnswer(leaderPlayerId, 'round-1', team.assignedCodeword || 'ORACLE');
  console.log('Submission Result:', submitRes);
  if (!submitRes.success || !submitRes.isCorrect) throw new Error(`Submission failed: ${submitRes.message}`);
  if (!submitRes.points || submitRes.points <= 0) throw new Error(`Invalid points awarded: ${submitRes.points}`);

  console.log('\n ALL HINTS & SCORING TESTS PASSED PERFECTLY!');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
