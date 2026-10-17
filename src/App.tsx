import React, { useState, useEffect } from 'react';
import { GameProvider, useGameSession } from './context/GameContext';
import { Navbar } from './components/Navbar';
import { JoinModal } from './components/JoinModal';
import { LobbyTeamFormation } from './components/LobbyTeamFormation';
import { RoundContainer } from './components/RoundContainer';
import { LeaderboardDrawer } from './components/LeaderboardDrawer';
import { AdminControlPanel } from './components/AdminControlPanel';

const MainGameContent: React.FC = () => {
  const { player, payload } = useGameSession();
  const [isAdminView, setIsAdminView] = useState(() => {
    return window.location.pathname.includes('/admin') || window.location.hash.includes('admin');
  });

  // Listen to popstate or hash changes
  useEffect(() => {
    const handleLocationChange = () => {
      setIsAdminView(window.location.pathname.includes('/admin') || window.location.hash.includes('admin'));
    };
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  const openAdmin = () => {
    setIsAdminView(true);
    window.history.pushState(null, '', '/admin');
  };

  const closeAdmin = () => {
    setIsAdminView(false);
    window.history.pushState(null, '', '/');
  };

  return (
    <div className="min-h-screen bg-[#08090c] text-[#f4f0e8] underworld-bg-mesh flex flex-col justify-between selection:bg-[#c4a45a] selection:text-[#08090c]">
      {/* Centered Mobile-First 480px Container */}
      <div className="w-full max-w-[480px] mx-auto min-h-screen flex flex-col bg-[#08090c] border-x border-[#2a2e3d]/40 shadow-2xl relative">
        <Navbar />

        <main className="flex-1 px-4 pb-12">
          {isAdminView ? (
            <AdminControlPanel payload={payload} onClose={closeAdmin} />
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
            <button
              onClick={isAdminView ? closeAdmin : openAdmin}
              className="text-[#c4a45a] hover:underline font-bold"
            >
              {isAdminView ? 'Player Screen' : 'Admin Gate'}
            </button>
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
