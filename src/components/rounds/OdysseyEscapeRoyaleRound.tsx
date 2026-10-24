import React, { useState, useEffect } from 'react';
import { useGameSession } from '../../context/GameContext';
import type {
  Round3Vessel,
  Round3SuddenDeathAction,
} from '../../types';
import {
  Trophy,
  Skull,
  Shield,
  Swords,
  Wind,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Lock,
  DoorOpen,
} from 'lucide-react';
import confetti from 'canvas-confetti';

export const OdysseyEscapeRoyaleRound: React.FC = () => {
  const {
    player,
    team,
    payload,
    round3Session,
    voteRound3,
    voteRound3SuddenDeath,
  } = useGameSession();

  const [selectedVessel, setSelectedVessel] = useState<Round3Vessel | null>(null);
  const [useCerberusLeash, setUseCerberusLeash] = useState(false);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [voteNotice, setVoteNotice] = useState<string | null>(null);

  // Sudden death state
  const [selectedAction, setSelectedAction] = useState<Round3SuddenDeathAction | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Confetti trigger once podium completed
  useEffect(() => {
    if (round3Session?.current_phase === 'COMPLETED' || round3Session?.podium?.bronze_team_id) {
      try {
        confetti({
          particleCount: 80,
          spread: 90,
          origin: { y: 0.5 },
          colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#ef4444'],
        });
      } catch {}
    }
  }, [round3Session?.current_phase, round3Session?.podium?.bronze_team_id]);

  if (!round3Session) {
    return (
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-6 text-center space-y-3">
        <Sparkles className="w-8 h-8 text-[#c4a45a] mx-auto animate-pulse" />
        <h3 className="text-base font-serif font-bold text-[#f4f0e8]">
          Awakening the River Styx...
        </h3>
        <p className="text-xs text-[#8e95a5]">
          Synchronizing wave congestion engine and fleet records.
        </p>
      </div>
    );
  }

  const config = payload?.config?.round3;
  const targetDistance = config?.target_distance_meters || 1000;
  const currentWave = round3Session.current_wave;
  const currentPhase = round3Session.current_phase;
  const waveVotes = round3Session.wave_votes?.[currentWave] || {};
  const teamVote = team ? waveVotes[team.id] : null;
  const playerVote = (player && teamVote?.player_votes?.[player.id]) || selectedVessel;

  const teamState = team ? round3Session.team_states?.[team.id] : null;
  const myDistance = teamState?.current_distance_meters || 0;
  const hasMyTeamEscaped = Boolean(teamState?.has_escaped);

  const activeTeams = payload?.teams_leaderboard || [];
  const totalTeamsCount = activeTeams.length;
  const maxSailboatsSafe = Math.ceil(totalTeamsCount * (config?.vessels?.SAILBOAT?.capacity_percent || 0.30));

  // Round 2 Nemesis for this team
  const nemesisTeamId = team?.nemesis_team_id;
  const nemesisTeam = nemesisTeamId ? activeTeams.find(t => t.id === nemesisTeamId) : null;
  const canUseCerberus = Boolean(nemesisTeam && !teamState?.cerberus_used);

  // Phase Countdown Timer
  const now = Date.now();
  const phaseEndsAt = round3Session.phase_ends_at || now;
  const secondsLeft = Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));

  // Cast Vessel Vote
  const handleCastVesselVote = async (vessel: Round3Vessel, activateLeash?: boolean) => {
    setSelectedVessel(vessel);
    setIsSubmittingVote(true);
    setVoteNotice(null);
    const shouldLeash = activateLeash !== undefined ? activateLeash : useCerberusLeash;
    try {
      const res = await voteRound3(
        vessel,
        canUseCerberus && shouldLeash && nemesisTeamId ? nemesisTeamId : undefined
      );
      if (res.success) {
        setVoteNotice(`Locked vote for ${vessel}!${shouldLeash ? ' (🐕‍🦺 Stygian Leash Active)' : ''}`);
      } else {
        setVoteNotice(res.error || 'Failed to submit vote');
      }
    } catch (err: any) {
      setVoteNotice(err.message || 'Vote failed');
    } finally {
      setIsSubmittingVote(false);
    }
  };

  // Cast Sudden Death Vote
  const handleCastSuddenDeathAction = async (action: Round3SuddenDeathAction) => {
    setSelectedAction(action);
    setIsSubmittingAction(true);
    try {
      await voteRound3SuddenDeath(action);
    } catch {}
    finally {
      setIsSubmittingAction(false);
    }
  };

  // --------------------------------------------------------------------------
  // SUDDEN DEATH STANDOFF OVERLAY VIEW
  // --------------------------------------------------------------------------
  if (round3Session.is_sudden_death && round3Session.sudden_death_state) {
    const sd = round3Session.sudden_death_state;
    const isContender = team && (sd.teams[0] === team.id || sd.teams[1] === team.id);
    const teamA = activeTeams.find(t => t.id === sd.teams[0]);
    const teamB = activeTeams.find(t => t.id === sd.teams[1]);
    const sdSecondsLeft = Math.max(0, Math.ceil((sd.phase_ends_at - Date.now()) / 1000));

    return (
      <div className="bg-[#10121a] border-2 border-red-500/60 rounded-2xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center space-x-1 px-3 py-1 bg-red-950/80 border border-red-500/60 rounded-full text-xs font-mono font-black text-red-300 animate-pulse">
            <Swords className="w-3.5 h-3.5 text-red-400" />
            <span>THE NARROW GATE • SUDDEN DEATH STANDOFF</span>
          </div>
          <h3 className="text-lg font-serif font-black text-[#f4f0e8]">
            {teamA?.name || 'Contender A'} vs {teamB?.name || 'Contender B'}
          </h3>
          <p className="text-xs text-[#8e95a5]">
            Only one crew can slip through the final rift in the gates!
          </p>
        </div>

        {/* Phase Timer */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-xs font-mono">
          <span className="text-[#8e95a5]">STANDOFF PHASE: <strong className="text-red-400 font-bold">{sd.phase}</strong></span>
          <span className="text-amber-400 font-bold">{sdSecondsLeft}s remaining</span>
        </div>

        {/* Contender Actions */}
        {isContender ? (
          <div className="space-y-3">
            {sd.phase === 'PARLEY' && (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 text-center space-y-2">
                <h4 className="text-sm font-serif font-bold text-amber-200">
                  🗣️ 40s Parley Window
                </h4>
                <p className="text-xs text-[#8e95a5]">
                  Look across at your rivals in the room! Negotiate, bluff, or prepare your maneuver before voting opens!
                </p>
              </div>
            )}

            {sd.phase === 'VOTE' && (
              <div className="space-y-3">
                <div className="text-center text-xs font-mono text-[#c4a45a] font-bold">
                  Lock your crew's tactical maneuver:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => handleCastSuddenDeathAction('SHIELDS')}
                    disabled={isSubmittingAction}
                    className={`p-3.5 rounded-xl border flex flex-col items-center space-y-1 transition-all ${
                      selectedAction === 'SHIELDS'
                        ? 'bg-blue-950/80 border-blue-400 shadow-lg scale-102 text-white'
                        : 'bg-[#161922] border-[#2a2e3d] hover:border-blue-400/60 text-[#8e95a5]'
                    }`}
                  >
                    <Shield className="w-5 h-5 text-blue-400" />
                    <span className="font-serif font-bold text-xs text-[#f4f0e8]">RAISE SHIELDS</span>
                    <span className="text-[10px] text-[#8e95a5]">Deflects Ram • Loses to Sails</span>
                  </button>

                  <button
                    onClick={() => handleCastSuddenDeathAction('RAM')}
                    disabled={isSubmittingAction}
                    className={`p-3.5 rounded-xl border flex flex-col items-center space-y-1 transition-all ${
                      selectedAction === 'RAM'
                        ? 'bg-red-950/80 border-red-400 shadow-lg scale-102 text-white'
                        : 'bg-[#161922] border-[#2a2e3d] hover:border-red-400/60 text-[#8e95a5]'
                    }`}
                  >
                    <Swords className="w-5 h-5 text-red-400" />
                    <span className="font-serif font-bold text-xs text-[#f4f0e8]">RAM THEIR HULL</span>
                    <span className="text-[10px] text-[#8e95a5]">Smashes Sails • Loses to Shields</span>
                  </button>

                  <button
                    onClick={() => handleCastSuddenDeathAction('SAILS')}
                    disabled={isSubmittingAction}
                    className={`p-3.5 rounded-xl border flex flex-col items-center space-y-1 transition-all ${
                      selectedAction === 'SAILS'
                        ? 'bg-emerald-950/80 border-emerald-400 shadow-lg scale-102 text-white'
                        : 'bg-[#161922] border-[#2a2e3d] hover:border-emerald-400/60 text-[#8e95a5]'
                    }`}
                  >
                    <Wind className="w-5 h-5 text-emerald-400" />
                    <span className="font-serif font-bold text-xs text-[#f4f0e8]">FULL SAILS</span>
                    <span className="text-[10px] text-[#8e95a5]">Outruns Shields • Loses to Ram</span>
                  </button>
                </div>
              </div>
            )}

            {sd.phase === 'REVEAL' && (
              <div className="p-4 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center space-y-2">
                <h4 className="text-sm font-serif font-black text-amber-300">
                  ⚡ Standoff Resolved
                </h4>
                <p className="text-xs font-mono text-[#f4f0e8]">
                  {sd.resolution_text || 'Both crews clashed at the narrow gate!'}
                </p>
                {sd.winner_team_id && (
                  <div className="inline-block px-3 py-1 bg-emerald-950/80 border border-emerald-500/50 rounded-full text-xs font-mono font-bold text-emerald-300">
                    🏆 Winner: {activeTeams.find(t => t.id === sd.winner_team_id)?.name || 'Escaped Crew'}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Spectator View */
          <div className="p-4 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center space-y-2">
            <h4 className="text-sm font-serif font-bold text-[#c4a45a]">
              Spectating the Duel
            </h4>
            <p className="text-xs text-[#8e95a5]">
              {teamA?.name} and {teamB?.name} are locked in a sudden-death duel for podium glory. Watch the live resolution!
            </p>
            {sd.resolution_text && (
              <p className="text-xs font-mono text-[#f4f0e8] pt-2">
                {sd.resolution_text}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // OLYMPIC UNDERWORLD PODIUM (WHEN 3 CREWS ESCAPE OR ROUND COMPLETED)
  // --------------------------------------------------------------------------
  if (round3Session.current_phase === 'COMPLETED' || (round3Session.podium?.gold_team_id && round3Session.podium?.silver_team_id && round3Session.podium?.bronze_team_id)) {
    const goldTeam = activeTeams.find(t => t.id === round3Session.podium.gold_team_id);
    const silverTeam = activeTeams.find(t => t.id === round3Session.podium.silver_team_id);
    const bronzeTeam = activeTeams.find(t => t.id === round3Session.podium.bronze_team_id);

    return (
      <div className="space-y-5">
        {/* Podium Banner */}
        <div className="bg-gradient-to-b from-[#161922] via-[#10121a] to-[#08090c] border-2 border-[#c4a45a] rounded-2xl p-6 shadow-2xl text-center space-y-4">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-[#c4a45a]/20 border border-[#c4a45a]/50 rounded-full text-xs font-mono font-bold text-[#c4a45a]">
            <Trophy className="w-4 h-4 text-[#c4a45a]" />
            <span>THE GATES OF LONDON ARE SEALED</span>
          </div>
          <h2 className="text-2xl font-serif font-black text-[#f4f0e8]">
            The Odyssey Podium of Champions
          </h2>
          <p className="text-xs text-[#8e95a5] max-w-md mx-auto">
            Three crews navigated the Stygian mist, broke the tomb cipher, out-bluffed their rivals, and crossed the 1,000m threshold!
          </p>

          {/* Olympic 3-Step Podium */}
          <div className="grid grid-cols-3 gap-2 pt-4 items-end max-w-lg mx-auto">
            {/* 2nd Place: Silver */}
            <div className="flex flex-col items-center space-y-2">
              <span className="text-2xl">🥈</span>
              <div className="w-full bg-[#1e2330] border-t-2 border-slate-300 rounded-t-xl p-3 text-center min-h-[140px] flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-mono font-bold text-slate-300">SILVER 2ND</span>
                  <h4 className="text-xs sm:text-sm font-serif font-black text-[#f4f0e8] truncate">
                    {silverTeam?.name || 'Silver Crew'}
                  </h4>
                </div>
                <div className="text-[10px] font-mono text-[#8e95a5] truncate">
                  {silverTeam?.members?.map(m => m.name).slice(0, 3).join(', ')}
                </div>
              </div>
            </div>

            {/* 1st Place: Gold (Tallest) */}
            <div className="flex flex-col items-center space-y-2">
              <span className="text-3xl animate-bounce">🥇</span>
              <div className="w-full bg-gradient-to-b from-[#c4a45a]/30 to-[#1e2330] border-t-4 border-[#c4a45a] rounded-t-xl p-3 text-center min-h-[180px] flex flex-col justify-between shadow-gold-glow">
                <div>
                  <span className="text-[10px] font-mono font-black text-[#c4a45a]">GOLD 1ST</span>
                  <h4 className="text-sm sm:text-base font-serif font-black text-[#f4f0e8] truncate">
                    {goldTeam?.name || 'Champion Crew'}
                  </h4>
                </div>
                <div className="text-[10px] font-mono text-[#f4f0e8]/80 truncate">
                  {goldTeam?.members?.map(m => m.name).join(', ')}
                </div>
              </div>
            </div>

            {/* 3rd Place: Bronze */}
            <div className="flex flex-col items-center space-y-2">
              <span className="text-2xl">🥉</span>
              <div className="w-full bg-[#1e2330] border-t-2 border-amber-700 rounded-t-xl p-3 text-center min-h-[110px] flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-mono font-bold text-amber-600">BRONZE 3RD</span>
                  <h4 className="text-xs sm:text-sm font-serif font-black text-[#f4f0e8] truncate">
                    {bronzeTeam?.name || 'Bronze Crew'}
                  </h4>
                </div>
                <div className="text-[10px] font-mono text-[#8e95a5] truncate">
                  {bronzeTeam?.members?.map(m => m.name).slice(0, 3).join(', ')}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#2a2e3d]/80 text-center">
            <p className="text-xs font-mono text-[#c4a45a] font-bold">
              🎖️ Collect your 3D-printed Underworld Medals from the organizer at the bar!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ACTIVE WAVE CARD & FLEET PROGRESS TRACK
  // --------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Winds of Olympus Honor Announcement Banner */}
      {teamState?.honor_bonus_granted && (
        <div className="bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-emerald-950/90 border border-emerald-500/60 rounded-2xl p-4 shadow-xl text-emerald-100 space-y-1">
          <div className="flex items-center space-x-2 text-emerald-300 font-bold text-xs uppercase tracking-wider font-mono">
            <span>🕊️ WINDS OF OLYMPUS ACTIVATED</span>
          </div>
          <p className="text-xs text-emerald-200/90 leading-relaxed font-serif">
            Your crew kept your word in the dark cavern.
          </p>
          <div className="text-xs sm:text-sm font-bold text-emerald-300 font-mono">
            Athena rewards your honour: +{teamState.honor_bonus_meters || 75}m Wind Boost granted!
          </div>
        </div>
      )}

      {/* Wave Header Banner */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
              Round 3: Escape Royale
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#161922] border border-[#2a2e3d] text-[10px] font-mono font-bold text-[#f4f0e8]">
              Wave {currentWave} of {config?.num_scheduled_waves || 4}
            </span>
          </div>
          <h3 className="text-base font-serif font-black text-[#f4f0e8]">
            {currentPhase === 'BLUFF' && '🗣️ Phase 1: The Bluff & Parley'}
            {currentPhase === 'VOTE' && '🗳️ Phase 2: Secret Fleet Vote'}
            {currentPhase === 'REVEAL' && '⚡ Phase 3: Wave Surge Report'}
          </h3>
        </div>

        {/* Phase Timer */}
        <div className="text-right">
          <span className="text-[10px] font-mono text-[#8e95a5] block">PHASE ENDS IN</span>
          <span className={`text-xl font-mono font-black ${secondsLeft <= 5 ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`}>
            {secondsLeft}s
          </span>
        </div>
      </div>

      {/* PROGRESS TRACK COMPONENT (ALWAYS VISIBLE) */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between text-xs font-mono pb-1 border-b border-[#2a2e3d]/60">
          <span className="text-[#8e95a5] flex items-center space-x-1">
            <span>RIVER STYX FLEET TRACK</span>
          </span>
          <span className="text-[#c4a45a] font-bold flex items-center space-x-1">
            <DoorOpen className="w-3.5 h-3.5 text-[#c4a45a]" />
            <span>PORTAL AT {targetDistance}m</span>
          </span>
        </div>

        {/* Track Bar */}
        <div className="relative w-full h-8 bg-[#08090c] rounded-xl border border-[#2a2e3d] overflow-hidden flex items-center px-2">
          {/* Finish Line Marker */}
          <div className="absolute right-0 top-0 bottom-0 w-2 bg-gradient-to-l from-emerald-500 to-transparent" />
          <div className="absolute right-2 text-[10px] font-mono font-bold text-emerald-400/80 z-0">
            🚪 1000m
          </div>

          {/* Fleet Boat Icons */}
          {activeTeams.map((t) => {
            const state = round3Session.team_states?.[t.id];
            const dist = state?.current_distance_meters || 0;
            const pct = Math.min(100, Math.max(0, (dist / targetDistance) * 100));
            const isMyTeam = team?.id === t.id;
            const isNemesis = nemesisTeamId === t.id;

            return (
              <div
                key={t.id}
                style={{ left: `calc(${pct}% - 14px)` }}
                className={`absolute top-1 bottom-1 flex items-center transition-all duration-700 z-10 ${
                  isMyTeam ? 'scale-110 z-20' : ''
                }`}
              >
                <div
                  className={`w-7 h-6 rounded flex items-center justify-center text-xs shadow-md border ${
                    isMyTeam
                      ? 'bg-[#c4a45a] text-[#08090c] border-white font-bold ring-2 ring-[#c4a45a]/50'
                      : isNemesis
                      ? 'bg-rose-950 border-rose-500 text-rose-300'
                      : 'bg-[#1e2330] border-[#2a2e3d] text-[#f4f0e8]'
                  }`}
                  title={`${t.name}: ${dist}m`}
                >
                  {isNemesis ? <Skull className="w-3 h-3 text-rose-400" /> : '⛵'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Your Distance Callout */}
        <div className="flex items-center justify-between text-xs font-mono pt-1 text-[#8e95a5]">
          <span>
            {teamState?.honor_bonus_granted ? (
              <>
                Your Crew: <strong className="text-[#c4a45a]">{myDistance}m / {targetDistance}m</strong>{' '}
                <span className="text-emerald-400">
                  ({myDistance - 75}m points + 75m 🕊️ Winds of Olympus)
                </span>
              </>
            ) : (
              <>
                Your Crew: <strong className="text-[#c4a45a]">{myDistance}m / {targetDistance}m</strong>
              </>
            )}
          </span>
          {hasMyTeamEscaped ? (
            <span className="text-emerald-400 font-bold flex items-center space-x-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>ESCAPED! Rank #{teamState?.escape_rank}</span>
            </span>
          ) : (
            <span>{Math.max(0, targetDistance - myDistance)}m to escape</span>
          )}
        </div>
      </div>

      {/* PHASE 1: THE BLUFF VIEW */}
      {currentPhase === 'BLUFF' && (
        <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center space-x-2 text-amber-400">
            <span className="text-base">🗣️</span>
            <h4 className="text-sm font-serif font-black text-[#f4f0e8]">
              Look Around the Pub & Bluff Your Rivals!
            </h4>
          </div>

          <p className="text-xs text-[#cbd5e1] leading-relaxed">
            Stand up and look across tables! The howls of Cerberus echo behind you and the exit portal across the River Styx is slowly sealing shut. Only <strong className="text-amber-300 font-bold">1 crew</strong> can take the Ghost Ship. Max <strong className="text-sky-300 font-bold">{maxSailboatsSafe} crews</strong> can sail before the Sailboat capsizes! Coordinate your crew before the secret ballot opens!
          </p>

          {/* 3 Vessels Rules Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs font-mono">
            {/* Rowboat */}
            <div className="p-3 rounded-xl bg-[#08090c] border border-[#3a4157] space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400">🚣 THE ROWBOAT</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 font-bold border border-emerald-500/40">SAFE</span>
              </div>
              <p className="text-[11px] text-[#cbd5e1]">
                Never capsizes. Reliable <strong className="text-[#f4f0e8]">+150m</strong> for all boarding crews.
              </p>
            </div>

            {/* Sailboat */}
            <div className="p-3 rounded-xl bg-[#08090c] border border-[#3a4157] space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-400">⛵ THE SAILBOAT</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 font-bold border border-sky-500/40">BALANCED</span>
              </div>
              <p className="text-[11px] text-[#cbd5e1]">
                Fast winds (<strong className="text-[#f4f0e8]">+300m</strong>). Capsizes (<strong>0m</strong>) if &gt;{maxSailboatsSafe} crews board!
              </p>
            </div>

            {/* Ghost Ship */}
            <div className="p-3 rounded-xl bg-[#08090c] border border-[#3a4157] space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-300">⚡ THE GHOST SHIP</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 font-bold border border-purple-500/40">GAMBLE</span>
              </div>
              <p className="text-[11px] text-[#cbd5e1]">
                Mythic surge (<strong className="text-[#f4f0e8]">+450m</strong>) ONLY if 1 crew boards. 2+ crews collide (<strong className="text-rose-400">-50m</strong>)!
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#161922] border border-[#3a4157] text-center text-xs font-mono text-[#a9b4c7]">
            <Lock className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
            Voting buttons unlock when bluffing ends in <strong>{secondsLeft}s</strong>.
          </div>
        </div>
      )}

      {/* PHASE 2: SECRET VOTING VIEW */}
      {currentPhase === 'VOTE' && (
        <div className="bg-[#10121a] border border-[#3a4157] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-[#3a4157] pb-2">
            <div>
              <h4 className="text-sm font-serif font-black text-[#f4f0e8]">
                Select Your Escape Route
              </h4>
              <p className="text-xs text-[#cbd5e1]">
                Majority of your crew decides your vessel. Negotiator breaks ties.
              </p>
            </div>
            {teamVote && (
              <span className="text-xs font-mono text-amber-400 font-bold">
                {Object.keys(teamVote.player_votes || {}).length}/{team?.player_ids?.length || 5} Voted
              </span>
            )}
          </div>

          {voteNotice && (
            <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-500/50 text-amber-300 text-xs font-mono text-center">
              {voteNotice}
            </div>
          )}

          {/* 3 GIANT HIGH-CONTRAST TOUCH TARGETS (MIN 64PX HEIGHT) */}
          <div className="space-y-3">
            {/* ROWBOAT */}
            <button
              onClick={() => handleCastVesselVote('ROWBOAT')}
              disabled={isSubmittingVote}
              className={`w-full min-h-[64px] p-4 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] ${
                playerVote === 'ROWBOAT'
                  ? 'bg-emerald-950/70 border-emerald-400 shadow-lg text-white ring-2 ring-emerald-400/50'
                  : 'bg-[#161922] border-[#3a4157] hover:border-emerald-500/60 text-[#f4f0e8]'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">🚣</span>
                <div>
                  <div className="font-serif font-black text-sm text-[#f4f0e8] flex items-center space-x-1.5">
                    <span>THE ROWBOAT</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-bold">
                      SAFE
                    </span>
                  </div>
                  <div className="text-xs text-[#cbd5e1]">
                    Steady oars • Never capsizes • Guaranteed +150m
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-emerald-400">
                +150m
              </span>
            </button>

            {/* SAILBOAT */}
            <button
              onClick={() => handleCastVesselVote('SAILBOAT')}
              disabled={isSubmittingVote}
              className={`w-full min-h-[64px] p-4 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] ${
                playerVote === 'SAILBOAT'
                  ? 'bg-sky-950/70 border-sky-400 shadow-lg text-white ring-2 ring-sky-400/50'
                  : 'bg-[#161922] border-[#3a4157] hover:border-sky-500/60 text-[#f4f0e8]'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">⛵</span>
                <div>
                  <div className="font-serif font-black text-sm text-[#f4f0e8] flex items-center space-x-1.5">
                    <span>THE SAILBOAT</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-950 border border-sky-500/40 text-sky-300 font-bold">
                      BALANCED
                    </span>
                  </div>
                  <div className="text-xs text-[#cbd5e1]">
                    Fast winds • Capsizes if &gt;{maxSailboatsSafe} crews board (0m)
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-sky-400">
                +300m
              </span>
            </button>

            {/* GHOST SHIP */}
            <button
              onClick={() => handleCastVesselVote('GHOST_SHIP')}
              disabled={isSubmittingVote}
              className={`w-full min-h-[64px] p-4 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] ${
                playerVote === 'GHOST_SHIP'
                  ? 'bg-purple-950/70 border-purple-400 shadow-lg text-white ring-2 ring-purple-400/50'
                  : 'bg-[#161922] border-[#3a4157] hover:border-purple-500/60 text-[#f4f0e8]'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <div className="font-serif font-black text-sm text-[#f4f0e8] flex items-center space-x-1.5">
                    <span>THE GHOST SHIP</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-950 border border-purple-500/40 text-purple-300 font-bold">
                      SOLO GAMBLE
                    </span>
                  </div>
                  <div className="text-xs text-[#cbd5e1]">
                    Mythic surge (+450m) ONLY if 1 crew boards. 2+ collide (-50m)
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-purple-400">
                +450m
              </span>
            </button>
          </div>

          {/* STYGIAN LEASH (CERBERUS REVENGE) */}
          {canUseCerberus && nemesisTeam && (
            <div className={`p-4 rounded-xl border transition-all ${
              useCerberusLeash
                ? 'bg-gradient-to-r from-red-950/80 via-[#16121f] to-red-950/80 border-red-500 shadow-xl'
                : 'bg-[#10121a] border-[#3a4157]/80'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-red-400">
                  <span className="text-base">🐕‍🦺</span>
                  <span>STYGIAN LEASH</span>
                  <span className="text-[#8e95a5]">➔</span>
                  <span className="text-[#f4f0e8] underline decoration-red-500 font-bold">{nemesisTeam.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !useCerberusLeash;
                    setUseCerberusLeash(next);
                    if (selectedVessel) {
                      handleCastVesselVote(selectedVessel, next);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all active:scale-95 ${
                    useCerberusLeash
                      ? 'bg-red-600 text-white shadow-lg shadow-red-900/50'
                      : 'bg-[#1e2330] border border-[#3a4157] text-[#8e95a5] hover:text-white'
                  }`}
                >
                  {useCerberusLeash ? '✓ LEASH ARMED' : 'ARM STYGIAN LEASH'}
                </button>
              </div>

              <div className="text-[11px] space-y-1 font-mono text-[#cbd5e1] bg-black/40 p-2.5 rounded-lg border border-red-500/20">
                <div className="flex items-center space-x-1 text-[#f4f0e8]">
                  <span className="text-emerald-400">• If they Float:</span>
                  <span>Steal <strong>50m</strong> from their hull</span>
                </div>
                <div className="flex items-center space-x-1 text-[#f4f0e8]">
                  <span className="text-amber-400">• If they Crash:</span>
                  <span>Drag them down & get <strong>+100m bonus</strong>!</span>
                </div>
                <div className="text-[10px] text-rose-300 pt-1 border-t border-white/10">
                  ⚠️ <strong>Don't crash:</strong> If your own ship sinks, the leash snaps (0m).
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE 3: REVEAL & SURGE REPORT */}
      {currentPhase === 'REVEAL' && (
        <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="text-center space-y-1 pb-2 border-b border-[#2a2e3d]">
            <span className="text-xs font-mono text-[#c4a45a] font-bold">
              ══ WAVE {currentWave} SURGE REPORT ══
            </span>
            <h4 className="text-base font-serif font-black text-[#f4f0e8]">
              The Styx Waters Settle
            </h4>
          </div>

          {/* Breakdown scroll view */}
          {(() => {
            const report = round3Session.wave_reports?.[currentWave];
            const myOutcome = team ? report?.team_outcomes?.[team.id] : null;

            return (
              <div className="space-y-3 font-mono text-xs">
                {/* Vessels report */}
                <div className="p-3.5 rounded-xl bg-[#08090c] border border-[#2a2e3d] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[#8e95a5]">
                      🚣 Rowboat: {report?.rowboat_teams?.length || 0} crews
                    </span>
                    <span className="text-emerald-400 font-bold">All Safe (+150m)</span>
                  </div>

                  <div className="flex items-center justify-between border-t border-[#2a2e3d]/60 pt-2">
                    <span className="text-[#8e95a5]">
                      ⛵ Sailboat: {report?.sailboat_teams?.length || 0} crews
                    </span>
                    {report?.sailboat_capsized ? (
                      <span className="text-rose-400 font-bold flex items-center space-x-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>OVERLOADED! Capsized (0m)</span>
                      </span>
                    ) : (
                      <span className="text-sky-400 font-bold">Safe Surge (+300m)</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[#2a2e3d]/60 pt-2">
                    <span className="text-[#8e95a5]">
                      ⚡ Ghost Ship: {report?.ghost_ship_teams?.length || 0} crews
                    </span>
                    {report?.ghost_ship_solo_team_id ? (
                      <span className="text-purple-400 font-bold">
                        SOLO SURGE! (+450m)
                      </span>
                    ) : report?.ghost_ship_collided ? (
                      <span className="text-rose-400 font-bold">
                        COLLIDED! (-50m penalty)
                      </span>
                    ) : (
                      <span className="text-[#8e95a5]">Unboarded</span>
                    )}
                  </div>
                </div>

                {/* Stygian Leash Events */}
                {report?.cerberus_events && report.cerberus_events.length > 0 && (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/50 space-y-2">
                    {report.cerberus_events.map((evt, idx) => (
                      <div key={idx} className="text-[11px] font-mono p-2 rounded-lg bg-black/40 border border-red-500/20 space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[#f4f0e8] font-bold">
                            🐕‍🦺 {evt.attacker_team_name} leashed {evt.target_team_name}!
                          </span>
                          {evt.leash_snapped ? (
                            <span className="text-rose-400 font-bold">⚡ LEASH SNAPPED (0m)</span>
                          ) : evt.event_type === 'WRECK_DRAG' ? (
                            <span className="text-amber-400 font-bold">💥 WRECK DRAG! (+100m / -100m)</span>
                          ) : (
                            <span className="text-emerald-400 font-bold">⚓ ANCHOR BIT! (+50m / -50m)</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8e95a5]">
                          {evt.leash_snapped
                            ? `${evt.attacker_team_name}'s own boat crashed! Curse wasted.`
                            : evt.event_type === 'WRECK_DRAG'
                            ? `${evt.target_team_name} crashed on ${evt.target_vessel}! Dragged down into the deep.`
                            : `${evt.target_team_name} floated safely on ${evt.target_vessel}. 50m siphoned from their hull.`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Your Crew Summary Card */}
                {myOutcome && (
                  <div className="p-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#242b3b] to-[#161922] border border-[#c4a45a] text-center space-y-1">
                    <span className="text-[10px] uppercase text-[#c4a45a] font-bold">
                      YOUR CREW WAVE SUMMARY
                    </span>
                    <h5 className="text-sm font-serif font-black text-[#f4f0e8]">
                      Sailed on {myOutcome.vessel} ({myOutcome.total_meters_gained >= 0 ? `+${myOutcome.total_meters_gained}m` : `${myOutcome.total_meters_gained}m`})
                    </h5>
                    <p className="text-xs text-[#8e95a5]">
                      Total Distance: <strong className="text-white">{myOutcome.new_total_distance}m / {targetDistance}m</strong>
                    </p>
                    {myOutcome.just_escaped && (
                      <div className="inline-block mt-1 px-3 py-1 bg-emerald-900 border border-emerald-400 rounded-full text-xs font-bold text-white shadow-lg">
                        🎉 ESCAPED TARTARUS! Rank #{myOutcome.escape_rank}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
