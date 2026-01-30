import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendAICommand, formatConversationHistory } from '../services/aiCommandService';
import { parsePlayerNamesWithAI } from '../services/aiService';
import { balanceTeams } from '../utils/teamBalancer';
import { Player as DbPlayer } from '../types/database';
import { AIPlayerResult } from '../types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  hasImage?: boolean;
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
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hey! I'm your AI assistant for Streamlined Soccer.\n\n**Manage Players:**\n• "Add John, rating 75, midfielder"\n• "Update Ahmed's rating to 80"\n• "Show top 10 players"\n• "Delete inactive players"\n\n**Create Lineups:**\n• Paste a list of names\n• Upload a screenshot\n• "Put these on the field: Ali, Omar, Hassan..."\n\nWhat would you like to do?`,
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && !isMinimized && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

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

  // Check if input looks like a player list
  const looksLikePlayerList = (text: string): boolean => {
    const lines = text.split(/[\n,]/).filter(l => l.trim());
    // If there are multiple short items (likely names), it's probably a list
    if (lines.length >= 3 && lines.every(l => l.trim().length < 30)) {
      return true;
    }
    // Check for keywords that suggest it's a player list
    const listKeywords = ['players:', 'team:', 'lineup:', 'names:', 'list:'];
    if (listKeywords.some(k => text.toLowerCase().includes(k))) {
      return true;
    }
    return false;
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && !selectedImage) || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput || '(Image uploaded)',
      timestamp: new Date(),
      hasImage: !!selectedImage,
    };

    const loadingMessage: Message = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setInput('');
    const imageToProcess = selectedImage;
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsLoading(true);

    try {
      // Check if this is an image or player list that should be assigned to field
      const shouldAssignToField = imageToProcess ||
        looksLikePlayerList(trimmedInput) ||
        trimmedInput.toLowerCase().includes('field') ||
        trimmedInput.toLowerCase().includes('pitch') ||
        trimmedInput.toLowerCase().includes('lineup');

      if (shouldAssignToField && (imageToProcess || looksLikePlayerList(trimmedInput))) {
        // Parse players and assign to field
        let playerNames: string[] = [];

        if (imageToProcess) {
          // Use AI to parse image
          playerNames = await parsePlayerNamesWithAI(undefined, imageToProcess.base64, imageToProcess.mimeType);
        } else {
          // Parse text list
          const lines = trimmedInput.split(/[\n,]/).map(l => l.trim()).filter(l => l && l.length < 30);
          // Clean up common prefixes
          playerNames = lines.map(name => {
            return name
              .replace(/^\d+[\.\)\-\s]+/, '') // Remove numbering like "1." or "1)"
              .replace(/^[-•*]\s*/, '') // Remove bullet points
              .trim();
          }).filter(n => n);
        }

        if (playerNames.length > 0 && onAssignToField && findPlayerByName) {
          // Balance and assign to field
          const balanced = balanceTeams(playerNames, findPlayerByName);
          const allPlayers: AIPlayerResult[] = [
            ...balanced.black.players.map(name => ({ name, team: 'black' as const })),
            ...balanced.white.players.map(name => ({ name, team: 'white' as const })),
          ];
          onAssignToField(allPlayers);

          const assistantMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Done! Assigned ${playerNames.length} players to the field:\n\n**Black Team** (Score: ${balanced.black.totalScore}):\n${balanced.black.players.map(n => `• ${n}`).join('\n')}\n\n**White Team** (Score: ${balanced.white.totalScore}):\n${balanced.white.players.map(n => `• ${n}`).join('\n')}\n\nTeams are balanced by rating and position.`,
            timestamp: new Date(),
          };
          setMessages(prev => prev.filter(m => !m.isLoading).concat(assistantMessage));
          if (onPlayersUpdated) onPlayersUpdated();
          setIsLoading(false);
          return;
        }
      }

      // Regular AI command
      const history = messages
        .filter(m => m.id !== 'welcome' && !m.isLoading)
        .map(m => ({ role: m.role, content: m.content }));

      const formattedHistory = formatConversationHistory(history);
      const response = await sendAICommand(trimmedInput, formattedHistory);

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.response || 'I processed your request.',
        timestamp: new Date(),
      };

      setMessages(prev => prev.filter(m => !m.isLoading).concat(assistantMessage));

      if (onPlayersUpdated) {
        onPlayersUpdated();
      }
    } catch (err) {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => prev.filter(m => !m.isLoading).concat(errorMessage));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
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
  };

  const clearChat = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: `Chat cleared! What would you like to do?`,
        timestamp: new Date(),
      }
    ]);
  };

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-50"
        title="Open AI Assistant"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[10px] font-bold text-black">
          AI
        </span>
      </button>
    );
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 bg-slate-900 border border-slate-700 rounded-full shadow-2xl flex items-center gap-2 px-4 py-2 z-50">
        <span className="text-emerald-400 text-sm font-medium">AI Assistant</span>
        <button
          onClick={() => setIsMinimized(false)}
          className="text-slate-400 hover:text-white p-1"
          title="Expand"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={() => setIsOpen(false)}
          className="text-slate-400 hover:text-red-400 p-1"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  const chatWidth = isExpanded ? 'w-[600px] max-w-[calc(100vw-3rem)]' : 'w-96 max-w-[calc(100vw-3rem)]';
  const chatHeight = isExpanded ? 'h-[700px] max-h-[calc(100vh-3rem)]' : 'h-[500px] max-h-[calc(100vh-6rem)]';

  // Full chat interface
  return (
    <div className={`fixed bottom-6 right-6 ${chatWidth} ${chatHeight} bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden transition-all duration-300`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">AI Command Center</h3>
            <p className="text-slate-400 text-xs">Manage everything • Paste lists • Upload images</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-700 rounded"
            title={isExpanded ? "Shrink" : "Expand"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isExpanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              )}
            </svg>
          </button>
          <button
            onClick={clearChat}
            className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-700 rounded"
            title="Clear chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-700 rounded"
            title="Minimize"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-400 hover:text-red-400 p-1.5 hover:bg-slate-700 rounded"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                message.role === 'user'
                  ? 'bg-emerald-500 text-white rounded-br-md'
                  : 'bg-slate-800 text-slate-100 rounded-bl-md'
              }`}
            >
              {message.isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-slate-400 text-sm">Processing...</span>
                </div>
              ) : (
                <>
                  {message.hasImage && (
                    <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Image attached
                    </div>
                  )}
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Selected image preview */}
      {selectedImage && (
        <div className="px-4 py-2 bg-slate-800/50 border-t border-slate-700">
          <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-2">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm text-slate-300 flex-1">Image ready to process</span>
            <button
              onClick={removeImage}
              className="text-slate-400 hover:text-red-400 p-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-slate-700 bg-slate-800/50">
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
            className="text-slate-400 hover:text-emerald-400 p-2.5 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50"
            title="Upload image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a command or paste player names..."
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 resize-none min-h-[42px] max-h-[120px]"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || (!input.trim() && !selectedImage)}
            className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white p-2.5 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-slate-500 text-xs mt-2 text-center">
          Paste names • Upload screenshots • "Add player" • "Show top 10"
        </p>
      </div>
    </div>
  );
};

export default AICommandCenter;
