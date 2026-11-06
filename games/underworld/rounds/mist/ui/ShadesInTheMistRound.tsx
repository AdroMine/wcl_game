// Round 2: Shades in the Mist. The server owns the clock and the steps; this screen only displays them.
// One clash = one VOTE step (talk and vote, voting open the whole time), then a DEBRIEF reveal. The rope is the timer.
import React, { useEffect, useRef, useState } from 'react';
import { Check, Crown, Handshake, HeartCrack, Skull, Sword, Swords } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { MoralStatus, Stance } from '../../../../../shared/protocol.ts';
import { useGame } from '../../../../../src/game/useGame';
import { usePendingVote, VoteFeedback } from '../../../../../src/game/usePendingVote';
import { EmojiKeypad, CODE_LENGTH } from '../../../../../src/components/EmojiKeypad';
import { BTN_GOLD, ErrorNote, pts, reducedMotion } from '../../../../../src/components/ui';

// ------------------------------------------------------------------ pairing
/** The rival crew's emoji code. */
const rivalCode = (r: { code: string } | undefined): string => r?.code ?? '';

const PairingStep: React.FC = () => {
  const { view, meta, send } = useGame();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = view?.team;
  const r2 = view?.r2;
  if (!team || !r2) return null;

  if (r2.paired && r2.rival) {
    return (
      <div data-testid="r2-paired" className="mt-6 p-6 rounded-2xl bg-emerald-950/30 border border-emerald-500/50 text-center space-y-3">
        <Check className="w-12 h-12 text-emerald-300 mx-auto" />
        <h3 className="text-2xl font-serif font-black text-emerald-200 [overflow-wrap:anywhere]">{r2.rival.name}</h3>
        <p className="text-4xl tracking-widest text-[#f4f0e8]">{rivalCode(r2.rival)}</p>
        <p className="text-base text-[#cbd5e1]">Waiting for the first clash.</p>
      </div>
    );
  }

  const connect = async () => {
    if (picked.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const r = await send('R2_PAIR', { code: picked.join('') });
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? 'Could not pair.');
      setTimeout(() => setError(null), 3000);
    }
    else setPicked([]);
  };

  return (
    <div className="min-h-[calc(100dvh-8rem)] flex flex-col pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="text-center">
        <span className="text-base text-[#cbd5e1]">Your crew</span>
        <div data-testid="my-battle-code" className="text-6xl tracking-[0.15em] leading-tight">
          {team.emojiCode}
        </div>
      </div>

      <div className="mt-auto pt-4 space-y-3">
        {/* The error takes the prompt's line, so the keypad never moves under the thumb. */}
        <p role="status" aria-live="polite" className={`text-center text-lg font-serif font-bold ${error ? 'text-red-300' : 'text-[#e5cb87]'}`}>
          {error ?? 'Tap your rival’s code'}
        </p>
        <div className={`rounded-2xl transition-shadow ${error ? 'ring-2 ring-red-400/70' : ''}`}>
          <EmojiKeypad
            pool={meta?.emojiPool ?? []}
            value={picked}
            onChange={v => {
              setPicked(v);
              setError(null);
            }}
            disabled={busy}
            slotsTestId="rival-code-display"
          />
        </div>
        <button data-testid="r2-connect" onClick={connect} disabled={picked.length !== CODE_LENGTH || busy} className={`${BTN_GOLD} disabled:opacity-100 disabled:bg-none disabled:bg-[#161922] disabled:text-[#7c869a] disabled:border disabled:border-[#2a2e3d] disabled:shadow-none disabled:cursor-not-allowed`}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ history (Round 2 results only)
const StanceText: React.FC<{ s: Stance }> = ({ s }) => (
  <span className={`inline-flex items-center gap-1 font-bold ${s === 'TRUCE' ? 'text-emerald-300' : 'text-red-300'}`}>
    {s === 'TRUCE' ? <Handshake className="w-4 h-4" /> : <Sword className="w-4 h-4" />}
    {s === 'TRUCE' ? 'Truce' : 'Ambush'}
  </span>
);

const History: React.FC = () => {
  const { view } = useGame();
  const r2 = view?.r2;
  if (!r2 || r2.clashes.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="r2-history">
      {r2.clashes.map(c => (
        <div key={c.clash} className="flex items-center justify-between gap-2 text-base px-3 min-h-[48px] rounded-xl bg-[#161922] border border-[#2a2e3d]">
          <span className="font-mono text-[#a9b4c7]">{c.clash}</span>
          <span className="flex items-center gap-1.5 text-[#f4f0e8]">
            <StanceText s={c.myStance} /> <span className="text-[#a9b4c7]">vs</span> <StanceText s={c.rivalStance} />
          </span>
          <span className="font-mono font-bold text-[#e5cb87]">{pts(c.myPts)}</span>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ a clash
const ClashStep: React.FC = () => {
  const { view, meta, send } = useGame();
  const phase = view?.phase;
  const r2 = view?.r2;
  const clash = phase?.clash ?? 0;
  const step = phase?.step ?? '';
  const vote = usePendingVote<Stance>((view?.me?.myVote as Stance | undefined) ?? null, `r2:${clash}:${step === 'DEBRIEF' ? 'D' : 'V'}`);

  if (!phase || !r2) return null;
  const byeTotal = (r2.bye ?? []).reduce((a, n) => a + n, 0);
  if (!r2.paired || !r2.rival) {
    return (
      <div className="mt-6 p-6 rounded-2xl bg-[#10121a] border border-[#3a4157] text-center space-y-2">
        <Handshake className="w-10 h-10 text-emerald-300 mx-auto" />
        <h3 data-testid="r2-bye" className="text-xl font-serif font-black text-[#f4f0e8]">No rival this round</h3>
        <p className="text-base text-[#cbd5e1]">Truce points every clash. +{meta?.r3.honourBonus ?? 75} m head start in Round 3.</p>
        {byeTotal > 0 && <p className="text-lg font-mono font-bold text-emerald-300">{pts(byeTotal)} pts</p>}
      </div>
    );
  }

  const rival = r2.rival;
  const stakes = meta?.r2Stakes.find(s => s.clash === clash);
  const current = r2.clashes.find(c => c.clash === clash);

  const cast = (v: Stance) => {
    if (vote.locked) return;
    void vote.submit(v, () => send('R2_VOTE', { vote: v }));
  };

  // ---------------------------------------------------------------- DEBRIEF: the reveal and nothing else
  if (step === 'DEBRIEF') {
    if (!current) {
      return (
        <div data-testid="r2-reveal" className="mt-6 text-center">
          <h3 className="text-2xl font-serif font-black text-[#f4f0e8]">Revealing…</h3>
        </div>
      );
    }
    const my = current.myStance;
    const their = current.rivalStance;
    let word = 'Truce kept';
    let Icon = Handshake;
    let tone = 'border-emerald-500 text-emerald-300 from-emerald-950/70';
    if (my === 'TRUCE' && their === 'AMBUSH') {
      word = 'Betrayed';
      Icon = HeartCrack;
      tone = 'border-red-500 text-red-300 from-red-950/70';
    } else if (my === 'AMBUSH' && their === 'TRUCE') {
      word = 'Ruthless ambush';
      Icon = Sword;
      tone = 'border-[#c4a45a] text-[#e5cb87] from-amber-950/60';
    } else if (my === 'AMBUSH' && their === 'AMBUSH') {
      word = 'Stalemate';
      Icon = Swords;
      tone = 'border-slate-400 text-slate-200 from-slate-900/80';
    }
    // The crew's own votes show only when it was split.
    const members = view?.team?.members ?? [];
    const votes = current.myVotes;
    const hasT = votes.includes('T');
    const hasA = votes.includes('A');
    return (
      <div data-testid="r2-reveal" className="mt-4 space-y-4">
        <div className={`bg-gradient-to-b ${tone} to-[#10121a] border-2 rounded-2xl p-6 text-center space-y-3`}>
          <Icon className="w-12 h-12 mx-auto" />
          <h3 className="text-3xl font-serif font-black">{word}</h3>
          <p className="text-4xl font-mono font-black text-[#f4f0e8] tabular-nums whitespace-nowrap">
            {pts(current.myPts)} <span className="text-xl text-[#a9b4c7]">vs</span> {pts(current.rivalPts)}
          </p>
          <p className="text-base text-[#cbd5e1] [overflow-wrap:anywhere]">
            You: {my === 'TRUCE' ? 'Truce' : 'Ambush'} · {rival.name}: {their === 'TRUCE' ? 'Truce' : 'Ambush'}
          </p>
        </div>
        {hasT && hasA && (
          <div className="flex flex-wrap justify-center gap-2" data-testid="r2-split">
            {members.map((m, i) => {
              const c = votes[i] ?? '-';
              return (
                <span key={i} className="inline-flex items-center gap-1.5 min-h-[40px] py-1.5 px-3 rounded-2xl border border-[#3a4157] bg-[#161922] text-base text-[#f4f0e8]">
                  {c === 'T' ? <Handshake className="w-4 h-4 text-emerald-300" /> : c === 'A' ? <Sword className="w-4 h-4 text-red-300" /> : <span className="text-[#a9b4c7]">–</span>}
                  <span className="min-w-0 text-left leading-tight [overflow-wrap:anywhere]">{m.name}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- VOTE: talk, then vote (open the whole step)
  const tiles = stakes
    ? [
        { Icon: Handshake, v: stakes.bothTruce, cap: 'Both truce', c: 'text-emerald-300' },
        { Icon: Sword, v: stakes.ambushWin, cap: 'You ambush', c: 'text-amber-300' },
        { Icon: Swords, v: stakes.bothAmbush, cap: 'Both ambush', c: 'text-red-300' },
        { Icon: HeartCrack, v: stakes.truceLoss, cap: 'Betrayed', c: 'text-[#cbd5e1]' },
      ]
    : [];
  return (
    <div className="min-h-[calc(100dvh-8rem)] flex flex-col pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="text-center">
        <div className="text-2xl font-serif font-black text-[#f4f0e8] [overflow-wrap:anywhere]">
          {rival.name} <span className="text-[#e5cb87]">{rivalCode(rival)}</span>
        </div>
        <p className="text-lg text-[#cbd5e1] mt-1">Talk to {rival.name}, then vote</p>
      </div>

      <div className="mt-auto pt-4 grid grid-cols-1 gap-3">
        {(['TRUCE', 'AMBUSH'] as Stance[]).map(s => {
          const picked = vote.choice === s;
          const dim = vote.choice && !picked;
          const truce = s === 'TRUCE';
          const Icon = truce ? Handshake : Sword;
          return (
            <button
              key={s}
              type="button"
              data-testid={truce ? 'vote-truce' : 'vote-ambush'}
              disabled={vote.locked}
              onClick={() => cast(s)}
              className={`w-full min-h-[104px] px-5 rounded-2xl border-2 flex items-center justify-center gap-3 transition disabled:cursor-not-allowed ${
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
              <Icon className={`w-9 h-9 ${truce ? 'text-emerald-200' : 'text-red-200'}`} />
              <span className={`text-3xl font-serif font-black ${truce ? 'text-emerald-100' : 'text-red-100'}`}>{truce ? 'Truce' : 'Ambush'}</span>
            </button>
          );
        })}
      </div>

      {/* One fixed-height slot: the hint, the sending state and the confirmation swap in place, so nothing jumps. */}
      <div className="min-h-[60px] mt-3 flex flex-col justify-center gap-2">
        <VoteFeedback vote={vote} testId="r2-voted" registeredText={`Vote registered: ${vote.choice === 'TRUCE' ? 'Truce' : 'Ambush'}`} />
        <ErrorNote text={vote.error} />
        {vote.status === 'idle' && !vote.error && <p className="text-base text-center text-[#cbd5e1]">Crew majority decides.</p>}
      </div>
      <div className="flex justify-center mb-3">
        <span data-testid="r2-voted-count" className="text-base font-mono text-[#e5cb87]">
          {r2.votedCount ?? 0}/{r2.teamSize} voted
        </span>
      </div>

      {tiles.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5" data-testid="r2-stakes">
          {tiles.map((t, i) => (
            <div key={i} className="rounded-xl bg-[#10121a] border border-[#2a2e3d] py-2 text-center">
              <t.Icon className={`w-5 h-5 mx-auto ${t.c}`} />
              <div className={`text-lg font-mono font-black tabular-nums ${t.c}`}>{pts(t.v)}</div>
              <div className="text-sm leading-tight text-[#cbd5e1] px-0.5">{t.cap}</div>
            </div>
          ))}
        </div>
      )}
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
    icon: <Skull className="w-6 h-6" />,
    flavour: 'They took your supplies in the Stygian mist. Hades remembers this debt. You can take Revenge in the trials ahead.',
  },
  AGGRESSOR: {
    box: 'from-amber-950/80 to-[#10121a] border-[#c4a45a]',
    chip: 'bg-amber-950 border-[#c4a45a]/60 text-[#e5cb87]',
    text: 'text-[#f4f0e8]/90',
    icon: <Crown className="w-6 h-6" />,
    flavour: 'You outsmarted your rival across the mist. Watch your back: they may take Revenge in the trials ahead.',
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
  const byeTotal = (r2?.bye ?? []).reduce((a, n) => a + n, 0);
  const total = r2 ? r2.clashes.reduce((a, c) => a + c.myPts, 0) + byeTotal : 0;
  const played = !!r2?.paired && r2.clashes.length > 0;

  // Confetti once when the results appear (not with reduced motion).
  const fired = useRef(false);
  useEffect(() => {
    if (!played || fired.current) return;
    fired.current = true;
    if (reducedMotion()) return;
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
    <div className="space-y-4 pt-2">
      <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 ${style ? `bg-gradient-to-b ${style.box}` : 'border-[#3a4157] bg-[#10121a]'}`}>
        <div className="min-w-0">
          <p className="text-base text-[#cbd5e1]">Round 2</p>
          <h3 data-testid="r2-moral" className="text-lg font-serif font-bold text-[#f4f0e8] [overflow-wrap:anywhere]">
            {style ? (moral?.name ?? id) : r2.paired ? 'Done' : 'Truce points'}
          </h3>
        </div>
        <p className="shrink-0 text-3xl font-mono font-black text-emerald-300 tabular-nums">
          {pts(total)} <span className="text-base font-normal text-[#cbd5e1]">pts</span>
        </p>
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
