/**
 * Message Buffer — Ring buffer for incoming WhatsApp messages
 *
 * Captures ALL incoming messages from Baileys messages.upsert.
 * - Max 200 messages per chat, 100 chats
 * - FIFO eviction when full
 * - Persisted to disk (JSON) on graceful shutdown, loaded on startup
 * - 7-day TTL auto-eviction
 * - Unread tracking: Map<JID, lastReadTimestamp>
 */

import fs from 'fs';
import path from 'path';
import type { BufferedMessage, ChatSummary } from './types.js';

const MAX_MESSAGES_PER_CHAT = 200;
const MAX_CHATS = 100;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface ChatBuffer {
  jid: string;
  name: string;
  isGroup: boolean;
  messages: BufferedMessage[];
  lastActivity: number;
}

interface PersistedState {
  chats: Record<string, ChatBuffer>;
  lastReadTimestamps: Record<string, number>;
  savedAt: string;
}

export class MessageBuffer {
  private chats: Map<string, ChatBuffer> = new Map();
  private lastReadTimestamps: Map<string, number> = new Map();
  private persistPath: string;
  private evictionTimer: NodeJS.Timeout | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private static readonly AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(dataDir: string) {
    this.persistPath = path.join(dataDir, 'message-buffer.json');
    this.load();
    this.startEvictionTimer();
    this.startAutoSave();
  }

  /**
   * Add an incoming message to the buffer
   */
  addMessage(message: BufferedMessage): void {
    let chat = this.chats.get(message.chatJid);

    if (!chat) {
      // Evict oldest chats until under capacity
      while (this.chats.size >= MAX_CHATS) {
        this.evictOldestChat();
      }

      chat = {
        jid: message.chatJid,
        name: message.chatName,
        isGroup: message.chatJid.endsWith('@g.us'),
        messages: [],
        lastActivity: message.timestamp,
      };
      this.chats.set(message.chatJid, chat);
    }

    // Update chat metadata
    chat.name = message.chatName || chat.name;
    chat.lastActivity = Math.max(chat.lastActivity, message.timestamp);

    // FIFO eviction for messages within a chat
    if (chat.messages.length >= MAX_MESSAGES_PER_CHAT) {
      chat.messages.shift();
    }

    chat.messages.push(message);
  }

  /**
   * Get all chats with summary info
   */
  getChats(): ChatSummary[] {
    const summaries: ChatSummary[] = [];

    for (const chat of this.chats.values()) {
      const lastMessage = chat.messages.length > 0
        ? chat.messages[chat.messages.length - 1]
        : null;

      const lastReadTs = this.lastReadTimestamps.get(chat.jid) ?? 0;
      const unreadCount = chat.messages.filter(
        m => !m.isFromMe && m.timestamp > lastReadTs
      ).length;

      summaries.push({
        jid: chat.jid,
        name: chat.name,
        isGroup: chat.isGroup,
        lastMessage,
        unreadCount,
        lastActivity: chat.lastActivity,
      });
    }

    // Sort by last activity (most recent first)
    summaries.sort((a, b) => b.lastActivity - a.lastActivity);
    return summaries;
  }

  /**
   * Get messages for a specific chat
   */
  getMessages(chatJid: string, limit = 50, before?: number): BufferedMessage[] {
    const chat = this.chats.get(chatJid);
    if (!chat) return [];

    let messages = chat.messages;

    if (before) {
      messages = messages.filter(m => m.timestamp < before);
    }

    // Return most recent messages (tail of array)
    return messages.slice(-limit);
  }

  /**
   * Mark a chat as read (all messages up to now)
   */
  markRead(chatJid: string): void {
    this.lastReadTimestamps.set(chatJid, Date.now());
  }

