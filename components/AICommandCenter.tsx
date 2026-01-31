import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendAICommand, formatConversationHistory } from '../services/aiCommandService';
import { parsePlayerNamesWithAI } from '../services/aiService';
import { balanceTeams } from '../utils/teamBalancer';
import { Player as DbPlayer } from '../types/database';
import { AIPlayerResult } from '../types';
import SkillEditor from './SkillEditor';
import { supabase } from '../lib/supabase';
import { useChat, ChatThread, ChatMessage } from '../hooks/useChat';

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
  const [showThreads, setShowThreads] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [newPlayer, setNewPlayer] = useState<NewPlayerData | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    messages,
    createThread,
    deleteThread,
    addMessage,
  } = useChat();

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

    // Create thread if none exists
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = await createThread();
      if (!threadId) return;
    }

    // Add user message
    const userContent = selectedImage ? `[Image] ${trimmedInput || 'Process this image'}` : trimmedInput;
    await addMessage('user', userContent);

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

        if (imageToProcess) {
          playerNames = await parsePlayerNamesWithAI(undefined, imageToProcess.base64, imageToProcess.mimeType);
        } else {
          playerNames = await parsePlayerNamesWithAI(trimmedInput);
        }

        if (playerNames.length > 0 && onAssignToField && findPlayerByName) {
          const balanced = balanceTeams(playerNames, findPlayerByName);
          const allPlayers: AIPlayerResult[] = [
            ...balanced.black.map(p => ({ name: p.name, team: 'black' as const })),
            ...balanced.white.map(p => ({ name: p.name, team: 'white' as const })),
          ];
          onAssignToField(allPlayers);

          await addMessage('assistant', `✓ ${playerNames.length} players assigned to field\n\nBlack (${balanced.blackTotal}): ${balanced.black.map(p => p.name).join(', ')}\n\nWhite (${balanced.whiteTotal}): ${balanced.white.map(p => p.name).join(', ')}`);
          if (onPlayersUpdated) onPlayersUpdated();
          setIsLoading(false);
          return;
        }
      }

      // Check if this looks like adding a player
      const isAddingPlayer = /^add\s+/i.test(trimmedInput) ||
        /^new\s+player/i.test(trimmedInput) ||
        /^create\s+/i.test(trimmedInput);

      // Get recent messages for context
      const recentMessages = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));
      const formattedHistory = formatConversationHistory(recentMessages);
      const result = await sendAICommand(trimmedInput, formattedHistory);

      // Check if a player was added and fetch their data for skill editing
      if (isAddingPlayer && result.response?.toLowerCase().includes('added')) {
        const nameMatch = result.response.match(/added\s+player\s+(.+?)\s+with/i) ||
                         result.response.match(/added\s+(.+?)\s+with/i) ||
                         result.response.match(/player\s+(.+?)\s+has\s+been/i) ||
                         result.response.match(/Added[^:]*:\s*([^\n,]+)/i);

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
            await addMessage('assistant', `✓ Added ${p.name} (${p.overall_score})\n\nAdjust skills below:`);
            if (onPlayersUpdated) onPlayersUpdated();
            setIsLoading(false);
            return;
          }
        }
      }

      await addMessage('assistant', result.response || 'Done!');

      if (onPlayersUpdated) {
        onPlayersUpdated();
      }
    } catch (err) {
      await addMessage('assistant', `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`);
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

    await addMessage('assistant', `✓ ${newPlayer?.name}'s skills saved!`);
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

  const handleNewChat = async () => {
    await createThread();
    setShowThreads(false);
  };

  const handleSelectThread = (thread: ChatThread) => {
    setActiveThreadId(thread.id);
    setShowThreads(false);
  };

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (confirm('Delete this chat?')) {
      await deleteThread(threadId);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Toggle button when closed */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      )}

      {/* Side panel */}
      {isOpen && (
        <div
          ref={dropZoneRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`fixed top-0 right-0 z-50 w-full sm:w-96 h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col transition-all ${
            isDragging ? 'ring-2 ring-inset ring-emerald-500' : ''
          }`}
        >
          {/* Drop overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/95">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-emerald-400 font-medium">Drop image here</p>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <button
                onClick={() => setShowThreads(!showThreads)}
                className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <span className="text-sm font-medium text-white truncate max-w-[180px]">
                  {threads.find(t => t.id === activeThreadId)?.title || 'New Chat'}
                </span>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${showThreads ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <button
              onClick={handleNewChat}
              className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-emerald-400"
              title="New chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Thread list dropdown */}
          {showThreads && (
            <div className="border-b border-slate-800 bg-slate-800/50 max-h-64 overflow-y-auto">
              {threads.length === 0 ? (
                <div className="px-4 py-6 text-center text-slate-500 text-sm">
                  No chats yet
                </div>
              ) : (
                threads.map(thread => (
                  <div
                    key={thread.id}
                    onClick={() => handleSelectThread(thread)}
                    className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${
                      thread.id === activeThreadId ? 'bg-emerald-500/10 border-l-2 border-emerald-500' : 'hover:bg-slate-800 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{thread.title}</div>
                      <div className="text-[10px] text-slate-500">{formatDate(thread.updated_at)}</div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteThread(e, thread.id)}
                      className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && !newPlayer && (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-full bg-slate-800 mx-auto mb-3 flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className="text-slate-500 text-sm mb-3">Start a conversation</p>
                <div className="flex flex-wrap gap-1.5 justify-center px-4">
                  {['Add Mo 75', 'List players', 'Show stats'].map(s => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-full transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 rounded-2xl px-4 py-2.5">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

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
          {selectedImage && (
            <div className="mx-4 mb-2 flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-slate-300 flex-1">Image ready</span>
              <button onClick={removeImage} className="text-slate-400 hover:text-red-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-slate-800 bg-slate-900">
            <div className="flex items-end gap-2">
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
                className="p-2 text-slate-500 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>

              <div className="flex-1 bg-slate-800 rounded-xl px-3 py-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Message..."
                  disabled={isLoading}
                  rows={1}
                  className="w-full bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none resize-none min-h-[24px] max-h-[120px]"
                />
              </div>

              <button
                onClick={handleSend}
                disabled={isLoading || (!input.trim() && !selectedImage)}
                className={`p-2 rounded-lg transition-colors ${
                  isLoading || (!input.trim() && !selectedImage)
                    ? 'bg-slate-800 text-slate-500'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AICommandCenter;
