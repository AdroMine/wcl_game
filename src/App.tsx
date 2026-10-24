import React, { useState, useEffect } from 'react';
import { GameProvider, useGameSession } from './context/GameContext';
import { Navbar } from './components/Navbar';
import { JoinModal } from './components/JoinModal';
import { LobbyTeamFormation } from './components/LobbyTeamFormation';
import { RoundContainer } from './components/RoundContainer';
import { LeaderboardDrawer } from './components/LeaderboardDrawer';
import { preloadAllRounds } from './lib/roundPreloader';

const AdminControlPanel = React.lazy(() =>
  import('./components/AdminControlPanel').then(m => ({ default: m.AdminControlPanel }))
);
const SoloTesterWorkbench = React.lazy(() =>
  import('./components/SoloTesterWorkbench').then(m => ({ default: m.SoloTesterWorkbench }))
);

const MainGameContent: React.FC = () => {
  const { player, payload } = useGameSession();
  const [isAdminView, setIsAdminView] = useState(() => {
    return window.location.pathname.includes('/admin') || window.location.hash.includes('admin');
  });
  const [isSoloTesterView, setIsSoloTesterView] = useState(() => {
    return window.location.pathname.includes('/solotester') || window.location.hash.includes('solotester') ||
           window.location.pathname.includes('/test') || window.location.hash.includes('test');
  });

  // Preload all round chunks into memory during browser idle time
  useEffect(() => {
    preloadAllRounds();
  }, []);

  // Listen to popstate or hash changes
  useEffect(() => {
    const handleLocationChange = () => {
      setIsAdminView(window.location.pathname.includes('/admin') || window.location.hash.includes('admin'));
      setIsSoloTesterView(
        window.location.pathname.includes('/solotester') || window.location.hash.includes('solotester') ||
        window.location.pathname.includes('/test') || window.location.hash.includes('test')
      );
    };
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);


  const closeAdmin = () => {
    setIsAdminView(false);
    setIsSoloTesterView(false);
    window.history.pushState(null, '', '/');
  };

  // Render Solo Tester full-screen workbench
  if (isSoloTesterView) {
    return (
      <React.Suspense fallback={<div className="p-8 text-center text-xs font-mono text-[#8e95a5]">Loading Solo Workbench...</div>}>
        <SoloTesterWorkbench />
      </React.Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh flex flex-col justify-between selection:bg-[#c4a45a] selection:text-[#08090c]">
      {/* Centered Container: Responsive 480px for players, spacious 4xl for admin dashboard */}
      <div className={`w-full ${isAdminView ? 'max-w-4xl' : 'max-w-[480px]'} mx-auto min-h-screen flex flex-col bg-[#08090c] border-x border-[#2a2e3d]/40 shadow-2xl relative transition-all duration-300`}>
        <Navbar />

        <main className={`flex-1 ${isAdminView ? 'px-4 sm:px-6' : 'px-4'} pb-12`}>
          {isAdminView ? (
            <React.Suspense fallback={<div className="p-8 text-center text-xs font-mono text-[#8e95a5]">Loading Admin Panel...</div>}>
              <AdminControlPanel payload={payload} onClose={closeAdmin} />
            </React.Suspense>
          ) : !player ? (
            <JoinModal />
          ) : payload?.state === 'LOBBY_TEAM_FORMATION' ? (
            <LobbyTeamFormation />
          ) : payload?.state === 'ROUND_ACTIVE' ? (
            <RoundContainer />
          ) : (
            <LeaderboardDrawer />
          )}
        </main>

        {/* Global Slide-up Leaderboard Drawer (for active round view) */}
        {!isAdminView && <LeaderboardDrawer />}

        {/* Mobile-Friendly Subtle Footer */}
        <footer className="py-4 px-4 text-center border-t border-[#2a2e3d]/50 bg-[#08090c]/80 text-[10px] font-mono text-[#8e95a5]">
          <div className="flex items-center justify-between">
            <span>UNDERWORLD ENGINE • PUB REALTIME</span>
            {isAdminView && (
              <button
                onClick={closeAdmin}
                className="text-[#c4a45a] hover:underline font-bold"
              >
                Exit Admin
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export function App() {
  return (
    <GameProvider>
      <MainGameContent />
    </GameProvider>
  );
}

export default App;
