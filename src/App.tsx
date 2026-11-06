import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Megaphone, Pause } from 'lucide-react';
import { GameProvider, useGame } from './game/useGame';
import { readName } from './game/session';
import { Navbar } from './components/Navbar';
import { JoinModal } from './components/JoinModal';
import { LobbyTeamFormation } from './components/LobbyTeamFormation';
import { RoundContainer, RulesSheet } from './components/RoundContainer';
import { Rope } from './components/Rope';
import { LeaderboardDrawer } from './components/LeaderboardDrawer';

const AdminControlPanel = React.lazy(() => import('./components/AdminControlPanel').then(m => ({ default: m.AdminControlPanel })));
const ScreenView = React.lazy(() => import('./components/ScreenView').then(m => ({ default: m.ScreenView })));
const WrappedPreview = React.lazy(() => import('../games/underworld/recap/ui/WrappedPreview').then(m => ({ default: m.WrappedPreview })));
const FrontPagePreview = React.lazy(() => import('../games/underworld/recap/ui/WrappedPreview').then(m => ({ default: m.FrontPagePreview })));
const SoloTester = React.lazy(() => import('./components/SoloTester').then(m => ({ default: m.SoloTester })));

/** A known device waits here for the server. It never sees the Join screen. */
const Waiting: React.FC<{ known: boolean }> = ({ known }) => {
  const name = readName();
  return (
    <div data-testid={known ? 'reconnecting-screen' : 'connecting-screen'} className="min-h-[70vh] flex flex-col items-center justify-center text-center space-y-4 px-6">
      <Loader2 className="w-10 h-10 text-[#c4a45a] animate-spin" />
      <h2 className="text-2xl font-serif font-black text-[#f4f0e8]">{known ? 'Reconnecting…' : 'Connecting…'}</h2>
      <p className="text-base text-[#a9b4c7] max-w-xs">
        {known
          ? `${name ? `Welcome back, ${name}. ` : ''}Your place is safe.`
          : 'Pub Wi-Fi can be slow.'}
      </p>
    </div>
  );
};

/**
 * Pause is a thin banner under the top bar on every phone screen (lobby, rounds, even over a briefing). It is fixed and sits above
 * the full-screen modals; the rope shows the frozen clock. A polite live region announces pause and resume.
 */
const PausedBanner: React.FC = () => {
  const { view } = useGame();
  const paused = !!view?.phase.paused || view?.phase.pausedAt != null;
  const was = useRef(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    document.documentElement.style.setProperty('--paused-h', paused ? '38px' : '0px');
    return () => void document.documentElement.style.removeProperty('--paused-h');
  }, [paused]);
  useEffect(() => {
    if (!view) return;
    if (paused !== was.current) setSaid(paused ? 'The host has paused the game.' : 'The game has resumed.');
    was.current = paused;
  }, [paused, view]);
  return (
    <>
      {paused && (
        <div className="paused-wrap fixed left-1/2 -translate-x-1/2 w-full max-w-[480px]" style={{ zIndex: 99999 }}>
          <div data-testid="paused-banner" className="flex items-center justify-center gap-2 bg-[#2a2e3d] border-y border-[#5b6377] text-[#f4f0e8] text-base font-bold py-1.5 px-3">
            <Pause className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Paused by the host</span>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
    </>
  );
};

/** The host's notice is a banner; it moves below the pause banner when both show. */
const Banners: React.FC = () => {
  const { view } = useGame();
  if (!view?.notice) return null;
  const paused = !!view.phase.paused || view.phase.pausedAt != null;
  return (
    <div className={`sticky z-30 ${paused ? 'top-[105px]' : 'top-[67px]'}`}>
      <div data-testid="notice-banner" className="flex items-center justify-center space-x-2 bg-[#c4a45a] text-[#08090c] text-base font-bold py-2 px-3">
        <Megaphone className="w-4 h-4 shrink-0" />
        <span>{view.notice}</span>
      </div>
    </div>
  );
};

const PlayerContent: React.FC = () => {
  const { view, meta, synced, knownDevice } = useGame();
  if (!view || !meta) return <Waiting known={knownDevice} />;
  // Only a live answer from the server can say "unknown player". A cached view without `me` is not proof.
  if (!view.me) return synced ? <JoinModal /> : <Waiting known={knownDevice} />;
  if (view.phase.name === 'LOBBY') return <LobbyTeamFormation />;
  return <RoundContainer />;
};

const PlayerApp: React.FC = () => {
  const { view } = useGame();
  const paused = !!view?.phase.paused || view?.phase.pausedAt != null;
  const [boardOpen, setBoardOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh flex flex-col selection:bg-[#c4a45a] selection:text-[#08090c]">
      <Rope />
      <PausedBanner />
      <div className="w-full max-w-[480px] mx-auto min-h-screen flex flex-col bg-[#08090c] border-x border-[#2a2e3d]/40 relative">
        <Navbar onToggleBoard={() => setBoardOpen(o => !o)} onOpenRules={() => setRulesOpen(true)} />
        <Banners />
        <main className={`flex-1 px-4 pb-6 ${paused ? "pt-10" : ""}`}>
          <PlayerContent />
        </main>
        <LeaderboardDrawer open={boardOpen} onClose={() => setBoardOpen(false)} />
        <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
      </div>
    </div>
  );
};

const Loading: React.FC<{ what: string }> = ({ what }) => (
  <div className="p-8 text-center text-sm font-mono text-[#8e95a5]">Loading {what}...</div>
);

export function App() {
  const path = window.location.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) {
    return (
      <React.Suspense fallback={<Loading what="admin panel" />}>
        <AdminControlPanel />
      </React.Suspense>
    );
  }
  if (path === '/screen' || path.startsWith('/screen/')) {
    return (
      <React.Suspense fallback={<Loading what="projector view" />}>
        <ScreenView />
      </React.Suspense>
    );
  }
  if (path === '/wrapped-preview') {
    return (
      <React.Suspense fallback={<Loading what="recap preview" />}>
        <WrappedPreview />
      </React.Suspense>
    );
  }
  if (path === '/front-page') {
    return (
      <React.Suspense fallback={<Loading what="front page" />}>
        <FrontPagePreview />
      </React.Suspense>
    );
  }
  if (path === '/solotester' || path.startsWith('/solotester/')) {
    return (
      <React.Suspense fallback={<Loading what="solo tester" />}>
        <SoloTester />
      </React.Suspense>
    );
  }
  return (
    <GameProvider>
      <PlayerApp />
    </GameProvider>
  );
}

export default App;
