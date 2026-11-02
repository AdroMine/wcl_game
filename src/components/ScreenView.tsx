// /screen: the projector view. Large type, dark, read from across a pub. Display only.
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { ScreenView as ScreenData } from '../../shared/protocol.ts';
import { ClockOffset, formatClock } from '../game/clock';
import { apiUrl, getRuntimeConfig, loadRuntimeConfig } from '../game/config';
import { LiveFeed } from '../game/feed';
import type { FeedStatus } from '../game/feed';
import { useTick } from '../game/useNow';

const PHASE_TITLES: Record<string, string> = {
  LOBBY: 'Gather your crews',
  R1_ACTIVE: 'Round 1: The Shattered Tablet',
  R1_RESULTS: 'Round 1 complete',
  R2_PAIRING: 'Round 2: Find your rival',
  R2_CLASH: 'Round 2: Shades in the Mist',
  R2_RESULTS: 'Round 2 complete',
  R3_ACTIVE: 'Round 3: Escape from Tartarus',
  R3_RESULTS: 'The river is crossed',
  FINISHED: 'Final standings',
};
const STEP_NAMES: Record<string, string> = { BRIEFING: 'Briefing', HUDDLE: 'Huddle', PARLEY: 'Dialogue', VOTE: 'Vote', DEBRIEF: 'Reveal', BLUFF: 'Bluff', REVEAL: 'Reveal', SUDDEN_DEATH: 'Sudden Death' };
const VESSELS: Record<string, string> = { R: 'Rowboat', S: 'Sailboat', G: 'Ghost Ship' };

