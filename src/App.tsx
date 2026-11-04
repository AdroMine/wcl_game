import React, { useState } from 'react';
import { Loader2, WifiOff, PauseCircle, Megaphone } from 'lucide-react';
import { GameProvider, useGame } from './game/useGame';
import { readName } from './game/session';
import { Navbar } from './components/Navbar';
import { JoinModal } from './components/JoinModal';
import { LobbyTeamFormation } from './components/LobbyTeamFormation';
import { RoundContainer } from './components/RoundContainer';
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
      <p className="text-sm text-[#a9b4c7] max-w-xs">
        {known
          ? `${name ? `Welcome back, ${name}. ` : ''}Finding the game again. Your place in the Underworld is safe.`
          : 'Reaching the game server. This can take a moment on pub Wi-Fi.'}
      </p>
    </div>
  );
};

const Banners: React.FC = () => {
  const { view, status, synced, knownDevice } = useGame();
  const down = status === 'reconnecting' || status === 'offline' || (!synced && !!view);
  return (
    <div className="sticky top-[64px] z-30">
      {down && (
        <div data-testid="reconnecting-banner" role="status" className="flex items-center justify-center space-x-2 bg-amber-900/95 text-amber-100 text-sm font-semibold py-2 px-3 border-b border-amber-500/50">
          <WifiOff className="w-4 h-4" />
          <span>{status === 'offline' ? 'Offline. Reconnecting…' : knownDevice || synced ? 'Reconnecting…' : 'Connecting…'}</span>
        </div>
      )}
      {!down && status === 'polling' && (
        <div data-testid="polling-banner" className="text-center bg-[#161922] text-[#a9b4c7] text-xs font-mono py-1.5 border-b border-[#2a2e3d]">
          Weak connection: updating every few seconds
        </div>
      )}
      {view?.phase.paused && (
        <div data-testid="paused-banner" className="flex items-center justify-center space-x-2 bg-sky-950/95 text-sky-100 text-sm font-semibold py-2 px-3 border-b border-sky-500/40">
          <PauseCircle className="w-4 h-4" />
          <span>Paused by the host. The clock is stopped.</span>
        </div>
      )}
      {view?.notice && (
        <div data-testid="notice-banner" className="flex items-center justify-center space-x-2 bg-[#c4a45a] text-[#08090c] text-sm font-bold py-2 px-3">
          <Megaphone className="w-4 h-4 shrink-0" />
          <span>{view.notice}</span>
        </div>
      )}
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
  const [boardOpen, setBoardOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh flex flex-col justify-between selection:bg-[#c4a45a] selection:text-[#08090c]">
      <div className="w-full max-w-[480px] mx-auto min-h-screen flex flex-col bg-[#08090c] border-x border-[#2a2e3d]/40 shadow-2xl relative">
        <Navbar onToggleBoard={() => setBoardOpen(o => !o)} />
        <Banners />
        <main className="flex-1 px-4 pb-12">
          <PlayerContent />
        </main>
        <LeaderboardDrawer open={boardOpen} onClose={() => setBoardOpen(false)} />
        <footer className="py-4 px-4 text-center border-t border-[#2a2e3d]/50 bg-[#08090c]/80 text-[10px] font-mono text-[#8e95a5]">
          UNDERWORLD ENGINE • PUB REALTIME
        </footer>
      </div>
    </div>
  );
};

const Loading: React.FC<{ what: string }> = ({ what }) => (
  <div className="p-8 text-center text-xs font-mono text-[#8e95a5]">Loading {what}...</div>
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
