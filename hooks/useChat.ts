import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface ChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export function useChat() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Load threads
  const loadThreads = useCallback(async () => {
    if (!supabase || !user) return;

    setIsLoadingThreads(true);
    try {
      const { data, error } = await supabase
        .from('chat_threads')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setThreads(data || []);

      // Auto-select first thread if none selected
      if (data && data.length > 0 && !activeThreadId) {
        setActiveThreadId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      setIsLoadingThreads(false);
    }
  }, [user, activeThreadId]);

  // Load messages for active thread
  const loadMessages = useCallback(async () => {
    if (!supabase || !activeThreadId) {
      setMessages([]);
      return;
    }

    setIsLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('thread_id', activeThreadId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [activeThreadId]);

  // Create new thread
  const createThread = useCallback(async (title?: string): Promise<string | null> => {
    if (!supabase || !user) return null;

    try {
      const { data, error } = await supabase
        .from('chat_threads')
        .insert({
          user_id: user.id,
          title: title || 'New Chat',
        })
        .select()
        .single();

      if (error) throw error;

      setThreads(prev => [data, ...prev]);
      setActiveThreadId(data.id);
      setMessages([]);
      return data.id;
    } catch (err) {
      console.error('Failed to create thread:', err);
      return null;
    }
  }, [user]);

  // Update thread title
  const updateThreadTitle = useCallback(async (threadId: string, title: string) => {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('chat_threads')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', threadId);

      if (error) throw error;

      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, title, updated_at: new Date().toISOString() } : t
      ));
    } catch (err) {
      console.error('Failed to update thread title:', err);
    }
  }, []);

  // Delete thread
  const deleteThread = useCallback(async (threadId: string) => {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('chat_threads')
        .delete()
        .eq('id', threadId);

      if (error) throw error;

      setThreads(prev => prev.filter(t => t.id !== threadId));

      // If deleted active thread, switch to another
      if (activeThreadId === threadId) {
        const remaining = threads.filter(t => t.id !== threadId);
        setActiveThreadId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  }, [activeThreadId, threads]);

  // Add message to current thread
  const addMessage = useCallback(async (role: 'user' | 'assistant', content: string): Promise<ChatMessage | null> => {
    if (!supabase || !activeThreadId) return null;

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          thread_id: activeThreadId,
          role,
          content,
        })
        .select()
        .single();

      if (error) throw error;

      setMessages(prev => [...prev, data]);

      // Update thread's updated_at
      await supabase
        .from('chat_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeThreadId);

      // Auto-title thread from first user message
      const thread = threads.find(t => t.id === activeThreadId);
      if (thread && thread.title === 'New Chat' && role === 'user') {
        const title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
        await updateThreadTitle(activeThreadId, title);
      }

      return data;
    } catch (err) {
      console.error('Failed to add message:', err);
      return null;
    }
  }, [activeThreadId, threads, updateThreadTitle]);

  // Add optimistic message (before API response)
  const addOptimisticMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      thread_id: activeThreadId || '',
      role,
      content,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);
    return optimisticMsg;
  }, [activeThreadId]);

  // Load threads on mount
  useEffect(() => {
    if (user) {
      loadThreads();
    }
  }, [user, loadThreads]);

  // Load messages when active thread changes
  useEffect(() => {
    loadMessages();
  }, [activeThreadId, loadMessages]);

  return {
    threads,
    activeThreadId,
    setActiveThreadId,
    messages,
    isLoadingThreads,
    isLoadingMessages,
    createThread,
    updateThreadTitle,
    deleteThread,
    addMessage,
    addOptimisticMessage,
    loadThreads,
    loadMessages,
  };
}
