import {
  calculateHeadstartMeters,
  resolveTeamVesselChoice,
  calculateVoteUnanimity,
  getVesselBoldnessRank,
  sortCrossingCandidates,
  evaluateWaveCongestion,
  resolveSuddenDeath,
  CrossingCandidate,
} from './src/lib/round3Engine';
import { DEFAULT_ROUND3_CONFIG } from './src/lib/defaultConfig';
import type { Team, Player, Round3TeamWaveVote, Round3TeamState } from './src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('====================================================');
console.log('RUNNING ROUND 3 (THE ODYSSEY ESCAPE ROYALE) TEST SUITE');
console.log('====================================================\n');

// --------------------------------------------------------------------------
// TEST 1: Head-start Calculations
// --------------------------------------------------------------------------
console.log('Test 1: Head-start Calculations');
{
  const hs0 = calculateHeadstartMeters(0, DEFAULT_ROUND3_CONFIG);
  assert(hs0 === 0, `0 pts yields 0m (got ${hs0})`);

  const hs250 = calculateHeadstartMeters(250, DEFAULT_ROUND3_CONFIG);
  assert(hs250 === 50, `250 pts / 5 yields 50m (got ${hs250})`);

  const hs500 = calculateHeadstartMeters(500, DEFAULT_ROUND3_CONFIG);
  assert(hs500 === 100, `500 pts / 5 yields 100m (got ${hs500})`);

  const hs1000 = calculateHeadstartMeters(1000, DEFAULT_ROUND3_CONFIG);
  assert(hs1000 === 200, `1000 pts / 5 yields 200m (got ${hs1000})`);

  const hs2000 = calculateHeadstartMeters(2000, DEFAULT_ROUND3_CONFIG);
  assert(hs2000 === 200, `2000 pts / 5 is capped at max 200m (got ${hs2000})`);
}

// --------------------------------------------------------------------------
// TEST 2: Team Vessel Choice Resolution & Negotiator Tie-Breaker
// --------------------------------------------------------------------------
console.log('\nTest 2: Team Vessel Choice Resolution');
{
  const pMap = new Map<string, Player>();
  pMap.set('p1', { id: 'p1', name: 'P1', teamId: 't1', roleId: 'captain', roleName: 'Captain', roleColor: '#fff' });
  pMap.set('p2', { id: 'p2', name: 'P2', teamId: 't1', roleId: 'negotiator', roleName: 'Negotiator', roleColor: '#fff' });
  pMap.set('p3', { id: 'p3', name: 'P3', teamId: 't1', roleId: 'scout', roleName: 'Scout', roleColor: '#fff' });
  pMap.set('p4', { id: 'p4', name: 'P4', teamId: 't1', roleId: 'oarsman', roleName: 'Oarsman', roleColor: '#fff' });
  pMap.set('p5', { id: 'p5', name: 'P5', teamId: 't1', roleId: 'lookout', roleName: 'Lookout', roleColor: '#fff' });
  const memberIds = ['p1', 'p2', 'p3', 'p4', 'p5'];

  // Majority check: 3 Rowboat vs 2 Sailboat
  const votesMajority: Record<string, any> = {
    p1: 'ROWBOAT',
    p2: 'SAILBOAT',
    p3: 'ROWBOAT',
    p4: 'SAILBOAT',
    p5: 'ROWBOAT',
  };
  const resMajority = resolveTeamVesselChoice(votesMajority, memberIds, pMap);
  assert(resMajority === 'ROWBOAT', `3 Rowboat vs 2 Sailboat resolves to ROWBOAT (got ${resMajority})`);

  // Tied check 2 vs 2: Negotiator (p2) voted SAILBOAT
  const votesTie: Record<string, any> = {
    p1: 'ROWBOAT',
    p2: 'SAILBOAT',
    p3: 'ROWBOAT',
    p4: 'SAILBOAT',
    p5: 'ABSTAIN',
  };
  const resTie = resolveTeamVesselChoice(votesTie, memberIds, pMap);
  assert(resTie === 'SAILBOAT', `2 Rowboat vs 2 Sailboat broken by Negotiator (p2 -> SAILBOAT) (got ${resTie})`);

  // Uncast/empty votes default to ROWBOAT
  const resEmpty = resolveTeamVesselChoice({}, memberIds, pMap);
  assert(resEmpty === 'ROWBOAT', `Empty votes default to ROWBOAT (got ${resEmpty})`);
}

