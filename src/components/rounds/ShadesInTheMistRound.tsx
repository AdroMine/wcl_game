import React, { useState, useEffect, useRef } from 'react';
import { useGameSession } from '../../context/GameContext';
import {
  Shield,
  MessageSquare,
  Vote,
  Sparkles,
  Swords,
  Crown,
  Handshake,
  Skull,
  Lock,
  Clock,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Round2Phase, Round2ClashData } from '../../types';

export const ShadesInTheMistRound: React.FC = () => {
  const {
    player,
    team,
    role,
    payload,
    round2Match,
    pairRound2,
    voteRound2,
    advanceRound2,
  } = useGameSession();

  // Matchmaking link input
  const [battleCodeInput, setBattleCodeInput] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Voting state
  const [isVoting, setIsVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  // Transition cues
  const [borderFlash, setBorderFlash] = useState(false);
  const prevPhaseRef = useRef<Round2Phase | null>(null);

  // Local phase timer countdown
  const [phaseSecondsLeft, setPhaseSecondsLeft] = useState<number>(0);

  // Trigger phase advancement when local timer hits 0
  const isAdvancingRef = useRef(false);

  useEffect(() => {
    if (!round2Match?.phase_ends_at || round2Match.completed) {
      setPhaseSecondsLeft(0);
      return;
    }

    const checkTimer = () => {
      const now = Date.now();
      const left = Math.max(0, Math.round((round2Match.phase_ends_at - now) / 1000));
      setPhaseSecondsLeft(left);

      // Trigger automatic phase transition when time hits 0
      if (left <= 0 && !isAdvancingRef.current && !round2Match.completed) {
        isAdvancingRef.current = true;
        advanceRound2(round2Match.id).finally(() => {
          setTimeout(() => {
            isAdvancingRef.current = false;
          }, 3000);
        });
      }
    };

    checkTimer();
    const interval = setInterval(checkTimer, 500);
    return () => clearInterval(interval);
  }, [round2Match?.phase_ends_at, round2Match?.completed, round2Match?.id]);

  // Haptic & visual cue on transition to Phase 2 (PARLEY)
  useEffect(() => {
    if (round2Match?.current_phase) {
      if (
        prevPhaseRef.current !== round2Match.current_phase &&
        round2Match.current_phase === 'PARLEY'
      ) {
        try {
          if ('vibrate' in navigator) {
            navigator.vibrate(200);
          }
        } catch (e) {
          // ignore
        }
        setBorderFlash(true);
        setTimeout(() => setBorderFlash(false), 2000);
      }

      // Confetti on match completion if team did well
      if (
        round2Match.completed &&
        prevPhaseRef.current !== 'DEBRIEF' &&
        prevPhaseRef.current !== null
      ) {
        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.6 },
            colors: ['#c4a45a', '#38bdf8', '#fb923c'],
          });
        } catch (e) {
          // ignore
        }
      }

      prevPhaseRef.current = round2Match.current_phase;
    }
  }, [round2Match?.current_phase, round2Match?.completed]);

  // Handle pairing submission
  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!battleCodeInput.trim()) return;
    setLinkError(null);
    setIsLinking(true);
    try {
      const res = await pairRound2(battleCodeInput.trim());
      if (!res.success) {
        setLinkError(res.error || 'Could not link with this squad.');
      } else {
        setBattleCodeInput('');
      }
    } catch (err: any) {
      setLinkError(err.message || 'Failed to connect squads.');
    } finally {
      setIsLinking(false);
    }
  };

  // Handle vote selection
  const handleVote = async (choice: 'TRUCE' | 'AMBUSH') => {
    if (isVoting) return;
    setIsVoting(true);
    setVoteError(null);
    try {
      const res = await voteRound2(choice);
      if (!res.success) {
        setVoteError(res.error || 'Failed to submit ballot.');
      }
    } catch (err: any) {
      setVoteError(err.message || 'Vote failed.');
    } finally {
      setIsVoting(false);
    }
  };

  // ----------------------------------------------------
  // VIEW 1: UNPAIRED / MATCHMAKING VIEW
  // ----------------------------------------------------
  if (!round2Match) {
    const myBattleCode = team?.battle_code || '??';

    // List available unlinked squads for reference
    const allTeams = payload?.teams_leaderboard || [];
    const activeMatches = payload?.round2_all_matches || [];
    const activeTeamIds = new Set<string>();
    for (const m of activeMatches) {
      if (!m.completed) {
        activeTeamIds.add(m.team_a_id);
        activeTeamIds.add(m.team_b_id);
      }
    }
    const otherAvailableTeams = allTeams.filter(
      t => t.id !== team?.id && !activeTeamIds.has(t.id)
    );

    return (
      <div className="space-y-4 py-2">
        {/* Title Card */}
        <div className="bg-[#10121a] border border-[#c4a45a]/40 rounded-2xl p-5 shadow-2xl text-center space-y-2 relative overflow-hidden">
          <div className="absolute inset-0 bg-radial-vignette opacity-40 pointer-events-none" />
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#c4a45a]/10 border border-[#c4a45a]/30 text-[#c4a45a] text-[10px] font-mono uppercase tracking-wider font-bold">
            <Swords className="w-3.5 h-3.5" />
            <span>Squad Face-off Matchmaking</span>
          </div>
          <h2 className="text-xl font-serif font-black text-[#f4f0e8] tracking-tight">
            Round 2: Shades in the Mist
          </h2>
          <p className="text-xs text-[#8e95a5] max-w-sm mx-auto leading-relaxed">
            Find an opposing squad in the pub. Either table enters the other&apos;s 2-digit battle code to initiate your 3-clash duel.
          </p>
        </div>

        {/* My Team's 2-Digit Battle Code Beacon */}
        <div className="bg-gradient-to-b from-[#161922] to-[#10121a] border-2 border-[#c4a45a] rounded-2xl p-6 text-center shadow-beacon space-y-2" style={{ '--beacon-glow': 'rgba(196, 164, 90, 0.35)' } as React.CSSProperties}>
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#8e95a5] font-bold block">
            YOUR SQUAD&apos;S BATTLE CODE
          </span>
          <div className="flex items-center justify-center space-x-3 py-2">
            <span className="text-5xl font-mono font-black text-[#c4a45a] tracking-[0.25em] pl-3 py-1 px-4 rounded-xl bg-[#08090c] border border-[#c4a45a]/40 shadow-inner">
              {myBattleCode}
            </span>
          </div>
          <p className="text-[11px] text-[#f4f0e8] font-serif italic">
            Show this code to the table you wish to duel!
          </p>
        </div>

        {/* Enter Opponent's Code Box */}
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
          <div className="flex items-center space-x-2 text-xs font-serif font-bold text-[#f4f0e8]">
            <Handshake className="w-4 h-4 text-cyan-400" />
            <span>Link With Opposing Crew</span>
          </div>
          <p className="text-[11px] text-[#8e95a5]">
            Or enter the 2-digit battle code shown on your rival&apos;s phone:
          </p>

          <form onSubmit={handlePairSubmit} className="space-y-3">
            <div className="flex space-x-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={battleCodeInput}
                onChange={e => setBattleCodeInput(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="49"
                className="w-24 bg-[#08090c] border-2 border-[#2a2e3d] focus:border-cyan-400 rounded-xl px-3 py-2.5 text-center text-2xl font-mono font-black text-[#f4f0e8] outline-none tracking-widest"
              />
              <button
                type="submit"
                disabled={isLinking || battleCodeInput.length < 2}
                className={`flex-1 py-3 px-4 rounded-xl font-serif font-bold text-xs tracking-wide transition-all flex items-center justify-center space-x-1.5 ${
                  battleCodeInput.length === 2 && !isLinking
                    ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white shadow-lg shadow-cyan-900/30 active:scale-[0.98]'
                    : 'bg-[#161922] text-[#8e95a5] border border-[#2a2e3d] cursor-not-allowed'
                }`}
              >
                <span>{isLinking ? 'Linking...' : '⚔️ Initiate Clash'}</span>
                {!isLinking && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>

            {linkError && (
              <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/50 text-red-300 text-xs font-mono text-center">
                {linkError}
              </div>
            )}
          </form>
        </div>

        {/* Available Rivals in Pub */}
        {otherAvailableTeams.length > 0 && (
          <div className="bg-[#10121a]/60 border border-[#2a2e3d]/50 rounded-xl p-3 text-[11px]">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] font-bold block mb-1.5">
              Available Crews Waiting to Clash ({otherAvailableTeams.length})
            </span>
            <div className="space-y-1.5">
              {otherAvailableTeams.map(t => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-[#161922]/50 border border-[#2a2e3d]/40"
                >
                  <span className="font-serif font-bold text-[#f4f0e8] truncate max-w-[200px]">
                    {t.name}
                  </span>
                  <button
                    onClick={() => {
                      if (t.battle_code) {
                        setBattleCodeInput(t.battle_code);
                      }
                    }}
                    className="px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] font-bold hover:bg-cyan-900/60"
                  >
                    Code [{t.battle_code || '??'}]
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // IN-MATCH LOGIC & COMMON DATA
  // ----------------------------------------------------
  const currentClash = round2Match.current_clash || 1;
  const currentPhase: Round2Phase = round2Match.current_phase || 'HUDDLE';
  const isMatchComplete = round2Match.completed;

  // Determine which team is "us" and which is "them"
  const isTeamA = round2Match.team_a_id === team?.id;
  const opponentTeamId = isTeamA ? round2Match.team_b_id : round2Match.team_a_id;
  const opponentTeam = payload?.teams_leaderboard?.find(t => t.id === opponentTeamId);
  const opponentName = opponentTeam?.name || 'Opposing Crew';
  const opponentBattleCode = opponentTeam?.battle_code || '??';

  // Dynamic point matrix from game_session.config.round2
  const r2Config = payload?.config?.round2;
  const scoringTier =
    r2Config?.scoring_matrix?.[String(currentClash)] || {
      both_truce: 75 * currentClash,
      ambush_win: 150 * currentClash,
      truce_loss: 0,
      both_ambush: 15 * currentClash,
    };

  // Find clash data
  const clashDataList: Round2ClashData[] = round2Match.clash_data || [];
  const curClashRecord = clashDataList.find(c => c.clash === currentClash);

  // My team votes map
  const myTeamVotes = isTeamA ? curClashRecord?.team_a_votes || {} : curClashRecord?.team_b_votes || {};
  const myVote = player ? myTeamVotes[player.id] : undefined;
  const hasMyVoteRecorded = myVote === 'TRUCE' || myVote === 'AMBUSH';

  // Team members list
  const teamMembers = team?.player_ids || [];
  const teamMemberInfoList = teamMembers.map(pid => {
    const p = payload?.teams_leaderboard?.find(t => t.id === team?.id)?.members.find(m => m.id === pid);
    const vote = myTeamVotes[pid];
    const isSelf = pid === player?.id;
    return {
      id: pid,
      name: isSelf ? `${p?.name || 'You'} (You)` : p?.name || 'Teammate',
      roleName: p?.roleName || 'Crew Member',
      roleColor: p?.roleColor || '#c4a45a',
      hasVoted: Boolean(vote),
      voteValue: isSelf ? vote : vote === 'LOCKED' ? 'LOCKED' : vote,
      isSelf,
    };
  });

  // Calculate tie-breaker information
  const isNegotiator = role?.id === 'negotiator';

  // Phase Timer format
  const mins = Math.floor(phaseSecondsLeft / 60);
  const secs = phaseSecondsLeft % 60;
  const formattedPhaseTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isUrgent = phaseSecondsLeft > 0 && phaseSecondsLeft <= 10;

  // ----------------------------------------------------
  // VIEW 2: MATCH COMPLETED / NEMESIS SUMMARY
  // ----------------------------------------------------
  if (isMatchComplete) {
    const nemesisTeamId = team?.nemesis_team_id;
    const isNemesisVictim = nemesisTeamId === opponentTeamId;

    // Check if opponent marked us as nemesis
    const isNemesisVictor = opponentTeam?.nemesis_team_id === team?.id;

    // Ambushes count
    let myAmbushes = 0;
    let enemyAmbushes = 0;
    for (const c of clashDataList) {
      const myStance = isTeamA ? c.team_a_stance : c.team_b_stance;
      const enemyStance = isTeamA ? c.team_b_stance : c.team_a_stance;
      if (myStance === 'AMBUSH' && enemyStance === 'TRUCE') myAmbushes++;
      if (enemyStance === 'AMBUSH' && myStance === 'TRUCE') enemyAmbushes++;
    }

    const totalPointsWon = clashDataList.reduce((sum, c) => {
      return sum + (isTeamA ? c.team_a_pts || 0 : c.team_b_pts || 0);
    }, 0);

    return (
      <div className="space-y-4 py-2">
        {/* Banner Card based on Nemesis outcome */}
        {isNemesisVictim ? (
          <div className="bg-gradient-to-b from-red-950/80 to-[#10121a] border-2 border-red-500 rounded-2xl p-6 text-center space-y-3 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-900/60 border border-red-400 flex items-center justify-center mx-auto text-red-200">
              <Skull className="w-6 h-6 animate-pulse" />
            </div>
            <div className="inline-block px-3 py-1 rounded-full bg-red-950 border border-red-500/60 text-red-300 font-mono text-[10px] uppercase font-bold tracking-widest">
              ⚔️ NEMESIS MARKED
            </div>
            <h2 className="text-xl font-serif font-black text-[#f4f0e8]">
              Nemesis Marked: Crew &apos;{opponentName}&apos;
            </h2>
            <p className="text-xs text-red-200/90 font-serif italic max-w-xs mx-auto leading-relaxed">
              &ldquo;They took your supplies in the Stygian mist. Hades remembers this debt. Seek your vengeance in the trials ahead.&rdquo;
            </p>
          </div>
        ) : isNemesisVictor ? (
          <div className="bg-gradient-to-b from-amber-950/80 to-[#10121a] border-2 border-[#c4a45a] rounded-2xl p-6 text-center space-y-3 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center mx-auto text-[#c4a45a]">
              <Crown className="w-6 h-6" />
            </div>
            <div className="inline-block px-3 py-1 rounded-full bg-amber-950 border border-[#c4a45a]/60 text-[#c4a45a] font-mono text-[10px] uppercase font-bold tracking-widest">
              👑 CROWN OF CUNNING
            </div>
            <h2 className="text-xl font-serif font-black text-[#f4f0e8]">
              Crown of Cunning: Victorious
            </h2>
            <p className="text-xs text-[#f4f0e8]/90 font-serif italic max-w-xs mx-auto leading-relaxed">
              &ldquo;You outsmarted Crew &apos;{opponentName}&apos; across the mist. Watch your back in the trials ahead—they will not forget.&rdquo;
            </p>
          </div>
        ) : myAmbushes === 0 && enemyAmbushes === 0 ? (
          <div className="bg-gradient-to-b from-emerald-950/80 to-[#10121a] border-2 border-emerald-500 rounded-2xl p-6 text-center space-y-3 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-emerald-900/60 border border-emerald-400 flex items-center justify-center mx-auto text-emerald-200">
              <Handshake className="w-6 h-6" />
            </div>
            <div className="inline-block px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/60 text-emerald-300 font-mono text-[10px] uppercase font-bold tracking-widest">
              🤝 HONORABLE ALLIES
            </div>
            <h2 className="text-xl font-serif font-black text-[#f4f0e8]">
              Honorable Allies: Unbroken Peace
            </h2>
            <p className="text-xs text-emerald-200/90 font-serif italic max-w-xs mx-auto leading-relaxed">
              &ldquo;Neither crew broke faith in the Stygian mist. Both tables shared supplies and stood honorable before Charon.&rdquo;
            </p>
          </div>
        ) : (
          <div className="bg-gradient-to-b from-cyan-950/80 to-[#10121a] border-2 border-cyan-500 rounded-2xl p-6 text-center space-y-3 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-cyan-900/60 border border-cyan-400 flex items-center justify-center mx-auto text-cyan-200">
              <Swords className="w-6 h-6" />
            </div>
            <div className="inline-block px-3 py-1 rounded-full bg-cyan-950 border border-cyan-500/60 text-cyan-300 font-mono text-[10px] uppercase font-bold tracking-widest">
              ⚔️ EVEN RIVALS
            </div>
            <h2 className="text-xl font-serif font-black text-[#f4f0e8]">
              Even Rivals: Balanced Blood
            </h2>
            <p className="text-xs text-cyan-200/90 font-serif italic max-w-xs mx-auto leading-relaxed">
              &ldquo;You traded blows equally in the Stygian mist. An evenly matched clash of cunning and blades.&rdquo;
            </p>
          </div>
        )}

        {/* Total Points Card */}
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#8e95a5] font-bold block">
              Round 2 Points Earned
            </span>
            <span className="text-xs text-[#f4f0e8]">All 3 Clashes Finalized</span>
          </div>
          <div className="text-right">
            <span className="text-2xl font-mono font-black text-emerald-400">
              +{totalPointsWon}
            </span>
            <span className="text-[10px] font-mono text-[#8e95a5] ml-1">PTS</span>
          </div>
        </div>

        {/* Clash Breakdown History */}
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-2.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold block">
            3-Clash History Breakdown
          </span>
          <div className="space-y-2">
            {clashDataList.map(c => {
              const myStance = isTeamA ? c.team_a_stance : c.team_b_stance;
              const enemyStance = isTeamA ? c.team_b_stance : c.team_a_stance;
              const myPts = isTeamA ? c.team_a_pts : c.team_b_pts;

              return (
                <div
                  key={c.clash}
                  className="p-2.5 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <span className="font-mono text-[10px] text-[#8e95a5] font-bold block">
                      CLASH {c.clash} OF 3
                    </span>
                    <div className="flex items-center space-x-1.5 font-serif font-bold">
                      <span className={myStance === 'TRUCE' ? 'text-emerald-400' : 'text-red-400'}>
                        {myStance === 'TRUCE' ? '🤝 Truce' : '🗡️ Ambush'}
                      </span>
                      <span className="text-[#8e95a5] text-[10px]">vs</span>
                      <span className={enemyStance === 'TRUCE' ? 'text-emerald-400' : 'text-red-400'}>
                        {enemyStance === 'TRUCE' ? '🤝 Truce' : '🗡️ Ambush'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono font-bold text-emerald-400">
                    +{myPts} pts
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer info */}
        <div className="p-3 rounded-xl bg-[#161922]/50 border border-[#2a2e3d]/40 text-center text-xs text-[#8e95a5]">
          Waiting for the Game Master to announce the Round 2 Leaderboard.
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW 3: ACTIVE CLASH PHASES (1: HUDDLE, 2: PARLEY, 3: VOTE, 4: DEBRIEF)
  // ----------------------------------------------------
  return (
    <div
      className={`space-y-3.5 py-2 transition-all duration-500 ${
        borderFlash ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-[#08090c] rounded-2xl' : ''
      }`}
    >
      {/* Dynamic Header with Synchronized Phase Timer */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              ROUND 2: SHADES IN THE MIST
            </span>
          </div>
          <h2 className="text-base font-serif font-black text-[#f4f0e8] leading-tight">
            CLASH {currentClash} OF 3
          </h2>
          <div className="text-[11px] font-mono text-[#8e95a5] flex items-center space-x-1 mt-0.5">
            <span>Rival:</span>
            <span className="text-cyan-400 font-bold truncate max-w-[140px]">{opponentName}</span>
            <span className="text-[#c4a45a]">[{opponentBattleCode}]</span>
          </div>
        </div>

        {/* Phase Live Countdown */}
        <div className="text-right">
          <div className="flex items-center space-x-1 justify-end text-[10px] font-mono text-[#8e95a5]">
            <Clock className="w-3 h-3 text-[#c4a45a]" />
            <span>PHASE TIMER</span>
          </div>
          <div className="flex items-center space-x-1.5 justify-end mt-0.5">
            <span
              className={`font-mono text-2xl font-black tracking-wider transition-colors ${
                isUrgent ? 'text-red-400 animate-pulse' : 'text-[#f4f0e8]'
              }`}
            >
              {formattedPhaseTime}
            </span>
          </div>
        </div>
      </div>

      {/* 4-Phase Progress Indicator Bar */}
      <div className="grid grid-cols-4 gap-1.5 bg-[#10121a] p-1.5 rounded-xl border border-[#3a4157]">
        <div
          className={`py-1.5 px-1 rounded-lg text-center transition-all ${
            currentPhase === 'HUDDLE'
              ? 'bg-[#c4a45a] text-[#08090c] font-black'
              : 'text-[#a9b4c7] bg-[#161922]/50'
          }`}
        >
          <span className="text-[9px] font-mono block">PHASE 1</span>
          <span className="text-[10px] font-serif font-bold uppercase block truncate">Huddle</span>
        </div>
        <div
          className={`py-1.5 px-1 rounded-lg text-center transition-all ${
            currentPhase === 'PARLEY'
              ? 'bg-cyan-500 text-[#08090c] font-black shadow-lg shadow-cyan-900/40'
              : 'text-[#a9b4c7] bg-[#161922]/50'
          }`}
        >
          <span className="text-[9px] font-mono block">PHASE 2</span>
          <span className="text-[10px] font-serif font-bold uppercase block truncate">Dialogue</span>
        </div>
        <div
          className={`py-1.5 px-1 rounded-lg text-center transition-all ${
            currentPhase === 'VOTE'
              ? 'bg-purple-500 text-[#08090c] font-black shadow-lg shadow-purple-900/40 animate-pulse'
              : 'text-[#a9b4c7] bg-[#161922]/50'
          }`}
        >
          <span className="text-[9px] font-mono block">PHASE 3</span>
          <span className="text-[10px] font-serif font-bold uppercase block truncate">Vote</span>
        </div>
        <div
          className={`py-1.5 px-1 rounded-lg text-center transition-all ${
            currentPhase === 'DEBRIEF'
              ? 'bg-emerald-500 text-[#08090c] font-black'
              : 'text-[#a9b4c7] bg-[#161922]/50'
          }`}
        >
          <span className="text-[9px] font-mono block">PHASE 4</span>
          <span className="text-[10px] font-serif font-bold uppercase block truncate">Debrief</span>
        </div>
      </div>

      {/* Stakes Preview Pill dynamically read from config.round2 */}
      <div className="bg-[#10121a] border border-[#3a4157] rounded-xl px-3 py-2 flex items-center justify-between text-[11px] font-mono">
        <span className="text-[#e5cb87] font-bold">CLASH {currentClash} STAKES:</span>
        <div className="flex items-center space-x-2 text-[10px]">
          <span className="text-emerald-400 font-bold">Truce: +{scoringTier.both_truce}</span>
          <span className="text-[#3a4157]">|</span>
          <span className="text-amber-400 font-bold">Ambush Win: +{scoringTier.ambush_win}</span>
          <span className="text-[#3a4157]">|</span>
          <span className="text-red-400 font-bold">Both Ambush: +{scoringTier.both_ambush}</span>
        </div>
      </div>

      {/* ==================================================== */}
      {/* PHASE 1: PRIVATE HUDDLE */}
      {/* ==================================================== */}
      {currentPhase === 'HUDDLE' && (
        <div className="bg-[#161922] border-2 border-[#c4a45a] rounded-2xl p-6 shadow-beacon space-y-4 text-center" style={{ '--beacon-glow': 'rgba(196, 164, 90, 0.25)' } as React.CSSProperties}>
          <div className="w-12 h-12 rounded-full bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center mx-auto text-[#c4a45a]">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-serif font-black text-[#f4f0e8] uppercase tracking-wide">
              🛡️ Private Crew Huddle
            </h3>
            <p className="text-xs text-[#e5cb87] font-mono mt-0.5">
              Duration: {phaseSecondsLeft}s remaining
            </p>
          </div>

          <p className="text-xs text-[#cbd5e1] font-serif leading-relaxed max-w-sm mx-auto">
            Huddle with your teammates only. Do <strong className="text-red-400 font-bold">NOT</strong> speak to the other table yet. Are they trustworthy friends or enemies who will betray you? What is our strategy for Clash {currentClash}?
          </p>

          <div className="p-3 rounded-xl bg-[#08090c] border border-[#3a4157] text-left space-y-1.5 text-[11px]">
            <span className="text-[10px] font-mono text-[#e5cb87] uppercase font-bold block">
              Crew Roster & Strategy
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {teamMemberInfoList.map(m => (
                <div key={m.id} className="flex items-center space-x-1.5 truncate">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.roleColor }}
                  />
                  <span className="text-[#f4f0e8] truncate text-[10px] font-medium">{m.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[10px] font-mono text-[#a9b4c7] italic">
            🔒 Voting buttons remain locked until Phase 3.
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* PHASE 2: THE DIALOGUE */}
      {/* ==================================================== */}
      {currentPhase === 'PARLEY' && (
        <div className="bg-[#161922] border-2 border-cyan-400 rounded-2xl p-6 shadow-beacon space-y-4 text-center animate-fadeIn" style={{ '--beacon-glow': 'rgba(56, 189, 248, 0.35)' } as React.CSSProperties}>
          <div className="w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-400 flex items-center justify-center mx-auto text-cyan-300 animate-pulse">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-serif font-black text-cyan-300 uppercase tracking-wide">
              🗣️ The Dialogue: Negotiate with Opponents
            </h3>
            <p className="text-xs text-cyan-400 font-mono mt-0.5">
              Dialogue Window: {phaseSecondsLeft}s remaining
            </p>
          </div>

          <p className="text-xs text-[#cbd5e1] font-serif leading-relaxed max-w-sm mx-auto">
            Turn to the other table. Look them in the eye. Are they trustworthy friends or enemies who will betray you? Negotiate your pact, demand promises, or feed them false confidence.
          </p>

          <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-left space-y-2 text-xs">
            <div className="flex items-center justify-between text-cyan-300 font-mono text-[11px] font-bold">
              <span>Rival Crew: {opponentName}</span>
              <span>Table Code [{opponentBattleCode}]</span>
            </div>
            <p className="text-[11px] text-[#cbd5e1] italic">
              Remember: When the dialogue timer ends, every player casts a secret blind vote on their own phone.
            </p>
          </div>

          <div className="text-[10px] font-mono text-[#a9b4c7]">
            Secret blind voting begins automatically when this timer expires.
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* PHASE 3: SECRET BLIND BALLOT */}
      {/* ==================================================== */}
      {currentPhase === 'VOTE' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Prompt Banner */}
          <div className="bg-[#10121a] border border-purple-500/50 rounded-2xl p-4 shadow-xl text-center space-y-1">
            <div className="inline-flex items-center space-x-1 text-purple-400 text-xs font-mono uppercase font-bold tracking-wider">
              <Vote className="w-3.5 h-3.5" />
              <span>Phase 3: Secret Blind Ballot</span>
            </div>
            <h3 className="text-base font-serif font-black text-[#f4f0e8]">
              CAST YOUR SECRET BALLOT
            </h3>
            <p className="text-[11px] text-[#8e95a5]">
              Vote individually. Your choice is sealed and masked from everyone until reveal.
            </p>
          </div>

          {/* Negotiator Role Badge if current player is Negotiator */}
          {isNegotiator && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/50 flex items-center space-x-2 text-xs">
              <Sparkles className="w-4 h-4 text-[#c4a45a] flex-shrink-0" />
              <div className="text-[11px] text-amber-200">
                <strong>You are the Negotiator:</strong> If your squad ties (e.g. 2–2), your vote breaks the tie!
              </div>
            </div>
          )}

          {/* Large Touch Action Buttons (min 56px height) */}
          {!hasMyVoteRecorded ? (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleVote('TRUCE')}
                disabled={isVoting}
                className="w-full min-h-[56px] py-4 px-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-[#f4f0e8] font-serif font-bold text-sm tracking-wide shadow-xl flex items-center justify-between transition-all border border-emerald-400/50"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">🤝</span>
                  <div className="text-left">
                    <span className="block text-sm font-black">VOTE TRUCE</span>
                    <span className="block text-[10px] font-mono text-emerald-200">Share supplies honorably</span>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-400/30">
                  +{scoringTier.both_truce} pts
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleVote('AMBUSH')}
                disabled={isVoting}
                className="w-full min-h-[56px] py-4 px-5 rounded-2xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 active:scale-[0.98] text-[#f4f0e8] font-serif font-bold text-sm tracking-wide shadow-xl flex items-center justify-between transition-all border border-red-400/50"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">🗡️</span>
                  <div className="text-left">
                    <span className="block text-sm font-black">VOTE AMBUSH</span>
                    <span className="block text-[10px] font-mono text-rose-200">Steal enemy supplies by surprise</span>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold bg-red-950/80 px-2.5 py-1 rounded-lg border border-red-400/30">
                  +{scoringTier.ambush_win} pts
                </span>
              </button>
            </div>
          ) : (
            /* Locked Choice Indicator */
            <div className="bg-[#10121a] border-2 border-emerald-500 rounded-2xl p-5 text-center space-y-2 shadow-beacon" style={{ '--beacon-glow': 'rgba(52, 211, 153, 0.3)' } as React.CSSProperties}>
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500 text-emerald-300 font-mono text-xs font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>🔒 CHOICE RECORDED</span>
              </div>
              <h4 className="text-base font-serif font-black text-[#f4f0e8]">
                You Voted: {myVote === 'TRUCE' ? '🤝 TRUCE' : '🗡️ AMBUSH'}
              </h4>
              <p className="text-[11px] text-[#8e95a5]">
                Your ballot is locked in. Waiting for the remaining shades to cast their votes.
              </p>
            </div>
          )}

          {voteError && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-500 text-red-200 text-xs font-mono text-center">
              {voteError}
            </div>
          )}

          {/* Teammate Status List (Masking Choices) */}
          <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                Squad Ballot Status
              </span>
              <span className="text-[10px] font-mono text-[#8e95a5]">
                Opponent choices hidden
              </span>
            </div>

            <div className="space-y-1.5">
              {teamMemberInfoList.map(m => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-2 rounded-xl bg-[#161922] border border-[#2a2e3d] text-xs"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: m.roleColor }}
                    />
                    <div className="truncate">
                      <span className="font-serif font-bold text-[#f4f0e8] text-xs block truncate">
                        {m.name}
                      </span>
                      <span className="text-[10px] font-mono text-[#8e95a5] block">
                        {m.roleName}
                      </span>
                    </div>
                  </div>

                  <div>
                    {m.hasVoted ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 font-mono text-[10px] font-bold flex items-center space-x-1">
                        <Lock className="w-3 h-3" />
                        <span>{m.isSelf ? `${m.voteValue}` : 'LOCKED'}</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold animate-pulse">
                        ⏳ THINKING...
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[10px] font-mono text-[#8e95a5] text-center pt-1">
              If timer reaches 0:00, unsubmitted ballots record ABSTAIN.
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* PHASE 4: REVEAL & DEBRIEF */}
      {/* ==================================================== */}
      {currentPhase === 'DEBRIEF' && curClashRecord && (
        <div className="space-y-4 animate-fadeIn">
          {/* Synchronized Stance Reveal Banner */}
          {(() => {
            const myStance = isTeamA ? curClashRecord.team_a_stance : curClashRecord.team_b_stance;
            const enemyStance = isTeamA ? curClashRecord.team_b_stance : curClashRecord.team_a_stance;
            const myPts = isTeamA ? curClashRecord.team_a_pts : curClashRecord.team_b_pts;
            const enemyPts = isTeamA ? curClashRecord.team_b_pts : curClashRecord.team_a_pts;

            let outcomeTitle = '🤝 HONORABLE TRUCE';
            let outcomeBg = 'from-emerald-950/80 to-[#10121a] border-emerald-500';
            let outcomeColor = 'text-emerald-300';

            if (myStance === 'TRUCE' && enemyStance === 'TRUCE') {
              outcomeTitle = '🤝 HONORABLE TRUCE';
              outcomeBg = 'from-emerald-950/80 to-[#10121a] border-emerald-500';
              outcomeColor = 'text-emerald-300';
            } else if (myStance === 'TRUCE' && enemyStance === 'AMBUSH') {
              outcomeTitle = '⚡ BETRAYED IN TARTARUS!';
              outcomeBg = 'from-red-950/80 to-[#10121a] border-red-500';
              outcomeColor = 'text-red-400';
            } else if (myStance === 'AMBUSH' && enemyStance === 'TRUCE') {
              outcomeTitle = '🗡️ RUTHLESS AMBUSH!';
              outcomeBg = 'from-amber-950/80 to-[#10121a] border-[#c4a45a]';
              outcomeColor = 'text-[#c4a45a]';
            } else {
              outcomeTitle = '⚔️ BLOODIED STALEMATE';
              outcomeBg = 'from-slate-900/90 to-[#10121a] border-slate-500';
              outcomeColor = 'text-slate-300';
            }

            // Squad breakdown
            const votesObj = isTeamA ? curClashRecord.team_a_votes : curClashRecord.team_b_votes;
            let truceCount = 0;
            let ambushCount = 0;
            let abstainCount = 0;
            for (const v of Object.values(votesObj || {})) {
              if (v === 'TRUCE') truceCount++;
              else if (v === 'AMBUSH') ambushCount++;
              else if (v === 'ABSTAIN') abstainCount++;
            }

            return (
              <>
                <div className={`bg-gradient-to-b ${outcomeBg} border-2 rounded-2xl p-6 text-center space-y-3 shadow-2xl`}>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#8e95a5] font-bold">
                    CLASH {currentClash} REVEAL
                  </div>
                  <h3 className={`text-xl font-serif font-black ${outcomeColor}`}>
                    {outcomeTitle}
                  </h3>

                  {/* Stance Banner */}
                  <div className="flex items-center justify-center space-x-3 py-2 text-xs font-mono">
                    <div className="p-2.5 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center min-w-[120px]">
                      <span className="text-[9px] text-[#8e95a5] block">YOUR SQUAD</span>
                      <span className={`text-sm font-black ${myStance === 'TRUCE' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {myStance}
                      </span>
                    </div>
                    <span className="text-base font-serif text-[#8e95a5]">VS</span>
                    <div className="p-2.5 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center min-w-[120px]">
                      <span className="text-[9px] text-[#8e95a5] block">{opponentName.slice(0, 14)}</span>
                      <span className={`text-sm font-black ${enemyStance === 'TRUCE' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {enemyStance}
                      </span>
                    </div>
                  </div>

                  {/* Score Delta */}
                  <div className="p-3 rounded-xl bg-[#08090c]/90 border border-[#2a2e3d] flex items-center justify-around font-mono text-xs">
                    <div>
                      <span className="text-[10px] text-[#8e95a5] block">YOUR CREW</span>
                      <span className="text-base font-black text-emerald-400">+{myPts} pts</span>
                    </div>
                    <div className="w-px h-8 bg-[#2a2e3d]" />
                    <div>
                      <span className="text-[10px] text-[#8e95a5] block">OPPONENT CREW</span>
                      <span className="text-base font-black text-cyan-400">+{enemyPts} pts</span>
                    </div>
                  </div>
                </div>

                {/* Squad Vote Breakdown */}
                <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
                      Your Squad Votes Breakdown
                    </span>
                    <span className="text-[10px] font-mono text-[#8e95a5]">
                      {truceCount} Truce • {ambushCount} Ambush {abstainCount > 0 ? `• ${abstainCount} Abstain` : ''}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {teamMemberInfoList.map(m => {
                      const revealedVote = votesObj?.[m.id] || 'ABSTAIN';
                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-[#161922] border border-[#2a2e3d] text-xs"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: m.roleColor }}
                            />
                            <span className="font-serif font-bold text-[#f4f0e8] text-xs truncate">
                              {m.name}
                            </span>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                              revealedVote === 'TRUCE'
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50'
                                : revealedVote === 'AMBUSH'
                                ? 'bg-red-950/80 text-red-300 border border-red-500/50'
                                : 'bg-slate-900 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {revealedVote === 'TRUCE' ? '🤝 Truce' : revealedVote === 'AMBUSH' ? '🗡️ Ambush' : 'Abstain'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Breather Countdown Card */}
                <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 text-center space-y-1">
                  <span className="text-[10px] font-mono text-[#8e95a5] uppercase font-bold block">
                    {currentClash < (r2Config?.num_clashes || 3)
                      ? `Clash ${currentClash + 1} begins in:`
                      : 'Finalizing 3-Clash standings in:'}
                  </span>
                  <div className="text-2xl font-mono font-black text-[#f4f0e8]">
                    {phaseSecondsLeft}s
                  </div>
                  <p className="text-[11px] text-[#8e95a5] italic">
                    Use this breather for table banter and psychological warfare.
                  </p>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
