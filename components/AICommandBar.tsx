import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendAICommand, formatConversationHistory } from '../services/aiCommandService';
import { parsePlayerNamesWithAI } from '../services/aiService';
import { balanceTeams } from '../utils/teamBalancer';
import { Player as DbPlayer } from '../types/database';
import { AIPlayerResult } from '../types';
import SkillEditor from './SkillEditor';
import { supabase } from '../lib/supabase';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface NewPlayerData {
  id: string;
  name: string;
  overall_score: number;
  shooting: number;
  passing: number;
  ball_control: number;
  playmaking: number;
  defending: number;
  fitness: number;
}

interface AICommandBarProps {
  onPlayersUpdated?: () => void;
  onAssignToField?: (players: AIPlayerResult[]) => void;
  findPlayerByName?: (name: string) => DbPlayer | null;
}

const AICommandBar: React.FC<AICommandBarProps> = ({
  onPlayersUpdated,
  onAssignToField,
  findPlayerByName
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [newPlayer, setNewPlayer] = useState<NewPlayerData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
    }
  }, [input]);

  // Auto-hide response after delay (but not if skill editor is showing)
  useEffect(() => {
    if (response && !newPlayer) {
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
      responseTimeoutRef.current = setTimeout(() => {
        setResponse(null);
        setIsError(false);
      }, 6000);
    }
    return () => {
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
    };
  }, [response, newPlayer]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setSelectedImage({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setSelectedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const looksLikePlayerList = (text: string): boolean => {
    const lines = text.split(/[\n,]/).filter(l => l.trim());
    if (lines.length >= 3 && lines.every(l => l.trim().length < 30)) {
      return true;
    }
    const listKeywords = ['players:', 'team:', 'lineup:', 'names:', 'list:'];
    if (listKeywords.some(k => text.toLowerCase().includes(k))) {
      return true;
    }
    return false;
  };

  // Check if the response indicates a player was added
  const extractNewPlayer = (responseText: string): NewPlayerData | null => {
    // Look for patterns like "Added player: Name" or player data in the response
    const addedMatch = responseText.match(/Added player[:\s]+([^\n]+)/i);
    if (!addedMatch) return null;

    // Try to extract the player name
    const playerInfo = addedMatch[1];
    const nameMatch = playerInfo.match(/^([^,\(]+)/);
    if (!nameMatch) return null;

    const name = nameMatch[1].trim();

    // We'll fetch the actual player from the database
    return null; // Will be handled by checking database after add
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && !selectedImage) || isLoading) return;

    setInput('');
    const imageToProcess = selectedImage;
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsLoading(true);
    setResponse(null);
    setIsError(false);
    setNewPlayer(null);

    try {
      // Check if this is an image or player list that should be assigned to field
      const shouldAssignToField = imageToProcess ||
        looksLikePlayerList(trimmedInput) ||
        trimmedInput.toLowerCase().includes('field') ||
        trimmedInput.toLowerCase().includes('pitch') ||
        trimmedInput.toLowerCase().includes('lineup');

      if (shouldAssignToField && (imageToProcess || looksLikePlayerList(trimmedInput))) {
        let playerNames: string[] = [];

        if (imageToProcess) {
          playerNames = await parsePlayerNamesWithAI(undefined, imageToProcess.base64, imageToProcess.mimeType);
        } else {
          const lines = trimmedInput.split(/[\n,]/).map(l => l.trim()).filter(l => l && l.length < 30);
          playerNames = lines.map(name => {
            return name
              .replace(/^\d+[\.\)\-\s]+/, '')
              .replace(/^[-•*]\s*/, '')
              .trim();
          }).filter(n => n);
        }

        if (playerNames.length > 0 && onAssignToField && findPlayerByName) {
          const balanced = balanceTeams(playerNames, findPlayerByName);
          const allPlayers: AIPlayerResult[] = [
            ...balanced.black.players.map(name => ({ name, team: 'black' as const })),
            ...balanced.white.players.map(name => ({ name, team: 'white' as const })),
          ];
          onAssignToField(allPlayers);

          setResponse(`✓ ${playerNames.length} players assigned • Black ${balanced.black.totalScore} vs White ${balanced.white.totalScore}`);
          if (onPlayersUpdated) onPlayersUpdated();
          setIsLoading(false);
          return;
        }
      }

      // Check if this looks like adding a player
      const isAddingPlayer = /^add\s+/i.test(trimmedInput) ||
        /^new\s+player/i.test(trimmedInput) ||
        /^create\s+/i.test(trimmedInput);

      // Regular AI command
      const formattedHistory = formatConversationHistory(conversationHistory);
      const result = await sendAICommand(trimmedInput, formattedHistory);

      // Update conversation history
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: trimmedInput },
        { role: 'assistant', content: result.response || '' }
      ].slice(-10));

      // Check if a player was added and fetch their data for skill editing
      if (isAddingPlayer && result.response?.toLowerCase().includes('added')) {
        // Extract player name from response
        const nameMatch = result.response.match(/Added[^:]*:\s*([^\n,]+)/i) ||
                         result.response.match(/player[:\s]+([^\n,\(]+)/i);

        if (nameMatch && supabase) {
          const playerName = nameMatch[1].trim();
          // Fetch the newly added player
          const { data: players } = await supabase
            .from('players')
            .select('*')
            .ilike('name', playerName)
            .order('created_at', { ascending: false })
            .limit(1);

          if (players && players.length > 0) {
            const p = players[0];
            setNewPlayer({
              id: p.id,
              name: p.name,
              overall_score: p.overall_score,
              shooting: p.shooting,
              passing: p.passing,
              ball_control: p.ball_control,
              playmaking: p.playmaking,
              defending: p.defending,
              fitness: p.fitness,
            });
            setResponse(`✓ Added ${p.name} (${p.overall_score}) - adjust skills below`);
            if (onPlayersUpdated) onPlayersUpdated();
            setIsLoading(false);
            return;
          }
        }
      }

      setResponse(result.response || 'Done!');

      if (onPlayersUpdated) {
        onPlayersUpdated();
      }
    } catch (err) {
      setIsError(true);
      setResponse(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkillSave = async (playerId: string, skills: {
    shooting: number;
    passing: number;
    ball_control: number;
    playmaking: number;
    defending: number;
    fitness: number;
  }) => {
    if (!supabase) return;

    const { error } = await supabase
      .from('players')
      .update({
        ...skills,
        updated_at: new Date().toISOString(),
      })
      .eq('id', playerId);

    if (error) {
      console.error('Failed to update skills:', error);
      throw error;
    }

    if (onPlayersUpdated) {
      onPlayersUpdated();
    }

    setResponse(`✓ ${newPlayer?.name} skills updated!`);
  };

  const handleSkillDismiss = () => {
    setNewPlayer(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setSelectedImage({ base64, mimeType: file.type });
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  }, []);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setSelectedImage({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Skill Editor for new player */}
      {newPlayer && (
        <div className="mb-4">
          <SkillEditor
            playerName={newPlayer.name}
            playerId={newPlayer.id}
            initialSkills={{
              shooting: newPlayer.shooting,
              passing: newPlayer.passing,
              ball_control: newPlayer.ball_control,
              playmaking: newPlayer.playmaking,
              defending: newPlayer.defending,
              fitness: newPlayer.fitness,
            }}
            onSave={handleSkillSave}
            onDismiss={handleSkillDismiss}
          />
        </div>
      )}

      {/* Response toast (only show if no skill editor) */}
      {response && !newPlayer && (
        <div
          className={`mb-4 p-4 rounded-2xl text-sm font-medium transition-all cursor-pointer ${
            isError
              ? 'bg-red-500/10 border border-red-500/20 text-red-400'
              : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
          }`}
          onClick={() => setResponse(null)}
        >
          <p className="whitespace-pre-wrap">{response}</p>
        </div>
      )}

      {/* Image preview */}
      {selectedImage && (
        <div className={`mb-3 flex items-center gap-3 rounded-xl p-3 border transition-all ${
          isLoading
            ? 'bg-emerald-500/10 border-emerald-500/30 animate-pulse'
            : 'bg-slate-800/50 border-slate-700'
        }`}>
          {isLoading ? (
            <>
              <svg className="w-5 h-5 text-emerald-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm text-emerald-400 flex-1 font-medium">Processing image with AI...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm text-slate-300 flex-1">Image ready - press send</span>
              <button
                onClick={removeImage}
                className="text-slate-400 hover:text-red-400 p-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* Main input bar with drop zone */}
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative bg-slate-900/80 backdrop-blur-sm rounded-2xl border shadow-xl overflow-hidden transition-all ${
          isDragging
            ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/5'
            : 'border-slate-700/50'
        }`}
      >
        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-emerald-400 font-bold">Drop image here</p>
              <p className="text-slate-500 text-xs mt-1">Screenshot of player list</p>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2 p-3">
          {/* Image upload button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="text-slate-500 hover:text-emerald-400 p-2 hover:bg-slate-800 rounded-xl transition-all disabled:opacity-50 flex-shrink-0"
            title="Upload image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Add Mo 75 • Paste names • Upload screenshot..."
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none resize-none min-h-[36px] max-h-[100px] py-2"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={isLoading || (!input.trim() && !selectedImage)}
            className={`p-2 rounded-xl transition-all flex-shrink-0 ${
              isLoading
                ? 'bg-slate-700 text-slate-400'
                : (input.trim() || selectedImage)
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-500'
            }`}
          >
            {isLoading ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            )}
          </button>
        </div>

        {/* Hint text */}
        <div className="px-4 pb-3 flex items-center justify-center gap-4 text-[10px] text-slate-600 font-medium uppercase tracking-wider">
          <span>"Add John 80"</span>
          <span>•</span>
          <span>Paste names</span>
          <span>•</span>
          <span>Upload pic</span>
        </div>
      </div>
    </div>
  );
};

export default AICommandBar;
