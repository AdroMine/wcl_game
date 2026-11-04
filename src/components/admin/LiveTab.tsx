// Tab 1: "Live game". One card per phase; monitoring only, except the lobby setup, Round 2 pairing and Sudden Death.
import React, { useState } from 'react';
import { Users } from 'lucide-react';
import type { AdminMatch, AdminTeam, AdminViewData } from '../../game/admin';
import { phaseBase, stepLabel } from './AdminHeader';
import { ExportCard } from './ExportCard';
import { FrontPageCard } from './FrontPageCard';
import { BOX, BTN, BTN_PRIMARY, BTN_RED, CARD, CrewName, H, INPUT, MUTED, MoralBadge, RankBadge, TARGET_DISTANCE, TeamSelect, medal, solveClock, standings } from './kit';
import type { Run } from './kit';

interface Props {
  view: AdminViewData;
  run: Run;
  busy: boolean;
}

export const LiveTab: React.FC<Props> = ({ view, run, busy }) => {
  switch (view.phase.name) {
    case 'LOBBY':
      return <LobbyCard view={view} run={run} busy={busy} />;
    case 'R1_ACTIVE':
      return <Round1Card view={view} />;
    case 'R1_RESULTS':
      return <Round1Results view={view} />;
    case 'R2_PAIRING':
      return <PairingCard view={view} run={run} busy={busy} />;
    case 'R2_CLASH':
      return <ClashCard view={view} />;
    case 'R2_RESULTS':
      return <Round2Results view={view} />;
    case 'R3_ACTIVE':
      return (
        <div className="space-y-3">
          <FleetCard view={view} />
          <SuddenDeathCard view={view} run={run} busy={busy} />
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <FinalStandings view={view} />
          {view.phase.name === 'R3_RESULTS' && <SuddenDeathCard view={view} run={run} busy={busy} />}
        </div>
      );
  }
};

const byId = (view: AdminViewData) => new Map(view.teams.map(t => [t.id, t] as const));
const sizeOf = (t: AdminTeam | undefined) => t?.playerIds.length ?? 0;

