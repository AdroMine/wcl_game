import { isSupabaseConfigured } from './supabase';
import QRCode from 'qrcode';
import {
  fetchFullSyncPayloadFromSupabase,
  supabaseJoinPlayer,
  supabaseLeavePlayer,
  supabaseFormTeam,
  supabaseRenameTeam,
  supabaseSubmitRoundAnswer,
  supabaseAdminSetState,
  supabaseAdminAdjustTimer,
  supabaseAdminChangeRole,
  supabaseAdminMovePlayerTeam,
  supabaseAdminRemovePlayer,
  supabaseAdminAddPlayer,
  supabaseAdminAdjustTeamScore,
  supabaseAdminUpdateConfig,
  supabaseAdminResetGame,
  supabaseAdminDeleteTeam,
  supabaseAdminAutoGroup,
  supabaseAdminSpawnDemoCrew,
  supabaseVerifyAdminPasscode,
  supabaseRound2PairByCode,
  supabaseRound2CastVote,
  supabaseRound2AdvancePhase,
  supabaseAdminRound2AutoPair,
  supabaseAdminRound2ManualPair,
  supabaseAdminRound2AdjustTimer,
  supabaseAdminRound2SkipPhase,
  supabaseAdminRound2ResetMatches,
  supabaseAdminRound2SaveDurations,
  supabaseAdminRound2SaveScoring,
  supabaseRequestRoundHint,
} from './supabaseService';
import type { GameState, GameConfig, Round2ScoringTier } from '../types';

const API_BASE = '/api';

export async function fetchServerInfo() {
  if (isSupabaseConfigured) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wcl-game.pages.dev';
    try {
      const qrDataUrl = await QRCode.toDataURL(origin, {
        margin: 1,
        width: 320,
        color: {
          dark: '#08090c',
          light: '#f4f0e8',
        },
      });
      return {
        localIp: 'Cloud Edge',
        port: 443,
        clientPort: '443',
        joinUrl: origin,
        qrDataUrl,
      };
    } catch {
      return {
        localIp: 'Cloud Edge',
        port: 443,
        clientPort: '443',
        joinUrl: origin,
        qrDataUrl: null,
      };
    }
  }

  const res = await fetch(`${API_BASE}/server-info`);
  if (!res.ok) throw new Error('Failed to fetch server info');
  return res.json();
}

export async function joinPlayer(name: string, playerId?: string) {
  if (isSupabaseConfigured) {
    return supabaseJoinPlayer(name, playerId);
  }
  const res = await fetch(`${API_BASE}/player/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, playerId }),
  });
  if (!res.ok) throw new Error('Failed to join game');
  return res.json();
}

export async function leavePlayer(playerId: string) {
  if (isSupabaseConfigured) {
    return supabaseLeavePlayer(playerId);
  }
  const res = await fetch(`${API_BASE}/player/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error('Failed to leave game');
  return res.json();
}

export async function formTeamApi(leaderPlayerId: string, joinCodes: string[], customName?: string) {
  if (isSupabaseConfigured) {
    const res = await supabaseFormTeam(leaderPlayerId, joinCodes, customName);
    if (!res.success) throw new Error(res.error || 'Failed to form crew');
    return res;
  }
  const res = await fetch(`${API_BASE}/team/form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaderPlayerId, joinCodes, customName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to form crew');
  return data;
}

export async function renameTeamApi(teamId: string, name: string) {
  if (isSupabaseConfigured) {
    const res = await supabaseRenameTeam(teamId, name);
    if (!res.success) throw new Error(res.error || 'Failed to rename crew');
    return res;
  }
  const res = await fetch(`${API_BASE}/team/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to rename crew');
  return data;
}

export async function submitRoundAnswerApi(playerId: string, roundId: string, answer: string) {
  if (isSupabaseConfigured) {
    return supabaseSubmitRoundAnswer(playerId, roundId, answer);
  }
  const res = await fetch(`${API_BASE}/round/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, roundId, answer }),
  });
  return res.json();
}

export async function requestRoundHintApi(teamId: string, hintIndex: number) {
  if (isSupabaseConfigured) {
    return supabaseRequestRoundHint(teamId, hintIndex);
  }
  const res = await fetch(`${API_BASE}/round/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, hintIndex }),
  });
  return res.json();
}

export async function pollSyncApi(playerId?: string) {
  if (isSupabaseConfigured) {
    return fetchFullSyncPayloadFromSupabase(playerId);
  }
  const url = playerId ? `${API_BASE}/sync?playerId=${encodeURIComponent(playerId)}` : `${API_BASE}/sync`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Polling sync failed');
  return res.json();
}

// Admin API
export async function verifyAdminPasscode(passcode: string) {
  if (isSupabaseConfigured) {
    return supabaseVerifyAdminPasscode(passcode);
  }
  const res = await fetch(`${API_BASE}/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  return res.ok;
}

export async function adminSetState(passcode: string, state: string, roundIndex?: number) {
  if (isSupabaseConfigured) {
    await supabaseAdminSetState(state as GameState, roundIndex);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ state, roundIndex }),
  });
  return res.json();
}

export async function adminAdjustTimer(passcode: string, action: 'adjust' | 'pause', secondsDelta?: number) {
  if (isSupabaseConfigured) {
    await supabaseAdminAdjustTimer(action, secondsDelta);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/timer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ action, secondsDelta }),
  });
  return res.json();
}

export async function adminChangeRole(passcode: string, playerId: string, roleId: string) {
  if (isSupabaseConfigured) {
    await supabaseAdminChangeRole(playerId, roleId);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/player/role`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ playerId, roleId }),
  });
  return res.json();
}

