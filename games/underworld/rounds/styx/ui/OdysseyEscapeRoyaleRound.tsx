// Round 3: Escape from Tartarus (the River Styx). Display and input only; the server resolves every wave.
// A wave = one VOTE step ("Decide": boats and revenge open from the start), then a REVEAL. The rope is the timer.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Anchor, Check, CheckCircle2, Ghost, Link2, Loader2, Medal, Sailboat, Wind } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { SdAction, Vessel } from '../../../../../shared/protocol.ts';
import { useGame } from '../../../../../src/game/useGame';
import { usePendingVote, VoteFeedback } from '../../../../../src/game/usePendingVote';
import { CARD, ErrorNote, OVERLAY_TOP, ordinal, pts, reducedMotion, useOverlay } from '../../../../../src/components/ui';
import { useTick } from '../../../../../src/game/useNow';
import { SdReveal, SdTriangle } from './SuddenDeath';

const OUTCOME_LINE = {
  moved: 'You moved ahead.',
  sailboatSank: 'Your Sailboat capsized.',
  ghostSank: 'Your Ghost Ship collided.',
  escaped: 'You escaped!',
};
/** Signed metres with a real minus sign: +250 m, −100 m, 0 m. */
const metres = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} m`;
const VESSEL_ICON: Record<Vessel, typeof Anchor> = {
  ROWBOAT: Anchor,
  SAILBOAT: Sailboat,
  GHOST_SHIP: Ghost,
};

const VESSEL_STYLE: Record<Vessel, { on: string; hover: string; amount: string; icon: string }> = {
  ROWBOAT: {
    on: 'bg-emerald-950/70 border-emerald-400 ring-2 ring-emerald-400/50',
    hover: 'hover:border-emerald-500/60',
    amount: 'text-emerald-400',
    icon: 'text-emerald-300',
  },
  SAILBOAT: {
    on: 'bg-sky-950/70 border-sky-400 ring-2 ring-sky-400/50',
    hover: 'hover:border-sky-500/60',
    amount: 'text-sky-400',
    icon: 'text-sky-300',
  },
  GHOST_SHIP: {
    on: 'bg-purple-950/70 border-purple-400 ring-2 ring-purple-400/50',
    hover: 'hover:border-purple-500/60',
    amount: 'text-purple-400',
    icon: 'text-purple-300',
  },
};

// ------------------------------------------------------------------ the progress strip
/** "135 m · 4th" over a thin river strip: your crew in gold, the others as small dots. No list. */
const ProgressStrip: React.FC<{
  rows: [string, number, number, string][];
  mine: string | undefined;
  distance: number;
  pos: number | undefined;
  target: number;
  honour: number | null;
}> = ({ rows, mine, distance, pos, target, honour }) => {
  const pct = (dist: number, rank: number) => Math.min(96, rank > 0 ? 100 : Math.max(0, (dist / Math.max(1, target)) * 100));
  return (
    <div className="space-y-1.5" data-testid="r3-fleet">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xl font-mono font-black text-[#e5cb87]">
          <span data-testid="r3-distance">{distance} m</span>
          {pos ? <span> · {ordinal(pos)}</span> : null}
        </div>
        <div className="text-sm text-[#a9b4c7]">Escape at {target} m</div>
      </div>
      <div className="relative h-7 rounded-full overflow-hidden border border-sky-800/70 bg-gradient-to-b from-[#0b3a66] to-[#0a2f55]">
        <div className="absolute right-0 inset-y-0 w-2 bg-emerald-500/70" />
        {rows
          .filter(([name]) => name !== mine)
          .map(([name, dist, rank], i) => (
            <span
              key={`${name}-${i}`}
              data-testid="r3-boat"
              title={`${name}: ${dist} m`}
              className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-[#cbd5e1]/70"
              style={{
                left: `${pct(dist, rank)}%`,
                transform: 'translate(-50%,-50%)',
              }}
            />
          ))}
        <span
          data-testid="r3-boat-me"
          className="absolute top-1/2 w-5 h-5 rounded-full bg-[#e5cb87] border-2 border-white shadow-[0_0_8px_rgba(229,203,135,0.7)]"
          style={{
            left: `${Math.min(97, (distance / Math.max(1, target)) * 100)}%`,
            transform: 'translate(-50%,-50%)',
            transition: 'left 700ms ease-out',
          }}
        />
      </div>
      {honour != null && (
        <p data-testid="r3-honourable" className="text-sm text-emerald-300 flex items-center gap-1.5">
          <Wind className="w-4 h-4" />+{honour} m head start for keeping your word
        </p>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ the podium
const PODIUM_COLOR = ['#e5cb87', '#cbd5e1', '#d6893a'];
export const Podium: React.FC<{ names: string[] }> = ({ names }) => (
  <div className="bg-gradient-to-b from-[#161922] via-[#10121a] to-[#08090c] border-2 border-[#c4a45a] rounded-2xl p-4 space-y-3" data-testid="r3-podium">
    <h2 className="text-2xl font-serif font-black text-[#f4f0e8] text-center">The Podium</h2>
    {/* Rows, not columns: a 32-character crew name needs the full width. */}
    <ol className="space-y-2">
      {[0, 1, 2].map(place => (
        <li
          key={place}
          className="flex items-center gap-3 rounded-xl border bg-[#1e2330] px-3 py-3 min-h-[64px]"
          style={{ borderColor: place === 0 ? PODIUM_COLOR[0] : '#3a4157' }}
        >
          <Medal className={`w-8 h-8 shrink-0 ${place === 0 ? 'motion-safe:animate-bounce' : ''}`} style={{ color: PODIUM_COLOR[place] }} aria-hidden="true" />
          <span className="w-10 shrink-0 text-base font-mono font-bold" style={{ color: PODIUM_COLOR[place] }}>
            {ordinal(place + 1)}
          </span>
          <h4 className="min-w-0 text-lg leading-snug font-serif font-black text-[#f4f0e8] [overflow-wrap:anywhere]">{names[place] ?? '-'}</h4>
        </li>
      ))}
    </ol>
  </div>
);

// ------------------------------------------------------------------ the screen
export const OdysseyEscapeRoyaleRound: React.FC = () => {
  const { view, meta, send, serverNow } = useGame();
  const wave = view?.phase.wave ?? 0;
  const step = view?.phase.step ?? '';
  const phaseName = view?.phase.name;
  const r3 = view?.r3;
  // Local UI only: which Sudden Death result this phone has already dismissed with Continue.
  const [sdSeen, setSdSeen] = useState('');
  // A Sudden Death run from the results screen takes over until its reveal ends.
  const finished = (phaseName === 'R3_RESULTS' || phaseName === 'FINISHED') && step !== 'SUDDEN_DEATH';
  const inSd = step === 'SUDDEN_DEATH' && !!r3?.sd;
  useTick(inSd && r3?.sd?.resolved ? 250 : 60_000);
  const myVote = view?.me?.myVote;
  useOverlay(inSd);

  const vesselVote = usePendingVote<Vessel>(step === 'VOTE' ? (myVote as Vessel | undefined) : null, `v:${wave}:${step}`);
  const leashVote = usePendingVote<'ARMED'>(r3?.leash?.armed ? 'ARMED' : null, `l:${wave}`);
  const sdVote = usePendingVote<SdAction>(inSd ? (myVote as SdAction | undefined) : null, `sd:${wave}:${step}`);

  // Confetti once when the podium appears (not with reduced motion).
  const podiumLen = r3?.podium?.length ?? 0;
  const fired = useRef(false);
  useEffect(() => {
    if (!finished || podiumLen === 0 || fired.current) return;
    fired.current = true;
    if (reducedMotion()) return;
    try {
      confetti({
        particleCount: 80,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#ef4444'],
      });
    } catch {
      /* ignore */
    }
  }, [finished, podiumLen]);

  if (!view || !r3) {
    return (
      <div className={`${CARD} text-center space-y-1 mt-6`}>
        <h3 className="text-xl font-serif font-black text-[#f4f0e8]">Your crew is not on the river</h3>
        <p className="text-base text-[#a9b4c7]">Watch the main screen.</p>
      </div>
    );
  }

  const target = meta?.r3.targetDistance ?? 1000;
  const honourBonus = meta?.r3.honourBonus ?? 75;
  const myName = view.team?.name;
  const cap = r3.sailboatCapacity;

  const sdKey = r3.sd ? `${r3.sd.teamA}|${r3.sd.teamB}|${r3.sd.winner ?? ''}` : '';
  const showSd = !!r3.sd?.resolved && sdKey !== sdSeen;
  if (finished) {
    return (
      <div className="space-y-4 pt-2">
        {showSd && r3.sd ? (
          // A moment, not a page: centred under the navbar like the lobby's first screen.
          <div className="min-h-[calc(100dvh-9rem)] flex flex-col justify-center pb-12">
            <div className={`${CARD} space-y-4`} data-testid="sd-summary">
              <h2 className="text-center text-2xl font-serif font-black text-[#e5cb87]">Sudden Death</h2>
              <SdReveal
                teamA={r3.sd.teamA}
                teamB={r3.sd.teamB}
                side={r3.sd.side}
                pickA={r3.sd.pickA}
                pickB={r3.sd.pickB}
                winner={r3.sd.winner}
                winnerSide={r3.sd.winnerSide}
                text={r3.sd.text}
                elapsed={Infinity}
                celebrate={false}
              />
              <button
                type="button"
                data-testid="sd-continue"
                onClick={() => setSdSeen(sdKey)}
                className="w-full min-h-[52px] rounded-xl bg-[#c4a45a] text-[#08090c] font-serif font-black text-lg active:scale-[0.98]"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <Podium names={r3.podium ?? []} />
        )}
        {!showSd && (
          <div className="text-center py-1">
            {r3.escaped ? (
              <h3 data-testid="r3-escaped" className="text-2xl font-serif font-black text-emerald-200">
                Your crew escaped as #{r3.escapedRank}
              </h3>
            ) : (
              <h3 className="text-2xl font-serif font-black text-[#f4f0e8]">
                Your crew: {r3.distance} m{r3.myPos ? ` · ${ordinal(r3.myPos)}` : ''}
              </h3>
            )}
          </div>
        )}
      </div>
    );
  }

  const sd = r3.sd;
  const canVote = step === 'VOTE' && !r3.escaped;
  const lw = r3.lastWave;
  const vessels = meta?.vessels ?? [];

  const castVessel = (vessel: Vessel) => {
    if (!canVote || vesselVote.locked) return;
    void vesselVote.submit(vessel, () => send('R3_VOTE', { vessel }));
  };
  const armLeash = () => {
    if (!canVote || leashVote.locked) return;
    void leashVote.submit('ARMED', () => send('R3_ARM_LEASH', {}));
  };
  const castSd = (action: SdAction) => {
    if (sdVote.locked) return;
    void sdVote.submit(action, () => send('SD_VOTE', { action }));
  };

  // ---------------------------------------------------------------- Sudden Death: a full overlay (the rope stays on top)
  if (inSd && sd) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-[#08090c] px-4 pb-4" style={{ paddingTop: OVERLAY_TOP }} data-testid="r3-sd">
        <div className="max-w-md mx-auto bg-[#10121a] border-2 border-red-500/60 rounded-2xl p-5 space-y-4">
          <div className="text-center space-y-1">
            <div className="text-base font-bold text-red-300">Sudden Death</div>
            <h3 className="text-xl font-serif font-black text-[#f4f0e8] [overflow-wrap:anywhere]">
              {sd.teamA} vs {sd.teamB}
            </h3>
          </div>

          {sd.resolved ? (
            <SdReveal
              teamA={sd.teamA}
              teamB={sd.teamB}
              side={sd.side}
              pickA={sd.pickA}
              pickB={sd.pickB}
              winner={sd.winner}
              winnerSide={sd.winnerSide}
              text={sd.text}
              elapsed={view.phase.startedAt != null ? serverNow() - view.phase.startedAt : Infinity}
            />
          ) : sd.mine ? (
            <div className="space-y-3">
              <p className="text-center text-lg font-serif font-bold text-[#e5cb87]">Tap your move</p>
              <SdTriangle className="w-full max-w-[300px] mx-auto" onPick={castSd} picked={sdVote.choice ?? null} disabled={sdVote.locked} />
              <VoteFeedback vote={sdVote} testId="sd-voted" />
              <ErrorNote text={sdVote.error} />
              <p className="text-center text-base text-[#e5cb87]">
                {sd.votedCount ?? 0}/{r3.teamSize} voted
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-center">
              <h4 className="text-lg font-serif font-bold text-[#e5cb87]">You are watching</h4>
              <SdTriangle />
            </div>
          )}
        </div>
      </div>
    );
  }

  const strip = (
    <ProgressStrip
      rows={r3.fleet}
      mine={myName}
      distance={r3.distance}
      pos={r3.myPos}
      target={target}
      honour={r3.honourable && wave <= 1 ? honourBonus : null}
    />
  );

  // ---------------------------------------------------------------- BRIEFING fallback (the modal normally covers it)
  if (step === 'BRIEFING') {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <h2 className="text-3xl font-serif font-black text-[#f4f0e8]">Get ready</h2>
      </div>
    );
  }

  // ---------------------------------------------------------------- REVEAL: what this wave did to my crew
  if (step === 'REVEAL') {
    if (!lw) {
      return (
        <div className="space-y-4 pt-2">
          <div data-testid="r3-outcome" className="rounded-2xl border border-[#3a4157] bg-[#10121a] p-6 text-center">
            <h3 data-testid="r3-step" className="text-2xl font-serif font-black text-[#f4f0e8]">
              No boat this wave
            </h3>
          </div>
          {strip}
        </div>
      );
    }
    const bad = (lw.vessel === 'SAILBOAT' && lw.sailboatCapsized) || (lw.vessel === 'GHOST_SHIP' && lw.ghostCollided);
    const sentence = r3.escaped
      ? OUTCOME_LINE.escaped
      : bad
        ? lw.vessel === 'SAILBOAT'
          ? OUTCOME_LINE.sailboatSank
          : OUTCOME_LINE.ghostSank
        : OUTCOME_LINE.moved;
    const OutIcon = bad ? AlertTriangle : CheckCircle2;
    const toGo = Math.max(0, target - r3.distance);
    const total = lw.gained;
    const revenge = (lw.leashes ?? []).map(l => {
      if (l.kind === 'LEASH_SNAPPED') return 'Your revenge failed (boat sank).';
      if (l.role === 'holder') return `Revenge on ${l.otherName}: ${metres(l.delta)}`;
      return `${l.otherName} took revenge: ${metres(l.delta)}`;
    });
    return (
      <div className="space-y-4 pt-1">
        <div
          data-testid="r3-outcome"
          className={`rounded-2xl border-2 px-5 py-4 text-center space-y-1.5 ${bad ? 'border-red-400 bg-red-950/60' : 'border-emerald-400 bg-emerald-950/50'}`}
        >
          <OutIcon className={`w-7 h-7 mx-auto ${bad ? 'text-red-300' : 'text-emerald-300'}`} aria-hidden="true" />
          <p
            data-testid="r3-lastwave"
            className={`text-[44px] leading-none font-mono font-black tabular-nums ${total > 0 ? 'text-emerald-300' : total < 0 ? 'text-red-300' : 'text-[#cbd5e1]'}`}
          >
            {metres(total)}
          </p>
          <p data-testid="r3-step" className="text-lg font-sans font-medium text-white [overflow-wrap:anywhere]">
            {sentence}
          </p>
          {revenge.map((t, i) => (
            <p key={i} className="text-[15px] leading-snug text-[#cbd5e1] [overflow-wrap:anywhere]">
              {t}
            </p>
          ))}
          <p className="text-[15px] font-semibold text-[#e5cb87] tabular-nums" data-testid="r3-togo">
            {r3.escaped ? 'Escaped' : `${toGo} m to go`}
          </p>
        </div>
        {strip}
      </div>
    );
  }

  // ---------------------------------------------------------------- VOTE ("Decide")
  const leash = r3.leash && (r3.leash.available || r3.leash.armed) ? r3.leash : null;
  const leashTarget = leash?.targetName;
  const armed = !!leash?.armed || leashVote.locked;
  return (
    // Context rides at the top; the boats and Revenge sit in the thumb zone (mt-auto) so nothing jumps between states.
    <div className="min-h-[calc(100dvh-8rem)] flex flex-col gap-4 pt-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {strip}

      {r3.escaped ? (
        <div data-testid="r3-escaped" className="mt-4 p-6 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 text-center space-y-2">
          <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto" />
          <h3 className="text-2xl font-serif font-black text-emerald-200">Escaped as #{r3.escapedRank}</h3>
        </div>
      ) : (
        <>
          {/* Status above, decision below: the prompt sits with the boats it governs. */}
          <div className="mt-auto space-y-3">
            <h3 data-testid="r3-step" className="text-xl tracking-normal font-serif font-black text-[#f4f0e8] text-center">
              Pick your boat.
            </h3>
            {/* Three boats side by side so the whole choice fits on one screen without scrolling. */}
            <div className="grid grid-cols-3 gap-2">
              {vessels.map(v => {
                const st = VESSEL_STYLE[v.id];
                const Icon = VESSEL_ICON[v.id];
                const picked = vesselVote.choice === v.id;
                const dim = vesselVote.choice && !picked;
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-testid={`vessel-${v.id}`}
                    disabled={!canVote || vesselVote.locked}
                    onClick={() => castVessel(v.id)}
                    className={`min-w-0 min-h-[176px] px-2 py-3 rounded-2xl border-2 text-center flex flex-col items-center gap-1.5 transition disabled:cursor-not-allowed ${
                      picked
                        ? `${st.on} shadow-lg`
                        : dim
                          ? 'bg-[#161922] border-[#2a2e3d] opacity-40'
                          : `bg-[#161922] border-[#3a4157] ${canVote ? `${st.hover} active:scale-[0.98]` : ''}`
                    }`}
                  >
                    <Icon className={`w-9 h-9 shrink-0 ${st.icon}`} />
                    <span className="block font-serif font-black text-base leading-tight text-[#f4f0e8]">{v.name}</span>
                    <span className={`font-mono text-lg font-black tabular-nums leading-none ${st.amount}`}>{pts(v.success)} m</span>
                    <span className="block text-sm text-[#cbd5e1] leading-snug" data-testid={v.id === 'SAILBOAT' ? 'sailboat-capacity' : undefined}>
                      {v.id === 'ROWBOAT' && 'Always safe.'}
                      {v.id === 'SAILBOAT' && `Sinks if more than ${cap} ${cap === 1 ? 'crew picks' : 'crews pick'} it.`}
                      {v.id === 'GHOST_SHIP' && 'Only if no other crew picks it.'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-[60px] flex flex-col justify-center gap-2">
              <VoteFeedback vote={vesselVote} testId="r3-voted" />
              <ErrorNote text={vesselVote.error} />
              {vesselVote.status === 'idle' && !vesselVote.error && (
                <p className="text-base text-center text-[#cbd5e1]">Crew majority decides.</p>
              )}
            </div>
            <div className="flex justify-center">
              <span data-testid="r3-voted-count" className="text-base font-mono text-[#e5cb87]">
                {r3.votedCount ?? 0}/{r3.teamSize} voted
              </span>
            </div>

            {leash && (
              <div data-testid="r3-leash" className="space-y-1.5">
                {/* Quiet outlined toggle: never louder than the chosen boat. */}
                <button
                  type="button"
                  data-testid={armed ? 'r3-leash-registered' : 'arm-leash'}
                  aria-pressed={armed}
                  disabled={!canVote || armed}
                  onClick={armLeash}
                  className={`w-full min-w-0 min-h-[48px] py-2 px-3 rounded-xl border bg-transparent flex items-center justify-center gap-2 text-base font-bold transition disabled:cursor-not-allowed ${
                    armed ? 'border-red-300/50 text-red-200' : 'border-[#3a4157] text-[#cbd5e1] active:scale-[0.98]'
                  }`}
                >
                  {leashVote.status === 'sending' ? (
                    <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                  ) : armed ? (
                    <Check className="w-5 h-5 shrink-0" />
                  ) : (
                    <Link2 className="w-5 h-5 shrink-0" />
                  )}
                  <span className="leading-tight [overflow-wrap:anywhere]">
                    {leashVote.status === 'sending' ? 'Arming…' : armed ? 'Revenge armed' : `Take revenge${leashTarget ? ` on ${leashTarget}` : ''}`}
                  </span>
                </button>
                {leashVote.status === 'sending' && leashVote.slow && <p className="text-sm text-amber-300">Still sending. Keep this screen open.</p>}
                <ErrorNote text={leashVote.error} />
                <p className="text-sm text-center text-[#cbd5e1]">{leashTarget ? `${leashTarget} loses` : 'They lose'} 50 m, you gain 50 m. Don’t sink.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
