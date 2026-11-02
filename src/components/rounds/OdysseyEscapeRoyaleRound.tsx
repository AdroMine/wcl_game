// Round 3: Escape from Tartarus (the River Styx). Display and input only; the server resolves every wave.
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, DoorOpen, Link2, Lock, Shield, Skull, Swords, Trophy, Users, Wind } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { SdAction, Vessel } from '../../../shared/protocol.ts';
import { useGame } from '../../game/useGame';
import { usePendingVote, VoteFeedback } from '../../game/usePendingVote';
import { CARD, Countdown, ErrorNote, LABEL, pts } from '../ui';

const STEP_TITLES: Record<string, string> = {
  BRIEFING: 'Briefing',
  BLUFF: '🗣️ Phase 1: The Bluff',
  VOTE: '🗳️ Phase 2: Secret Fleet Vote',
  REVEAL: '⚡ Phase 3: Wave Surge Report',
  SUDDEN_DEATH: 'Sudden Death',
};
const VESSEL_NAME: Record<string, string> = { R: 'Rowboat', S: 'Sailboat', G: 'Ghost Ship' };
const VESSEL_EMOJI: Record<string, string> = { ROWBOAT: '🚣', SAILBOAT: '⛵', GHOST_SHIP: '⚡', R: '🚣', S: '⛵', G: '⚡' };

const VESSEL_STYLE: Record<Vessel, { tag: string; tagBox: string; on: string; hover: string; amount: string }> = {
  ROWBOAT: { tag: 'SAFE', tagBox: 'bg-emerald-950 border-emerald-500/40 text-emerald-300', on: 'bg-emerald-950/70 border-emerald-400 ring-2 ring-emerald-400/50', hover: 'hover:border-emerald-500/60', amount: 'text-emerald-400' },
  SAILBOAT: { tag: 'BALANCED', tagBox: 'bg-sky-950 border-sky-500/40 text-sky-300', on: 'bg-sky-950/70 border-sky-400 ring-2 ring-sky-400/50', hover: 'hover:border-sky-500/60', amount: 'text-sky-400' },
  GHOST_SHIP: { tag: 'SOLO GAMBLE', tagBox: 'bg-purple-950 border-purple-500/40 text-purple-300', on: 'bg-purple-950/70 border-purple-400 ring-2 ring-purple-400/50', hover: 'hover:border-purple-500/60', amount: 'text-purple-400' },
};

const SD_OPTIONS: { id: SdAction; label: string; hint: string; icon: React.ReactNode; on: string; hover: string }[] = [
  { id: 'SHIELDS', label: 'RAISE SHIELDS', hint: 'Deflects Ram • Loses to Sails', icon: <Shield className="w-6 h-6 text-blue-400" />, on: 'bg-blue-950/80 border-blue-400', hover: 'hover:border-blue-400/60' },
  { id: 'RAM', label: 'RAM THEIR HULL', hint: 'Smashes Sails • Loses to Shields', icon: <Swords className="w-6 h-6 text-red-400" />, on: 'bg-red-950/80 border-red-400', hover: 'hover:border-red-400/60' },
  { id: 'SAILS', label: 'FULL SAILS', hint: 'Outruns Shields • Loses to Ram', icon: <Wind className="w-6 h-6 text-emerald-400" />, on: 'bg-emerald-950/80 border-emerald-400', hover: 'hover:border-emerald-400/60' },
];

const LEASH_LABEL: Record<string, { label: string; tone: string }> = {
  LEASH_SNAPPED: { label: '⚡ LEASH SNAPPED', tone: 'text-rose-400' },
  WRECK_DRAG: { label: '💥 WRECK DRAG', tone: 'text-amber-400' },
  ANCHOR_SIPHON: { label: '⚓ ANCHOR SIPHON', tone: 'text-emerald-400' },
};

// ------------------------------------------------------------------ the river
const TRACK_LANES = 4;
const LANE_PX = 30;
const BOAT_PCT = 11; // boats closer than this overlap on a phone-width track

