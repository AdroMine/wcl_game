import type {
  Round3Config,
  Round3Vessel,
  Round3SuddenDeathAction,
  Round3TeamState,
  Round3TeamWaveVote,
  Round3WaveReport,
  Round3CerberusEvent,
  Team,
  Player,
} from '../types';
import { DEFAULT_ROUND3_CONFIG } from './defaultConfig';

/**
 * Calculate starting head-start distance in meters based on cumulative points from Rounds 1 & 2.
 * Formula: min(max_headstart_meters, floor(score / headstart_point_divisor))
 * Example: 500 points / 5 = 100m. Max cap = 200m.
 */
export function calculateHeadstartMeters(
  cumulativeScore: number,
  config: Round3Config = DEFAULT_ROUND3_CONFIG
): number {
  const divisor = config.headstart_point_divisor || 5;
  const maxCap = config.max_headstart_meters || 200;
  const rawMeters = Math.floor(Math.max(0, cumulativeScore) / divisor);
  return Math.min(maxCap, rawMeters);
}

/**
 * Determine a team's resolved vessel choice from individual player votes.
 * - Simple majority of active votes wins.
 * - In case of a tie between top vessels, the Negotiator's vote breaks the tie.
 * - If still tied, absent, or no votes cast, defaults to ROWBOAT.
 */
export function resolveTeamVesselChoice(
  playerVotes: Record<string, Round3Vessel | 'ABSTAIN'>,
  memberIds: string[],
  playersMap: Map<string, Player>
): Round3Vessel {
  const counts: Record<Round3Vessel, number> = {
    ROWBOAT: 0,
    SAILBOAT: 0,
    GHOST_SHIP: 0,
  };

  for (const pid of memberIds) {
    const vote = playerVotes[pid];
    if (vote && vote !== 'ABSTAIN' && counts[vote] !== undefined) {
      counts[vote]++;
    }
  }

  const maxVotes = Math.max(counts.ROWBOAT, counts.SAILBOAT, counts.GHOST_SHIP);
  if (maxVotes === 0) {
    return 'ROWBOAT'; // Default safe vessel if nobody voted
  }

  const tiedVessels = (['ROWBOAT', 'SAILBOAT', 'GHOST_SHIP'] as Round3Vessel[]).filter(
    v => counts[v] === maxVotes
  );

  if (tiedVessels.length === 1) {
    return tiedVessels[0];
  }

  // Tie-breaker: Negotiator role vote
  const negotiatorId = memberIds.find(pid => {
    const p = playersMap.get(pid);
    return p?.roleId === 'negotiator';
  });

  if (negotiatorId) {
    const negVote = playerVotes[negotiatorId];
    if (negVote && negVote !== 'ABSTAIN' && tiedVessels.includes(negVote)) {
      return negVote;
    }
  }

  // If still tied or Negotiator not present, default to safe ROWBOAT if tied, otherwise first tied
  return tiedVessels.includes('ROWBOAT') ? 'ROWBOAT' : tiedVessels[0];
}

/**
 * Helper to calculate vote unanimity score (ratio of team members that voted for the chosen vessel).
 */
export function calculateVoteUnanimity(
  playerVotes: Record<string, Round3Vessel | 'ABSTAIN'>,
  chosenVessel: Round3Vessel,
  teamSize: number
): number {
  if (teamSize <= 0) return 0;
  let matchingVotes = 0;
  for (const pid in playerVotes) {
    if (playerVotes[pid] === chosenVessel) {
      matchingVotes++;
    }
  }
  return matchingVotes / teamSize;
}

/**
 * Vessel Boldness Hierarchy for tie-breakers:
 * Ghost Ship (3) > Sailboat (2) > Rowboat (1)
 */
export function getVesselBoldnessRank(vessel: Round3Vessel): number {
  switch (vessel) {
    case 'GHOST_SHIP':
      return 3;
    case 'SAILBOAT':
      return 2;
    case 'ROWBOAT':
    default:
      return 1;
  }
}

export interface CrossingCandidate {
  team: Team;
  newTotalDistance: number;
  vessel: Round3Vessel;
  unanimity: number;
  priorScore: number;
}

/**
 * Sort candidates who crossed 1,000m in the SAME wave using the strict 4-priority tie-breaker:
 * Priority 1: Distance Overshoot (highest meters past 1000)
 * Priority 2: Vessel Boldness (Ghost Ship > Sailboat > Rowboat)
 * Priority 3: Crew Vote Unanimity (5/5 beats 4/1 or 3/2)
 * Priority 4: Cumulative Prior Points (highest score from Rounds 1 & 2)
 */
