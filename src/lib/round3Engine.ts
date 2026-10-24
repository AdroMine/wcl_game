import type {
  Round3Config,
  Round3Vessel,
  Round3SuddenDeathAction,
  Round3TeamState,
  Round3TeamWaveVote,
  Round3WaveReport,
  Round3CerberusEvent,
  Round2Match,
  TeamMoralReport,
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
 * Check if a team achieved unbroken mutual honor in Round 2.
 * Requires:
 * 1. A completed match with at least 3 clash results.
 * 2. In ALL clashes, BOTH the team and their rival chose 'TRUCE'.
 */
export function checkRound2MutualHonor(teamId: string, round2Matches: Round2Match[]): boolean {
  const match = round2Matches.find(m => m.team_a_id === teamId || m.team_b_id === teamId);
  if (!match || !match.clash_data || match.clash_data.length < 3) return false;

  for (const clash of match.clash_data) {
    if (clash.team_a_stance !== 'TRUCE' || clash.team_b_stance !== 'TRUCE') {
      return false;
    }
  }
  return true;
}

/**
 * Calculate total starting distance for Round 3 including score head-start AND Winds of Olympus honor boost.
 */
export function calculateRound3StartingDistance(
  cumulativeScore: number,
  hasMutualHonor: boolean,
  config: Round3Config = DEFAULT_ROUND3_CONFIG
): { startingMeters: number; headstartMeters: number; honorBonusMeters: number } {
  const headstartMeters = calculateHeadstartMeters(cumulativeScore, config);
  const honorBonusMeters = hasMutualHonor ? (config.honor?.honor_bonus_meters ?? 75) : 0;
  const startingMeters = headstartMeters + honorBonusMeters;
  return { startingMeters, headstartMeters, honorBonusMeters };
}

/**
 * Evaluates a team's complete moral legacy from Round 2 for Admin & Floor Facilitators.
 * Produces actionable color-coded badges:
 * - HONOURABLE: Unbroken peace (3 mutual truces) -> 🕊️ Winds of Olympus (+75m)
 * - BETRAYED: Victim of backstabbing -> 🩸 Cerberus Vengeance token ready
 * - AGGRESSOR: Backstabbed their rival -> 🗡️ Hunted as Nemesis
 * - MUTUAL_BRAWL: Both sides traded ambushes
 * - PENDING: Match unfinished or not yet paired
 */
export function evaluateTeamRound2MoralStatus(
  teamId: string,
  round2Matches: Round2Match[],
  teamsList: { id: string; name: string }[] = []
): TeamMoralReport {
  const match = round2Matches.find(m => m.team_a_id === teamId || m.team_b_id === teamId);
  if (!match || !match.clash_data || match.clash_data.length === 0) {
    return {
      status: 'PENDING',
      label: 'Pending Clash',
      shortBadge: '⏳ Pending',
      badgeClass: 'bg-[#161922] border-[#3a4157] text-[#a9b4c7]',
      rivalTeamId: null,
      rivalTeamName: null,
      mutualTruceCount: 0,
      myAmbushCount: 0,
      enemyAmbushCount: 0,
      mutualAmbushCount: 0,
    };
  }

  const isTeamA = match.team_a_id === teamId;
  const rivalId = isTeamA ? match.team_b_id : match.team_a_id;
  const rivalTeam = teamsList.find(t => t.id === rivalId);
  const rivalName = rivalTeam?.name || 'Rival Crew';

  let mutualTruceCount = 0;
  let myAmbushCount = 0;
  let enemyAmbushCount = 0;
  let mutualAmbushCount = 0;

  for (const c of match.clash_data) {
    const myStance = isTeamA ? c.team_a_stance : c.team_b_stance;
    const enemyStance = isTeamA ? c.team_b_stance : c.team_a_stance;

    if (myStance === 'TRUCE' && enemyStance === 'TRUCE') {
      mutualTruceCount++;
    } else if (myStance === 'AMBUSH' && enemyStance === 'TRUCE') {
      myAmbushCount++;
    } else if (myStance === 'TRUCE' && enemyStance === 'AMBUSH') {
      enemyAmbushCount++;
    } else if (myStance === 'AMBUSH' && enemyStance === 'AMBUSH') {
      mutualAmbushCount++;
    }
  }

  // 1. Unbroken peace across all 3 clashes
  if (mutualTruceCount === 3) {
    return {
      status: 'HONOURABLE',
      label: `🕊️ Honourable (+75m Winds)`,
      shortBadge: '🕊️ +75m Winds',
      badgeClass: 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300 font-bold',
      rivalTeamId: rivalId,
      rivalTeamName: rivalName,
      mutualTruceCount,
      myAmbushCount,
      enemyAmbushCount,
      mutualAmbushCount,
    };
  }

  // 2. Betrayed by rival (victim holds Cerberus vengeance token)
  if (enemyAmbushCount > myAmbushCount) {
    return {
      status: 'BETRAYED',
      label: `🩸 Betrayed by ${rivalName} (Cerberus Token)`,
      shortBadge: '🩸 Betrayed (Cerberus)',
      badgeClass: 'bg-rose-950/80 border-rose-500/80 text-rose-300 font-bold',
      rivalTeamId: rivalId,
      rivalTeamName: rivalName,
      mutualTruceCount,
      myAmbushCount,
      enemyAmbushCount,
      mutualAmbushCount,
    };
  }

  // 3. Aggressor (backstabbed rival)
  if (myAmbushCount > enemyAmbushCount) {
    return {
      status: 'AGGRESSOR',
      label: `🗡️ Aggressor (Betrayed ${rivalName})`,
      shortBadge: '🗡️ Aggressor (Hunted)',
      badgeClass: 'bg-amber-950/80 border-amber-500/80 text-amber-300 font-bold',
      rivalTeamId: rivalId,
      rivalTeamName: rivalName,
      mutualTruceCount,
      myAmbushCount,
      enemyAmbushCount,
      mutualAmbushCount,
    };
  }

  // 4. Mutual brawl (both ambushed equally)
  return {
    status: 'MUTUAL_BRAWL',
    label: `⚔️ Blood Feud with ${rivalName}`,
    shortBadge: '⚔️ Blood Feud',
    badgeClass: 'bg-purple-950/80 border-purple-500/80 text-purple-300 font-bold',
    rivalTeamId: rivalId,
    rivalTeamName: rivalName,
    mutualTruceCount,
    myAmbushCount,
    enemyAmbushCount,
    mutualAmbushCount,
  };
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

  // 3. Stygian Leash (Cerberus Vengeance) Evaluation
  const cerberusEvents: Round3CerberusEvent[] = [];
  const cerberusDeltas: Record<string, number> = {};

  const didVesselCrash = (vessel: Round3Vessel): boolean => {
    if (vessel === 'SAILBOAT') return sailboatCapsized;
    if (vessel === 'GHOST_SHIP') return ghostShipCollided;
    return false; // ROWBOAT never crashes
  };

  const anchorSiphon = config.vengeance.anchor_siphon_meters ?? 50;
  const wreckBonus = config.vengeance.wreck_bonus_meters ?? 100;

  for (const team of participatingTeams) {
    const vote = teamVotes[team.id];
    const state = currentTeamStates[team.id];

    if (
      vote?.cerberus_target_team_id &&
      !state?.cerberus_used
    ) {
      const targetTeamId = vote.cerberus_target_team_id;
      const targetVote = teamVotes[targetTeamId];
      const hunterVessel: Round3Vessel = vote?.resolved_vessel || 'ROWBOAT';
      const targetVessel: Round3Vessel = targetVote?.resolved_vessel || 'ROWBOAT';

      const hunterCrashed = didVesselCrash(hunterVessel);
      const targetCrashed = didVesselCrash(targetVessel);

      let eventType: 'ANCHOR_SIPHON' | 'WRECK_DRAG' | 'LEASH_SNAPPED';
      let attackerBonus = 0;
      let targetPenalty = 0;

      if (hunterCrashed) {
        // Backfire: Hunter's own boat crashed/capsized! Leash snaps, 0m gained, curse wasted
        eventType = 'LEASH_SNAPPED';
        attackerBonus = 0;
        targetPenalty = 0;
      } else if (targetCrashed) {
        // Wreck Drag: Target's boat crashed/capsized! Dragged down into the deep
        eventType = 'WRECK_DRAG';
        attackerBonus = wreckBonus;
        targetPenalty = -wreckBonus;
      } else {
        // Anchor Siphon: Target's boat floated safely! Cerberus siphons 50m from their hull
        eventType = 'ANCHOR_SIPHON';
        attackerBonus = anchorSiphon;
        targetPenalty = -anchorSiphon;
      }

      cerberusDeltas[team.id] = (cerberusDeltas[team.id] || 0) + attackerBonus;
      cerberusDeltas[targetTeamId] = (cerberusDeltas[targetTeamId] || 0) + targetPenalty;

      cerberusEvents.push({
        attacker_team_id: team.id,
        attacker_team_name: teamsMap.get(team.id)?.name || 'Challenger',
        target_team_id: targetTeamId,
        target_team_name: teamsMap.get(targetTeamId)?.name || 'Nemesis',
        attacker_vessel: hunterVessel,
        target_vessel: targetVessel,
        attacker_crashed: hunterCrashed,
        target_crashed: targetCrashed,
        leash_snapped: hunterCrashed,
        event_type: eventType,
        success: !hunterCrashed,
        guessed_vessel: vote.cerberus_guessed_vessel || targetVessel,
        actual_vessel: targetVessel,
        attacker_bonus: attackerBonus,
        target_penalty: targetPenalty,
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
