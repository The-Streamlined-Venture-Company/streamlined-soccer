
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Player, AIPlayerResult } from './types';
import Pitch from './components/Pitch';
import PlayerNode from './components/PlayerNode';
import AICommandCenter from './components/AICommandCenter';
import Auth, { PasswordReset } from './components/Auth';
import PlayerManager from './components/admin/PlayerManager';
import { useAuth } from './contexts/AuthContext';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useImageExport } from './hooks/useImageExport';
import { usePlayers } from './hooks/usePlayers';

type Page = 'lineup' | 'players';

// Hook to detect portrait orientation on mobile
const useIsPortrait = () => {
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      // Only apply portrait mode on smaller screens (mobile)
      const isMobile = window.innerWidth < 768;
      const isPortraitOrientation = window.innerHeight > window.innerWidth;
      setIsPortrait(isMobile && isPortraitOrientation);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  return isPortrait;
};

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
  const isPortrait = useIsPortrait();
  const [currentPage, setCurrentPage] = useState<Page>('lineup');
  const [pitchPlayers, setPitchPlayers] = useState<Player[]>(INITIAL_PLAYERS);
  const [showRatings, setShowRatings] = useState(true);
  const [hideUI, setHideUI] = useState(false);
  const [titleClicks, setTitleClicks] = useState(0);
  const [chatDocked, setChatDocked] = useState(false);
  const pitchRef = useRef<HTMLDivElement>(null);
  const showRatingsRef = useRef(showRatings);
  showRatingsRef.current = showRatings;

  // Transform player position for portrait mode (rotate 90° clockwise)
  // Black team goes to top, White team goes to bottom
  const getTransformedPosition = useCallback((position: { x: number; y: number }) => {
    if (!isPortrait) return position;
    // Rotate: newX = y, newY = 100 - x (to flip so black is at top)
    return {
      x: position.y,
      y: 100 - position.x
    };
  }, [isPortrait]);

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
  const { getRatingForName, findPlayerByName, players: dbPlayers, refresh: refreshPlayers } = usePlayers();

  // Autocomplete suggestions from database
  const getSuggestions = useCallback((query: string) => {
    if (!query || query.length < 1) return [];
    const lowerQuery = query.toLowerCase();
    return dbPlayers
      .filter(p => p.name.toLowerCase().includes(lowerQuery))
      .map(p => ({ name: p.name, rating: p.overall_score }))
      .slice(0, 5);
  }, [dbPlayers]);

  // Swap players (exchange names and ratings only - position and team color are fixed to slots)
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
          };
        }
        if (p.id === id2) {
          return {
            ...p,
            name: player1.name,
            rating: player1.rating,
          };
        }
        return p;
      });
    });
  }, []);

  // Drag and drop hook - swap only, positions are fixed
  const { handleDragStart, draggedId, dropTargetId, dragPosition } = useDragAndDrop({
    pitchRef,
    players: pitchPlayers,
    onSwapPlayers: handleSwapPlayers,
  });

  // Image export hook
  const { exportAsImage, shareAsImage, copyToClipboard, isExporting, canShare } = useImageExport({ pitchRef });
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Handle export with ratings toggle
  const handleExport = useCallback(async () => {
    const originalShowRatings = showRatingsRef.current;
    await exportAsImage(
      () => setShowRatings(false),
      () => setShowRatings(originalShowRatings)
    );
    setShowShareMenu(false);
  }, [exportAsImage]);

  // Handle share (WhatsApp etc)
  const handleShare = useCallback(async () => {
    const originalShowRatings = showRatingsRef.current;
    await shareAsImage(
      () => setShowRatings(false),
      () => setShowRatings(originalShowRatings)
    );
    setShowShareMenu(false);
  }, [shareAsImage]);

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    const originalShowRatings = showRatingsRef.current;
    await copyToClipboard(
      () => setShowRatings(false),
      () => setShowRatings(originalShowRatings)
    );
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
    setShowShareMenu(false);
  }, [copyToClipboard]);

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
      <div className={`min-h-screen bg-[#020617] flex flex-col items-center p-4 md:p-8 transition-all duration-300 ${chatDocked ? 'sm:pr-[24rem] md:pr-[26rem]' : ''}`}>
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

        {/* AI Command Center - floating chat */}
        {isAuthenticated && <AICommandCenter onPlayersUpdated={refreshPlayers} onDockChange={setChatDocked} />}
      </div>
    );
  }

  // Lineup Page (default)
  return (
    <div className={`min-h-screen bg-[#020617] flex flex-col items-center transition-all duration-500 ${hideUI ? 'p-0' : 'p-4 md:p-8'} ${chatDocked && !hideUI ? 'sm:pr-[24rem] md:pr-[26rem]' : ''}`}>

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

          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
            {canEditPlayers && (
              <button
                onClick={() => setCurrentPage('players')}
                className="px-4 py-3 sm:py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-tight transition-all flex items-center gap-2 min-h-[44px]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Players
              </button>
            )}

            {/* Share/Export dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                disabled={isExporting}
                className="px-4 py-3 sm:py-2.5 bg-white text-slate-900 hover:bg-slate-200 rounded-xl text-xs font-black uppercase tracking-tight transition-all active:scale-95 border-b-4 border-slate-300 disabled:opacity-50 flex items-center gap-1.5 min-h-[44px]"
              >
                {isExporting ? '...' : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share
                  </>
                )}
              </button>

              {/* Share menu dropdown */}
              {showShareMenu && (
                <>
                  {/* Backdrop to close menu */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowShareMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 bg-slate-800 rounded-xl shadow-xl border border-slate-700 overflow-hidden z-50 min-w-[180px]">
                    {/* WhatsApp / Native Share */}
                    {canShare && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShare(); }}
                        className="w-full px-4 py-3 text-left text-sm text-white hover:bg-slate-700 active:bg-slate-600 flex items-center gap-3 transition-colors"
                      >
                        <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        Share to WhatsApp
                      </button>
                    )}

                    {/* Copy to Clipboard */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-slate-700 active:bg-slate-600 flex items-center gap-3 transition-colors"
                    >
                      <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      {copyFeedback ? 'Copied!' : 'Copy to Clipboard'}
                    </button>

                    {/* Download */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExport(); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-slate-700 active:bg-slate-600 flex items-center gap-3 transition-colors border-t border-slate-700"
                    >
                      <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download Image
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setHideUI(true)}
              className="px-4 py-3 sm:py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-tight transition-all active:scale-95 border-b-4 border-emerald-800 min-h-[44px]"
            >
              Focus
            </button>
          </div>
        </header>
      )}

      <main
        className={`relative w-full transition-all duration-500 ${
          hideUI
            ? 'max-w-none h-screen'
            : isPortrait
              ? 'max-w-md aspect-[3/4] shadow-2xl mb-8'
              : 'max-w-4xl aspect-[4/5] md:aspect-[4/3] shadow-2xl mb-8'
        }`}
        ref={pitchRef}
      >
        <Pitch isPortrait={isPortrait}>
          {pitchPlayers.map(player => (
            <PlayerNode
              key={player.id}
              player={player}
              onUpdateName={updatePlayerName}
              onDragStart={handleDragStart}
              showRatings={showRatings}
              isBeingDragged={draggedId === player.id}
              isDropTarget={dropTargetId === player.id}
              dragPosition={draggedId === player.id ? dragPosition : null}
              getSuggestions={getSuggestions}
              displayPosition={getTransformedPosition(player.position)}
            />
          ))}

        </Pitch>

        {hideUI && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col sm:flex-row gap-3 sm:gap-4 z-[1000] px-4 w-full sm:w-auto max-w-sm sm:max-w-none pb-safe">
            <button
              onClick={canShare ? handleShare : handleExport}
              disabled={isExporting}
              className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 sm:px-8 py-4 rounded-full font-black text-sm uppercase tracking-widest shadow-2xl border-b-4 border-emerald-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 min-h-[56px]"
            >
              {isExporting ? 'Sharing...' : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {canShare ? 'Share' : 'Save'}
                </>
              )}
            </button>
            <button
              onClick={() => setHideUI(false)}
              className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white px-6 sm:px-8 py-4 rounded-full font-black text-sm uppercase tracking-widest border border-white/20 transition-all min-h-[56px]"
            >
              Back
            </button>
          </div>
        )}
      </main>

      {!hideUI && (
        <section className="w-full max-w-4xl space-y-6">
          {/* Reset button */}
          <button
            onClick={handleReset}
            className="w-full py-3 border border-dashed border-slate-800 rounded-2xl text-slate-700 text-[10px] font-black uppercase tracking-[0.3em] hover:bg-red-500/5 hover:border-red-500/20 hover:text-red-500 transition-all"
          >
            Reset Pitch
          </button>
        </section>
      )}

      {/* Floating AI Command Center */}
      {isAuthenticated && (
        <AICommandCenter
          onPlayersUpdated={refreshPlayers}
          onAssignToField={handleAIPlayers}
          findPlayerByName={findPlayerByName}
          onDockChange={setChatDocked}
        />
      )}

      {!hideUI && (
        <footer className="mt-12 text-slate-600 text-[10px] font-black uppercase tracking-[0.3em] pb-12 opacity-50 text-center">
          {isAuthenticated ? 'Synced to Cloud' : 'Local Storage Mode'} • Streamlined Soccer
        </footer>
      )}
    </div>
  );
};

export default App;