/** Boats shown on the track: your crew plus the top boats; everyone else only appears in the list. */
function trackBoats(rows: [string, number, number, string][], mine: string | undefined, target: number): { name: string; dist: number; pct: number; lane: number; isMe: boolean }[] {
  const ranked = [...rows].sort((x, y) => (x[2] > 0 && y[2] > 0 ? x[2] - y[2] : x[2] > 0 ? -1 : y[2] > 0 ? 1 : y[1] - x[1]));
  const keep = rows.length <= 8 ? ranked : ranked.filter((r, i) => i < 5 || r[0] === mine);
  const boats = keep
    .map(([name, dist, rank]) => ({ name, dist, pct: Math.min(94, rank > 0 ? 100 : Math.max(0, (dist / Math.max(1, target)) * 100)), lane: 0, isMe: name === mine }))
    .sort((x, y) => x.pct - y.pct);
  // Greedy lane assignment: first lane whose last boat is far enough to the left; otherwise the emptiest gap.
  const lastPct: number[] = Array(TRACK_LANES).fill(-1000);
  for (const bt of boats) {
    let lane = lastPct.findIndex(l => bt.pct - l >= BOAT_PCT);
    if (lane < 0) lane = lastPct.indexOf(Math.min(...lastPct));
    bt.lane = lane;
    lastPct[lane] = bt.pct;
  }
  return boats;
}
const FleetTrack: React.FC<{ rows: [string, number, number, string][]; mine: string | undefined; target: number; rival: string | null | undefined }> = ({ rows, mine, target, rival }) => {
  const boats = trackBoats(rows, mine, target);
  const lanes = Math.min(TRACK_LANES, Math.max(1, boats.length));
  const height = lanes * LANE_PX + 12;
  return (
    <div className="space-y-2" data-testid="r3-fleet">
      <div className="flex items-center justify-between text-sm font-mono">
        <span className="text-[#a9b4c7]">RIVER STYX FLEET TRACK</span>
        <span className="text-[#e5cb87] font-bold flex items-center space-x-1">
          <DoorOpen className="w-4 h-4" />
          <span>PORTAL AT {target} m</span>
        </span>
      </div>
      <div className="relative w-full bg-[#08090c] rounded-xl border border-[#2a2e3d] overflow-hidden" style={{ height }}>
        <div className="absolute right-0 top-0 bottom-0 w-3 bg-gradient-to-l from-emerald-500 to-transparent" />
        <div className="absolute right-3 top-0 flex items-center text-xs font-mono font-bold text-emerald-400/80">🚪 {target} m</div>
        {boats.map((bt, i) => {
          const isRival = !!rival && bt.name === rival;
          return (
            <div
              key={`${bt.name}-${i}`}
              data-testid={bt.isMe ? 'r3-boat-me' : 'r3-boat'}
              data-lane={bt.lane}
              title={`${bt.name}: ${bt.dist} m`}
              style={{ left: `${bt.pct}%`, top: 6 + (bt.lane % lanes) * LANE_PX, height: LANE_PX - 2 }}
              className={`absolute flex items-center transition-all duration-700 ${bt.isMe ? 'z-20' : isRival ? 'z-10' : 'z-0'}`}
            >
              <div
                className={`w-7 h-7 rounded flex items-center justify-center text-sm shadow-md border ${
                  bt.isMe ? 'bg-[#c4a45a] text-[#08090c] border-white ring-2 ring-[#c4a45a]/60' : isRival ? 'bg-rose-950 border-rose-500 text-rose-300' : 'bg-[#1e2330] border-[#2a2e3d] text-[#f4f0e8] opacity-80'
                }`}
              >
                {isRival ? <Skull className="w-4 h-4 text-rose-400" /> : '⛵'}
              </div>
              {bt.isMe && <span className="ml-1 text-[10px] font-mono font-bold text-[#e5cb87] bg-[#08090c]/80 px-1 rounded">YOU</span>}
            </div>
          );
        })}
      </div>
      {rows.length > boats.length && <p className="text-[11px] font-mono text-[#8e95a5]">Showing your crew and the top 5 boats. All crews are in the list below.</p>}
    </div>
  );
};