export function sortCrossingCandidates(candidates: CrossingCandidate[]): CrossingCandidate[] {
  return [...candidates].sort((a, b) => {
    // Priority 1: Distance Overshoot
    if (b.newTotalDistance !== a.newTotalDistance) {
      return b.newTotalDistance - a.newTotalDistance;
    }
    // Priority 2: Vessel Boldness
    const boldnessA = getVesselBoldnessRank(a.vessel);
    const boldnessB = getVesselBoldnessRank(b.vessel);
    if (boldnessB !== boldnessA) {
      return boldnessB - boldnessA;
    }
    // Priority 3: Crew Vote Unanimity
    if (Math.abs(b.unanimity - a.unanimity) > 0.001) {
      return b.unanimity - a.unanimity;
    }
    // Priority 4: Cumulative Prior Points
    return b.priorScore - a.priorScore;
  });
}

/**
 * Core Congestion & Surge Evaluation Engine for Wave Phase 3 (REVEAL).
 * Evaluates capacity thresholds for all 3 vessels, applies Cerberus revenge,
 * updates distance meters, and allocates podium spots to newly escaped teams.
 */
export function evaluateWaveCongestion(args: {
  activeTeams: Team[];
  teamVotes: Record<string, Round3TeamWaveVote>;
  currentTeamStates: Record<string, Round3TeamState>;
  config: Round3Config;
  waveNumber: number;
  existingPodium: {
    gold_team_id: string | null;
    silver_team_id: string | null;
    bronze_team_id: string | null;
  };
  teamsMap: Map<string, Team>;
}): Round3WaveReport {
  const {
    activeTeams,
    teamVotes,
    currentTeamStates,
    config,
    waveNumber,
    existingPodium,
    teamsMap,
  } = args;

  // Filter teams that haven't escaped yet
  const participatingTeams = activeTeams.filter(t => !currentTeamStates[t.id]?.has_escaped);
  const totalActiveCount = participatingTeams.length;

  const rowboatTeams: string[] = [];
  const sailboatTeams: string[] = [];
  const ghostShipTeams: string[] = [];

  for (const team of participatingTeams) {
    const vote = teamVotes[team.id];
    const vessel: Round3Vessel = vote?.resolved_vessel || 'ROWBOAT';
    if (vessel === 'ROWBOAT') {
      rowboatTeams.push(team.id);
    } else if (vessel === 'SAILBOAT') {
      sailboatTeams.push(team.id);
    } else if (vessel === 'GHOST_SHIP') {
      ghostShipTeams.push(team.id);
    }
  }

  // 1. Sailboat capacity check
  const sailboatCfg = config.vessels.SAILBOAT;
  const maxSailboatAllowed = Math.ceil(totalActiveCount * (sailboatCfg.capacity_percent || 0.30));
  const sailboatCapsized = sailboatTeams.length > maxSailboatAllowed;

  // 2. Ghost Ship collision check
  const ghostShipCollided = ghostShipTeams.length >= 2;
  const ghostShipSoloTeamId = ghostShipTeams.length === 1 ? ghostShipTeams[0] : null;

  // 3. Cerberus Vengeance Evaluation
  const cerberusEvents: Round3CerberusEvent[] = [];
  const cerberusDeltas: Record<string, number> = {};

  for (const team of participatingTeams) {
    const vote = teamVotes[team.id];
    const state = currentTeamStates[team.id];

    if (
      vote?.cerberus_target_team_id &&
      vote?.cerberus_guessed_vessel &&
      !state?.cerberus_used
    ) {
      const targetTeamId = vote.cerberus_target_team_id;
      const guessedVessel = vote.cerberus_guessed_vessel;
      const targetVote = teamVotes[targetTeamId];
      const targetActualVessel: Round3Vessel = targetVote?.resolved_vessel || 'ROWBOAT';

      const isSuccess = targetActualVessel === guessedVessel;
      const bonus = isSuccess ? (config.vengeance.cerberus_bonus_meters || 150) : 0;
      const penalty = isSuccess ? (config.vengeance.cerberus_penalty_meters || -150) : 0;

      if (isSuccess) {
        cerberusDeltas[team.id] = (cerberusDeltas[team.id] || 0) + bonus;
        cerberusDeltas[targetTeamId] = (cerberusDeltas[targetTeamId] || 0) + penalty;
      }

      cerberusEvents.push({
        attacker_team_id: team.id,
        attacker_team_name: teamsMap.get(team.id)?.name || 'Challenger',
        target_team_id: targetTeamId,
        target_team_name: teamsMap.get(targetTeamId)?.name || 'Nemesis',
        guessed_vessel: guessedVessel,
        actual_vessel: targetActualVessel,
        success: isSuccess,
        attacker_bonus: bonus,
        target_penalty: penalty,
      });
    }
  }

  // 4. Calculate Distance Gained per Team
  const teamOutcomes: Round3WaveReport['team_outcomes'] = {};
  const crossingCandidates: CrossingCandidate[] = [];

  for (const team of participatingTeams) {
    const vote = teamVotes[team.id];
    const vessel: Round3Vessel = vote?.resolved_vessel || 'ROWBOAT';
    let baseMeters = 0;

    if (vessel === 'ROWBOAT') {
      baseMeters = config.vessels.ROWBOAT.distance_success; // +150m
    } else if (vessel === 'SAILBOAT') {
      baseMeters = sailboatCapsized
        ? config.vessels.SAILBOAT.distance_fail // 0m
        : config.vessels.SAILBOAT.distance_success; // +300m
    } else if (vessel === 'GHOST_SHIP') {
      if (ghostShipSoloTeamId === team.id) {
        baseMeters = config.vessels.GHOST_SHIP.distance_success; // +450m
      } else if (ghostShipCollided) {
        baseMeters = config.vessels.GHOST_SHIP.distance_fail; // -50m
      } else {
        baseMeters = 0;
      }
    }

    const cDelta = cerberusDeltas[team.id] || 0;
    const totalMetersGained = baseMeters + cDelta;

    const oldDistance = currentTeamStates[team.id]?.current_distance_meters || 0;
    const newTotalDistance = Math.max(0, oldDistance + totalMetersGained);
    const justEscaped = newTotalDistance >= (config.target_distance_meters || 1000);

    teamOutcomes[team.id] = {
      vessel,
      base_meters: baseMeters,
      cerberus_delta: cDelta,
      total_meters_gained: totalMetersGained,
      new_total_distance: newTotalDistance,
      just_escaped: justEscaped,
      escape_rank: null,
    };

    if (justEscaped) {
      const unanimity = calculateVoteUnanimity(
        vote?.player_votes || {},
        vessel,
        team.player_ids?.length || 5
      );
      crossingCandidates.push({
        team,
        newTotalDistance,
        vessel,
        unanimity,
        priorScore: team.score || 0,
      });
    }
  }

  // 5. Rank Crossing Candidates using multi-team tie-breaker hierarchy
  if (crossingCandidates.length > 0) {
    const sortedCrossers = sortCrossingCandidates(crossingCandidates);

    // Available podium slots
    const availableRanks: number[] = [];
    if (!existingPodium.gold_team_id) availableRanks.push(1);
    if (!existingPodium.silver_team_id) availableRanks.push(2);
    if (!existingPodium.bronze_team_id) availableRanks.push(3);

    for (let i = 0; i < sortedCrossers.length; i++) {
      const crosser = sortedCrossers[i];
      const assignedRank = availableRanks[i] || (3 + i + 1); // 1=Gold, 2=Silver, 3=Bronze, >3=Escaped
      teamOutcomes[crosser.team.id].escape_rank = assignedRank;
    }
  }

  return {
    wave_number: waveNumber,
    rowboat_teams: rowboatTeams,
    sailboat_teams: sailboatTeams,
    ghost_ship_teams: ghostShipTeams,
    sailboat_capsized: sailboatCapsized,
    ghost_ship_collided: ghostShipCollided,
    ghost_ship_solo_team_id: ghostShipSoloTeamId,
    cerberus_events: cerberusEvents,
    team_outcomes: teamOutcomes,
  };
}

