// Round 2: Shades in the Mist. The server owns the clock and the steps; this screen only displays them.
import React, { useEffect, useRef, useState } from 'react';
import { Clock, Crown, Delete, Handshake, Lock, MessageSquare, Shield, Skull, Swords, Users, Vote, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { MoralStatus, Stance } from '../../../shared/protocol.ts';
import { useGame } from '../../game/useGame';
import { usePendingVote, VoteFeedback } from '../../game/usePendingVote';
import { BTN_GOLD, CARD, Countdown, ErrorNote, LABEL, pts } from '../ui';

// ------------------------------------------------------------------ pairing
const PairingStep: React.FC = () => {
  const { view, send } = useGame();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = view?.team;
  const r2 = view?.r2;
  if (!team || !r2) return null;

  if (r2.paired && r2.rival) {
    return (
      <div className="space-y-4">
        <div data-testid="r2-paired" className={`${CARD} text-center space-y-2 border-emerald-500/50`}>
          <div className="inline-flex w-12 h-12 rounded-full bg-emerald-900/60 text-emerald-300 items-center justify-center">
            <Check className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-serif font-black text-emerald-200">Paired with {r2.rival.name}</h3>
          <p className="text-sm text-[#cbd5e1]">
            Rival code <span className="font-mono font-bold text-[#f4f0e8]">{r2.rival.battleCode}</span>
          </p>
        </div>
        <div className={`${CARD} text-center space-y-1`}>
          <p className="text-base text-[#f4f0e8] font-semibold">Waiting for the other crews</p>
          <p className="text-sm text-[#a9b4c7]">The first clash starts for every crew at the same moment. Stay close to your rival crew.</p>
        </div>
      </div>
    );
  }

  const press = (d: string) => setDigits(x => (x.length < 2 ? x + d : x));

  const connect = async () => {
    if (digits.length !== 2 || busy) return;
    setBusy(true);
    setError(null);
    const r = await send('R2_PAIR', { code: digits });
    setBusy(false);
    if (!r.ok) setError(r.message ?? 'Could not pair.');
    else setDigits('');
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD} text-center space-y-2`}>
        <span className={LABEL}>Step 1: Your code</span>
        <p className="text-sm text-[#a9b4c7]">Show this to your rival crew.</p>
        <div data-testid="my-battle-code" className="text-7xl font-mono font-black tracking-[0.2em] text-[#e5cb87] py-2">
          {team.battleCode}
        </div>
      </div>

      <div className={`${CARD} space-y-3`}>
        <div className="text-center space-y-1">
          <span className={LABEL}>Step 2: Enter rival&apos;s code</span>
          <p className="text-sm text-[#a9b4c7]">Ask a rival crew for their 2-digit code. One crew types it, both are linked.</p>
        </div>
        <div className="flex justify-center space-x-3" data-testid="rival-code-display">
          {[0, 1].map(i => (
            <div
              key={i}
              className={`w-20 h-24 rounded-2xl border-2 flex items-center justify-center text-5xl font-mono font-black ${
                digits[i] ? 'border-[#c4a45a] text-[#f4f0e8] bg-[#161922]' : i === digits.length ? 'border-[#c4a45a]/70 border-dashed bg-[#161922]' : 'border-[#2a2e3d] border-dashed bg-[#161922]/50'
              }`}
            >
              {digits[i] ?? ''}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button
              key={d}
              data-testid={`key-${d}`}
              onClick={() => press(d)}
              className="min-h-[64px] rounded-xl bg-[#161922] hover:bg-[#202533] active:scale-95 border border-[#3a4157] text-3xl font-mono font-bold text-[#f4f0e8] transition"
            >
              {d}
            </button>
          ))}
          <button
            onClick={() => setDigits('')}
            aria-label="Clear"
            className="min-h-[64px] rounded-xl bg-[#161922] border border-[#3a4157] text-sm font-mono text-[#a9b4c7]"
          >
            Clear
          </button>
          <button
            data-testid="key-0"
            onClick={() => press('0')}
            className="min-h-[64px] rounded-xl bg-[#161922] hover:bg-[#202533] active:scale-95 border border-[#3a4157] text-3xl font-mono font-bold text-[#f4f0e8] transition"
          >
            0
          </button>
          <button
            onClick={() => setDigits(x => x.slice(0, -1))}
            aria-label="Delete"
            className="min-h-[64px] rounded-xl bg-[#161922] border border-[#3a4157] text-[#a9b4c7] flex items-center justify-center"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>
        <ErrorNote text={error} />
        <button data-testid="r2-connect" onClick={connect} disabled={digits.length !== 2 || busy} className={BTN_GOLD}>
          {busy ? 'Linking...' : 'Link with rival crew'}
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ history
const StanceText: React.FC<{ s: Stance; emoji?: boolean }> = ({ s, emoji }) => (
  <span className={s === 'TRUCE' ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold'}>
    {emoji ? (s === 'TRUCE' ? '🤝 ' : '🗡️ ') : ''}
    {s === 'TRUCE' ? 'Truce' : 'Ambush'}
  </span>
);

const History: React.FC = () => {
  const { view } = useGame();
  const r2 = view?.r2;
  if (!r2 || r2.clashes.length === 0) return null;
  return (
    <div className={`${CARD} space-y-2`} data-testid="r2-history">
      <span className={LABEL}>Clash history</span>
      {r2.clashes.map(c => (
        <div key={c.clash} className="flex items-center justify-between text-sm p-3 min-h-[56px] rounded-xl bg-[#161922] border border-[#2a2e3d]">
          <span className="font-mono text-[#a9b4c7]">Clash {c.clash}</span>
          <span className="text-[#f4f0e8]">
            <StanceText s={c.myStance} emoji /> <span className="text-[#a9b4c7]">vs</span> <StanceText s={c.rivalStance} emoji />
          </span>
          <span className="font-mono font-bold text-[#e5cb87]">{pts(c.myPts)}</span>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ the phase progress bar
const SEGMENTS: { id: string; label: string; on: string }[] = [
  { id: 'HUDDLE', label: 'Huddle', on: 'bg-[#c4a45a] text-[#08090c] font-black' },
  { id: 'PARLEY', label: 'Dialogue', on: 'bg-cyan-500 text-[#08090c] font-black shadow-lg shadow-cyan-900/40' },
  { id: 'VOTE', label: 'Vote', on: 'bg-purple-500 text-[#08090c] font-black shadow-lg shadow-purple-900/40' },
  { id: 'DEBRIEF', label: 'Debrief', on: 'bg-emerald-500 text-[#08090c] font-black' },
];

const PhaseBar: React.FC<{ step: string }> = ({ step }) => (
  <div className="grid grid-cols-4 gap-1.5 bg-[#10121a] p-1.5 rounded-xl border border-[#3a4157]" data-testid="r2-phasebar">
    {SEGMENTS.map((s, i) => (
      <div key={s.id} className={`py-2 px-1 rounded-lg text-center transition-all ${step === s.id ? s.on : 'text-[#a9b4c7] bg-[#161922]/50'}`}>
        <span className="text-xs font-mono block">PHASE {i + 1}</span>
        <span className="text-xs font-serif font-bold uppercase block truncate">{s.label}</span>
      </div>
    ))}
  </div>
);

// ------------------------------------------------------------------ a clash
interface Mate {
  name: string;
  role: string;
  color: string;
  isSelf: boolean;
}

const ClashStep: React.FC = () => {
  const { view, meta, send } = useGame();
  const phase = view?.phase;
  const r2 = view?.r2;
  const clash = phase?.clash ?? 0;
  const step = phase?.step ?? '';
  const vote = usePendingVote<Stance>((view?.me?.myVote as Stance | undefined) ?? null, `r2:${clash}:${step}`);

  // Vibrate and flash cyan when the dialogue starts (not when the app opens in the middle of it).
  const prevStep = useRef<string | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevStep.current !== null && prevStep.current !== step && step === 'PARLEY') {
      try {
        if ('vibrate' in navigator) navigator.vibrate(200);
      } catch {
        /* ignore */
      }
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 2000);
      prevStep.current = step;
      return () => clearTimeout(t);
    }
    prevStep.current = step;
    return undefined;
  }, [step]);

  if (!phase || !r2) return null;
  if (!r2.paired || !r2.rival) {
    return (
      <div className={`${CARD} text-center space-y-1`}>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Your crew is sitting out Round 2</h3>
        <p className="text-sm text-[#a9b4c7]">You were not paired with a rival crew. Watch the screen for Round 3.</p>
      </div>
    );
  }

  const rival = r2.rival;
  const myName = view?.me?.name;
  const roleColor = (id: string) => meta?.roles.find(r => r.id === id)?.color ?? '#c4a45a';
  const roleName = (id: string) => meta?.roles.find(r => r.id === id)?.name ?? '';
  const mates: Mate[] = (view?.team?.members ?? []).map(m => ({ name: m.name, role: roleName(m.role), color: roleColor(m.role), isSelf: m.name === myName }));
  const stakes = meta?.r2Stakes.find(s => s.clash === clash);
  const current = r2.clashes.find(c => c.clash === clash);
  const totalClashes = meta?.r2Stakes.length ?? 3;

  const cast = (v: Stance) => {
    if (vote.locked) return;
    void vote.submit(v, () => send('R2_VOTE', { vote: v }));
  };

  return (
    <div className={`space-y-3.5 transition-all duration-500 ${flash ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-[#08090c] rounded-2xl' : ''}`}>
      <div className={`${CARD} flex items-center justify-between gap-3`}>
        <div className="min-w-0">
          <span className={LABEL}>Round 2: Shades in the Mist</span>
          <h3 data-testid="r2-step" className="text-xl font-serif font-black text-[#f4f0e8] leading-tight">
            Clash {clash} of {totalClashes}
          </h3>
          <div className="text-sm font-mono text-[#a9b4c7] flex items-center space-x-1 mt-0.5 min-w-0">
            <span>Rival:</span>
            <span className="text-cyan-300 font-bold truncate">{rival.name}</span>
            <span className="text-[#e5cb87] shrink-0">[{rival.battleCode}]</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center space-x-1 justify-end text-xs font-mono text-[#a9b4c7]">
            <Clock className="w-3.5 h-3.5 text-[#e5cb87]" />
            <span>PHASE TIMER</span>
          </div>
          <Countdown endsAt={phase.endsAt} className="text-4xl" />
        </div>
      </div>

      {step === 'BRIEFING' ? (
        <div data-testid="r2-briefing" className={`${CARD} text-center space-y-1`}>
          <h3 className="text-xl font-serif font-black text-[#f4f0e8]">Briefing...</h3>
          <p className="text-sm text-[#a9b4c7]">Round 2 begins when the briefing ends. Voting is closed.</p>
        </div>
      ) : (
        <>
          <PhaseBar step={step} />

          {stakes && (
            <div className="bg-[#10121a] border border-[#3a4157] rounded-xl px-3 py-2.5 text-sm font-mono space-y-1" data-testid="r2-stakes">
              <span className="text-[#e5cb87] font-bold block">CLASH {clash} STAKES</span>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-emerald-300 font-bold">Both Truce: {pts(stakes.bothTruce)}</span>
                <span className="text-amber-300 font-bold">Ambush wins: {pts(stakes.ambushWin)}</span>
                <span className="text-red-300 font-bold">Both Ambush: {pts(stakes.bothAmbush)}</span>
                <span className="text-[#a9b4c7] font-bold">Betrayed: {pts(stakes.truceLoss)}</span>
              </div>
            </div>
          )}

          {step === 'HUDDLE' && (
            <div className="bg-[#161922] border-2 border-[#c4a45a] rounded-2xl p-5 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-[#c4a45a]/20 border border-[#c4a45a] flex items-center justify-center mx-auto text-[#c4a45a]">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-serif font-black text-[#f4f0e8] uppercase tracking-wide">🛡️ Private Crew Huddle</h3>
              <p className="text-base text-[#cbd5e1] font-serif leading-relaxed">
                Huddle with your teammates only. Do <strong className="text-red-400 font-bold">NOT</strong> speak to the other table yet. Are they trustworthy friends or enemies who will betray you? What is our strategy for Clash {clash}?
              </p>
              <div className="p-3 rounded-xl bg-[#08090c] border border-[#3a4157] text-left space-y-2">
                <span className="text-xs font-mono text-[#e5cb87] uppercase font-bold block">Crew roster and strategy</span>
                <div className="grid grid-cols-2 gap-2">
                  {mates.map((m, i) => (
                    <div key={i} className="flex items-center space-x-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                      <span className="text-[#f4f0e8] truncate text-sm font-medium">{m.isSelf ? `${m.name} (You)` : m.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-sm font-mono text-[#a9b4c7] italic">🔒 Voting buttons stay locked until Phase 3.</div>
            </div>
          )}

          {step === 'PARLEY' && (
            <div className="bg-[#161922] border-2 border-cyan-400 rounded-2xl p-5 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-400 flex items-center justify-center mx-auto text-cyan-300 animate-pulse">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-serif font-black text-cyan-300 uppercase tracking-wide">🗣️ The Dialogue</h3>
              <p className="text-base text-[#cbd5e1] font-serif leading-relaxed">
                Turn to the other table. Look them in the eye. Are they trustworthy friends or enemies who will betray you? Negotiate your pact, demand promises, or feed them false confidence. Bluffing is allowed.
              </p>
              <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-left space-y-2">
                <div className="flex items-center justify-between gap-2 text-cyan-300 font-mono text-sm font-bold">
                  <span className="truncate">Rival crew: {rival.name}</span>
                  <span className="shrink-0">Table code [{rival.battleCode}]</span>
                </div>
                <p className="text-sm text-[#cbd5e1] italic">When the dialogue timer ends, every player casts a secret vote on their own phone.</p>
              </div>
            </div>
          )}

          {step === 'VOTE' && (
            <div className="space-y-3.5">
              <div className="bg-[#10121a] border border-purple-500/50 rounded-2xl p-4 text-center space-y-1">
                <div className="inline-flex items-center space-x-1.5 text-purple-300 text-sm font-mono uppercase font-bold tracking-wider">
                  <Vote className="w-4 h-4" />
                  <span>Phase 3: Secret ballot</span>
                </div>
                <h3 className="text-xl font-serif font-black text-[#f4f0e8]">CAST YOUR SECRET BALLOT</h3>
                <p className="text-sm text-[#a9b4c7]">Your choice stays hidden until the reveal. Your crew majority decides. A tie is a Truce.</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {(['TRUCE', 'AMBUSH'] as Stance[]).map(s => {
                  const picked = vote.choice === s;
                  const dim = vote.choice && !picked;
                  const truce = s === 'TRUCE';
                  const reward = truce ? stakes?.bothTruce : stakes?.ambushWin;
                  return (
                    <button
                      key={s}
                      type="button"
                      data-testid={truce ? 'vote-truce' : 'vote-ambush'}
                      disabled={vote.locked}
                      onClick={() => cast(s)}
                      className={`w-full min-h-[88px] py-3 px-4 rounded-2xl border-2 flex items-center justify-between transition disabled:cursor-not-allowed ${
                        picked
                          ? truce
                            ? 'bg-emerald-800/70 border-emerald-300 ring-2 ring-emerald-300/50'
                            : 'bg-red-800/70 border-red-300 ring-2 ring-red-300/50'
                          : dim
                            ? 'bg-[#161922] border-[#2a2e3d] opacity-40'
                            : truce
                              ? 'bg-emerald-950/50 border-emerald-500/70 active:scale-[0.98]'
                              : 'bg-red-950/50 border-red-500/70 active:scale-[0.98]'
                      }`}
                    >
                      <span className="flex items-center space-x-3 text-left min-w-0">
                        <span className="text-3xl">{truce ? '🤝' : '🗡️'}</span>
                        <span className="min-w-0">
                          <span className={`block text-xl font-serif font-black ${truce ? 'text-emerald-100' : 'text-red-100'}`}>
                            {truce ? 'VOTE TRUCE' : 'VOTE AMBUSH'}
                          </span>
                          <span className={`block text-sm font-mono ${truce ? 'text-emerald-200' : 'text-rose-200'}`}>
                            {truce ? 'Share supplies honourably' : 'Steal enemy supplies by surprise'}
                          </span>
                        </span>
                      </span>
                      {reward !== undefined && (
                        <span className={`font-mono text-sm font-bold px-2.5 py-1 rounded-lg border shrink-0 ml-2 ${truce ? 'bg-emerald-950/80 border-emerald-400/30 text-emerald-100' : 'bg-red-950/80 border-red-400/30 text-red-100'}`}>
                          {pts(reward)} pts
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <VoteFeedback vote={vote} testId="r2-voted" registeredText={`Vote registered: ${vote.choice === 'TRUCE' ? 'Truce' : 'Ambush'}`} />
              <ErrorNote text={vote.error} />
              {vote.status === 'idle' && <p className="text-center text-sm text-[#a9b4c7]">The first vote you cast is final.</p>}

              <div className={`${CARD} space-y-2.5`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={LABEL}>Squad ballot status</span>
                  <span className="flex items-center space-x-1.5 text-sm font-mono text-[#e5cb87]" data-testid="r2-voted-count">
                    <Users className="w-4 h-4" />
                    <span>
                      {r2.votedCount ?? 0} of {r2.teamSize} voted
                    </span>
                  </span>
                </div>
                <div className="space-y-1.5">
                  {mates.map((m, i) => {
                    const done = r2.votedBy?.[i] === true || (m.isSelf && vote.status === 'registered');
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 p-2.5 min-h-[48px] rounded-xl bg-[#161922] border border-[#2a2e3d]">
                        <span className="flex items-center space-x-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                          <span className="min-w-0">
                            <span className="font-serif font-bold text-[#f4f0e8] text-sm block truncate">{m.isSelf ? `${m.name} (You)` : m.name}</span>
                            <span className="text-xs font-mono text-[#a9b4c7] block">{m.role}</span>
                          </span>
                        </span>
                        {done ? (
                          <span className="px-2.5 py-1 rounded bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-bold flex items-center space-x-1 shrink-0">
                            <Lock className="w-3.5 h-3.5" />
                            <span>LOCKED</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded bg-amber-950/40 border border-amber-500/40 text-amber-300 font-mono text-xs font-bold shrink-0">waiting</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs font-mono text-[#a9b4c7] text-center">When the timer reaches 0:00, anyone who has not voted counts as abstaining. Nobody sees another vote until the reveal.</p>
              </div>
            </div>
          )}

          {step === 'DEBRIEF' && current && (() => {
            const my = current.myStance;
            const their = current.rivalStance;
            let title = '🤝 HONOURABLE TRUCE';
            let bg = 'from-emerald-950/80 to-[#10121a] border-emerald-500';
            let color = 'text-emerald-300';
            if (my === 'TRUCE' && their === 'AMBUSH') {
              title = '⚡ BETRAYED IN TARTARUS!';
              bg = 'from-red-950/80 to-[#10121a] border-red-500';
              color = 'text-red-400';
            } else if (my === 'AMBUSH' && their === 'TRUCE') {
              title = '🗡️ RUTHLESS AMBUSH!';
              bg = 'from-amber-950/80 to-[#10121a] border-[#c4a45a]';
              color = 'text-[#e5cb87]';
            } else if (my === 'AMBUSH' && their === 'AMBUSH') {
              title = '⚔️ BLOODIED STALEMATE';
              bg = 'from-slate-900/90 to-[#10121a] border-slate-500';
              color = 'text-slate-300';
            }
            const votes = current.myVotes;
            const truceCount = [...votes].filter(c => c === 'T').length;
            const ambushCount = [...votes].filter(c => c === 'A').length;
            const abstainCount = [...votes].filter(c => c === '-').length;
            return (
              <div data-testid="r2-reveal" className="space-y-3.5">
                <div className={`bg-gradient-to-b ${bg} border-2 rounded-2xl p-5 text-center space-y-3 shadow-2xl`}>
                  <div className="text-xs font-mono uppercase tracking-widest text-[#a9b4c7] font-bold">CLASH {clash} REVEAL</div>
                  <h3 className={`text-2xl font-serif font-black ${color}`}>{title}</h3>
                  <div className="flex items-center justify-center space-x-3 py-1 font-mono">
                    <div className="p-2.5 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center min-w-[112px]">
                      <span className="text-xs text-[#a9b4c7] block">YOUR CREW</span>
                      <span className={`text-base font-black ${my === 'TRUCE' ? 'text-emerald-400' : 'text-red-400'}`}>{my === 'TRUCE' ? 'TRUCE' : 'AMBUSH'}</span>
                    </div>
                    <span className="text-base font-serif text-[#a9b4c7]">VS</span>
                    <div className="p-2.5 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center min-w-[112px]">
                      <span className="text-xs text-[#a9b4c7] block truncate max-w-[112px]">{rival.name}</span>
                      <span className={`text-base font-black ${their === 'TRUCE' ? 'text-emerald-400' : 'text-red-400'}`}>{their === 'TRUCE' ? 'TRUCE' : 'AMBUSH'}</span>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#08090c]/90 border border-[#2a2e3d] flex items-center justify-around font-mono">
                    <div>
                      <span className="text-xs text-[#a9b4c7] block">YOUR CREW</span>
                      <span className="text-xl font-black text-emerald-400">{pts(current.myPts)} pts</span>
                    </div>
                    <div className="w-px h-10 bg-[#2a2e3d]" />
                    <div>
                      <span className="text-xs text-[#a9b4c7] block">RIVAL CREW</span>
                      <span className="text-xl font-black text-cyan-400">{pts(current.rivalPts)} pts</span>
                    </div>
                  </div>
                </div>

                <div className={`${CARD} space-y-3`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={LABEL}>Your squad votes</span>
                    <span className="text-sm font-mono text-[#a9b4c7]">
                      {truceCount} Truce • {ambushCount} Ambush{abstainCount > 0 ? ` • ${abstainCount} Abstain` : ''}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {mates.map((m, i) => {
                      const c = votes[i] ?? '-';
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 p-2.5 min-h-[48px] rounded-xl bg-[#161922] border border-[#2a2e3d]">
                          <span className="flex items-center space-x-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                            <span className="font-serif font-bold text-[#f4f0e8] text-sm truncate">{m.isSelf ? `${m.name} (You)` : m.name}</span>
                          </span>
                          <span
                            className={`px-2.5 py-1 rounded font-mono text-xs font-bold shrink-0 ${
                              c === 'T' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50' : c === 'A' ? 'bg-red-950/80 text-red-300 border border-red-500/50' : 'bg-slate-900 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {c === 'T' ? '🤝 Truce' : c === 'A' ? '🗡️ Ambush' : 'Abstain'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={`${CARD} text-center space-y-1`}>
                  <span className="text-xs font-mono text-[#a9b4c7] uppercase font-bold block">
                    {clash < totalClashes ? `Clash ${clash + 1} begins in` : 'Round 2 results in'}
                  </span>
                  <Countdown endsAt={phase.endsAt} className="text-3xl" testId="r2-breather" />
                  <p className="text-sm text-[#a9b4c7] italic">Use this breather for table banter and psychological warfare.</p>
                </div>
              </div>
            );
          })()}
        </>
      )}

      <History />
    </div>
  );
};

// ------------------------------------------------------------------ results
const MORAL_STYLE: Record<string, { box: string; chip: string; text: string; icon: React.ReactNode; flavour: string }> = {
  HONOURABLE: {
    box: 'from-emerald-950/80 to-[#10121a] border-emerald-500',
    chip: 'bg-emerald-950 border-emerald-500/60 text-emerald-300',
    text: 'text-emerald-200/90',
    icon: <Handshake className="w-6 h-6" />,
    flavour: 'Neither crew broke faith in the Stygian mist. You stood honourable before Charon.',
  },
  BETRAYED: {
    box: 'from-red-950/80 to-[#10121a] border-red-500',
    chip: 'bg-red-950 border-red-500/60 text-red-300',
    text: 'text-red-200/90',
    icon: <Skull className="w-6 h-6 animate-pulse" />,
    flavour: 'They took your supplies in the Stygian mist. Hades remembers this debt. Seek vengeance in the trials ahead.',
  },
  AGGRESSOR: {
    box: 'from-amber-950/80 to-[#10121a] border-[#c4a45a]',
    chip: 'bg-amber-950 border-[#c4a45a]/60 text-[#e5cb87]',
    text: 'text-[#f4f0e8]/90',
    icon: <Crown className="w-6 h-6" />,
    flavour: 'You outsmarted your rival across the mist. Watch your back in the trials ahead; they will not forget.',
  },
  BLOOD_FEUD: {
    box: 'from-cyan-950/80 to-[#10121a] border-cyan-500',
    chip: 'bg-cyan-950 border-cyan-500/60 text-cyan-300',
    text: 'text-cyan-200/90',
    icon: <Swords className="w-6 h-6" />,
    flavour: 'Blood was spilled on both sides of the mist. No honour, no debt, only the river ahead.',
  },
};

const Results: React.FC = () => {
  const { view, meta } = useGame();
  const r2 = view?.r2;
  const total = r2 ? r2.clashes.reduce((a, c) => a + c.myPts, 0) : 0;
  const played = !!r2?.paired && r2.clashes.length > 0;

  // Confetti once when the results appear.
  const fired = useRef(false);
  useEffect(() => {
    if (!played || fired.current) return;
    fired.current = true;
    try {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 }, colors: ['#c4a45a', '#38bdf8', '#fb923c'] });
    } catch {
      /* ignore */
    }
  }, [played]);

  if (!r2) return null;
  const id = r2.moral && r2.moral !== 'NONE' ? (r2.moral as MoralStatus) : undefined;
  const moral = id ? meta?.moralStatuses.find(m => m.id === id) : undefined;
  const style = id ? MORAL_STYLE[id] : undefined;

  return (
    <div className="space-y-4">
      {style ? (
        <div className={`bg-gradient-to-b ${style.box} border-2 rounded-2xl p-6 text-center space-y-3 shadow-2xl`}>
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center mx-auto ${style.chip}`}>{style.icon}</div>
          <div className={`inline-block px-3 py-1 rounded-full border font-mono text-xs uppercase font-bold tracking-widest ${style.chip}`}>Your moral legacy</div>
          <h2 data-testid="r2-moral" className="text-2xl font-serif font-black text-[#f4f0e8]">
            {moral?.name ?? id}
          </h2>
          <p className={`text-base font-serif italic max-w-xs mx-auto leading-relaxed ${style.text}`}>{moral?.note ?? style.flavour}</p>
        </div>
      ) : (
        <div className={`${CARD} text-center space-y-2`}>
          <span className={LABEL}>Round 2 complete</span>
          <h3 data-testid="r2-moral" className="text-2xl font-serif font-black text-[#e5cb87]">
            {r2.paired ? 'No moral status' : 'No clash played'}
          </h3>
        </div>
      )}

      <div className={`${CARD} flex items-center justify-between`}>
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-[#a9b4c7] font-bold block">Round 2 points earned</span>
          <span className="text-sm text-[#f4f0e8]">All clashes finalised</span>
        </div>
        <div className="text-right">
          <span className="text-3xl font-mono font-black text-emerald-400">{pts(total)}</span>
          <span className="text-xs font-mono text-[#a9b4c7] ml-1">PTS</span>
        </div>
      </div>

      <History />
      <div className="p-3 rounded-xl bg-[#161922]/50 border border-[#2a2e3d]/40 text-center text-sm text-[#a9b4c7]">Waiting for the Game Master to announce the Round 2 leaderboard.</div>
    </div>
  );
};

export const ShadesInTheMistRound: React.FC = () => {
  const { view } = useGame();
  const name = view?.phase.name;
  if (name === 'R2_PAIRING') return <PairingStep />;
  if (name === 'R2_CLASH') return <ClashStep />;
  return <Results />;
};
