import React, { useState, useRef } from 'react';
import { AIPlayerResult } from '../types';
import { Player } from '../types/database';
import { parsePlayerNamesWithAI } from '../services/aiService';
import { balanceTeams, formatTeamBalance } from '../utils/teamBalancer';

interface AIImporterProps {
  onPlayersFound: (players: AIPlayerResult[]) => void;
  findPlayerByName: (name: string) => Player | null;
}

const AIImporter: React.FC<AIImporterProps> = ({ onPlayersFound, findPlayerByName }) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balanceInfo, setBalanceInfo] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setError(null);
        setBalanceInfo(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const processWithAI = async () => {
    setIsProcessing(true);
    setError(null);
    setBalanceInfo(null);

    try {
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;

      if (image) {
        // Extract base64 and mime type from data URL
        const [header, base64] = image.split(',');
        imageBase64 = base64;
        const mimeMatch = header.match(/data:([^;]+)/);
        imageMimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      }

      // Get player names from AI
      const playerNames = await parsePlayerNamesWithAI(
        input || undefined,
        imageBase64,
        imageMimeType
      );

      if (playerNames.length === 0) {
        throw new Error('No players found in the input');
      }

      // Balance teams based on ratings and positions
      const teams = balanceTeams(playerNames, findPlayerByName);

      // Convert to AIPlayerResult format
      const result: AIPlayerResult[] = [
        ...teams.black.map(p => ({ name: p.name, team: 'black' as const })),
        ...teams.white.map(p => ({ name: p.name, team: 'white' as const })),
      ];

      // Show balance info
      setBalanceInfo(formatTeamBalance(teams));

      onPlayersFound(result);
      setInput('');
      setImage(null);
    } catch (err) {
      console.error('AI Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to parse names';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full bg-slate-900/60 backdrop-blur-xl border border-emerald-500/20 rounded-3xl p-6 mb-8 shadow-2xl relative overflow-hidden group">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 blur-[100px] pointer-events-none group-hover:bg-emerald-500/20 transition-all duration-700" />

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-black text-white italic uppercase tracking-tighter flex items-center gap-2">
              <svg className="w-6 h-6 text-emerald-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Smart Chrono-Sync
            </h3>
            {image && (
              <button onClick={() => setImage(null)} className="text-xs font-bold text-red-400 uppercase tracking-widest hover:text-red-300">
                Clear Image
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {balanceInfo && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <p className="text-sm text-emerald-400 font-medium">{balanceInfo}</p>
            </div>
          )}

          {!image ? (
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
                setBalanceInfo(null);
              }}
              placeholder="Paste group chat list or drag screenshot here..."
              className="w-full h-32 bg-slate-950/50 border-2 border-slate-800 rounded-2xl p-4 text-slate-200 text-sm focus:border-emerald-500/50 focus:outline-none transition-all resize-none placeholder:text-slate-600 font-medium"
            />
          ) : (
            <div className="relative w-full h-32 rounded-2xl overflow-hidden border-2 border-emerald-500/30">
               <img src={image} className="w-full h-full object-cover opacity-50 grayscale" alt="Uploaded source" />
               <div className="absolute inset-0 flex items-center justify-center">
                 <span className="text-emerald-400 font-black uppercase text-xs tracking-widest bg-black/60 px-4 py-2 rounded-full backdrop-blur-sm">Image Ready for Sorting</span>
               </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full md:w-auto self-stretch justify-end">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border border-slate-700 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Upload Screenshot
          </button>

          <button
            onClick={processWithAI}
            disabled={isProcessing || (!input && !image)}
            className={`w-full px-8 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-xl ${
              isProcessing || (!input && !image)
              ? 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-50'
              : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:scale-[1.02] active:scale-95 shadow-emerald-500/20 border-b-4 border-emerald-800'
            }`}
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                Balancing Teams...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                Auto-Split Teams
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIImporter;
