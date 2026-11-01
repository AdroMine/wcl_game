// Round 2: Shades in the Mist. The server owns the clock and the steps; this screen only displays them.
import React, { useEffect, useState } from 'react';
import { Delete, Handshake, Swords, Users, Check } from 'lucide-react';
import type { MoralStatus, Stance } from '../../../shared/protocol.ts';
import { useGame } from '../../game/useGame';
import { BTN_GOLD, CARD, Countdown, ErrorNote, LABEL, pts } from '../ui';

const STEP_NAMES: Record<string, string> = { HUDDLE: 'Huddle', PARLEY: 'Dialogue', VOTE: 'Vote', DEBRIEF: 'Reveal' };
const STEP_HELP: Record<string, string> = {
  HUDDLE: 'Whisper with your own crew. Decide: Truce or Ambush?',
  PARLEY: 'Face your rival crew and talk. Bluffing is allowed.',
  VOTE: 'Vote now. Your crew majority decides. A tie is a Truce.',
  DEBRIEF: 'The clash is scored. See what your rival chose.',
};

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
            <StanceText s={c.myStance} /> vs <StanceText s={c.rivalStance} />
          </span>
          <span className="font-mono font-bold text-[#e5cb87]">{pts(c.myPts)}</span>
        </div>
      ))}
    </div>
  );
};

