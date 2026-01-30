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
  timestamp: Date;
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

interface AICommandCenterProps {
  onPlayersUpdated?: () => void;
  onAssignToField?: (players: AIPlayerResult[]) => void;
  findPlayerByName?: (name: string) => DbPlayer | null;
}

const AICommandCenter: React.FC<AICommandCenterProps> = ({
  onPlayersUpdated,
  onAssignToField,
  findPlayerByName
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [newPlayer, setNewPlayer] = useState<NewPlayerData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, newPlayer]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

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

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && !selectedImage) || isLoading) return;

    // Add user message
    const userMessage: ConversationMessage = {
      role: 'user',
      content: selectedImage ? `[Image] ${trimmedInput || 'Process this image'}` : trimmedInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    setInput('');
    const imageToProcess = selectedImage;
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsLoading(true);
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

        // Use AI to parse both images AND text lists
        // AI extracts first names, handles various formats, limits to 12 players
        if (imageToProcess) {
          playerNames = await parsePlayerNamesWithAI(undefined, imageToProcess.base64, imageToProcess.mimeType);
        } else {
          // Use AI to intelligently extract player names from text
          playerNames = await parsePlayerNamesWithAI(trimmedInput);
        }

        if (playerNames.length > 0 && onAssignToField && findPlayerByName) {
          const balanced = balanceTeams(playerNames, findPlayerByName);
          const allPlayers: AIPlayerResult[] = [
            ...balanced.black.map(p => ({ name: p.name, team: 'black' as const })),
            ...balanced.white.map(p => ({ name: p.name, team: 'white' as const })),
          ];
          onAssignToField(allPlayers);

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✓ ${playerNames.length} players assigned to field\n\n**Black Team** (${balanced.blackTotal}):\n${balanced.black.map(p => p.name).join(', ')}\n\n**White Team** (${balanced.whiteTotal}):\n${balanced.white.map(p => p.name).join(', ')}`,
            timestamp: new Date(),
          }]);
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
      const historyForAPI = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      const formattedHistory = formatConversationHistory(historyForAPI);
      const result = await sendAICommand(trimmedInput, formattedHistory);

      // Check if a player was added and fetch their data for skill editing
      if (isAddingPlayer && result.response?.toLowerCase().includes('added')) {
        // Try various patterns to extract the player name from response
        const nameMatch = result.response.match(/added\s+(\w+)/i) ||
                         result.response.match(/Added[^:]*:\s*([^\n,]+)/i) ||
                         result.response.match(/player\s+(\w+)\s+has\s+been/i) ||
                         result.response.match(/player[:\s]+([^\n,\(]+)/i);

        if (nameMatch && supabase) {
          const playerName = nameMatch[1].trim();
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
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✓ Added ${p.name} (${p.overall_score})\n\nAdjust their skills below:`,
              timestamp: new Date(),
            }]);
            if (onPlayersUpdated) onPlayersUpdated();
            setIsLoading(false);
            return;
          }
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.response || 'Done!',
        timestamp: new Date(),
      }]);

      if (onPlayersUpdated) {
        onPlayersUpdated();
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ ${err instanceof Error ? err.message : 'Something went wrong'}`,
        timestamp: new Date(),
      }]);
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

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✓ ${newPlayer?.name}'s skills updated!`,
      timestamp: new Date(),
    }]);
    setNewPlayer(null);
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

  const clearChat = () => {
    setMessages([]);
    setNewPlayer(null);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-2xl shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center ${isOpen ? 'opacity-0 pointer-events-none' : ''}`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      {/* Chat panel - floating at bottom right */}
      {isOpen && (
        <div
          ref={dropZoneRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-48px)] h-[500px] max-h-[70vh] bg-slate-900 rounded-2xl border border-slate-700/50 shadow-2xl flex flex-col overflow-hidden transition-all ${
            isDragging ? 'ring-2 ring-emerald-500 border-emerald-500' : ''
          }`}
        >
            {/* Drop overlay */}
            {isDragging && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto text-emerald-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-emerald-400 font-bold text-lg">Drop image here</p>
                  <p className="text-slate-500 text-sm mt-1">Screenshot of player list</p>
                </div>
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">AI Command Center</h3>
                  <p className="text-[10px] text-slate-500">Add players, edit ratings, manage lineups</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearChat}
                  className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-500 hover:text-slate-300"
                  title="Clear chat"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && !newPlayer && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-slate-800 mx-auto mb-4 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <p className="text-slate-500 text-sm mb-4">What would you like to do?</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      'Add Mo 75',
                      'List all players',
                      'Show stats',
                    ].map(suggestion => (
                      <button
                        key={suggestion}
                        onClick={() => {
                          setInput(suggestion);
                          textareaRef.current?.focus();
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-full transition-all"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message, i) => (
                <div
                  key={i}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      message.role === 'user'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-800 text-slate-200'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      {selectedImage && (
                        <span className="text-xs text-emerald-400 ml-2">Processing image...</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Skill Editor inline */}
              {newPlayer && (
                <div className="mt-2">
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

              <div ref={messagesEndRef} />
            </div>

            {/* Image preview */}
            {selectedImage && !isLoading && (
              <div className="mx-4 mb-2 flex items-center gap-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-slate-300 flex-1">Image ready</span>
                <button
                  onClick={removeImage}
                  className="text-slate-400 hover:text-red-400 p-1 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Input area */}
            <div className="border-t border-slate-800 p-3">
              <div className="flex items-end gap-2">
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
                <div className="flex-1 bg-slate-800 rounded-xl px-3 py-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Add Mo 75 • Paste names • Upload pic..."
                    disabled={isLoading}
                    rows={1}
                    className="w-full bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none resize-none min-h-[24px] max-h-[120px]"
                  />
                </div>

                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={isLoading || (!input.trim() && !selectedImage)}
                  className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
};

export default AICommandCenter;