  /**
   * Search messages across all chats or a specific chat
   */
  searchMessages(query: string, chatJid?: string): BufferedMessage[] {
    const lowerQuery = query.toLowerCase();
    const results: BufferedMessage[] = [];

    const chatsToSearch = chatJid
      ? [this.chats.get(chatJid)].filter(Boolean) as ChatBuffer[]
      : Array.from(this.chats.values());

    for (const chat of chatsToSearch) {
      for (const msg of chat.messages) {
        if (msg.text.toLowerCase().includes(lowerQuery)) {
          results.push(msg);
        }
      }
    }

    // Sort by most recent first
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, 100); // Cap at 100 results
  }

  /**
   * Find a message by ID across all chats.
   * Returns the message and its chat context, or null if not found.
   */
  findMessageById(messageId: string): BufferedMessage | null {
    for (const chat of this.chats.values()) {
      const msg = chat.messages.find(m => m.id === messageId);
      if (msg) return msg;
    }
    return null;
  }

  /**
   * Get total unread count across all chats
   */
  getUnreadCount(): number {
    let total = 0;
    for (const chat of this.chats.values()) {
      const lastReadTs = this.lastReadTimestamps.get(chat.jid) ?? 0;
      total += chat.messages.filter(
        m => !m.isFromMe && m.timestamp > lastReadTs
      ).length;
    }
    return total;
  }

  /**
   * Persist buffer to disk
   */
  save(): void {
    try {
      const state: PersistedState = {
        chats: Object.fromEntries(this.chats),
        lastReadTimestamps: Object.fromEntries(this.lastReadTimestamps),
        savedAt: new Date().toISOString(),
      };

      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Atomic write: write to .tmp first, then rename
      const tmpPath = `${this.persistPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(state));
      fs.renameSync(tmpPath, this.persistPath);
      console.log(`[Buffer] Saved ${this.chats.size} chats to disk`);
    } catch (error) {
      console.error('[Buffer] Failed to save:', error);
    }
  }

  /**
   * Load buffer from disk
   */
  private load(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;

      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const state = JSON.parse(raw) as Partial<PersistedState>;

      if (!state.chats || typeof state.chats !== 'object') return;

      const chatEntries = Object.entries(state.chats);
      // Enforce MAX_CHATS — only load the most recent chats
      const sorted = chatEntries
        .filter(([, chat]) => chat && Array.isArray(chat.messages) && typeof chat.lastActivity === 'number')
        .sort(([, a], [, b]) => b.lastActivity - a.lastActivity)
        .slice(0, MAX_CHATS);

      for (const [jid, chat] of sorted) {
        // Enforce MAX_MESSAGES_PER_CHAT per chat
        if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
          chat.messages = chat.messages.slice(-MAX_MESSAGES_PER_CHAT);
        }
        this.chats.set(jid, chat);
      }

      if (state.lastReadTimestamps && typeof state.lastReadTimestamps === 'object') {
        for (const [jid, ts] of Object.entries(state.lastReadTimestamps)) {
          if (typeof ts === 'number') {
            this.lastReadTimestamps.set(jid, ts);
          }
        }
      }

      // Evict expired messages immediately after load
      this.evictExpired();

      console.log(`[Buffer] Loaded ${this.chats.size} chats from disk`);
    } catch (error) {
      console.error('[Buffer] Failed to load:', error);
    }
  }

  /**
   * Evict messages older than 7 days
   */
  private evictExpired(): void {
    const cutoff = Date.now() - TTL_MS;

    for (const [jid, chat] of this.chats) {
      chat.messages = chat.messages.filter(m => m.timestamp > cutoff);

      // Remove empty chats and their read timestamps
      if (chat.messages.length === 0) {
        this.chats.delete(jid);
        this.lastReadTimestamps.delete(jid);
      }
    }
  }

  /**
   * Remove the oldest chat (by last activity)
   */
  private evictOldestChat(): void {
    let oldestJid: string | null = null;
    let oldestTime = Infinity;

    for (const [jid, chat] of this.chats) {
      if (chat.lastActivity < oldestTime) {
        oldestTime = chat.lastActivity;
        oldestJid = jid;
      }
    }

    if (oldestJid) {
      this.chats.delete(oldestJid);
      this.lastReadTimestamps.delete(oldestJid);
    }
  }

  /**
   * Start periodic eviction of expired messages
   */
  private startEvictionTimer(): void {
    // Run eviction every hour
    this.evictionTimer = setInterval(() => this.evictExpired(), 60 * 60 * 1000);
    this.evictionTimer.unref(); // Don't keep process alive just for eviction
  }

  /**
   * Start periodic auto-save (every 5 minutes)
   */
  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      if (this.chats.size > 0) {
        this.save();
      }
    }, MessageBuffer.AUTO_SAVE_INTERVAL_MS);
    this.autoSaveTimer.unref(); // Don't keep process alive just for auto-save
  }

  /**
   * Clean shutdown
   */
  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    this.save();
  }
}