const StanceText: React.FC<{ s: Stance }> = ({ s }) => (
  <span className={s === 'TRUCE' ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold'}>{s === 'TRUCE' ? 'Truce' : 'Ambush'}</span>
);

// ------------------------------------------------------------------ a clash
const ClashStep: React.FC = () => {
  const { view, send } = useGame();
  const [chosen, setChosen] = useState<Stance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phase = view?.phase;
  const r2 = view?.r2;
  const clash = phase?.clash ?? 0;
  const step = phase?.step ?? '';

  useEffect(() => {
    setChosen(null);
    setError(null);
  }, [clash]);

  if (!phase || !r2) return null;
  if (!r2.paired || !r2.rival) {
    return (
      <div className={`${CARD} text-center space-y-1`}>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Your crew is sitting out Round 2</h3>
        <p className="text-sm text-[#a9b4c7]">You were not paired with a rival crew. Watch the screen for Round 3.</p>
      </div>
    );
  }

  const myVote = (view?.me?.myVote as Stance | undefined) ?? chosen ?? undefined;
  const voteNow = async (vote: Stance) => {
    if (busy || myVote) return;
    setBusy(true);
    setError(null);
    setChosen(vote);
    const r = await send('R2_VOTE', { vote });
    setBusy(false);
    if (!r.ok) {
      setChosen(null);
      setError(r.message ?? 'Vote not accepted.');
    }
  };

  const current = r2.clashes.find(c => c.clash === clash);

  return (
    <div className="space-y-4">
      <div className={`${CARD} text-center space-y-2`}>
        <span className={LABEL}>
          Clash {clash} of 3 • versus {r2.rival.name}
        </span>
        <h3 data-testid="r2-step" className="text-3xl font-serif font-black text-[#f4f0e8] tracking-wide">
          {STEP_NAMES[step] ?? step}
        </h3>
        <div>
          <Countdown endsAt={phase.endsAt} className="text-6xl" />
        </div>
        <p className="text-base text-[#cbd5e1] leading-snug">{STEP_HELP[step] ?? ''}</p>
      </div>

      {step === 'VOTE' && (
        <div className={`${CARD} space-y-3`}>
          <div className="grid grid-cols-1 gap-3">
            <button
              data-testid="vote-truce"
              disabled={!!myVote || busy}
              onClick={() => voteNow('TRUCE')}
              className={`min-h-[96px] rounded-2xl border-2 flex flex-col items-center justify-center space-y-1 transition disabled:cursor-not-allowed ${
                myVote === 'TRUCE' ? 'bg-emerald-800/70 border-emerald-300' : myVote ? 'bg-[#161922] border-[#2a2e3d] opacity-40' : 'bg-emerald-950/50 border-emerald-500/70 active:scale-[0.98]'
              }`}
            >
              <Handshake className="w-8 h-8 text-emerald-300" />
              <span className="text-2xl font-serif font-black text-emerald-100">TRUCE</span>
            </button>
            <button
              data-testid="vote-ambush"
              disabled={!!myVote || busy}
              onClick={() => voteNow('AMBUSH')}
              className={`min-h-[96px] rounded-2xl border-2 flex flex-col items-center justify-center space-y-1 transition disabled:cursor-not-allowed ${
                myVote === 'AMBUSH' ? 'bg-red-800/70 border-red-300' : myVote ? 'bg-[#161922] border-[#2a2e3d] opacity-40' : 'bg-red-950/50 border-red-500/70 active:scale-[0.98]'
              }`}
            >
              <Swords className="w-8 h-8 text-red-300" />
              <span className="text-2xl font-serif font-black text-red-100">AMBUSH</span>
            </button>
          </div>
          <ErrorNote text={error} />
          {myVote ? (
            <p data-testid="r2-voted" className="text-center text-base text-[#f4f0e8]">
              Your vote is locked: <StanceText s={myVote} />
            </p>
          ) : (
            <p className="text-center text-sm text-[#a9b4c7]">The first vote you cast is final.</p>
          )}
          <div className="flex items-center justify-center space-x-2 text-sm font-mono text-[#e5cb87]" data-testid="r2-voted-count">
            <Users className="w-4 h-4" />
            <span>
              {r2.votedCount ?? 0} of {r2.teamSize} teammates voted
            </span>
          </div>
        </div>
      )}

      {step === 'DEBRIEF' && current && (
        <div data-testid="r2-reveal" className={`${CARD} space-y-3`}>
          <span className={LABEL}>Reveal</span>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 rounded-xl bg-[#161922] border border-[#3a4157]">
              <div className="text-[11px] font-mono text-[#a9b4c7] uppercase">Your crew</div>
              <div className="text-2xl font-serif font-black mt-1">
                <StanceText s={current.myStance} />
              </div>
              <div className="text-lg font-mono font-bold text-[#e5cb87] mt-1">{pts(current.myPts)} pts</div>
            </div>
            <div className="p-3 rounded-xl bg-[#161922] border border-[#3a4157]">
              <div className="text-[11px] font-mono text-[#a9b4c7] uppercase truncate">{r2.rival.name}</div>
              <div className="text-2xl font-serif font-black mt-1">
                <StanceText s={current.rivalStance} />
              </div>
              <div className="text-lg font-mono font-bold text-[#e5cb87] mt-1">{pts(current.rivalPts)} pts</div>
            </div>
          </div>
        </div>
      )}

      <History />
    </div>
  );
};

// ------------------------------------------------------------------ results
const Results: React.FC = () => {
  const { view, meta } = useGame();
  const r2 = view?.r2;
  if (!r2) return null;
  const moral = r2.moral && r2.moral !== 'NONE' ? meta?.moralStatuses.find(m => m.id === (r2.moral as MoralStatus)) : undefined;
  const total = r2.clashes.reduce((a, c) => a + c.myPts, 0);
  return (
    <div className="space-y-4">
      <div className={`${CARD} text-center space-y-2`}>
        <span className={LABEL}>Round 2 complete</span>
        <h3 className="text-2xl font-serif font-black text-[#f4f0e8]">Your moral legacy</h3>
        <div data-testid="r2-moral" className="text-3xl font-serif font-black text-[#e5cb87]">
          {moral?.name ?? (r2.paired ? r2.moral : 'No clash played')}
        </div>
        {moral && <p className="text-sm text-[#cbd5e1] leading-relaxed">{moral.note}</p>}
        <p className="text-base font-mono text-[#f4f0e8]">Round 2 points: {pts(total)}</p>
      </div>
      <History />
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

