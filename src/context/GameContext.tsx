import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import type { SyncPayload, Player, Team, RoleConfig, RoundConfig, Round2Match } from '../types';
import {
  joinPlayer,
  leavePlayer,
  formTeamApi,
  renameTeamApi,
  submitRoundAnswerApi,
  pollSyncApi,
  round2PairByCodeApi,
  round2CastVoteApi,
  round2AdvancePhaseApi,
  requestRoundHintApi,
  rerollPlayerRoleApi,
} from '../lib/api';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface GameContextType {
  payload: SyncPayload | null;
  player: Player | null;
  team: Team | null;
  role: RoleConfig | null;
  currentRound: RoundConfig | null;
  round2Match: Round2Match | null;
  connectionStatus: 'connected' | 'connecting' | 'reconnecting' | 'polling-fallback' | 'disconnected';
  lastSyncedAt: Date | null;
  lowDataMode: boolean;
  toggleLowDataMode: () => void;
  isLeaderboardOpen: boolean;
  setIsLeaderboardOpen: (open: boolean) => void;
  join: (name: string) => Promise<void>;
  leave: () => Promise<void>;
  formTeam: (joinCodes: string[], customName?: string) => Promise<{ success: boolean; error?: string }>;
  renameTeam: (name: string) => Promise<{ success: boolean; error?: string }>;
  submitAnswer: (answer: string) => Promise<{ success: boolean; message: string; points?: number; isCorrect?: boolean }>;
  requestHint: (hintIndex: number) => Promise<{ success: boolean; hint?: string; error?: string }>;
  switchPlayer: (playerId: string) => void;
  pairRound2: (opponentBattleCode: string) => Promise<{ success: boolean; error?: string }>;
  voteRound2: (vote: 'TRUCE' | 'AMBUSH') => Promise<{ success: boolean; error?: string }>;
  advanceRound2: (matchId?: string) => Promise<void>;
  timeRemainingSeconds: number;
  rerollRole: () => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

const PLAYER_ID_KEY = 'underworld_player_id';
const LOW_DATA_KEY = 'underworld_low_data';

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [payload, setPayload] = useState<SyncPayload | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'reconnecting' | 'polling-fallback' | 'disconnected'>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [lowDataMode, setLowDataMode] = useState<boolean>(() => {
    return localStorage.getItem(LOW_DATA_KEY) === 'true';
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const sseReconnectTimeoutRef = useRef<number | null>(null);

  // Sync low-data-mode class on body
  useEffect(() => {
    if (lowDataMode) {
      document.body.classList.add('low-data-mode');
    } else {
      document.body.classList.remove('low-data-mode');
    }
    localStorage.setItem(LOW_DATA_KEY, String(lowDataMode));
  }, [lowDataMode]);

  const toggleLowDataMode = () => {
    setLowDataMode(prev => !prev);
  };

  const updateWithPayload = useCallback((data: SyncPayload) => {
    setPayload(data);
    setLastSyncedAt(new Date());
    if (data.server_now) {
      setServerTimeOffset(data.server_now - Date.now());
    }
  }, []);

  // Poll fallback / manual sync
  const runPoll = useCallback(async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY) || undefined;
    try {
      const data = await pollSyncApi(playerId);
      updateWithPayload(data);
      setConnectionStatus(prev => prev === 'connected' ? 'connected' : 'polling-fallback');
    } catch (e) {
      console.warn('Poll failed:', e);
      setConnectionStatus('disconnected');
    }
  }, [updateWithPayload]);

  // Connect to SSE stream (for local Node/Express dev)
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const playerId = localStorage.getItem(PLAYER_ID_KEY) || '';
    const url = `/api/events?playerId=${encodeURIComponent(playerId)}`;

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnectionStatus('connected');
        if (pollingIntervalRef.current) {
          window.clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };

      es.onmessage = (event) => {
        try {
          const data: SyncPayload = JSON.parse(event.data);
          updateWithPayload(data);
          setConnectionStatus('connected');
        } catch (err) {
          console.error('Failed to parse SSE payload:', err);
        }
      };

      es.onerror = () => {
        console.warn('SSE disconnected, falling back to polling...');
        es.close();
        eventSourceRef.current = null;
        setConnectionStatus('polling-fallback');

        if (!pollingIntervalRef.current) {
          runPoll();
          const intervalMs = lowDataMode ? 20000 : 10000;
          pollingIntervalRef.current = window.setInterval(runPoll, intervalMs);
        }

        if (!sseReconnectTimeoutRef.current) {
          sseReconnectTimeoutRef.current = window.setTimeout(() => {
            sseReconnectTimeoutRef.current = null;
            connectSSE();
          }, 5000);
        }
      };
    } catch (e) {
      console.error('Could not initiate SSE:', e);
      setConnectionStatus('polling-fallback');
      if (!pollingIntervalRef.current) {
        runPoll();
        pollingIntervalRef.current = window.setInterval(runPoll, 10000);
      }
    }
  }, [runPoll, updateWithPayload, lowDataMode]);

  // Handle Realtime connection & auto-sync
  useEffect(() => {
    // Initial fetch
    runPoll();

    // Pub-friendly Wakeup: When phone screen turns on or user switches tabs, sync immediately
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runPoll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (isSupabaseConfigured && supabase) {
      // Connect to Supabase Realtime Channel
      const channel = supabase
        .channel('underworld_game_updates')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, () => {
          runPoll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
          runPoll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
          runPoll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'round2_matches' }, () => {
          runPoll();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setConnectionStatus('connected');
          } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
            setConnectionStatus('reconnecting');
          }
        });

      // Background heartbeat poll (every 10s, or 20s in low data mode)
      const pollInterval = window.setInterval(runPoll, lowDataMode ? 20000 : 10000);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.clearInterval(pollInterval);
        supabase?.removeChannel(channel);
      };
    } else {
      // Use local SSE
      connectSSE();

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (eventSourceRef.current) eventSourceRef.current.close();
        if (pollingIntervalRef.current) window.clearInterval(pollingIntervalRef.current);
        if (sseReconnectTimeoutRef.current) window.clearTimeout(sseReconnectTimeoutRef.current);
      };
    }
  }, [runPoll, connectSSE, lowDataMode]);

  // Derived values
  const player = payload?.player || null;
  const team = payload?.team || null;
  const role = player && payload ? payload.config.roles.find(r => r.id === player.roleId) || null : null;
  const currentRound = payload ? payload.config.rounds[payload.current_round_index] || null : null;
  const round2Match = payload?.round2_match || null;

  // Real-time server synchronized timer countdown
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number>(0);

  useEffect(() => {
    if (!payload?.round_ends_at || payload.state !== 'ROUND_ACTIVE') {
      setTimeRemainingSeconds(0);
      return;
    }

    if (payload.round_is_paused) {
      return;
    }

    const interval = setInterval(() => {
      const nowEstimatedServer = Date.now() + serverTimeOffset;
      const left = Math.max(0, Math.round((payload.round_ends_at! - nowEstimatedServer) / 1000));
      setTimeRemainingSeconds(left);
    }, 500);

    return () => clearInterval(interval);
  }, [payload?.round_ends_at, payload?.state, payload?.round_is_paused, serverTimeOffset]);

  // Player actions
  const join = async (name: string) => {
    const existingId = localStorage.getItem(PLAYER_ID_KEY) || undefined;
    const res = await joinPlayer(name, existingId);
    if (res.player?.id) {
      localStorage.setItem(PLAYER_ID_KEY, res.player.id);
      await runPoll();
    }
  };

  const leave = async () => {
    const existingId = localStorage.getItem(PLAYER_ID_KEY);
    if (existingId) {
      await leavePlayer(existingId);
      localStorage.removeItem(PLAYER_ID_KEY);
      setPayload(prev => prev ? { ...prev, player: null, team: null } : null);
      await runPoll();
    }
  };

  const formTeam = async (joinCodes: string[], customName?: string) => {
    if (!player) return { success: false, error: 'Not joined in game' };
    try {
      await formTeamApi(player.id, joinCodes, customName);
      await runPoll();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to form crew' };
    }
  };

  const renameTeam = async (name: string) => {
    if (!team) return { success: false, error: 'No crew to rename' };
    try {
      await renameTeamApi(team.id, name);
      await runPoll();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to rename' };
    }
  };

  const submitAnswer = async (answer: string) => {
    if (!player || !currentRound) {
      return { success: false, message: 'Cannot submit right now' };
    }
    const res = await submitRoundAnswerApi(player.id, currentRound.id, answer);
    await runPoll();
    return res;
  };

  const requestHint = async (hintIndex: number) => {
    if (!team) return { success: false, error: 'You must form or belong to a crew first.' };
    try {
      const res = await requestRoundHintApi(team.id, hintIndex);
      await runPoll();
      return res;
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to request hint.' };
    }
  };

  const switchPlayer = async (targetPlayerId: string) => {
    localStorage.setItem(PLAYER_ID_KEY, targetPlayerId);
    await runPoll();
  };

  const pairRound2 = async (opponentBattleCode: string) => {
    if (!team) return { success: false, error: 'You must form or belong to a crew first.' };
    try {
      const res = await round2PairByCodeApi(team.id, opponentBattleCode);
      await runPoll();
      return res;
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to link squads.' };
    }
  };

  const voteRound2 = async (vote: 'TRUCE' | 'AMBUSH') => {
    if (!player || !team || !round2Match) {
      return { success: false, error: 'Cannot vote: match or player record not found.' };
    }
    try {
      const res = await round2CastVoteApi(round2Match.id, player.id, team.id, vote);
      await runPoll();
      return res;
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to cast ballot.' };
    }
  };

  const advanceRound2 = async (matchId?: string) => {
    const id = matchId || round2Match?.id;
    if (!id) return;
    try {
      await round2AdvancePhaseApi(id);
      await runPoll();
    } catch (err) {
      console.warn('Advance round 2 error:', err);
    }
  };

  const rerollRole = async (): Promise<{ success: boolean; error?: string }> => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return { success: false, error: 'No active shade found' };

    try {
      const res = await rerollPlayerRoleApi(playerId);
      if (res.success && res.player) {
        setPayload(prev => prev ? {
          ...prev,
          player: res.player!,
        } : prev);
        await runPoll();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to reroll role' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Error rerolling role' };
    }
  };

  return (
    <GameContext.Provider
      value={{
        payload,
        player,
        team,
        role,
        currentRound,
        round2Match,
        connectionStatus,
        lastSyncedAt,
        lowDataMode,
        toggleLowDataMode,
        isLeaderboardOpen,
        setIsLeaderboardOpen,
        join,
        leave,
        formTeam,
        renameTeam,
        submitAnswer,
        requestHint,
        switchPlayer,
        pairRound2,
        voteRound2,
        advanceRound2,
        rerollRole,
        timeRemainingSeconds,
        refresh: runPoll,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGameSession = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGameSession must be used within a GameProvider');
  }
  return context;
};
