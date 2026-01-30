
import React, { useState, useCallback, useRef } from 'react';
import { Player, TeamColor, AIPlayerResult } from './types';
import Pitch from './components/Pitch';
import PlayerNode from './components/PlayerNode';
import AIImporter from './components/AIImporter';
import Auth, { PasswordReset } from './components/Auth';
import PlayerManager from './components/admin/PlayerManager';
import { useAuth } from './contexts/AuthContext';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useImageExport } from './hooks/useImageExport';
import { usePlayers } from './hooks/usePlayers';

type Page = 'lineup' | 'players';

const INITIAL_PLAYERS: Player[] = [
  // Black Team (Left)
  { id: 'b1', name: '', team: 'black', position: { x: 12, y: 50 } },
  { id: 'b2', name: '', team: 'black', position: { x: 25, y: 30 } },
  { id: 'b3', name: '', team: 'black', position: { x: 25, y: 70 } },
  { id: 'b4', name: '', team: 'black', position: { x: 42, y: 20 } },
  { id: 'b5', name: '', team: 'black', position: { x: 42, y: 50 } },
  { id: 'b6', name: '', team: 'black', position: { x: 42, y: 80 } },

  // White Team (Right)
  { id: 'w1', name: '', team: 'white', position: { x: 88, y: 50 } },
  { id: 'w2', name: '', team: 'white', position: { x: 75, y: 30 } },
  { id: 'w3', name: '', team: 'white', position: { x: 75, y: 70 } },
  { id: 'w4', name: '', team: 'white', position: { x: 58, y: 20 } },
  { id: 'w5', name: '', team: 'white', position: { x: 58, y: 50 } },
  { id: 'w6', name: '', team: 'white', position: { x: 58, y: 80 } },
];

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('lineup');
  const [pitchPlayers, setPitchPlayers] = useState<Player[]>(INITIAL_PLAYERS);
  const [showRatings, setShowRatings] = useState(true);
  const [hideUI, setHideUI] = useState(false);
  const [titleClicks, setTitleClicks] = useState(0);
  const pitchRef = useRef<HTMLDivElement>(null);
  const showRatingsRef = useRef(showRatings);
  showRatingsRef.current = showRatings;

  // Secret login trigger - triple-click the title
  const handleTitleClick = useCallback(() => {
    setTitleClicks(prev => {
      const newCount = prev + 1;
      if (newCount >= 3) {
        window.dispatchEvent(new CustomEvent('secretLogin'));
        return 0;
      }
      // Reset after 1 second
      setTimeout(() => setTitleClicks(0), 1000);
      return newCount;
    });
  }, []);

  // Auth context
  const { canEditPlayers, isAuthenticated, isPasswordRecovery, clearPasswordRecovery, isLoading: isAuthLoading } = useAuth();

  // Player database hook
  const { getRatingForName, findPlayerByName } = usePlayers();

  // Swap players (exchange names, ratings, and team - positions are fixed slots)
  const handleSwapPlayers = useCallback((id1: string, id2: string) => {
    setPitchPlayers(prev => {
      const player1 = prev.find(p => p.id === id1);
      const player2 = prev.find(p => p.id === id2);
      if (!player1 || !player2) return prev;

      return prev.map(p => {
        if (p.id === id1) {
          return {
            ...p,
            name: player2.name,
            rating: player2.rating,
            team: player2.team,
          };
        }
        if (p.id === id2) {
          return {
            ...p,
            name: player1.name,
            rating: player1.rating,
            team: player1.team,
          };
        }
        return p;
      });
    });
  }, []);

  // Drag and drop hook with swap support
  const { handleDragStart, draggedId, dropTargetId } = useDragAndDrop({
    pitchRef,
    players: pitchPlayers,
    onPositionUpdate: (id, x, y) => {
      setPitchPlayers(prev => prev.map(p =>
        p.id === id ? { ...p, position: { x, y } } : p
      ));
    },
    onSwapPlayers: handleSwapPlayers,
  });

  // Image export hook
  const { exportAsImage, isExporting } = useImageExport({ pitchRef });

  // Handle export with ratings toggle
  const handleExport = useCallback(async () => {
    const originalShowRatings = showRatingsRef.current;
    await exportAsImage(
      () => setShowRatings(false),
      () => setShowRatings(originalShowRatings)
    );
  }, [exportAsImage]);

  // Get player rating from database
  const getPlayerRating = useCallback((name: string) => {
    if (!name) return undefined;
    return getRatingForName(name);
  }, [getRatingForName]);

  // Update player name and fetch rating
  const updatePlayerName = useCallback((id: string, newName: string) => {
    setPitchPlayers(prev => prev.map(p => {
      if (p.id === id) {
        const rating = getPlayerRating(newName);
        return { ...p, name: newName, rating };
      }
      return p;
    }));
  }, [getPlayerRating]);

  // Handle AI-parsed players (already balanced by AIImporter)
  const handleAIPlayers = useCallback((newPlayerData: AIPlayerResult[]) => {
    // Players come pre-balanced from AIImporter
    const blackPlayers = newPlayerData.filter(p => p.team === 'black');
    const whitePlayers = newPlayerData.filter(p => p.team === 'white');

    setPitchPlayers(prev => prev.map(existingPlayer => {
      const teamArray = existingPlayer.team === 'black' ? blackPlayers : whitePlayers;
      const index = prev.filter(p => p.team === existingPlayer.team).indexOf(existingPlayer);

      if (teamArray[index]) {
        const rating = getPlayerRating(teamArray[index].name) || 70;
        return {
          ...existingPlayer,
          name: teamArray[index].name,
          rating,
        };
      }
      return existingPlayer;
    }));
  }, [getPlayerRating]);

  const handleReset = () => {
    if (window.confirm('Reset pitch?')) setPitchPlayers(INITIAL_PLAYERS);
  };

  const totalRating = (team: TeamColor) =>
    pitchPlayers.filter(p => p.team === team && p.name).reduce((acc, p) => acc + (p.rating || 0), 0);

  // Show loading while checking auth
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic leading-none mb-4">
            STREAMLINED<span className="text-emerald-400"> SOCCER</span>
          </h1>
          <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated && !isPasswordRecovery) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic leading-none">
            STREAMLINED<span className="text-emerald-400"> SOCCER</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase mt-2">Smart Lineup Management</p>
        </div>
        <Auth />
      </div>
    );
  }

  // Players Database Page
  if (currentPage === 'players') {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center p-4 md:p-8">
        {/* Password Recovery Modal */}
        {isPasswordRecovery && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <PasswordReset onComplete={clearPasswordRecovery} />
          </div>
        )}

        <header className="w-full max-w-5xl flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentPage('lineup')}
              className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-white uppercase italic leading-none">
                Player Database
              </h1>
              <p className="text-slate-500 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Manage your squad</p>
            </div>
          </div>
        </header>

        <main className="w-full max-w-5xl">
          <PlayerManager />
        </main>

        <footer className="mt-12 text-slate-600 text-[10px] font-black uppercase tracking-[0.3em] pb-8 opacity-50 text-center">
          Synced to Cloud • Streamlined Soccer
        </footer>
      </div>
    );
  }

  // Lineup Page (default)
  return (
    <div className={`min-h-screen bg-[#020617] flex flex-col items-center transition-all duration-500 ${hideUI ? 'p-0' : 'p-4 md:p-8'}`}>

      {/* Password Recovery Modal */}
      {isPasswordRecovery && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <PasswordReset onComplete={clearPasswordRecovery} />
        </div>
      )}

      {!hideUI && (
        <header className="w-full max-w-4xl flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div className="text-center md:text-left">
            <h1
              onClick={handleTitleClick}
              className="text-4xl font-black tracking-tighter text-white uppercase italic leading-none cursor-default select-none"
            >
              STREAMLINED<span className="text-emerald-400"> SOCCER</span>
            </h1>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase mt-2">Smart Lineup Management</p>
          </div>

          <div className="flex items-center gap-2">
            {canEditPlayers && (
              <button
                onClick={() => setCurrentPage('players')}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-tight transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Players
              </button>
            )}

            <div className="flex items-center bg-slate-900 border border-white/5 rounded-xl px-3 py-2 gap-2">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Ratings</span>
              <button
                onClick={() => setShowRatings(!showRatings)}
                className={`w-9 h-5 rounded-full transition-all relative ${showRatings ? 'bg-emerald-600' : 'bg-slate-800'}`}
              >
                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${showRatings ? 'left-5' : 'left-1'}`} />
              </button>
            </div>

            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2.5 bg-white text-slate-900 hover:bg-slate-200 rounded-xl text-xs font-black uppercase tracking-tight transition-all active:scale-95 border-b-4 border-slate-300 disabled:opacity-50"
            >
              {isExporting ? '...' : 'Export'}
            </button>
            <button
              onClick={() => setHideUI(true)}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-tight transition-all active:scale-95 border-b-4 border-emerald-800"
            >
              Focus
            </button>
          </div>
        </header>
      )}

      <main
        className={`relative w-full transition-all duration-500 ${hideUI ? 'max-w-none h-screen' : 'max-w-4xl aspect-[4/5] md:aspect-[4/3] shadow-2xl mb-12'}`}
        ref={pitchRef}
      >
        <Pitch>
          {pitchPlayers.map(player => (
            <PlayerNode
              key={player.id}
              player={player}
              onUpdateName={updatePlayerName}
              onDragStart={handleDragStart}
              showRatings={showRatings}
              isBeingDragged={draggedId === player.id}
              isDropTarget={dropTargetId === player.id}
            />
          ))}

          {showRatings && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-8 pointer-events-none opacity-40">
              <div className="text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-black ring-1 ring-white/20"></span>
                B: {totalRating('black')}
              </div>
              <div className="text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white ring-1 ring-black/20"></span>
                W: {totalRating('white')}
              </div>
            </div>
          )}
        </Pitch>

        {hideUI && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-4 z-[1000]">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-4 rounded-full font-black text-sm uppercase tracking-widest shadow-2xl border-b-4 border-emerald-700 transition-all flex items-center gap-3 disabled:opacity-50"
            >
              {isExporting ? 'Saving...' : 'Save Lineup'}
            </button>
            <button
              onClick={() => setHideUI(false)}
              className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white px-8 py-4 rounded-full font-black text-sm uppercase tracking-widest border border-white/20 transition-all"
            >
              Back
            </button>
          </div>
        )}
      </main>

      {!hideUI && (
        <section className="w-full max-w-4xl space-y-8">
          <AIImporter onPlayersFound={handleAIPlayers} findPlayerByName={findPlayerByName} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-slate-900/80 p-6 rounded-3xl border border-white/5 shadow-xl relative overflow-hidden">
              <h3 className="text-xl font-black mb-6 text-white flex items-center justify-between uppercase italic tracking-tighter relative z-10">
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 bg-black rounded-full ring-2 ring-emerald-500/50"></span>
                  Squad Black
                </div>
                {showRatings && <span className="text-xs text-emerald-400 font-mono tracking-normal">PWR: {totalRating('black')}</span>}
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-6">
                {pitchPlayers.filter(p => p.team === 'black').map(player => (
                  <div key={player.id} className="flex flex-col group">
                    <label className="text-[10px] text-slate-500 font-black uppercase mb-1.5 tracking-widest flex justify-between">
                      <span>Slot {player.id}</span>
                      {showRatings && player.rating && <span className="text-emerald-500/60">{player.rating}</span>}
                    </label>
                    <input
                      value={player.name}
                      placeholder="Name..."
                      onChange={(e) => updatePlayerName(player.id, e.target.value)}
                      className="bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-sm font-bold text-white focus:border-emerald-500/50 transition-all focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/80 p-6 rounded-3xl border border-white/5 shadow-xl relative overflow-hidden">
              <h3 className="text-xl font-black mb-6 text-white flex items-center justify-between uppercase italic tracking-tighter relative z-10">
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 bg-white rounded-full ring-2 ring-emerald-500/50"></span>
                  Squad White
                </div>
                {showRatings && <span className="text-xs text-emerald-400 font-mono tracking-normal">PWR: {totalRating('white')}</span>}
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-6">
                {pitchPlayers.filter(p => p.team === 'white').map(player => (
                  <div key={player.id} className="flex flex-col group">
                    <label className="text-[10px] text-slate-500 font-black uppercase mb-1.5 tracking-widest flex justify-between">
                      <span>Slot {player.id}</span>
                      {showRatings && player.rating && <span className="text-emerald-500/60">{player.rating}</span>}
                    </label>
                    <input
                      value={player.name}
                      placeholder="Name..."
                      onChange={(e) => updatePlayerName(player.id, e.target.value)}
                      className="bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-sm font-bold text-white focus:border-emerald-500/50 transition-all focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleReset}
            className="w-full py-4 border-2 border-dashed border-slate-800 rounded-3xl text-slate-700 text-[10px] font-black uppercase tracking-[0.4em] hover:bg-red-500/5 hover:border-red-500/20 hover:text-red-500 transition-all"
          >
            Purge Pitch Data
          </button>
        </section>
      )}

      {!hideUI && (
        <footer className="mt-16 text-slate-600 text-[10px] font-black uppercase tracking-[0.3em] pb-12 opacity-50 text-center">
          {isAuthenticated ? 'Synced to Cloud' : 'Local Storage Mode'} • Streamlined Soccer
        </footer>
      )}
    </div>
  );
};

export default App;
