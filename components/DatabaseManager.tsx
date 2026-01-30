
import React, { useState } from 'react';
import { DatabasePlayer } from '../types';

interface DatabaseManagerProps {
  database: DatabasePlayer[];
  onDatabaseUpdate: (db: DatabasePlayer[]) => void;
  onSyncStatusChange: (isSynced: boolean) => void;
}

const DatabaseManager: React.FC<DatabaseManagerProps> = ({ database, onDatabaseUpdate, onSyncStatusChange }) => {
  const [url, setUrl] = useState(localStorage.getItem('sheet_url') || '');
  const [isSyncing, setIsSyncing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRating, setNewRating] = useState('70');

  const saveDatabase = (newDb: DatabasePlayer[]) => {
    onDatabaseUpdate(newDb);
    localStorage.setItem('pitchmaster_db', JSON.stringify(newDb));
  };

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const player: DatabasePlayer = {
      name: newName.trim(),
      rating: parseInt(newRating) || 70
    };
    saveDatabase([...database, player]);
    setNewName('');
  };

  const handleDelete = (name: string) => {
    saveDatabase(database.filter(p => p.name !== name));
  };

  const fetchCSV = async (targetUrl: string) => {
    if (!targetUrl) return;
    setIsSyncing(true);
    try {
      let finalUrl = targetUrl;
      if (targetUrl.includes('docs.google.com/spreadsheets') && !targetUrl.includes('export?format=csv')) {
         const match = targetUrl.match(/\/d\/([^\/]+)/);
         if (match) finalUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
      }

      const response = await fetch(finalUrl);
      const csvText = await response.text();
      const lines = csvText.split('\n');
      const headers = lines[0].toLowerCase().split(',');
      const nameIdx = headers.findIndex(h => h.includes('name'));
      const ratingIdx = headers.findIndex(h => h.includes('rating'));

      if (nameIdx === -1 || ratingIdx === -1) throw new Error('Invalid CSV Headers');

      const importedDb: DatabasePlayer[] = lines.slice(1)
        .filter(line => line.trim())
        .map(line => {
          const parts = line.split(',');
          return {
            name: parts[nameIdx]?.trim() || 'Unknown',
            rating: parseInt(parts[ratingIdx]) || 70,
          };
        });

      // Merge with existing, prioritizing new imports
      const mergedNames = new Set(importedDb.map(p => p.name));
      const filteredExisting = database.filter(p => !mergedNames.has(p.name));
      saveDatabase([...filteredExisting, ...importedDb]);
      
      onSyncStatusChange(true);
      localStorage.setItem('sheet_url', targetUrl);
    } catch (err) {
      alert('Sync Failed. Check URL and ensure "Published to Web" as CSV.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="bg-slate-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-sm shadow-xl">
        <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <h4 className="text-white font-black uppercase text-xs tracking-[0.2em] italic">Player Vault</h4>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Manual Entry */}
          <form onSubmit={handleAddManual} className="space-y-4">
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Quick Add Player</p>
            <div className="flex gap-2">
              <input 
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name..."
                className="flex-1 bg-black/40 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all"
              />
              <input 
                type="number"
                value={newRating}
                onChange={(e) => setNewRating(e.target.value)}
                className="w-20 bg-black/40 border border-slate-800 rounded-xl px-4 py-2 text-sm text-emerald-400 focus:outline-none focus:border-emerald-500/50"
              />
              <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Add</button>
            </div>
            
            <div className="pt-4 border-t border-white/5">
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-4">Bulk Import (Sheets)</p>
              <div className="flex gap-2">
                <input 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste Google Sheet CSV URL..."
                  className="flex-1 bg-black/20 border border-slate-800 rounded-xl px-4 py-2 text-[11px] text-slate-400 focus:outline-none focus:border-emerald-500/50"
                />
                <button 
                  type="button"
                  onClick={() => fetchCSV(url)}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  {isSyncing ? '...' : 'Sync'}
                </button>
              </div>
            </div>
          </form>

          {/* Database List */}
          <div className="space-y-4">
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest flex justify-between">
              <span>Saved Squad ({database.length})</span>
              <button onClick={() => saveDatabase([])} className="text-red-500 hover:text-red-400 transition-colors">Clear All</button>
            </p>
            <div className="max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
              <div className="grid grid-cols-1 gap-2">
                {database.length === 0 && <p className="text-slate-700 text-[10px] italic py-8 text-center uppercase font-bold tracking-widest">Vault is empty</p>}
                {database.sort((a,b) => b.rating - a.rating).map(p => (
                  <div key={p.name} className="flex items-center justify-between bg-black/20 hover:bg-black/40 p-2 rounded-lg group transition-all">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black ${p.rating >= 80 ? 'bg-amber-500/20 text-amber-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                        {p.rating}
                      </span>
                      <span className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">{p.name}</span>
                    </div>
                    <button 
                      onClick={() => handleDelete(p.name)}
                      className="text-slate-700 hover:text-red-500 p-1 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatabaseManager;