/**
 * Resolve Sudden Death Head-to-Head Standoff Maneuver.
 * Rock-Paper-Scissors rules:
 * - SHIELDS deflects RAM.
 * - RAM smashes SAILS.
 * - SAILS outruns SHIELDS.
 */
export function resolveSuddenDeath(
  actionA: Round3SuddenDeathAction,
  actionB: Round3SuddenDeathAction
): {
  winner: 'team_a' | 'team_b' | 'tie';
  description: string;
} {
  if (actionA === actionB) {
    return {
      winner: 'tie',
      description: `Deadlock! Both crews maneuvered with ${actionA}.`,
    };
  }

  if (
    (actionA === 'SHIELDS' && actionB === 'RAM') ||
    (actionA === 'RAM' && actionB === 'SAILS') ||
    (actionA === 'SAILS' && actionB === 'SHIELDS')
  ) {
    let actionDesc = '';
    if (actionA === 'SHIELDS') actionDesc = 'Shields deflected the Ramming hull!';
    else if (actionA === 'RAM') actionDesc = 'Ramming hull smashed through Full Sails!';
    else actionDesc = 'Full Sails outran the guarded Shields!';

    return {
      winner: 'team_a',
      description: `Victory for Challenger A! ${actionDesc}`,
    };
  }

  let actionDesc = '';
  if (actionB === 'SHIELDS') actionDesc = 'Shields deflected the Ramming hull!';
  else if (actionB === 'RAM') actionDesc = 'Ramming hull smashed through Full Sails!';
  else actionDesc = 'Full Sails outran the guarded Shields!';

  return {
    winner: 'team_b',
    description: `Victory for Challenger B! ${actionDesc}`,
  };
}
