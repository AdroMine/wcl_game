// Round 3: Escape from Tartarus (the River Styx). Display and input only; the server resolves every wave.
import React, { useEffect, useState } from 'react';
import { Anchor, Ghost, Link2, Sailboat, Ship, Trophy, Users } from 'lucide-react';
import type { SdAction, Vessel } from '../../../shared/protocol.ts';
import { useGame } from '../../game/useGame';
import { CARD, Countdown, ErrorNote, LABEL, pts } from '../ui';

const STEP_NAMES: Record<string, string> = { BLUFF: 'Bluff', VOTE: 'Vote', REVEAL: 'Reveal', SUDDEN_DEATH: 'Sudden Death' };
const VESSEL_LETTER: Record<string, string> = { R: 'Rowboat', S: 'Sailboat', G: 'Ghost Ship' };
const SD_NAMES: Record<SdAction, string> = { SHIELDS: 'Shields', RAM: 'Ram', SAILS: 'Sails' };

function VesselIcon({ id, className = 'w-8 h-8' }: { id: Vessel; className?: string }) {
  if (id === 'ROWBOAT') return <Ship className={className} />;
  if (id === 'SAILBOAT') return <Sailboat className={className} />;
  return <Ghost className={className} />;
}

const Fleet: React.FC<{ rows: [string, number, number, string][]; mine: string | undefined; target: number }> = ({ rows, mine, target }) => (
  <div className={`${CARD} space-y-2`} data-testid="r3-fleet">
    <span className={LABEL}>The river</span>
    {rows.map(([name, dist, rank, vessel], i) => (
      <div
        key={`${name}-${i}`}
        className={`p-2.5 rounded-xl border ${name === mine ? 'border-[#c4a45a] bg-[#161922]' : 'border-[#2a2e3d] bg-[#161922]/60'}`}
      >
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold text-[#f4f0e8] truncate pr-2">{name}</span>
          <span className="font-mono text-[#e5cb87] shrink-0">
            {rank > 0 ? `ESCAPED #${rank}` : `${dist} m`}
            {vessel ? ` • ${VESSEL_LETTER[vessel] ?? vessel}` : ''}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-[#08090c] overflow-hidden border border-[#2a2e3d]">
          <div className="h-full bg-gradient-to-r from-[#c4a45a] to-[#e5cb87]" style={{ width: `${Math.min(100, (dist / target) * 100)}%` }} />
        </div>
      </div>
    ))}
  </div>
);

const Podium: React.FC = () => {
  const { view } = useGame();
  const pod = view?.r3?.podium ?? [];
  if (!pod.length) return null;
  const medals = ['Gold', 'Silver', 'Bronze'];
  return (
    <div className={`${CARD} space-y-2 text-center`} data-testid="r3-podium">
      <Trophy className="w-8 h-8 text-[#e5cb87] mx-auto" />
      <h3 className="text-xl font-serif font-black text-[#f4f0e8]">The Podium</h3>
      {pod.map((n, i) => (
        <div key={i} className="p-3 rounded-xl bg-[#161922] border border-[#c4a45a]/40 flex justify-between items-center">
          <span className="text-xs font-mono font-bold text-[#e5cb87] uppercase">{medals[i]}</span>
          <span className="text-lg font-serif font-black text-[#f4f0e8] truncate pl-2">{n}</span>
        </div>
      ))}
    </div>
  );
};

export const OdysseyEscapeRoyaleRound: React.FC = () => {
  const { view, meta, send } = useGame();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wave = view?.phase.wave ?? 0;
  const step = view?.phase.step ?? '';
  const phaseName = view?.phase.name;
  const r3 = view?.r3;

  useEffect(() => {
    setChosen(null);
    setError(null);
  }, [wave, step]);

  if (!view || !r3) {
    return (
      <div className={`${CARD} text-center space-y-1`}>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Your crew is not on the river</h3>
        <p className="text-sm text-[#a9b4c7]">Watch the main screen and the standings.</p>
      </div>
    );
  }

  const target = meta?.r3.targetDistance ?? 1000;
  const myName = view.team?.name;
  const finished = phaseName === 'R3_RESULTS' || phaseName === 'FINISHED';
  const myVote = view.me?.myVote ?? chosen ?? undefined;

  const act = async (fn: () => ReturnType<typeof send>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setChosen(null);
      setError(r.message ?? 'Not accepted.');
    }
  };

  const vote = (vessel: Vessel) => {
    if (busy || myVote) return;
    setChosen(vessel);
    void act(() => send('R3_VOTE', { vessel }));
  };

  if (finished) {
    return (
      <div className="space-y-4">
        <Podium />
        <div className={`${CARD} text-center space-y-1`}>
          {r3.escaped ? (
            <h3 data-testid="r3-escaped" className="text-xl font-serif font-black text-emerald-200">
              Your crew escaped as #{r3.escapedRank}!
            </h3>
          ) : (
            <h3 className="text-xl font-serif font-black text-[#f4f0e8]">Your crew reached {r3.distance} m</h3>
          )}
        </div>
        <Fleet rows={r3.fleet} mine={myName} target={target} />
      </div>
    );
  }

  const sd = r3.sd;
  const inSd = step === 'SUDDEN_DEATH' && !!sd;
  const canVote = step === 'VOTE' && !r3.escaped;
  const lw = r3.lastWave;

  return (
    <div className="space-y-4">
      <div className={`${CARD} text-center space-y-2`}>
        <span className={LABEL}>Wave {wave}</span>
        <h3 data-testid="r3-step" className="text-3xl font-serif font-black text-[#f4f0e8]">
          {STEP_NAMES[step] ?? step}
        </h3>
        <div>
          <Countdown endsAt={view.phase.endsAt} className="text-6xl" />
        </div>
      </div>

      <div className={`${CARD} space-y-3`}>
        {r3.escaped ? (
          <div data-testid="r3-escaped" className="text-center space-y-1">
            <h3 className="text-2xl font-serif font-black text-emerald-200">ESCAPED!</h3>
            <p className="text-base text-[#cbd5e1]">Your crew crossed the Styx in position #{r3.escapedRank}. Watch the others race.</p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] font-mono text-[#a9b4c7] uppercase">Your distance</div>
                <div data-testid="r3-distance" className="text-4xl font-mono font-black text-[#e5cb87]">
                  {r3.distance} m
                </div>
              </div>
              <div className="text-right text-sm font-mono text-[#a9b4c7]">
                <div>Goal {target} m</div>
                {r3.myPos ? <div>Position {r3.myPos}</div> : null}
                <div>
                  {r3.escapedCount} escaped • {r3.activeCrews} racing
                </div>
              </div>
            </div>
            <div className="h-3 rounded-full bg-[#08090c] overflow-hidden border border-[#2a2e3d]">
              <div className="h-full bg-gradient-to-r from-[#c4a45a] to-[#e5cb87]" style={{ width: `${Math.min(100, (r3.distance / target) * 100)}%` }} />
            </div>
          </>
        )}
      </div>

      {!r3.escaped && !inSd && (
        <div className={`${CARD} space-y-3`}>
          <div className="text-center">
            <span className={LABEL}>Choose your vessel</span>
            <p data-testid="sailboat-capacity" className="text-base text-[#f4f0e8] font-semibold mt-1">
              Sailboat holds {r3.sailboatCapacity} {r3.sailboatCapacity === 1 ? 'crew' : 'crews'} this wave
            </p>
            <p className="text-sm text-[#a9b4c7]">
              {canVote ? 'Your crew majority decides. The first vote you cast is final.' : step === 'VOTE' ? '' : step === 'BLUFF' ? 'Talk it over. Voting opens soon.' : 'Voting is closed.'}
            </p>
          </div>
          {(meta?.vessels ?? []).map(v => {
            const picked = myVote === v.id;
            return (
              <button
                key={v.id}
                data-testid={`vessel-${v.id}`}
                disabled={!canVote || !!myVote || busy}
                onClick={() => vote(v.id)}
                className={`w-full min-h-[72px] rounded-2xl border-2 px-4 py-3 flex items-center space-x-3 text-left transition disabled:cursor-not-allowed ${
                  picked ? 'bg-[#c4a45a]/25 border-[#e5cb87]' : myVote || !canVote ? 'bg-[#161922] border-[#2a2e3d] opacity-50' : 'bg-[#161922] border-[#3a4157] hover:border-[#c4a45a] active:scale-[0.98]'
                }`}
              >
                <span className="text-[#e5cb87] shrink-0">
                  <VesselIcon id={v.id} />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-serif font-black text-[#f4f0e8]">
                    {v.name}
                    {picked ? ' ✓' : ''}
                  </span>
                  <span className="block text-xs text-[#a9b4c7] leading-snug">{v.note}</span>
                </span>
              </button>
            );
          })}
          <ErrorNote text={error} />
          {step === 'VOTE' && (
            <div className="flex items-center justify-center space-x-2 text-sm font-mono text-[#e5cb87]" data-testid="r3-voted-count">
              <Users className="w-4 h-4" />
              <span>
                {r3.votedCount ?? 0} of {r3.teamSize} teammates voted
              </span>
            </div>
          )}

          {r3.leash && r3.leash.available && (step === 'BLUFF' || step === 'VOTE') && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-3 space-y-2" data-testid="r3-leash">
              <div className="flex items-center space-x-2 text-sm font-bold text-red-200">
                <Link2 className="w-4 h-4" />
                <span>Stygian Leash{r3.leash.targetName ? `: ${r3.leash.targetName}` : ''}</span>
              </div>
              <p className="text-xs text-red-200/80">Once per game, tether the crew that betrayed you for this wave.</p>
              <button
                disabled={r3.leash.armed || busy || !canVote}
                onClick={() => void act(() => send('R3_ARM_LEASH', {}))}
                data-testid="arm-leash"
                className="w-full min-h-[56px] rounded-xl bg-red-900/50 border border-red-400/60 text-red-100 font-bold disabled:opacity-60"
              >
                {r3.leash.armed ? 'Leash armed' : canVote ? `Arm the leash${r3.leash.targetName ? ` on ${r3.leash.targetName}` : ''}` : 'Opens when voting starts'}
              </button>
            </div>
          )}
        </div>
      )}

      {sd && (
        <div className={`${CARD} space-y-3`} data-testid="r3-sd">
          <span className={LABEL}>Sudden Death standoff</span>
          <p className="text-lg font-serif font-black text-[#f4f0e8]">
            {sd.teamA} vs {sd.teamB}
          </p>
          {sd.resolved ? (
            <p className="text-base text-[#cbd5e1]">
              {sd.winner ? `${sd.winner} wins.` : 'No winner.'} {sd.text ?? ''}
            </p>
          ) : sd.mine && inSd ? (
            <>
              <p className="text-sm text-[#a9b4c7]">Shields beat Ram, Ram beats Sails, Sails beat Shields.</p>
              <div className="grid grid-cols-1 gap-2">
                {(['SHIELDS', 'RAM', 'SAILS'] as SdAction[]).map(a => (
                  <button
                    key={a}
                    data-testid={`sd-${a}`}
                    disabled={!!myVote || busy}
                    onClick={() => {
                      setChosen(a);
                      void act(() => send('SD_VOTE', { action: a }));
                    }}
                    className={`min-h-[64px] rounded-xl border-2 font-serif font-black text-lg disabled:cursor-not-allowed ${
                      myVote === a ? 'bg-[#c4a45a]/25 border-[#e5cb87] text-[#f4f0e8]' : myVote ? 'opacity-40 border-[#2a2e3d] text-[#a9b4c7]' : 'bg-[#161922] border-[#3a4157] text-[#f4f0e8]'
                    }`}
                  >
                    {SD_NAMES[a]}
                  </button>
                ))}
              </div>
              <p className="text-center text-sm font-mono text-[#e5cb87]">
                {sd.votedCount ?? 0} of {r3.teamSize} teammates voted
              </p>
              <ErrorNote text={error} />
            </>
          ) : (
            <p className="text-sm text-[#a9b4c7]">Watch the standoff. The race continues afterwards.</p>
          )}
        </div>
      )}

      {lw && (step === 'REVEAL' || step === 'BLUFF' || step === 'VOTE') && (
        <div data-testid="r3-lastwave" className={`${CARD} space-y-2`}>
          <span className={LABEL}>{step === 'REVEAL' ? `Wave ${lw.wave} result` : `Last wave (${lw.wave})`}</span>
          <div className="flex items-center justify-between">
            <span className="text-lg font-serif font-black text-[#f4f0e8]">{lw.vessel === 'ROWBOAT' ? 'Rowboat' : lw.vessel === 'SAILBOAT' ? 'Sailboat' : 'Ghost Ship'}</span>
            <span className="text-2xl font-mono font-black text-[#e5cb87]">{pts(lw.gained)} m</span>
          </div>
          {lw.sailboatCapsized && lw.vessel === 'SAILBOAT' && <p className="text-sm text-red-300">The Sailboat was overcrowded (limit {lw.capacity}) and capsized.</p>}
          {lw.ghostCollided && lw.vessel === 'GHOST_SHIP' && <p className="text-sm text-red-300">Ghost Ships collided.</p>}
          {lw.leash && (
            <p className="text-sm text-[#cbd5e1] flex items-center gap-1.5">
              <Anchor className="w-4 h-4" />
              <span>
                Leash {lw.leash.role === 'holder' ? 'on' : 'from'} {lw.leash.otherName}: {pts(lw.leash.delta)} m
              </span>
            </p>
          )}
        </div>
      )}

      <Fleet rows={r3.fleet} mine={myName} target={target} />
    </div>
  );
};