// ------------------------------------------------------------------ lobby
const LobbyCard: React.FC<Props> = ({ view, run, busy }) => {
  const unassigned = view.players.filter(p => p.teamId === null).length;
  return (
    <div className={BOX} data-testid="card-lobby">
      <div className={H}>Lobby</div>
      <div className="grid grid-cols-2 gap-2">
        <Counter label="Unassigned" value={unassigned} />
        <Counter label="Crews" value={view.teams.length} />
      </div>
      <div className={`${CARD}`} data-testid="crew-size">
        <div className={H}>Crew size (maximum, 3 to 6)</div>
        <div className="grid grid-cols-4 gap-2">
          {[3, 4, 5, 6].map(n => (
            <button
              key={n}
              data-testid={`crew-size-${n}`}
              disabled={busy}
              aria-pressed={view.crewSize === n}
              className={`${BTN} ${view.crewSize === n ? '!border-[#c4a45a] !bg-[#c4a45a]/20 text-[#e5cb87]' : ''}`}
              onClick={() => void run(`Crew size ${n}`, 'ADMIN_SET_CREW_SIZE', { size: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <p className={MUTED}>Auto-group builds crews of this size; a leftover of 2 or more forms a smaller crew; a single leftover is yours to place.</p>
      </div>
      <button data-testid="auto-group" className={`${BTN_PRIMARY} w-full`} disabled={busy || unassigned === 0} onClick={() => void run('Auto-group', 'ADMIN_AUTO_GROUP')}>
        <Users className="w-4 h-4" />
        Auto-group {unassigned} unassigned
      </button>
    </div>
  );
};

const Counter: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="rounded-xl border border-[#2a2e3d] bg-[#161922] p-3 text-center">
    <div className="text-2xl font-mono font-black text-[#e5cb87]">{value}</div>
    <div className="text-[10px] font-mono uppercase text-[#8e95a5]">{label}</div>
  </div>
);

// ------------------------------------------------------------------ round 1
const Round1Card: React.FC<{ view: AdminViewData }> = ({ view }) => {
  const [q, setQ] = useState('');
  const playing = view.teams.filter(t => t.r1);
  const solved = playing.filter(t => t.r1?.solved).length;
  const needle = q.trim().toLowerCase();
  const rows = playing
    .filter(t => !needle || t.name.toLowerCase().includes(needle) || t.battleCode.toLowerCase().includes(needle))
    .sort((a, b) => Number(a.r1!.solved) - Number(b.r1!.solved) || (a.r1!.solveSeconds ?? 0) - (b.r1!.solveSeconds ?? 0) || a.name.localeCompare(b.name));
  return (
    <div className={BOX} data-testid="card-r1">
      <div className="flex items-baseline justify-between gap-2">
        <div className={H}>Round 1 · The tablet</div>
        <div data-testid="r1-solved-count" className="text-sm font-mono font-bold text-[#e5cb87]">
          {solved} of {playing.length} solved
        </div>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search crew name or battle code" aria-label="Search crews" className={`${INPUT} w-full`} />
      <div className="space-y-2">
        {rows.map(t => (
          <div key={t.id} data-testid="r1-crew" className={CARD}>
            <div className="flex items-start justify-between gap-2">
              <CrewName t={t} />
              <span className={`shrink-0 text-xs font-mono font-bold ${t.r1!.solved ? 'text-emerald-300' : 'text-[#a9b4c7]'}`}>
                {t.r1!.solved ? `✓ ${solveClock(t.r1!.solveSeconds)} (+${t.r1!.points})` : 'Solving…'}
              </span>
            </div>
            <div className="text-xs font-mono text-[#a9b4c7] break-all">
              codeword <span className="text-[#f4f0e8] font-bold">{t.r1!.codeword}</span>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className={MUTED}>No crew matches.</div>}
      </div>
    </div>
  );
};

const Round1Results: React.FC<{ view: AdminViewData }> = ({ view }) => {
  const playing = view.teams.filter(t => t.r1);
  const solved = playing.filter(t => t.r1?.solved);
  const ranked = [...playing].sort((a, b) => b.r1Points - a.r1Points || (a.r1!.solveSeconds ?? 1e9) - (b.r1!.solveSeconds ?? 1e9));
  return (
    <div className={BOX} data-testid="card-r1-results">
      <div className="flex items-baseline justify-between gap-2">
        <div className={H}>Round 1 results</div>
        <div className="text-sm font-mono font-bold text-[#e5cb87]">
          {solved.length} of {playing.length} solved
        </div>
      </div>
      <div className="space-y-2">
        {ranked.slice(0, 10).map((t, i) => (
          <div key={t.id} className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161922] p-2 min-w-0">
            <RankBadge rank={i + 1} />
            <CrewName t={t} />
            <span className="ml-auto shrink-0 font-mono text-sm font-bold text-[#c4a45a]">{t.r1Points}</span>
          </div>
        ))}
        {ranked.length > 10 && <div className={MUTED}>and {ranked.length - 10} more (see Standings).</div>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ round 2
const PairingCard: React.FC<Props> = ({ view, run, busy }) => {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const teams = byId(view);
  const unpaired = view.unpairedTeamIds;
  const matches = view.matches.filter(m => !m.cancelled);
  return (
    <div className={BOX} data-testid="card-pairing">
      <div className="flex items-baseline justify-between gap-2">
        <div className={H}>Round 2 · Pairing</div>
        <div data-testid="pair-counts" className="text-sm font-mono font-bold text-[#e5cb87]">
          {view.teams.length - unpaired.length} paired · {unpaired.length} unpaired
        </div>
      </div>
      <button data-testid="auto-pair" className={`${BTN} w-full`} disabled={busy || unpaired.length < 2} onClick={() => void run('Auto-pair', 'ADMIN_R2_AUTO_PAIR')}>
        Auto-pair remaining crews
      </button>
      <div className={`${CARD}`}>
        <div className={H}>Pair by hand</div>
        <TeamSelect teams={view.teams} value={a} onChange={setA} label="Crew A" only={unpaired} testId="pair-a" />
        <TeamSelect teams={view.teams} value={b} onChange={setB} label="Crew B" only={unpaired} testId="pair-b" />
        <button
          data-testid="pair-go"
          className={`${BTN} w-full`}
          disabled={busy || !a || !b || a === b}
          onClick={() =>
            void run('Pair', 'ADMIN_R2_PAIR', { teamA: a, teamB: b }, () => {
              setA('');
              setB('');
            })
          }
        >
          Pair these two
        </button>
      </div>
      {matches.length > 0 && (
        <div className="space-y-2">
          <div className={H}>Matches ({matches.length})</div>
          {matches.map(m => (
            <div key={m.id} data-testid="pair-match" className={`${CARD} flex items-center gap-2 !space-y-0`}>
              <div className="min-w-0 flex-1 text-sm break-words">
                <span className="font-serif font-bold">{teams.get(m.teamA)?.name ?? m.teamA}</span> <span className="text-[10px] font-mono text-[#c4a45a]">[{teams.get(m.teamA)?.battleCode}]</span>
                <span className="text-[#8e95a5]"> vs </span>
                <span className="font-serif font-bold">{teams.get(m.teamB)?.name ?? m.teamB}</span> <span className="text-[10px] font-mono text-[#c4a45a]">[{teams.get(m.teamB)?.battleCode}]</span>
              </div>
              <button className={`${BTN} shrink-0`} disabled={busy} onClick={() => void run('Unpair', 'ADMIN_R2_UNPAIR', { teamId: m.teamA })}>
                Unpair
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <div className="text-xs font-mono text-[#8e95a5]">Unpaired crews ({unpaired.length}) · Truce points every clash + Honourable</div>
        <div className="flex flex-wrap gap-1.5">
          {unpaired.map(id => {
            const t = teams.get(id);
            return (
              <span key={id} className="px-2 py-1 rounded border border-amber-500/40 text-amber-200 text-xs break-words max-w-full">
                {t?.name ?? id} {t ? `[${t.battleCode}]` : ''}
                {(() => {
                  const b = view.byePoints?.[id] ?? [];
                  return b.length > 0 ? <span className="ml-1 font-mono text-emerald-300">bye: +{b.reduce((a, n) => a + n, 0)}</span> : null;
                })()}
              </span>
            );
          })}
          {unpaired.length === 0 && <span className={MUTED}>Everyone is paired.</span>}
        </div>
      </div>
    </div>
  );
};

const STANCE_LABEL: Record<string, string> = { TRUCE: 'Truce', AMBUSH: 'Ambush' };

const ClashCard: React.FC<{ view: AdminViewData }> = ({ view }) => {
  const teams = byId(view);
  const matches = view.matches.filter(m => !m.cancelled);
  const p = view.phase;
  return (
    <div className={BOX} data-testid="card-clash">
      <div className="flex items-baseline justify-between gap-2">
        <div className={H}>Round 2 · Clash monitor</div>
        <div className="text-xs font-mono font-bold text-[#e5cb87]">
          Clash {p.clash} · {stepLabel(p.step)}
        </div>
      </div>
      {matches.length === 0 && <div className={MUTED}>No matches.</div>}
      <div className="space-y-2">
        {matches.map(m => (
          <MatchCard key={m.id} m={m} view={view} teams={teams} />
        ))}
      </div>
    </div>
  );
};

const MatchCard: React.FC<{ m: AdminMatch; view: AdminViewData; teams: Map<string, AdminTeam>; showMoral?: boolean }> = ({ m, view, teams, showMoral }) => {
  const A = teams.get(m.teamA);
  const B = teams.get(m.teamB);
  const cur = m.clashes.find(c => c.clash === view.phase.clash);
  const done = m.clashes.length > 0 && m.clashes.every(c => c.resolved);
  const live = view.phase.name === 'R2_CLASH';
  const nameA = A?.name ?? m.teamA;
  const nameB = B?.name ?? m.teamB;
  return (
    <div data-testid="clash-match" className={CARD}>
      <div className="text-sm break-words">
        <span className="font-serif font-black">{nameA}</span> <span className="text-[10px] font-mono text-[#c4a45a]">[{A?.battleCode}]</span>
        <span className="text-[#8e95a5]"> vs </span>
        <span className="font-serif font-black">{nameB}</span> <span className="text-[10px] font-mono text-[#c4a45a]">[{B?.battleCode}]</span>
      </div>
      {live && cur && !cur.resolved && (
        <div data-testid="clash-votes" className="text-xs font-mono text-[#a9b4c7]">
          Votes in: {nameA.slice(0, 14)} {cur.votedA}/{sizeOf(A)} · {nameB.slice(0, 14)} {cur.votedB}/{sizeOf(B)}
        </div>
      )}
      {m.clashes
        .filter(c => c.resolved)
        .map(c => (
          <div key={c.clash} className="text-xs text-[#cbd5e1] break-words">
            <span className="font-mono text-[#8e95a5]">Clash {c.clash}:</span> {STANCE_LABEL[c.stanceA ?? ''] ?? '-'} ({c.ptsA >= 0 ? '+' : ''}
            {c.ptsA}) vs {STANCE_LABEL[c.stanceB ?? ''] ?? '-'} ({c.ptsB >= 0 ? '+' : ''}
            {c.ptsB})
          </div>
        ))}
      {(showMoral || done) && (
        <div className="flex flex-wrap gap-1.5">
          <MoralBadge status={view.moral[m.teamA]?.status} />
          <MoralBadge status={view.moral[m.teamB]?.status} />
        </div>
      )}
    </div>
  );
};

const Round2Results: React.FC<{ view: AdminViewData }> = ({ view }) => {
  const rows = [...view.teams].sort((a, b) => b.r2Points - a.r2Points || a.name.localeCompare(b.name));
  return (
    <div className={BOX} data-testid="card-r2-results">
      <div className={H}>Round 2 results</div>
      <div className="space-y-2">
        {rows.map(t => (
          <div key={t.id} data-testid="r2-result" className={`${CARD} !space-y-1`}>
            <div className="flex items-start justify-between gap-2">
              <CrewName t={t} />
              <span className="shrink-0 font-mono text-sm font-bold text-[#c4a45a]">{t.r2Points >= 0 ? '+' : ''}{t.r2Points}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <MoralBadge status={view.moral[t.id]?.status} />
              {!view.moral[t.id] && <span className={MUTED}>Sat out Round 2</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ round 3
const VESSEL: Record<string, string> = { ROWBOAT: 'Rowboat', SAILBOAT: 'Sailboat', GHOST_SHIP: 'Ghost Ship' };

const FleetCard: React.FC<{ view: AdminViewData }> = ({ view }) => {
  const r3 = view.r3!;
  const active = view.teams.filter(t => r3.teams[t.id] && !r3.teams[t.id].escaped).length;
  const capacity = Math.max(1, Math.floor(0.3 * active));
  const teams = byId(view);
  const rows = view.teams
    .filter(t => r3.teams[t.id])
    .sort((a, b) => {
      const x = r3.teams[a.id];
      const y = r3.teams[b.id];
      if (x.escaped !== y.escaped) return x.escaped ? -1 : 1;
      if (x.escaped && y.escaped) return (x.escapeRank ?? 99) - (y.escapeRank ?? 99);
      return y.distance - x.distance || a.name.localeCompare(b.name);
    });
  const last = r3.lastReport;
  return (
    <div className={BOX} data-testid="card-r3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className={H}>
          {phaseBase(view.phase)}
          {view.phase.step ? ` · ${stepLabel(view.phase.step)}` : ''}
        </div>
        <div data-testid="r3-capacity" className="text-xs font-mono font-bold text-[#e5cb87]">
          Sailboat holds {capacity} · {r3.escapeOrder.length} escaped
        </div>
      </div>
      <div className="space-y-2">
        {rows.map(t => {
          const x = r3.teams[t.id];
          const pct = Math.max(0, Math.min(100, (x.distance / TARGET_DISTANCE) * 100));
          const target = r3.leashArmed[t.id];
          const out = last?.outcomes[t.id];
          const voted = r3.votedThisWave[t.id] ?? 0;
          return (
            <div key={t.id} data-testid="fleet-crew" className={CARD}>
              <div className="flex items-start justify-between gap-2">
                <CrewName t={t} />
                <span className="shrink-0 text-xs font-mono font-bold text-[#e5cb87]">{x.escaped ? `${medal(x.escapeRank)} escaped` : `${Math.round(x.distance)} m`}</span>
              </div>
              <div className="h-2 rounded-full bg-[#0b0d13] border border-[#2a2e3d] overflow-hidden" role="progressbar" aria-valuenow={Math.round(x.distance)} aria-valuemax={TARGET_DISTANCE}>
                <div className={`h-full ${x.escaped ? 'bg-emerald-400' : 'bg-[#c4a45a]'}`} style={{ width: `${x.escaped ? 100 : pct}%` }} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#a9b4c7]">
                <MoralBadge status={view.moral[t.id]?.status} />
                {x.leashHolder && (
                  <span className={x.leashUsed ? 'text-[#8e95a5]' : target ? 'text-red-300' : 'text-[#e5cb87]'}>
                    ⛓ Leash {x.leashUsed ? 'used' : target ? `armed on ${teams.get(target)?.name ?? target}` : 'unused'}
                  </span>
                )}
                {!x.escaped && (
                  <span>
                    voted {voted}/{sizeOf(t)}
                  </span>
                )}
                {out && (
                  <span>
                    last: {VESSEL[out.vessel] ?? out.vessel} {out.gained >= 0 ? '+' : ''}
                    {out.gained} m
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SuddenDeathCard: React.FC<Props> = ({ view, run, busy }) => {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const sd = view.r3?.sd;
  const teams = byId(view);
  return (
    <div className="rounded-2xl border border-red-500/40 bg-[#10121a] p-3 space-y-2" data-testid="card-sd">
      <div className="text-[11px] font-mono uppercase tracking-wider text-red-300 font-bold">Sudden Death</div>
      {sd && !sd.resolved && (
        <div className="text-xs text-[#cbd5e1]">
          Duel running: {teams.get(sd.teamA)?.name} ({sd.votesA}) vs {teams.get(sd.teamB)?.name} ({sd.votesB})
        </div>
      )}
      {sd?.resolved && <div className="text-xs text-[#cbd5e1]">Last duel won by {teams.get(sd.winnerTeamId ?? '')?.name ?? 'nobody'}.</div>}
      <TeamSelect teams={view.teams} value={a} onChange={setA} label="Crew A" />
      <TeamSelect teams={view.teams} value={b} onChange={setB} label="Crew B" />
      <button
        data-testid="trigger-sd"
        className={`${BTN_RED} w-full`}
        disabled={busy || !a || !b || a === b}
        onClick={() => void run('Sudden death', 'ADMIN_TRIGGER_SUDDEN_DEATH', { teamA: a, teamB: b })}
      >
        Trigger Sudden Death
      </button>
    </div>
  );
};

// ------------------------------------------------------------------ final
const FinalStandings: React.FC<{ view: AdminViewData }> = ({ view }) => {
  const rows = standings(view);
  const escaped = view.r3 ? [...view.r3.escapeOrder] : [];
  const nameOf = (id: string) => view.teams.find(t => t.id === id)?.name ?? id;
  return (
    <div className={BOX} data-testid="card-final">
      <div className={H}>{view.phase.name === 'FINISHED' ? 'Final standings' : 'Round 3 results'}</div>
      <div className={CARD}>
        <FrontPageCard finished={view.phase.name === 'FINISHED'} />
      </div>
      <div className={CARD}>
        <ExportCard />
      </div>
      {escaped.length > 0 && (
        <div className="text-sm space-y-1">
          <div className="text-xs font-mono text-[#8e95a5]">Escape order</div>
          {escaped.slice(0, 3).map((id, i) => (
            <div key={id} className="break-words">
              {medal(i + 1)} <span className="font-serif font-bold">{nameOf(id)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {rows.map(({ team: t, r3 }, i) => (
          <div key={t.id} className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161922] p-2 min-w-0">
            <RankBadge rank={i + 1} />
            <div className="min-w-0 flex-1">
              <CrewName t={t} />
              {r3 && <div className="text-[11px] font-mono text-[#a9b4c7]">{r3.escaped ? `escaped ${medal(r3.escapeRank)}` : `${Math.round(r3.distance)} m`}</div>}
            </div>
            <span className="shrink-0 font-mono text-sm font-bold text-[#c4a45a]">{t.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export { MatchCard };