export const ScreenView: React.FC = () => {
  const [data, setData] = useState<ScreenData | null>(null);
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const [qr, setQr] = useState<string>('');
  const clock = useRef(new ClockOffset(0));
  const offset = useRef(0);
  useTick(250);

  useEffect(() => {
    let cancelled = false;
    let feed: LiveFeed<ScreenData> | null = null;
    void loadRuntimeConfig().then(() => {
      if (cancelled) return;
      feed = new LiveFeed<ScreenData>({
        streamUrl: () => apiUrl('/api/screen/stream'),
        pollUrl: () => apiUrl('/screen-view'),
        onStatus: setStatus,
        onValue: (v, serverNow) => {
          offset.current = clock.current.add(serverNow);
          setData(v);
        },
      });
      feed.start();
    });
    return () => {
      cancelled = true;
      feed?.stop();
    };
  }, []);

  const joinUrl = data?.joinUrl ?? getRuntimeConfig().publicUrl ?? window.location.origin;
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 360, color: { dark: '#08090c', light: '#f4f0e8' } })
      .then(u => live && setQr(u))
      .catch(() => live && setQr(''));
    return () => {
      live = false;
    };
  }, [joinUrl]);

  if (!data) {
    return (
      <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] flex items-center justify-center">
        <h1 data-testid="screen-connecting" className="text-5xl font-serif font-black">
          {status === 'reconnecting' || status === 'offline' ? 'Reconnecting…' : 'Connecting…'}
        </h1>
      </div>
    );
  }

  const p = data.phase;
  const left = p.paused && p.pausedRemainingMs !== undefined ? p.pausedRemainingMs : p.endsAt == null ? null : Math.max(0, p.endsAt - (Date.now() + offset.current));
  const stepName = p.step ? STEP_NAMES[p.step] ?? p.step : '';
  const inR3 = data.phase.name.startsWith('R3') || data.phase.name === 'FINISHED';
  const showFleet = !!data.fleet && data.fleet.length > 0 && inR3;
  const down = status === 'reconnecting' || status === 'offline';

  const briefing = p.step === 'BRIEFING';
  // Crew size is shown when the server includes it in the lobby view (optional field).
  const crewSize = data.lobby?.crewSize;
  let subtitle = briefing ? 'Briefing' : stepName;
  if (p.name === 'R2_CLASH') subtitle = `Clash ${p.clash} of 3 • ${stepName}`;
  if (p.name === 'R3_ACTIVE') subtitle = `Wave ${p.wave} • ${stepName}`;

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh p-8 flex flex-col gap-6" data-testid="screen-root">
      {down && (
        <div data-testid="screen-reconnecting" className="fixed top-3 right-3 bg-amber-900 text-amber-100 px-4 py-2 rounded-lg text-xl font-semibold z-50">
          Reconnecting…
        </div>
      )}
      {data.notice && <div className="bg-[#c4a45a] text-[#08090c] text-4xl font-black text-center py-4 rounded-2xl">{data.notice}</div>}

      <div className="grid grid-cols-12 gap-8 flex-1">
        <div className="col-span-7 flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="text-2xl font-mono uppercase tracking-widest text-[#e5cb87] font-bold">Underworld</div>
            <h1 data-testid="screen-title" className="text-6xl font-serif font-black leading-tight">
              {PHASE_TITLES[p.name] ?? data.title}
            </h1>
            {subtitle && (
              <div data-testid="screen-step" className="text-5xl font-serif font-bold text-[#e5cb87]">
                {subtitle}
              </div>
            )}
          </div>

          {left !== null && (
            <div data-testid="screen-countdown" className={`text-[11rem] leading-none font-mono font-black tabular-nums ${p.paused ? 'text-amber-300' : left <= 10_000 ? 'text-red-400' : 'text-[#f4f0e8]'}`}>
              {formatClock(left)}
              {p.paused && <span className="text-4xl ml-6 align-middle">PAUSED</span>}
            </div>
          )}
          {left === null && p.paused && <div className="text-7xl font-black text-amber-300">PAUSED</div>}

          <p data-testid="screen-instruction" className="text-4xl leading-snug text-[#cbd5e1] max-w-4xl">
            {briefing ? 'Briefing — the story is playing on your phones' : data.instruction}
          </p>

          <div className="flex items-center gap-6 text-3xl font-mono text-[#a9b4c7]">
            <span>{data.counts.players} players</span>
            <span>{data.counts.teams} crews</span>
            {p.name === 'LOBBY' && crewSize != null && <span data-testid="screen-crew-size">crew size {crewSize}</span>}
          </div>
        </div>

        <div className="col-span-5 flex flex-col gap-6">
          {data.podium && data.podium.length > 0 && (
            <div data-testid="screen-podium" className="bg-[#10121a] border border-[#c4a45a]/60 rounded-3xl p-6 space-y-2">
              <h2 className="text-3xl font-serif font-black text-[#e5cb87]">Podium</h2>
              {data.podium.map((n, i) => (
                <div key={i} className="text-4xl font-serif font-black">
                  {['Gold', 'Silver', 'Bronze'][i]}: {n}
                </div>
              ))}
            </div>
          )}

          {showFleet ? (
            <div data-testid="screen-fleet" className="bg-[#10121a] border border-[#3a4157] rounded-3xl p-6 space-y-2 flex-1 overflow-hidden">
              <h2 className="text-3xl font-serif font-black text-[#e5cb87]">The river</h2>
              {data.fleet!.slice(0, 10).map(([name, dist, rank, vessel], i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-2xl">
                    <span className="font-bold truncate pr-3">{name}</span>
                    <span className="font-mono text-[#e5cb87] shrink-0">{rank > 0 ? `#${rank} escaped` : `${dist} m`}{vessel ? ` • ${VESSELS[vessel] ?? vessel}` : ''}</span>
                  </div>
                  <div className="h-3 bg-[#08090c] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#c4a45a] to-[#e5cb87]" style={{ width: `${Math.min(100, dist / 10)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div data-testid="screen-board" className="bg-[#10121a] border border-[#3a4157] rounded-3xl p-6 space-y-2 flex-1">
              <h2 className="text-3xl font-serif font-black text-[#e5cb87]">Top crews</h2>
              {data.board.slice(0, 10).map(([name, score], i) => (
                <div key={i} className="flex items-center justify-between text-3xl py-1 border-b border-[#2a2e3d]/60">
                  <span className="flex items-center gap-4 min-w-0">
                    <span className="w-10 font-mono text-[#a9b4c7]">{i + 1}</span>
                    <span className="font-serif font-black truncate">{name}</span>
                  </span>
                  <span className="font-mono font-black text-[#c4a45a]">{score}</span>
                </div>
              ))}
              {data.board.length === 0 && <div className="text-2xl text-[#8e95a5]">No crews yet</div>}
            </div>
          )}

          <div className="flex items-center gap-5 bg-[#10121a] border border-[#3a4157] rounded-3xl p-4">
            {qr && <img data-testid="screen-qr" src={qr} alt="Join QR code" className="w-40 h-40 rounded-xl" />}
            <div className="min-w-0">
              <div className="text-2xl font-mono text-[#e5cb87] font-bold">Join on your phone</div>
              <div className="text-2xl break-all text-[#f4f0e8]">{joinUrl.replace(/^https?:\/\//, '')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
