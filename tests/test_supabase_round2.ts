import {
  fetchFullSyncPayloadFromSupabase,
  supabaseRound2PairByCode,
  supabaseRound2CastVote,
  supabaseRound2AdvancePhase,
  supabaseAdminRound2AdjustTimer,
  supabaseAdminRound2SkipPhase,
  supabaseAdminRound2SaveDurations,
  supabaseAdminRound2SaveScoring,
  supabaseAdminRound2ResetMatches,
  supabaseAdminRound2AutoPair,
  supabaseAdminRound2ManualPair,
  supabaseAdminSpawnDemoCrew,
} from '../src/lib/supabaseService';
import { supabase } from '../src/lib/supabase';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  console.log(`✓ ${msg}`);
}

async function runSupabaseIntegrationTest() {
  console.log('=== RUNNING SUPABASE ROUND 2 INTEGRATION TEST ===\n');

  // 1. Fetch initial payload
  const initialPayload = await fetchFullSyncPayloadFromSupabase();
  assert(Boolean(initialPayload), 'Fetched sync payload from Supabase');
  assert(Boolean(initialPayload.config?.round2), 'Config contains round2 settings');
  assert(initialPayload.config.round2?.num_clashes === 3, 'round2 num_clashes is 3');

  // 2. Ensure at least two teams exist with battle codes
  let teams = initialPayload.teams_leaderboard;
  console.log(`Current formed teams in DB: ${teams.length}`);

  let teamA = teams[0];
  let teamB = teams[1];

  if (teams.length < 2) {
    console.log('Spawning demo crew 1...');
    await supabaseAdminSpawnDemoCrew('underworld');
    console.log('Spawning demo crew 2...');
    await supabaseAdminSpawnDemoCrew('underworld');
    const updatedPayload = await fetchFullSyncPayloadFromSupabase();
    teams = updatedPayload.teams_leaderboard;
  }
  teamA = teams[0];
  teamB = teams[1];

  assert(Boolean(teamA.battle_code), `Team A has battle code: ${teamA.battle_code}`);
  assert(Boolean(teamB.battle_code), `Team B has battle code: ${teamB.battle_code}`);

  // Clean any previous matches
  await supabaseAdminRound2ResetMatches();

  // 3. Test Battle Code Pairing: Team A enters Team B's battle code
  console.log(`Pairing Team A (${teamA.name}) with Team B's code: ${teamB.battle_code}`);
  const pairResult = await supabaseRound2PairByCode(teamA.id, teamB.battle_code!);
  assert(pairResult.success, `Successfully paired teams via battle code: ${pairResult.match?.id}`);
  const matchId = pairResult.match!.id;

  // 4. Verify match is in Phase 1: HUDDLE
  let payloadAfterPair = await fetchFullSyncPayloadFromSupabase(undefined, teamA.id);
  let activeMatch = payloadAfterPair.round2_match;
  assert(Boolean(activeMatch), 'Match is present in player sync payload');
  assert(activeMatch?.current_phase === 'HUDDLE', 'Initial phase is HUDDLE');
  assert(activeMatch?.current_clash === 1, 'Initial clash is 1');

  // 5. Advance HUDDLE -> PARLEY
  console.log('Advancing HUDDLE -> PARLEY...');
  let adv1 = await supabaseRound2AdvancePhase(matchId);
  assert(adv1.success && adv1.match?.current_phase === 'PARLEY', 'Advanced to PARLEY');

  // 6. Test Timer Adjust in PARLEY (+30s)
  console.log('Testing live timer adjust (+30s)...');
  const oldEndsAt = adv1.match!.phase_ends_at;
  const timerRes = await supabaseAdminRound2AdjustTimer(30);
  assert(timerRes.success, 'Adjusted live timer successfully');
  const payloadAfterTimer = await fetchFullSyncPayloadFromSupabase(undefined, teamA.id);
  const newEndsAt = payloadAfterTimer.round2_match!.phase_ends_at;
  assert(newEndsAt >= oldEndsAt + 28000, `Timer increased by ~30s: ${newEndsAt - oldEndsAt}ms delta`);

  // 7. Advance PARLEY -> VOTE
  console.log('Advancing PARLEY -> VOTE...');
  let adv2 = await supabaseRound2AdvancePhase(matchId);
  assert(adv2.success && adv2.match?.current_phase === 'VOTE', 'Advanced to VOTE');

  // 8. Test voting and masking during VOTE
  console.log('Casting votes...');
  const playerA1Id = teamA.members[0].id!;
  const playerA2Id = teamA.members[1].id!;
  const playerB1Id = teamB.members[0].id!;

  // Team A member 1 votes TRUCE
  const v1 = await supabaseRound2CastVote(matchId, playerA1Id, teamA.id, 'TRUCE');
  assert(v1.success, 'Player A1 cast TRUCE vote');

  // Check sanitization: Player A2 views match
  const payloadForA2 = await fetchFullSyncPayloadFromSupabase(playerA2Id, teamA.id);
  const clashDataVOTE = payloadForA2.round2_match!.clash_data[0];
  assert(clashDataVOTE.team_a_votes[playerA1Id] === 'LOCKED', 'Player A2 sees player_a1 vote masked as LOCKED');
  assert(Object.keys(clashDataVOTE.team_b_votes).length === 0, 'Opponent votes are completely hidden');

  // Team B member 1 votes AMBUSH
  const v2 = await supabaseRound2CastVote(matchId, playerB1Id, teamB.id, 'AMBUSH');
  assert(v2.success, 'Player B1 cast AMBUSH vote');

  // 9. Advance VOTE -> DEBRIEF (Resolves stances & scores!)
  console.log('Advancing VOTE -> DEBRIEF (Resolving Clash 1)...');
  let adv3 = await supabaseRound2AdvancePhase(matchId);
  assert(adv3.success && adv3.match?.current_phase === 'DEBRIEF', 'Advanced to DEBRIEF');
  const debriefClash1 = adv3.match!.clash_data[0];
  console.log(`Clash 1 Outcome: Team A ${debriefClash1.team_a_stance} (+${debriefClash1.team_a_pts}) vs Team B ${debriefClash1.team_b_stance} (+${debriefClash1.team_b_pts})`);
  assert(debriefClash1.team_a_stance === 'TRUCE', 'Team A resolved to TRUCE');
  assert(debriefClash1.team_b_stance === 'AMBUSH', 'Team B resolved to AMBUSH');
  assert(debriefClash1.team_a_pts === 0, 'Team A scored 0 (truce loss)');
  assert(debriefClash1.team_b_pts === 150, 'Team B scored 150 (ambush win)');

  // 10. Advance DEBRIEF -> Clash 2 HUDDLE
  console.log('Advancing DEBRIEF -> Clash 2 HUDDLE...');
  let adv4 = await supabaseRound2AdvancePhase(matchId);
  assert(adv4.success && adv4.match?.current_phase === 'HUDDLE', 'Advanced to HUDDLE');
  assert(adv4.match?.current_clash === 2, 'Advanced to Clash 2');

  // 11. Fast-forward Clash 2 (Both Truce)
  console.log('Running Clash 2 (Both Truce)...');
  await supabaseRound2AdvancePhase(matchId); // to PARLEY
  await supabaseRound2AdvancePhase(matchId); // to VOTE
  await supabaseRound2CastVote(matchId, playerA1Id, teamA.id, 'TRUCE');
  await supabaseRound2CastVote(matchId, playerB1Id, teamB.id, 'TRUCE');
  let advClash2Debrief = await supabaseRound2AdvancePhase(matchId); // to DEBRIEF
  assert(advClash2Debrief.match?.clash_data[1].team_a_pts === 150, 'Clash 2 Both Truce team A got 150');
  assert(advClash2Debrief.match?.clash_data[1].team_b_pts === 150, 'Clash 2 Both Truce team B got 150');

  // 12. Advance to Clash 3 HUDDLE
  console.log('Advancing to Clash 3 HUDDLE...');
  let advClash3Huddle = await supabaseRound2AdvancePhase(matchId);
  assert(advClash3Huddle.match?.current_clash === 3, 'Advanced to Clash 3');

  // 13. Fast-forward Clash 3 (Team B ambushes Team A again)
  console.log('Running Clash 3 (Team B Ambushes Team A again)...');
  await supabaseRound2AdvancePhase(matchId); // to PARLEY
  await supabaseRound2AdvancePhase(matchId); // to VOTE
  await supabaseRound2CastVote(matchId, playerA1Id, teamA.id, 'TRUCE');
  await supabaseRound2CastVote(matchId, playerB1Id, teamB.id, 'AMBUSH');
  let advClash3Debrief = await supabaseRound2AdvancePhase(matchId); // to DEBRIEF
  assert(advClash3Debrief.match?.clash_data[2].team_b_pts === 450, 'Clash 3 Team B ambush win got 450');

  // 14. Advance past Clash 3 DEBRIEF -> MATCH COMPLETION & NEMESIS CALCULATION!
  console.log('Advancing past Clash 3 Debrief to complete match...');
  let finishMatch = await supabaseRound2AdvancePhase(matchId);
  assert(finishMatch.success, 'Finished match');
  assert(finishMatch.match?.completed === true, 'Match marked completed = true');

  // 15. Verify nemesis_team_id written to teams table in DB!
  console.log('Checking nemesis_team_id in database...');
  const { data: dbTeamA } = await supabase.from('teams').select('*').eq('id', teamA.id).single();
  console.log(`Team A nemesis_team_id in DB: ${dbTeamA?.nemesis_team_id}`);
  assert(dbTeamA?.nemesis_team_id === teamB.id, `Team A marked with Team B as nemesis in DB!`);

  // 16. Test Admin Config Save (Durations & Scoring)
  console.log('Testing Admin Config Live Updates...');
  const saveDurResult = await supabaseAdminRound2SaveDurations({
    HUDDLE: 45,
    PARLEY: 35,
    VOTE: 20,
    DEBRIEF: 30,
  });
  assert(saveDurResult.success, 'Saved Round 2 durations');

  const saveScoringResult = await supabaseAdminRound2SaveScoring({
    '1': { both_truce: 80, ambush_win: 160, truce_loss: 0, both_ambush: 20 },
    '2': { both_truce: 160, ambush_win: 320, truce_loss: 0, both_ambush: 40 },
    '3': { both_truce: 240, ambush_win: 480, truce_loss: 0, both_ambush: 60 },
  });
  assert(saveScoringResult.success, 'Saved Round 2 scoring matrix');

  // Verify in fetched payload
  const updatedPayload = await fetchFullSyncPayloadFromSupabase();
  assert(updatedPayload.config.round2?.phase_durations_seconds.HUDDLE === 45, 'Verified updated HUDDLE duration = 45');
  assert(updatedPayload.config.round2?.scoring_matrix['1'].both_truce === 80, 'Verified updated scoring matrix Clash 1 both_truce = 80');

  // Restore default config
  await supabaseAdminRound2SaveDurations({
    HUDDLE: 50,
    PARLEY: 40,
    VOTE: 25,
    DEBRIEF: 40,
  });
  await supabaseAdminRound2SaveScoring({
    '1': { both_truce: 75, ambush_win: 150, truce_loss: 0, both_ambush: 15 },
    '2': { both_truce: 150, ambush_win: 300, truce_loss: 0, both_ambush: 30 },
    '3': { both_truce: 225, ambush_win: 450, truce_loss: 0, both_ambush: 45 },
  });

  // Clean up matches
  await supabaseAdminRound2ResetMatches();
  console.log('\n ALL SUPABASE ROUND 2 INTEGRATION TESTS PASSED PERFECTLY!');
}

runSupabaseIntegrationTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