// --------------------------------------------------------------------------
// TEST 3: Unanimity and Boldness Rankings
// --------------------------------------------------------------------------
console.log('\nTest 3: Vote Unanimity & Boldness Rankings');
{
  const unanimity5 = calculateVoteUnanimity({ p1: 'ROWBOAT', p2: 'ROWBOAT', p3: 'ROWBOAT', p4: 'ROWBOAT', p5: 'ROWBOAT' }, 'ROWBOAT', 5);
  assert(unanimity5 === 1.0, `5/5 unanimous votes = 1.0 (got ${unanimity5})`);

  const unanimity3 = calculateVoteUnanimity({ p1: 'ROWBOAT', p2: 'ROWBOAT', p3: 'ROWBOAT', p4: 'SAILBOAT', p5: 'SAILBOAT' }, 'ROWBOAT', 5);
  assert(Math.abs(unanimity3 - 0.6) < 0.001, `3/5 votes = 0.6 (got ${unanimity3})`);

  assert(
    getVesselBoldnessRank('GHOST_SHIP') > getVesselBoldnessRank('SAILBOAT') &&
    getVesselBoldnessRank('SAILBOAT') > getVesselBoldnessRank('ROWBOAT'),
    'Boldness hierarchy is Ghost Ship (3) > Sailboat (2) > Rowboat (1)'
  );
}

// --------------------------------------------------------------------------
// TEST 4: Crossing Candidates 4-Priority Tie-Breaker
// --------------------------------------------------------------------------
console.log('\nTest 4: Crossing Candidates 4-Priority Tie-Breaker');
{
  const makeTeam = (id: string, name: string, score: number): Team => ({
    id,
    name,
    score,
    members: [],
    player_ids: [],
    created_at: Date.now(),
  });

  const candidates: CrossingCandidate[] = [
    { team: makeTeam('t1', 'Team 1', 200), newTotalDistance: 1020, vessel: 'GHOST_SHIP', unanimity: 1.0, priorScore: 200 },
    { team: makeTeam('t2', 'Team 2', 150), newTotalDistance: 1150, vessel: 'ROWBOAT', unanimity: 0.6, priorScore: 150 },
    { team: makeTeam('t3', 'Team 3', 300), newTotalDistance: 1100, vessel: 'ROWBOAT', unanimity: 0.8, priorScore: 300 },
    { team: makeTeam('t4', 'Team 4', 250), newTotalDistance: 1100, vessel: 'SAILBOAT', unanimity: 0.8, priorScore: 250 },
    { team: makeTeam('t5', 'Team 5', 400), newTotalDistance: 1100, vessel: 'SAILBOAT', unanimity: 1.0, priorScore: 400 },
  ];

  const sorted = sortCrossingCandidates(candidates);
  // Expected order:
  // 1. Team 2 (1150m, highest distance overshoot)
  // 2. Team 5 (1100m, SAILBOAT, 1.0 unanimity)
  // 3. Team 4 (1100m, SAILBOAT, 0.8 unanimity)
  // 4. Team 3 (1100m, ROWBOAT)
  // 5. Team 1 (1020m)
  assert(sorted[0].team.id === 't2', `Rank 1: t2 (1150m) beats all (got ${sorted[0].team.id})`);
  assert(sorted[1].team.id === 't5', `Rank 2: t5 (1100m, Sailboat, 1.0 unanimity) (got ${sorted[1].team.id})`);
  assert(sorted[2].team.id === 't4', `Rank 3: t4 (1100m, Sailboat, 0.8 unanimity) (got ${sorted[2].team.id})`);
  assert(sorted[3].team.id === 't3', `Rank 4: t3 (1100m, Rowboat) (got ${sorted[3].team.id})`);
  assert(sorted[4].team.id === 't1', `Rank 5: t1 (1020m) (got ${sorted[4].team.id})`);
}

