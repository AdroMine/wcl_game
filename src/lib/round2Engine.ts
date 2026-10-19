import type {
  Round2ClashData,
  Round2Match,
  Round2ScoringTier,
  Round2Stance,
  Round2Vote,
  Player,
} from '../types';
import { DEFAULT_ROUND2_CONFIG } from './defaultConfig';

/**
 * Generate a unique 2-digit battle code (e.g. "49")
 */
export function generateBattleCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = String(Math.floor(10 + Math.random() * 90)); // "10" to "99"
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  return String(Math.floor(10 + Math.random() * 90));
}

/**
 * Team Stance Determination:
 * Simple majority of active votes determines team stance (AMBUSH or TRUCE).
 * Tie-Breaker: If votes split evenly (e.g., 2–2 with 1 abstain, or a 4-player team),
 * the Negotiator role's vote breaks the tie. If still tied or absent, default to TRUCE.
 */
export function calculateTeamStance(
  votes: Record<string, Round2Vote>,
  memberIds: string[],
  playersMap: Map<string, Player>
): Round2Stance {
  let truceCount = 0;
  let ambushCount = 0;

  for (const pid of memberIds) {
    const vote = votes[pid];
    if (vote === 'TRUCE') truceCount++;
    else if (vote === 'AMBUSH') ambushCount++;
  }

  if (ambushCount > truceCount) return 'AMBUSH';
  if (truceCount > ambushCount) return 'TRUCE';

  // Tie-breaker: Check Negotiator vote
  const negotiatorId = memberIds.find(pid => {
    const p = playersMap.get(pid);
    return p?.roleId === 'negotiator';
  });

  if (negotiatorId && votes[negotiatorId]) {
    const negVote = votes[negotiatorId];
    if (negVote === 'AMBUSH') return 'AMBUSH';
    if (negVote === 'TRUCE') return 'TRUCE';
  }

  // If still tied, abstained, or absent: default to TRUCE
  return 'TRUCE';
}

/**
 * Escalating Stakes Calculation from dynamic config scoring matrix
 */
export function calculateClashPoints(
  stanceA: Round2Stance,
  stanceB: Round2Stance,
  clashNum: number,
  scoringMatrix?: Record<string, Round2ScoringTier>
): { team_a_pts: number; team_b_pts: number } {
  const matrix = scoringMatrix || DEFAULT_ROUND2_CONFIG.scoring_matrix;
  const tier: Round2ScoringTier =
    matrix[String(clashNum)] ||
    DEFAULT_ROUND2_CONFIG.scoring_matrix[String(clashNum)] ||
    DEFAULT_ROUND2_CONFIG.scoring_matrix['1'];

  if (stanceA === 'TRUCE' && stanceB === 'TRUCE') {
    return { team_a_pts: tier.both_truce, team_b_pts: tier.both_truce };
  }
  if (stanceA === 'AMBUSH' && stanceB === 'TRUCE') {
    return { team_a_pts: tier.ambush_win, team_b_pts: tier.truce_loss };
  }
  if (stanceA === 'TRUCE' && stanceB === 'AMBUSH') {
    return { team_a_pts: tier.truce_loss, team_b_pts: tier.ambush_win };
  }
  // Both AMBUSH
  return { team_a_pts: tier.both_ambush, team_b_pts: tier.both_ambush };
}

export interface NemesisOutcome {
  teamANemesis: string | null;
  teamBNemesis: string | null;
  ambushesAOnB: number;
  ambushesBOnA: number;
  statusA: 'NEMESIS' | 'CUNNING' | 'ALLIES' | 'RIVALS';
  statusB: 'NEMESIS' | 'CUNNING' | 'ALLIES' | 'RIVALS';
}

/**
 * End-of-Round Nemesis Calculation after Clash 3 concludes
 */
export function calculateNemesis(
  clashData: Round2ClashData[],
  teamAId: string,
  teamBId: string
): NemesisOutcome {
  let ambushesAOnB = 0;
  let ambushesBOnA = 0;

  for (const clash of clashData) {
    if (clash.team_a_stance === 'AMBUSH' && clash.team_b_stance === 'TRUCE') {
      ambushesAOnB++;
    } else if (clash.team_b_stance === 'AMBUSH' && clash.team_a_stance === 'TRUCE') {
      ambushesBOnA++;
    }
  }

  if (ambushesBOnA > ambushesAOnB) {
    return {
      teamANemesis: teamBId,
      teamBNemesis: null,
      ambushesAOnB,
      ambushesBOnA,
      statusA: 'NEMESIS',
      statusB: 'CUNNING',
    };
  }

  if (ambushesAOnB > ambushesBOnA) {
    return {
      teamANemesis: null,
      teamBNemesis: teamAId,
      ambushesAOnB,
      ambushesBOnA,
      statusA: 'CUNNING',
      statusB: 'NEMESIS',
    };
  }

  // Equal
  const isAllies = ambushesAOnB === 0 && ambushesBOnA === 0;
  return {
    teamANemesis: null,
    teamBNemesis: null,
    ambushesAOnB,
    ambushesBOnA,
    statusA: isAllies ? 'ALLIES' : 'RIVALS',
    statusB: isAllies ? 'ALLIES' : 'RIVALS',
  };
}

/**
 * Mask individual ballot selections from opponents and teammates during Phase 3 (VOTE).
 * Only Phase 4 (DEBRIEF) reveals stances and votes.
 */
export function sanitizeMatchForPlayer(
  match: Round2Match,
  playerId?: string,
  playerTeamId?: string | null
): Round2Match {
  if (match.current_phase !== 'VOTE') {
    return match;
  }

  // Deep clone clash_data to mask
  const sanitizedClashData = match.clash_data.map(clash => {
    if (clash.clash !== match.current_clash) {
      return clash;
    }

    const maskedA: Record<string, Round2Vote> = {};
    const isPlayerInTeamA = playerTeamId === match.team_a_id;
    const isPlayerInTeamB = playerTeamId === match.team_b_id;

    if (isPlayerInTeamA) {
      for (const [pid, vote] of Object.entries(clash.team_a_votes || {})) {
        maskedA[pid] = pid === playerId ? vote : ('LOCKED' as any);
      }
    }

    const maskedB: Record<string, Round2Vote> = {};
    if (isPlayerInTeamB) {
      for (const [pid, vote] of Object.entries(clash.team_b_votes || {})) {
        maskedB[pid] = pid === playerId ? vote : ('LOCKED' as any);
      }
    }

    return {
      ...clash,
      team_a_votes: maskedA,
      team_b_votes: maskedB,
      team_a_stance: 'TRUCE' as Round2Stance,
      team_b_stance: 'TRUCE' as Round2Stance,
      team_a_pts: 0,
      team_b_pts: 0,
    };
  });

  return {
    ...match,
    clash_data: sanitizedClashData,
  };
}