/** A short ranked list so the crew sees who is ahead, plus its own row. */
const Leaders: React.FC<{ rows: [string, number, number, string][]; mine: string | undefined; target: number }> = ({ rows, mine, target }) => {
  const sorted = [...rows].sort((a, b) => (a[2] > 0 && b[2] > 0 ? a[2] - b[2] : a[2] > 0 ? -1 : b[2] > 0 ? 1 : b[1] - a[1]));
  const top = sorted.slice(0, 5);
  const me = sorted.findIndex(r => r[0] === mine);
  const show = me >= 5 ? [...top, sorted[me]] : top;
  return (
    <div className="space-y-1.5 pt-1">
      {show.map(([name, dist, rank]) => (
        <div key={name} className={`p-2.5 rounded-xl border flex items-center justify-between text-sm ${name === mine ? 'border-[#c4a45a] bg-[#161922]' : 'border-[#2a2e3d] bg-[#161922]/60'}`}>
          <span className="font-bold text-[#f4f0e8] truncate pr-2">{name}</span>
          <span className="font-mono text-[#e5cb87] shrink-0">{rank > 0 ? `ESCAPED #${rank}` : `${dist} / ${target} m`}</span>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ the podium
const Podium: React.FC<{ names: string[] }> = ({ names }) => {
  const slot = (i: number, fallback: string) => names[i] ?? fallback;
  return (
    <div className="bg-gradient-to-b from-[#161922] via-[#10121a] to-[#08090c] border-2 border-[#c4a45a] rounded-2xl p-5 shadow-2xl text-center space-y-4" data-testid="r3-podium">
      <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-[#c4a45a]/20 border border-[#c4a45a]/50 rounded-full text-sm font-mono font-bold text-[#e5cb87]">
        <Trophy className="w-4 h-4" />
        <span>THE RIVER STYX IS CROSSED</span>
      </div>
      <h2 className="text-2xl font-serif font-black text-[#f4f0e8]">The Odyssey Podium of Champions</h2>
      <div className="grid grid-cols-3 gap-2 pt-2 items-end">
        <div className="flex flex-col items-center space-y-2">
          <span className="text-3xl">🥈</span>
          <div className="w-full bg-[#1e2330] border-t-2 border-slate-300 rounded-t-xl p-2.5 text-center min-h-[130px] flex flex-col justify-between">
            <span className="text-xs font-mono font-bold text-slate-300">SILVER 2ND</span>
            <h4 className="text-sm font-serif font-black text-[#f4f0e8] break-words">{slot(1, '-')}</h4>
          </div>
        </div>
        <div className="flex flex-col items-center space-y-2">
          <span className="text-4xl animate-bounce">🥇</span>
          <div className="w-full bg-gradient-to-b from-[#c4a45a]/30 to-[#1e2330] border-t-4 border-[#c4a45a] rounded-t-xl p-2.5 text-center min-h-[180px] flex flex-col justify-between">
            <span className="text-xs font-mono font-black text-[#e5cb87]">GOLD 1ST</span>
            <h4 className="text-base font-serif font-black text-[#f4f0e8] break-words">{slot(0, '-')}</h4>
          </div>
        </div>
        <div className="flex flex-col items-center space-y-2">
          <span className="text-3xl">🥉</span>
          <div className="w-full bg-[#1e2330] border-t-2 border-amber-700 rounded-t-xl p-2.5 text-center min-h-[100px] flex flex-col justify-between">
            <span className="text-xs font-mono font-bold text-amber-500">BRONZE 3RD</span>
            <h4 className="text-sm font-serif font-black text-[#f4f0e8] break-words">{slot(2, '-')}</h4>
          </div>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ the screen
export const OdysseyEscapeRoyaleRound: React.FC = () => {
  const { view, meta, send } = useGame();
  const wave = view?.phase.wave ?? 0;
  const step = view?.phase.step ?? '';
  const phaseName = view?.phase.name;
  const r3 = view?.r3;
  const finished = phaseName === 'R3_RESULTS' || phaseName === 'FINISHED';
  const inSd = step === 'SUDDEN_DEATH' && !!r3?.sd;
  const myVote = view?.me?.myVote;

  const vesselVote = usePendingVote<Vessel>(step === 'VOTE' ? (myVote as Vessel | undefined) : null, `v:${wave}:${step}`);
  const leashVote = usePendingVote<'ARMED'>(r3?.leash?.armed ? 'ARMED' : null, `l:${wave}`);
  const sdVote = usePendingVote<SdAction>(inSd ? (myVote as SdAction | undefined) : null, `sd:${wave}:${step}`);

  // Confetti once when the podium appears.
  const podiumLen = r3?.podium?.length ?? 0;
  const fired = useRef(false);
  useEffect(() => {
    if (!finished || podiumLen === 0 || fired.current) return;
    fired.current = true;
    try {
      confetti({ particleCount: 80, spread: 90, origin: { y: 0.5 }, colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#ef4444'] });
    } catch {
      /* ignore */
    }
  }, [finished, podiumLen]);

  if (!view || !r3) {
    return (
      <div className={`${CARD} text-center space-y-1`}>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">Your crew is not on the river</h3>
        <p className="text-sm text-[#a9b4c7]">Watch the main screen and the standings.</p>
      </div>
    );
  }

  const target = meta?.r3.targetDistance ?? 1000;
  const honourBonus = meta?.r3.honourBonus ?? 75;
  const myName = view.team?.name;
  const cap = r3.sailboatCapacity;
  const capText = `Sailboat holds ${cap} ${cap === 1 ? 'crew' : 'crews'} this wave`;
  const rival = r3.leash?.targetName;

  if (finished) {
    return (
      <div className="space-y-4">
        <Podium names={r3.podium ?? []} />
        <div className={`${CARD} text-center space-y-1`}>
          {r3.escaped ? (
            <h3 data-testid="r3-escaped" className="text-xl font-serif font-black text-emerald-200">
              Your crew escaped as #{r3.escapedRank}!
            </h3>
          ) : (
            <h3 className="text-xl font-serif font-black text-[#f4f0e8]">Your crew reached {r3.distance} m</h3>
          )}
        </div>
        <div className={`${CARD} space-y-2`}>
          <FleetTrack rows={r3.fleet} mine={myName} target={target} rival={null} />
          <Leaders rows={r3.fleet} mine={myName} target={target} />
        </div>
      </div>
    );
  }

  const sd = r3.sd;
  const canVote = step === 'VOTE' && !r3.escaped;
  const lw = r3.lastWave;
  const briefing = step === 'BRIEFING';
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

  // ---------------------------------------------------------------- Sudden Death: a full overlay
  if (inSd && sd) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-[#08090c] p-4" data-testid="r3-sd">
        <div className="max-w-md mx-auto bg-[#10121a] border-2 border-red-500/60 rounded-2xl p-5 shadow-2xl space-y-4">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-red-950/80 border border-red-500/60 rounded-full text-sm font-mono font-black text-red-300 animate-pulse">
              <Swords className="w-4 h-4 text-red-400" />
              <span>THE NARROW GATE • SUDDEN DEATH</span>
            </div>
            <h3 className="text-2xl font-serif font-black text-[#f4f0e8]">
              {sd.teamA} vs {sd.teamB}
            </h3>
            <p className="text-base text-[#a9b4c7]">Only one crew can slip through the final rift in the gates!</p>
            <Countdown endsAt={view.phase.endsAt} className="text-5xl" />
          </div>

          {sd.resolved ? (
            <div className="p-4 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center space-y-2">
              <h4 className="text-lg font-serif font-black text-amber-300">⚡ Standoff resolved</h4>
              {sd.text && <p className="text-base font-mono text-[#f4f0e8]">{sd.text}</p>}
              <div className="inline-block px-3 py-1.5 bg-emerald-950/80 border border-emerald-500/50 rounded-full text-sm font-mono font-bold text-emerald-300">
                {sd.winner ? `🏆 Winner: ${sd.winner}` : 'No winner'}
              </div>
            </div>
          ) : sd.mine ? (
            <div className="space-y-3">
              <p className="text-center text-base font-mono text-[#e5cb87] font-bold">Lock your crew&apos;s maneuver</p>
              <p className="text-center text-sm text-[#a9b4c7]">Shields beat Ram, Ram beats Sails, Sails beat Shields.</p>
              <div className="grid grid-cols-1 gap-2.5">
                {SD_OPTIONS.map(o => {
                  const picked = sdVote.choice === o.id;
                  const dim = sdVote.choice && !picked;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      data-testid={`sd-${o.id}`}
                      disabled={sdVote.locked}
                      onClick={() => castSd(o.id)}
                      className={`min-h-[76px] p-3.5 rounded-xl border-2 flex items-center space-x-3 text-left transition disabled:cursor-not-allowed ${
                        picked ? `${o.on} shadow-lg` : dim ? 'bg-[#161922] border-[#2a2e3d] opacity-40' : `bg-[#161922] border-[#3a4157] ${o.hover} active:scale-[0.98]`
                      }`}
                    >
                      <span className="shrink-0">{o.icon}</span>
                      <span className="min-w-0">
                        <span className="block font-serif font-black text-lg text-[#f4f0e8]">{o.label}</span>
                        <span className="block text-sm text-[#a9b4c7]">{o.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <VoteFeedback vote={sdVote} testId="sd-voted" />
              <ErrorNote text={sdVote.error} />
              <p className="text-center text-sm font-mono text-[#e5cb87]">
                {sd.votedCount ?? 0} of {r3.teamSize} teammates voted
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#08090c] border border-[#2a2e3d] text-center space-y-1">
              <h4 className="text-lg font-serif font-bold text-[#e5cb87]">Spectating the duel</h4>
              <p className="text-base text-[#a9b4c7]">
                {sd.teamA} and {sd.teamB} are locked in a sudden-death duel for podium glory. Watch the screen.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- the wave report
  const WaveReport = lw ? (
    <div data-testid="r3-lastwave" className={`${CARD} space-y-3`}>
      <div className="text-center space-y-1">
        <span className="text-sm font-mono text-[#e5cb87] font-bold block">{step === 'REVEAL' ? `══ WAVE ${lw.wave} SURGE REPORT ══` : `Last wave (${lw.wave})`}</span>
        {step === 'REVEAL' && <h4 className="text-lg font-serif font-black text-[#f4f0e8]">The Styx waters settle</h4>}
      </div>

      <div className="p-3 rounded-xl bg-[#08090c] border border-[#2a2e3d] space-y-2 font-mono text-sm">
        {lw.vessels.map(([code, boarded, outcome, metres], i) => (
          <div key={code} className={`flex items-center justify-between gap-2 ${i > 0 ? 'border-t border-[#2a2e3d]/60 pt-2' : ''}`}>
            <span className="text-[#a9b4c7]">
              {VESSEL_EMOJI[code]} {VESSEL_NAME[code] ?? code}: {boarded} {boarded === 1 ? 'crew' : 'crews'}
            </span>
            {outcome === 'SAFE' && <span className={`font-bold text-right ${code === 'G' ? 'text-purple-400' : code === 'S' ? 'text-sky-400' : 'text-emerald-400'}`}>{code === 'G' ? 'SOLO SURGE' : 'Safe'} ({pts(metres)} m)</span>}
            {outcome === 'CAPSIZED' && (
              <span className="text-rose-400 font-bold flex items-center space-x-1 text-right">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>OVERLOADED, capsized ({pts(metres)} m)</span>
              </span>
            )}
            {outcome === 'COLLIDED' && <span className="text-rose-400 font-bold text-right">COLLIDED ({pts(metres)} m)</span>}
            {outcome === 'UNBOARDED' && <span className="text-[#a9b4c7]">Unboarded</span>}
          </div>
        ))}
      </div>

      {lw.leashes && lw.leashes.length > 0 && (
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/50 space-y-2">
          {lw.leashes.map((l, i) => {
            const meta2 = LEASH_LABEL[l.kind] ?? { label: l.kind, tone: 'text-red-300' };
            return (
              <div key={i} className="text-sm font-mono p-2.5 rounded-lg bg-black/40 border border-red-500/20 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#f4f0e8] font-bold">{l.role === 'holder' ? `🐕‍🦺 You leashed ${l.otherName}` : `🐕‍🦺 ${l.otherName} leashed you`}</span>
                  <span className={`font-bold shrink-0 ${meta2.tone}`}>{meta2.label}</span>
                </div>
                <div className="text-[#a9b4c7]">
                  {l.kind === 'LEASH_SNAPPED' ? 'The holder’s own boat crashed. The curse was wasted.' : l.kind === 'WRECK_DRAG' ? 'Dragged down into the deep.' : 'Metres siphoned from the hull.'} ({pts(l.delta)} m for your crew)
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="p-4 rounded-xl bg-gradient-to-r from-[#161922] via-[#242b3b] to-[#161922] border border-[#c4a45a] text-center space-y-1">
        <span className="text-xs uppercase text-[#e5cb87] font-bold font-mono">Your crew wave summary</span>
        <h5 className="text-lg font-serif font-black text-[#f4f0e8]">
          Sailed on {lw.vessel === 'ROWBOAT' ? 'the Rowboat' : lw.vessel === 'SAILBOAT' ? 'the Sailboat' : 'the Ghost Ship'} ({pts(lw.gained)} m)
        </h5>
        {lw.sailboatCapsized && lw.vessel === 'SAILBOAT' && <p className="text-sm text-red-300">The Sailboat was overcrowded (limit {lw.capacity}) and capsized.</p>}
        {lw.ghostCollided && lw.vessel === 'GHOST_SHIP' && <p className="text-sm text-red-300">Ghost Ships collided.</p>}
        <p className="text-sm text-[#a9b4c7]">
          Total distance: <strong className="text-white">{r3.distance} m / {target} m</strong>
        </p>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {r3.honourable && (
        <div className="bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-emerald-950/90 border border-emerald-500/60 rounded-2xl p-4 shadow-xl text-emerald-100 space-y-1" data-testid="r3-honourable">
          <div className="text-emerald-300 font-bold text-sm uppercase tracking-wider font-mono">🕊️ WINDS OF OLYMPUS ACTIVATED</div>
          <p className="text-sm text-emerald-200/90 leading-relaxed font-serif">Your crew kept its word in the dark cavern.</p>
          <div className="text-base font-bold text-emerald-300 font-mono">Athena rewards your honour: +{honourBonus} m wind boost granted!</div>
        </div>
      )}

      <div className={`${CARD} flex items-center justify-between gap-3`}>
        <div className="min-w-0">
          <span className={LABEL}>Round 3: Escape Royale</span>
          <h3 data-testid="r3-step" className="text-xl font-serif font-black text-[#f4f0e8] leading-tight">
            {STEP_TITLES[step] ?? step}
          </h3>
          <span className="text-sm font-mono text-[#a9b4c7]">Wave {wave}</span>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs font-mono text-[#a9b4c7] block">PHASE ENDS IN</span>
          <Countdown endsAt={view.phase.endsAt} className="text-4xl" />
        </div>
      </div>

      <div className={`${CARD} space-y-3`}>
        <FleetTrack rows={r3.fleet} mine={myName} target={target} rival={rival} />
        {r3.escaped ? (
          <div data-testid="r3-escaped" className="text-center space-y-1">
            <h3 className="text-2xl font-serif font-black text-emerald-200 flex items-center justify-center space-x-2">
              <CheckCircle2 className="w-6 h-6" />
              <span>ESCAPED!</span>
            </h3>
            <p className="text-base text-[#cbd5e1]">Your crew crossed the Styx in position #{r3.escapedRank}. Watch the others race.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-xs font-mono text-[#a9b4c7] uppercase">Your crew</div>
                <div data-testid="r3-distance" className="text-4xl font-mono font-black text-[#e5cb87]">
                  {r3.distance} m
                </div>
                <div className="text-sm font-mono text-[#a9b4c7]">of {target} m</div>
              </div>
              <div className="text-right text-sm font-mono text-[#a9b4c7]">
                <div className="text-[#f4f0e8] font-bold">{Math.max(0, target - r3.distance)} m to escape</div>
                {r3.myPos ? <div>Position {r3.myPos}</div> : null}
                <div>
                  {r3.escapedCount} escaped • {r3.activeCrews} racing
                </div>
              </div>
            </div>
            {r3.honourable && <p className="text-sm text-emerald-400 font-mono">Includes the +{honourBonus} m 🕊️ Winds of Olympus head start.</p>}
          </div>
        )}
      </div>

      {briefing && (
        <div data-testid="r3-briefing" className={`${CARD} text-center space-y-1`}>
          <h3 className="text-xl font-serif font-black text-[#f4f0e8]">Briefing...</h3>
          <p className="text-sm text-[#a9b4c7]">Wave 1 begins when the briefing ends. Voting is closed.</p>
        </div>
      )}

      {/* The bluff: rules of the three vessels. */}
      {step === 'BLUFF' && !r3.escaped && (
        <div className={`${CARD} space-y-4`}>
          <div className="flex items-center space-x-2">
            <span className="text-xl">🗣️</span>
            <h4 className="text-lg font-serif font-black text-[#f4f0e8]">Look around the pub and bluff your rivals!</h4>
          </div>
          <p className="text-base text-[#cbd5e1] leading-relaxed">
            Stand up and look across tables! The howls of Cerberus echo behind you and the exit portal across the River Styx is slowly sealing shut. Only <strong className="text-amber-300">1 crew</strong> can take the Ghost Ship, and the Sailboat capsizes if too many crews board. Coordinate your crew before the secret ballot opens.
          </p>
          <p data-testid="sailboat-capacity" className="text-base text-[#f4f0e8] font-bold text-center">
            {capText}
          </p>
          <div className="grid grid-cols-1 gap-2">
            {vessels.map(v => {
              const st = VESSEL_STYLE[v.id];
              return (
                <div key={v.id} className="p-3 rounded-xl bg-[#08090c] border border-[#3a4157] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#f4f0e8] font-mono text-sm">
                      {VESSEL_EMOJI[v.id]} {v.name.toUpperCase()}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-bold border ${st.tagBox}`}>{st.tag}</span>
                  </div>
                  <p className="text-sm text-[#cbd5e1]">
                    {v.id === 'ROWBOAT' && `Never capsizes. Reliable ${pts(v.success)} m for every boarding crew.`}
                    {v.id === 'SAILBOAT' && `Fast winds (${pts(v.success)} m). Capsizes (${v.fail} m) for everyone if more than ${cap} ${cap === 1 ? 'crew' : 'crews'} board.`}
                    {v.id === 'GHOST_SHIP' && `Mythic surge (${pts(v.success)} m) ONLY if exactly 1 crew boards. 2 or more crews collide (${pts(v.fail)} m each).`}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="p-3 rounded-xl bg-[#161922] border border-[#3a4157] text-center text-sm font-mono text-[#a9b4c7]">
            <Lock className="w-4 h-4 inline mr-1 text-amber-400" />
            Voting buttons unlock when bluffing ends.
          </div>
        </div>
      )}

      {/* The vote. */}
      {step === 'VOTE' && !r3.escaped && (
        <div className={`${CARD} space-y-4`}>
          <div className="flex items-center justify-between gap-2 border-b border-[#3a4157] pb-2">
            <div>
              <h4 className="text-lg font-serif font-black text-[#f4f0e8]">Select your escape route</h4>
              <p className="text-sm text-[#cbd5e1]">Your crew majority decides your vessel. A tie goes to the safest vessel.</p>
            </div>
            <span data-testid="r3-voted-count" className="flex items-center space-x-1.5 text-sm font-mono text-[#e5cb87] font-bold shrink-0">
              <Users className="w-4 h-4" />
              <span>
                {r3.votedCount ?? 0}/{r3.teamSize}
              </span>
            </span>
          </div>
          <p data-testid="sailboat-capacity" className="text-base text-[#f4f0e8] font-bold text-center">
            {capText}
          </p>

          <div className="space-y-3">
            {vessels.map(v => {
              const st = VESSEL_STYLE[v.id];
              const picked = vesselVote.choice === v.id;
              const dim = vesselVote.choice && !picked;
              return (
                <button
                  key={v.id}
                  type="button"
                  data-testid={`vessel-${v.id}`}
                  disabled={vesselVote.locked}
                  onClick={() => castVessel(v.id)}
                  className={`w-full min-h-[76px] p-4 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition disabled:cursor-not-allowed ${
                    picked ? `${st.on} shadow-lg` : dim ? 'bg-[#161922] border-[#2a2e3d] opacity-40' : `bg-[#161922] border-[#3a4157] ${st.hover} active:scale-[0.99]`
                  }`}
                >
                  <span className="flex items-center space-x-3 min-w-0">
                    <span className="text-3xl shrink-0">{VESSEL_EMOJI[v.id]}</span>
                    <span className="min-w-0">
                      <span className="font-serif font-black text-lg text-[#f4f0e8] flex flex-wrap items-center gap-x-1.5">
                        <span>{v.name.toUpperCase()}</span>
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded font-bold border ${st.tagBox}`}>{st.tag}</span>
                      </span>
                      <span className="block text-sm text-[#cbd5e1] leading-snug">
                        {v.id === 'ROWBOAT' && `Steady oars. Never capsizes. Guaranteed ${pts(v.success)} m.`}
                        {v.id === 'SAILBOAT' && `Fast winds. Capsizes if more than ${cap} ${cap === 1 ? 'crew' : 'crews'} board (${v.fail} m).`}
                        {v.id === 'GHOST_SHIP' && `Mythic surge only if exactly 1 crew boards. 2 or more collide (${pts(v.fail)} m).`}
                      </span>
                    </span>
                  </span>
                  <span className={`font-mono text-base font-bold shrink-0 ${st.amount}`}>{pts(v.success)} m</span>
                </button>
              );
            })}
          </div>

          <VoteFeedback vote={vesselVote} testId="r3-voted" />
          <ErrorNote text={vesselVote.error} />
          {vesselVote.status === 'idle' && <p className="text-center text-sm text-[#a9b4c7]">The first vote you cast is final.</p>}

          {r3.leash && (r3.leash.available || r3.leash.armed) && (
            <div className={`p-4 rounded-xl border transition-all space-y-3 ${r3.leash.armed || leashVote.locked ? 'bg-gradient-to-r from-red-950/80 via-[#16121f] to-red-950/80 border-red-500' : 'bg-[#10121a] border-[#3a4157]/80'}`} data-testid="r3-leash">
              <div className="flex items-center space-x-2 text-sm font-mono font-bold text-red-300">
                <Link2 className="w-4 h-4 shrink-0" />
                <span>🐕‍🦺 STYGIAN LEASH</span>
                {r3.leash.targetName && (
                  <>
                    <span className="text-[#a9b4c7]">➔</span>
                    <span className="text-[#f4f0e8] underline decoration-red-500 truncate">{r3.leash.targetName}</span>
                  </>
                )}
              </div>
              <div className="text-sm space-y-1 font-mono text-[#cbd5e1] bg-black/40 p-3 rounded-lg border border-red-500/20">
                <p className="text-[#f4f0e8]">Once per game, tether the crew that betrayed you for this wave.</p>
                <div>
                  <span className="text-emerald-400">• If they float:</span> they lose <strong>50 m</strong>, you gain <strong>50 m</strong>.
                </div>
                <div>
                  <span className="text-amber-400">• If they crash:</span> they lose <strong>100 m</strong>, you gain <strong>100 m</strong>.
                </div>
                <div className="text-rose-300 pt-1 border-t border-white/10">
                  ⚠️ <strong>Do not crash:</strong> if your own boat crashes, the leash snaps and is wasted.
                </div>
              </div>
              {r3.leash.armed && leashVote.status === 'idle' ? (
                <div className="rounded-xl border border-red-400/60 bg-red-900/40 p-3 text-center text-base font-bold text-red-100">✓ Leash armed</div>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="arm-leash"
                    disabled={!canVote || leashVote.locked}
                    onClick={armLeash}
                    className={`w-full min-h-[56px] rounded-xl border font-bold text-base transition ${leashVote.locked ? 'bg-red-700/70 border-red-300 text-white' : 'bg-red-900/50 border-red-400/60 text-red-100 active:scale-[0.98]'} disabled:cursor-not-allowed`}
                  >
                    {leashVote.locked ? '✓ LEASH ARMED' : `ARM STYGIAN LEASH${r3.leash.targetName ? ` on ${r3.leash.targetName}` : ''}`}
                  </button>
                  <VoteFeedback vote={leashVote} registeredText="Leash registered" testId="r3-leash-registered" />
                  <ErrorNote text={leashVote.error} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {sd && sd.resolved && !inSd && (
        <div className={`${CARD} space-y-2`}>
          <span className={LABEL}>Sudden Death standoff</span>
          <p className="text-lg font-serif font-black text-[#f4f0e8]">
            {sd.teamA} vs {sd.teamB}
          </p>
          <p className="text-base text-[#cbd5e1]">
            {sd.winner ? `${sd.winner} wins.` : 'No winner.'} {sd.text ?? ''}
          </p>
        </div>
      )}

      {lw && (step === 'REVEAL' || step === 'BLUFF' || step === 'VOTE') ? WaveReport : null}

      <div className={`${CARD} space-y-1`}>
        <span className={LABEL}>The river</span>
        <Leaders rows={r3.fleet} mine={myName} target={target} />
      </div>
    </div>
  );
};