// --------------------------------------------------------------------------
// TEST 5: Wave Congestion Evaluation, Cerberus Vengeance & Capacity Rules
// --------------------------------------------------------------------------
console.log('\nTest 5: Wave Congestion Evaluation & Capacity Rules');
{
  const makeTeam = (id: string, name: string): Team => ({
    id,
    name,
    score: 0,
    members: [],
    player_ids: [],
    created_at: Date.now(),
  });

  const teams: Team[] = [
    makeTeam('tA', 'Crew Alpha'),
    makeTeam('tB', 'Crew Beta'),
    makeTeam('tC', 'Crew Gamma'),
    makeTeam('tD', 'Crew Delta'),
  ];
  const teamsMap = new Map<string, Team>();
  teams.forEach(t => teamsMap.set(t.id, t));

  // Scenario 5A: Sailboat Overload (> 30% of active teams capsize)
  // 4 active teams -> capacity ceil(4 * 0.3) = 2.
  // If 3 teams pick Sailboat -> Capsized! 0m.
  const teamStates: Record<string, Round3TeamState> = {
    tA: { team_id: 'tA', current_distance_meters: 100, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
    tB: { team_id: 'tB', current_distance_meters: 100, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
    tC: { team_id: 'tC', current_distance_meters: 100, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
    tD: { team_id: 'tD', current_distance_meters: 100, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
  };

  const votesCapsized: Record<string, Round3TeamWaveVote> = {
    tA: { team_id: 'tA', resolved_vessel: 'SAILBOAT', player_votes: {}, meters_gained: 0 },
    tB: { team_id: 'tB', resolved_vessel: 'SAILBOAT', player_votes: {}, meters_gained: 0 },
    tC: { team_id: 'tC', resolved_vessel: 'SAILBOAT', player_votes: {}, meters_gained: 0 },
    tD: { team_id: 'tD', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
  };

  const reportCapsized = evaluateWaveCongestion({
    activeTeams: teams,
    teamVotes: votesCapsized,
    currentTeamStates: teamStates,
    config: DEFAULT_ROUND3_CONFIG,
    waveNumber: 1,
    existingPodium: { gold_team_id: null, silver_team_id: null, bronze_team_id: null },
    teamsMap,
  });

  assert(reportCapsized.sailboat_capsized === true, 'Sailboat capsized because 3 > ceil(4 * 0.30) = 2');
  assert(reportCapsized.team_outcomes['tA'].base_meters === 0, 'tA gained 0m from capsized Sailboat');
  assert(reportCapsized.team_outcomes['tA'].new_total_distance === 100, 'tA stayed at 100m');
  assert(reportCapsized.team_outcomes['tD'].base_meters === 150, 'tD gained +150m from safe Rowboat');
  assert(reportCapsized.team_outcomes['tD'].new_total_distance === 250, 'tD reached 250m');

  // Scenario 5B: Ghost Ship Solo Surge (+450m) vs Collision (-50m)
  // Exactly 1 team picks Ghost Ship -> +450m
  const votesSoloGhost: Record<string, Round3TeamWaveVote> = {
    tA: { team_id: 'tA', resolved_vessel: 'GHOST_SHIP', player_votes: {}, meters_gained: 0 },
    tB: { team_id: 'tB', resolved_vessel: 'SAILBOAT', player_votes: {}, meters_gained: 0 },
    tC: { team_id: 'tC', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
    tD: { team_id: 'tD', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
  };

  const reportSoloGhost = evaluateWaveCongestion({
    activeTeams: teams,
    teamVotes: votesSoloGhost,
    currentTeamStates: teamStates,
    config: DEFAULT_ROUND3_CONFIG,
    waveNumber: 1,
    existingPodium: { gold_team_id: null, silver_team_id: null, bronze_team_id: null },
    teamsMap,
  });

  assert(reportSoloGhost.ghost_ship_solo_team_id === 'tA', 'Ghost Ship solo surge claimed by tA');
  assert(reportSoloGhost.ghost_ship_collided === false, 'Ghost Ship did not collide');
  assert(reportSoloGhost.team_outcomes['tA'].base_meters === 450, 'tA gained +450m from solo Ghost Ship');
  assert(reportSoloGhost.team_outcomes['tA'].new_total_distance === 550, 'tA surged to 550m (100 + 450)');

  // 2 teams pick Ghost Ship -> Collision (-50m)
  const votesCollideGhost: Record<string, Round3TeamWaveVote> = {
    tA: { team_id: 'tA', resolved_vessel: 'GHOST_SHIP', player_votes: {}, meters_gained: 0 },
    tB: { team_id: 'tB', resolved_vessel: 'GHOST_SHIP', player_votes: {}, meters_gained: 0 },
    tC: { team_id: 'tC', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
    tD: { team_id: 'tD', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
  };

  const reportCollideGhost = evaluateWaveCongestion({
    activeTeams: teams,
    teamVotes: votesCollideGhost,
    currentTeamStates: teamStates,
    config: DEFAULT_ROUND3_CONFIG,
    waveNumber: 1,
    existingPodium: { gold_team_id: null, silver_team_id: null, bronze_team_id: null },
    teamsMap,
  });

  assert(reportCollideGhost.ghost_ship_collided === true, 'Ghost Ship collided because 2 crews boarded');
  assert(reportCollideGhost.team_outcomes['tA'].base_meters === -50, 'tA penalized -50m');
  assert(reportCollideGhost.team_outcomes['tA'].new_total_distance === 50, 'tA dropped to 50m (100 - 50)');
  assert(reportCollideGhost.team_outcomes['tB'].new_total_distance === 50, 'tB dropped to 50m (100 - 50)');

  // Scenario 5C: Cerberus Vengeance Strike
  // tA targets tB and correctly predicts tB is taking 'GHOST_SHIP'
  const votesCerberus: Record<string, Round3TeamWaveVote> = {
    tA: {
      team_id: 'tA',
      resolved_vessel: 'ROWBOAT',
      cerberus_target_team_id: 'tB',
      cerberus_guessed_vessel: 'GHOST_SHIP',
      player_votes: {},
      meters_gained: 0,
    },
    tB: { team_id: 'tB', resolved_vessel: 'GHOST_SHIP', player_votes: {}, meters_gained: 0 },
    tC: { team_id: 'tC', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
    tD: { team_id: 'tD', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
  };

  const reportCerberus = evaluateWaveCongestion({
    activeTeams: teams,
    teamVotes: votesCerberus,
    currentTeamStates: teamStates,
    config: DEFAULT_ROUND3_CONFIG,
    waveNumber: 1,
    existingPodium: { gold_team_id: null, silver_team_id: null, bronze_team_id: null },
    teamsMap,
  });

  assert(reportCerberus.cerberus_events.length === 1, '1 Cerberus strike registered');
  assert(reportCerberus.cerberus_events[0].success === true, 'Cerberus strike succeeded (guess was GHOST_SHIP)');
  assert(reportCerberus.cerberus_events[0].target_penalty === -150, 'Target penalty is -150m');
  assert(reportCerberus.cerberus_events[0].attacker_bonus === 150, 'Hunter bonus is +150m');
  // tA: 100 + 150 (Rowboat) + 150 (Cerberus bonus) = 400m
  assert(reportCerberus.team_outcomes['tA'].new_total_distance === 400, `tA got +150 Rowboat and +150 Cerberus bonus = 400m (got ${reportCerberus.team_outcomes['tA'].new_total_distance})`);
  // tB: 100 + 450 (Ghost Ship solo) - 150 (Cerberus penalty) = 400m
  assert(reportCerberus.team_outcomes['tB'].new_total_distance === 400, `tB got +450 Ghost Ship and -150 Cerberus penalty = 400m (got ${reportCerberus.team_outcomes['tB'].new_total_distance})`);

  // Scenario 5D: Podium Allocation upon crossing 1,000m
  const teamStatesNearPortal: Record<string, Round3TeamState> = {
    tA: { team_id: 'tA', current_distance_meters: 800, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
    tB: { team_id: 'tB', current_distance_meters: 900, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
    tC: { team_id: 'tC', current_distance_meters: 850, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
    tD: { team_id: 'tD', current_distance_meters: 100, has_escaped: false, escape_rank: null, escaped_in_wave: null, cerberus_used: false },
  };

  const votesCrossing: Record<string, Round3TeamWaveVote> = {
    // tA picks GHOST_SHIP solo -> 800 + 450 = 1250m
    tA: { team_id: 'tA', resolved_vessel: 'GHOST_SHIP', player_votes: {}, meters_gained: 0 },
    // tB picks ROWBOAT -> 900 + 150 = 1050m
    tB: { team_id: 'tB', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
    // tC picks ROWBOAT -> 850 + 150 = 1000m
    tC: { team_id: 'tC', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
    // tD picks ROWBOAT -> 100 + 150 = 250m
    tD: { team_id: 'tD', resolved_vessel: 'ROWBOAT', player_votes: {}, meters_gained: 0 },
  };

  const reportCrossing = evaluateWaveCongestion({
    activeTeams: teams,
    teamVotes: votesCrossing,
    currentTeamStates: teamStatesNearPortal,
    config: DEFAULT_ROUND3_CONFIG,
    waveNumber: 3,
    existingPodium: { gold_team_id: null, silver_team_id: null, bronze_team_id: null },
    teamsMap,
  });

  assert(reportCrossing.team_outcomes['tA'].escape_rank === 1, 'tA (1250m) awarded Gold Medal (Rank 1)');
  assert(reportCrossing.team_outcomes['tB'].escape_rank === 2, 'tB (1050m) awarded Silver Medal (Rank 2)');
  assert(reportCrossing.team_outcomes['tC'].escape_rank === 3, 'tC (1000m) awarded Bronze Medal (Rank 3)');
  assert(reportCrossing.team_outcomes['tD'].escape_rank === null, 'tD (250m) did not escape yet');
}

// --------------------------------------------------------------------------
// TEST 6: Sudden Death Maneuver Resolution (Rock-Paper-Scissors)
// --------------------------------------------------------------------------
console.log('\nTest 6: Sudden Death Maneuver Resolution');
{
  const r1 = resolveSuddenDeath('SHIELDS', 'RAM');
  assert(r1.winner === 'team_a', `Shields deflects Ram -> team_a wins (${r1.description})`);

  const r2 = resolveSuddenDeath('RAM', 'SAILS');
  assert(r2.winner === 'team_a', `Ram smashes Sails -> team_a wins (${r2.description})`);

  const r3 = resolveSuddenDeath('SAILS', 'SHIELDS');
  assert(r3.winner === 'team_a', `Sails outruns Shields -> team_a wins (${r3.description})`);

  const r4 = resolveSuddenDeath('RAM', 'SHIELDS');
  assert(r4.winner === 'team_b', `Ram against Shields -> team_b wins (${r4.description})`);

  const r5 = resolveSuddenDeath('SHIELDS', 'SHIELDS');
  assert(r5.winner === 'tie', `Identical maneuvers -> tie (${r5.description})`);
}

console.log('\n====================================================');
console.log('🎉 ALL ROUND 3 UNIT AND INTEGRATION TESTS PASSED!');
console.log('====================================================\n');