export async function adminMovePlayerTeam(passcode: string, playerId: string, targetTeamId: string | null) {
  if (isSupabaseConfigured) {
    await supabaseAdminMovePlayerTeam(playerId, targetTeamId);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/player/team`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ playerId, targetTeamId }),
  });
  return res.json();
}

export async function adminRemovePlayer(passcode: string, playerId: string) {
  if (isSupabaseConfigured) {
    await supabaseAdminRemovePlayer(playerId);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/player/remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ playerId }),
  });
  return res.json();
}

export async function adminAutoGroup(passcode: string) {
  if (isSupabaseConfigured) {
    await supabaseAdminAutoGroup();
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/auto-group`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function adminSpawnDemoCrew(passcode: string) {
  if (isSupabaseConfigured) {
    await supabaseAdminSpawnDemoCrew();
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/spawn-demo-crew`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function adminAddPlayer(passcode: string, name: string, roleId?: string) {
  if (isSupabaseConfigured) {
    const player = await supabaseAdminAddPlayer(name, roleId);
    return { success: true, player };
  }
  const res = await fetch(`${API_BASE}/admin/player/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ name, roleId }),
  });
  return res.json();
}

export async function adminAdjustTeamScore(passcode: string, teamId: string, delta: number) {
  if (isSupabaseConfigured) {
    await supabaseAdminAdjustTeamScore(teamId, delta);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/team/score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ teamId, delta }),
  });
  return res.json();
}

export async function adminUpdateConfig(passcode: string, config: GameConfig) {
  if (isSupabaseConfigured) {
    await supabaseAdminUpdateConfig(config);
    return { success: true };
  }
  const res = await fetch(`${API_BASE}/admin/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ config }),
  });
  return res.json();
}

export async function adminDeleteTeam(passcode: string, teamId: string) {
  if (isSupabaseConfigured) {
    return supabaseAdminDeleteTeam(teamId);
  }
  const res = await fetch(`${API_BASE}/admin/team/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ teamId }),
  });
  return res.json();
}

export async function adminResetGame(passcode: string) {
  if (isSupabaseConfigured) {
    return supabaseAdminResetGame();
  }
  const res = await fetch(`${API_BASE}/admin/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({}),
  });
  return res.json();
}

// ==========================================
// ROUND 2: SHADES IN THE MIST
// ==========================================

export async function round2PairByCodeApi(myTeamId: string, opponentBattleCode: string) {
  if (isSupabaseConfigured) {
    return supabaseRound2PairByCode(myTeamId, opponentBattleCode);
  }
  const res = await fetch(`${API_BASE}/round2/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ myTeamId, opponentBattleCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to link squads');
  return data;
}

export async function round2CastVoteApi(matchId: string, playerId: string, teamId: string, vote: 'TRUCE' | 'AMBUSH') {
  if (isSupabaseConfigured) {
    return supabaseRound2CastVote(matchId, playerId, teamId, vote);
  }
  const res = await fetch(`${API_BASE}/round2/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId, playerId, teamId, vote }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to record ballot');
  return data;
}

export async function round2AdvancePhaseApi(matchId: string) {
  if (isSupabaseConfigured) {
    return supabaseRound2AdvancePhase(matchId);
  }
  const res = await fetch(`${API_BASE}/round2/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  });
  return res.json();
}

export async function adminRound2AutoPair(passcode: string) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2AutoPair();
  }
  const res = await fetch(`${API_BASE}/admin/round2/auto-pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
  });
  return res.json();
}

export async function adminRound2ManualPair(passcode: string, teamAId: string, teamBId: string) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2ManualPair(teamAId, teamBId);
  }
  const res = await fetch(`${API_BASE}/admin/round2/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ teamAId, teamBId }),
  });
  return res.json();
}

export async function adminRound2AdjustTimer(passcode: string, deltaSeconds: number) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2AdjustTimer(deltaSeconds);
  }
  const res = await fetch(`${API_BASE}/admin/round2/timer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ deltaSeconds }),
  });
  return res.json();
}

export async function adminRound2SkipPhase(passcode: string, matchId?: string) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2SkipPhase(matchId);
  }
  const res = await fetch(`${API_BASE}/admin/round2/skip-phase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ matchId }),
  });
  return res.json();
}

export async function adminRound2ResetMatches(passcode: string) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2ResetMatches();
  }
  const res = await fetch(`${API_BASE}/admin/round2/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
  });
  return res.json();
}

export async function adminRound2SaveDurations(
  passcode: string,
  durations: { HUDDLE: number; PARLEY: number; VOTE: number; DEBRIEF: number }
) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2SaveDurations(durations);
  }
  const res = await fetch(`${API_BASE}/admin/round2/durations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ durations }),
  });
  return res.json();
}

export async function adminRound2SaveScoring(
  passcode: string,
  scoringMatrix: Record<string, Round2ScoringTier>
) {
  if (isSupabaseConfigured) {
    return supabaseAdminRound2SaveScoring(scoringMatrix);
  }
  const res = await fetch(`${API_BASE}/admin/round2/scoring`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': passcode,
    },
    body: JSON.stringify({ scoringMatrix }),
  });
  return res.json();
}

