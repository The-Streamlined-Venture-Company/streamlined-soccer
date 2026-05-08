/**
 * WhatsApp Client — Baileys WebSocket connection to WhatsApp
 *
 * Ported from streamlined-messaging/src/whatsapp.ts (810 lines → ~350 lines).
 * Stripped: poll confirmation, AI chat routing, verification reply handling, terminal QR.
 * Kept: Baileys setup, lifecycle, keepalive, reconnection, group fetching, send, message forwarding.
 */

import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  getAggregateVotesInPollMessage,
  updateMessageWithPollUpdate,
  decryptPollVote,
  getKeyAuthor,
  isLidUser,
  jidNormalizedUser,
  proto,
  type WASocket,
  type WAMessageKey,
} from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import type {
  BufferedMessage,
  MessageType,
  PollResultData,
  OnMessageCallback,
  OnQRCallback,
  OnConnectionCallback,
  ConnectionState,
} from './types.js';

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private isConnected = false;
  private fullyInitialized = false;
  private phoneNumber: string | null = null;

  // Group cache
  private allGroups: Map<string, string> = new Map(); // JID → name
  private groupNameToJid: Map<string, string> = new Map(); // lowercase name → JID

  // LID ↔ Phone mapping (WhatsApp Linked Identity resolution)
  private lidToPhone: Map<string, string> = new Map(); // LID number → phone number
  private phoneToLid: Map<string, string> = new Map(); // phone number → LID number

  // Push-name cache (jid → display name). Populated from inbound messages —
  // used by /groups/:jid/participants for member-matching UIs.
  private pushNameByJid: Map<string, string> = new Map();
  private static readonly MAX_PUSH_NAME_CACHE = 2000;

  // Connection health
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private lastSuccessfulOperation: number = Date.now();
  /** Timestamp of last inbound Baileys event (connection update, message, contact).
   *  If this goes stale while "connected", the socket is zombie (read-dead). */
  private lastInboundEvent: number = Date.now();
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private intentionalDisconnect = false;
  private outerRetryTimer: NodeJS.Timeout | null = null;
  private static readonly KEEPALIVE_INTERVAL_MS = 30_000;
  private static readonly STALE_CONNECTION_THRESHOLD_MS = 60_000;
  /** If no inbound Baileys event for this long while "connected", force refresh.
   *  Healthy connections emit connection.update every ~15-30s. */
  private static readonly INBOUND_STALE_THRESHOLD_MS = 90_000;
  /** Max immediate reconnect attempts with exponential backoff (3s → 6s → 12s
   *  → 24s → 48s → capped at 60s). After this we drop into the OUTER retry
   *  loop below — a slow heartbeat that retries indefinitely, so the relay
   *  recovers on its own when WhatsApp comes back, no manual scan needed. */
  private static readonly MAX_RECONNECT_ATTEMPTS = 30;
  private static readonly RECONNECT_DELAY_CAP_MS = 60_000;
  /** Outer-loop retry interval for when MAX_RECONNECT_ATTEMPTS is exhausted.
   *  Keeps trying every 5 minutes forever until either the connection comes
   *  back, intentionalDisconnect is called, or the user re-pairs via QR. */
  private static readonly OUTER_RETRY_INTERVAL_MS = 5 * 60_000;

  // Message retry system
  private msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
  private messageStore = new Map<string, proto.IWebMessageInfo>();
  private static readonly MAX_MESSAGE_STORE_SIZE = 1000;

  // Poll tracking — separate store so polls survive general message eviction
  private pollMessages = new Map<string, proto.IWebMessageInfo>(); // messageId → full WAMessage
  private static readonly MAX_POLL_STORE_SIZE = 200;

  // Callbacks
  private onMessageCallback: OnMessageCallback | null = null;
  private onQRCallback: OnQRCallback | null = null;
  private onConnectionCallback: OnConnectionCallback | null = null;

  // Config
  private authDir: string;
  private pollPersistPath: string;

  constructor(dataDir: string) {
    this.authDir = path.join(dataDir, 'auth_info');
    this.pollPersistPath = path.join(dataDir, 'poll-store.json');
    this.loadPolls();
  }

  // ── Callbacks ────────────────────────────────────────────────────────────

  onMessage(callback: OnMessageCallback): void {
    this.onMessageCallback = callback;
  }

  onQR(callback: OnQRCallback): void {
    this.onQRCallback = callback;
  }

  onConnection(callback: OnConnectionCallback): void {
    this.onConnectionCallback = callback;
  }

  /** Mark that we received data from the socket — resets zombie detection */
  private touchInbound(): void {
    this.lastInboundEvent = Date.now();
  }

  // ── Connect ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    // Only reset attempts on a fresh user-initiated connect (not internal reconnect calls)
    if (!this.isReconnecting) {
      this.reconnectAttempts = 0;
    }
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const logger = pino({ level: 'warn' });

    // Fetch latest WhatsApp Web version
    let version: [number, number, number] | undefined;
    try {
      const { version: latestVersion } = await fetchLatestBaileysVersion();
      version = latestVersion;
      console.log('[WhatsApp] Using version:', version.join('.'));
    } catch {
      console.log('[WhatsApp] Could not fetch latest version, using default');
    }

    this.socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['Streamlined', 'Chrome', '3.0.0'],
      version,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      msgRetryCounterCache: this.msgRetryCounterCache,
      getMessage: async (key: WAMessageKey): Promise<proto.IMessage | undefined> => {
        const msgId = key.id;
        if (!msgId) return undefined;
        // Check pollMessages too — polls may be evicted from general store before votes arrive
        const msg = this.messageStore.get(msgId) || this.pollMessages.get(msgId);
        const found = !!msg;
        const hasPollCreation = !!(msg?.message?.pollCreationMessage || msg?.message?.pollCreationMessageV3);
        if (hasPollCreation) {
          console.log(`[WhatsApp] getMessage(${msgId?.slice(0, 12)}): found=${found}, isPoll=${hasPollCreation}`);
        }
        return msg?.message || undefined;
      },
    });

    // Handle WebSocket errors
    if (this.socket.ws && typeof (this.socket.ws as { on?: unknown }).on === 'function') {
      (this.socket.ws as NodeJS.EventEmitter).on('error', (err: Error) => {
        console.error('[WhatsApp] WebSocket error:', err.message);
      });
    }

    this.socket.ev.on('creds.update', saveCreds);

    // Store sent messages for retry system + capture poll creation messages
    this.socket.ev.on('messages.upsert', ({ messages }) => {
      this.touchInbound();
      for (const msg of messages) {
        if (!msg.key.id) continue;

        this.messageStore.set(msg.key.id, msg);
        while (this.messageStore.size > WhatsAppClient.MAX_MESSAGE_STORE_SIZE) {
          const oldestKey = this.messageStore.keys().next().value;
          if (oldestKey) this.messageStore.delete(oldestKey);
          else break;
        }

        // Track poll creation messages separately for vote aggregation
        const isPoll = msg.message?.pollCreationMessage
          || msg.message?.pollCreationMessageV2
          || msg.message?.pollCreationMessageV3;
        if (isPoll) {
          this.pollMessages.set(msg.key.id, msg);
          while (this.pollMessages.size > WhatsAppClient.MAX_POLL_STORE_SIZE) {
            const oldestPoll = this.pollMessages.keys().next().value;
            if (oldestPoll) this.pollMessages.delete(oldestPoll);
            else break;
          }
          console.log(`[WhatsApp] Tracked poll: ${msg.key.id} (${this.pollMessages.size} total)`);
        }

        // Manual poll vote decryption — Baileys 6.x has this code commented out
        // in process-message.js, so we replicate it here to capture poll votes.
        const pollUpdate = msg.message?.pollUpdateMessage;
        if (pollUpdate) {
          try {
            const creationMsgKey = pollUpdate.pollCreationMessageKey;
            if (!creationMsgKey?.id) continue;

            // Look up the poll creation message (has the encryption key)
            const pollMsg = this.pollMessages.get(creationMsgKey.id);
            if (!pollMsg) {
              console.log(`[WhatsApp] Poll vote for unknown poll ${creationMsgKey.id?.slice(0, 12)}, skipping`);
              continue;
            }

            const pollEncKey = pollMsg.message?.messageContextInfo?.messageSecret;
            if (!pollEncKey) {
              console.warn(`[WhatsApp] Poll ${creationMsgKey.id?.slice(0, 12)} missing messageSecret, cannot decrypt vote`);
              continue;
            }

            const meId = this.socket?.user?.id;
            if (!meId) continue;

            const meIdNormalised = jidNormalizedUser(meId);
            const pollCreatorJid = getKeyAuthor(creationMsgKey, meIdNormalised);
            const voterJid = getKeyAuthor(msg.key, meIdNormalised);

            const vote = decryptPollVote(
              pollUpdate.vote!,
              {
                pollEncKey,
                pollCreatorJid,
                pollMsgId: creationMsgKey.id!,
                voterJid,
              },
            );

            // Accumulate the decrypted vote on the stored poll message
            updateMessageWithPollUpdate(pollMsg, {
              pollUpdateMessageKey: msg.key,
              vote,
              senderTimestampMs: pollUpdate.senderTimestampMs
                ? Number(pollUpdate.senderTimestampMs)
                : Date.now(),
            });

            const selectedCount = vote?.selectedOptions?.length ?? 0;
            console.log(`[WhatsApp] Poll vote decrypted: ${voterJid?.slice(0, 12)} voted for ${selectedCount} option(s) on poll ${creationMsgKey.id?.slice(0, 12)}`);
          } catch (err) {
            console.warn('[WhatsApp] Failed to decrypt poll vote:', err instanceof Error ? err.message : err);
          }
        }
      }
    });

    // Listen for poll vote updates (messages.update carries decrypted votes)
    this.socket.ev.on('messages.update', (updates) => {
      this.touchInbound();
      console.log(`[WhatsApp] messages.update: ${updates.length} updates`, updates.map(u => ({
        id: u.key?.id?.slice(0, 12),
        hasPollUpdates: !!u.update?.pollUpdates,
        updateKeys: u.update ? Object.keys(u.update) : [],
      })));
      for (const { key, update } of updates) {
        if (!update.pollUpdates || !key.id) continue;

        const pollMsg = this.pollMessages.get(key.id);
        if (!pollMsg) {
          // Vote for a poll we don't have stored — likely created before relay started
          console.log(`[WhatsApp] Poll vote for unknown poll ${key.id}, skipping`);
          continue;
        }

        // Accumulate each vote update on the original message (Baileys utility)
        for (const pollUpdate of update.pollUpdates) {
          updateMessageWithPollUpdate(pollMsg, pollUpdate);
        }
        console.log(`[WhatsApp] Poll vote(s) received for ${key.id} (${update.pollUpdates.length} updates)`);
      }
    });

    // LID ↔ Phone mapping: track contact upserts to build bidirectional mapping
    this.socket.ev.on('contacts.upsert', (contacts: Array<{ id: string; jid?: string; lid?: string }>) => {
      this.touchInbound();
      for (const contact of contacts) {
        this.indexContactLid(contact);
      }
    });

    // Direct phone number share events (most reliable LID mapping source)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Baileys types don't export this event
    (this.socket.ev as { on: (event: string, cb: (data: { lid: string; jid: string }) => void) => void }).on(
      'chats.phoneNumberShare',
      (data: { lid: string; jid: string }) => {
        if (data.lid && data.jid) {
          const lid = data.lid.split('@')[0];
          const phone = data.jid.split('@')[0];
          this.lidToPhone.set(lid, phone);
          this.phoneToLid.set(phone, lid);
          console.log(`[WhatsApp] Phone share: LID ${lid.slice(0, 4)}*** → phone ${phone.slice(0, 4)}***`);
        }
      },
    );

    // History sync also provides contacts with both JID and LID
    this.socket.ev.on('messaging-history.set', (data: { contacts?: Array<{ id: string; jid?: string; lid?: string }> }) => {
      if (data.contacts) {
        for (const contact of data.contacts) {
          this.indexContactLid(contact);
        }
      }
    });

    // Connection lifecycle
    this.socket.ev.on('connection.update', async (update) => {
      this.touchInbound();
      const { connection, lastDisconnect, qr } = update;

      console.log('[WhatsApp] Connection update:', JSON.stringify({
        connection,
        hasQr: !!qr,
        error: lastDisconnect?.error?.message,
      }));

      if (qr) {
        this.emitConnectionState('qr-pending');
        this.onQRCallback?.(qr);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.stopKeepalive();
        this.isConnected = false;
        this.emitConnectionState('disconnected');

        console.log('[WhatsApp] Connection closed:', lastDisconnect?.error?.message, 'Code:', statusCode);

        // User explicitly called disconnect() — don't auto-reconnect
        if (this.intentionalDisconnect) {
          console.log('[WhatsApp] Intentional disconnect — not reconnecting');
          return;
        }

        // Guard: don't stack reconnect calls
        if (this.isReconnecting) {
          console.log('[WhatsApp] Already reconnecting, skipping');
          return;
        }

        // All reconnect paths share the same attempt counter
        this.reconnectAttempts++;
        if (this.reconnectAttempts > WhatsAppClient.MAX_RECONNECT_ATTEMPTS) {
          console.error(`[WhatsApp] Max immediate reconnect attempts (${WhatsAppClient.MAX_RECONNECT_ATTEMPTS}) reached. Falling back to slow outer retry every ${WhatsAppClient.OUTER_RETRY_INTERVAL_MS / 60_000}min until WhatsApp recovers or user re-pairs.`);
          this.emitConnectionState('disconnected');
          this.scheduleOuterRetry();
          return;
        }

        if (shouldReconnect && statusCode !== 408) {
          // Transient error (515 restart, network blip) — reconnect with backoff
          this.isReconnecting = true;
          this.emitConnectionState('reconnecting');
          const exp = 3000 * Math.pow(2, this.reconnectAttempts - 1);
          const delay = Math.min(exp, WhatsAppClient.RECONNECT_DELAY_CAP_MS);
          console.log(`[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${WhatsAppClient.MAX_RECONNECT_ATTEMPTS})...`);
          this.fullyInitialized = false;
          try {
            if (this.socket) {
              try { this.socket.end(undefined); } catch { /* ignore */ }
              this.socket = null;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            await this.connect();
          } finally {
            this.isReconnecting = false;
          }
        } else if (statusCode === 408) {
          // QR timed out — restart to generate a new QR
          this.isReconnecting = true;
          console.log(`[WhatsApp] QR code timed out (attempt ${this.reconnectAttempts}/${WhatsAppClient.MAX_RECONNECT_ATTEMPTS}). Restarting...`);
          try {
            if (this.socket) {
              try { this.socket.end(undefined); } catch { /* ignore */ }
              this.socket = null;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.connect();
          } finally {
            this.isReconnecting = false;
          }
        } else {
          // Logged out (401) — wipe auth state and start fresh (will generate new QR)
          console.log(`[WhatsApp] Logged out (attempt ${this.reconnectAttempts}/${WhatsAppClient.MAX_RECONNECT_ATTEMPTS}). Deleting auth state...`);
          this.isReconnecting = true;
          try {
            if (this.socket) {
              try { this.socket.end(undefined); } catch { /* ignore */ }
              this.socket = null;
            }
            if (fs.existsSync(this.authDir)) {
              const files = fs.readdirSync(this.authDir);
              for (const file of files) {
                try { fs.unlinkSync(path.join(this.authDir, file)); } catch { /* ignore */ }
              }
              console.log(`[WhatsApp] Cleared ${files.length} auth files`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.connect();
          } finally {
            this.isReconnecting = false;
          }
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastSuccessfulOperation = Date.now();
        // Cancel any pending outer-retry timer — we're back online.
        if (this.outerRetryTimer) {
          clearTimeout(this.outerRetryTimer);
          this.outerRetryTimer = null;
        }

        // Clear QR
        this.onQRCallback?.(null);

        console.log('[WhatsApp] Connected! Waiting for sync (5s)...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Send presence
        try {
          await this.socket?.sendPresenceUpdate('available');
          this.lastSuccessfulOperation = Date.now();
        } catch (e) {
          console.warn('[WhatsApp] Failed to send initial presence:', e);
        }

        // Extract phone number from credentials
        this.phoneNumber = state.creds.me?.id?.split(':')[0]?.split('@')[0] ?? null;

        // Fetch all groups
        await this.fetchGroups();

        // Start keepalive
        this.startKeepalive();
        this.fullyInitialized = true;
        this.emitConnectionState('connected');
        console.log('[WhatsApp] Fully initialized and ready!');
      }
    });

    // Forward incoming messages to buffer
    this.socket.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      if (type !== 'notify') return;

      for (const msg of msgs) {
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          '';

        const chatJid = msg.key.remoteJid || '';
        const isGroup = chatJid.endsWith('@g.us');
        const chatName = isGroup
          ? (this.allGroups.get(chatJid) || chatJid)
          : (msg.pushName || chatJid);

        // Determine message type
        let messageType: MessageType = 'text';
        if (msg.message?.pollCreationMessage || msg.message?.pollCreationMessageV2 || msg.message?.pollCreationMessageV3) {
          messageType = 'poll';
        } else if (msg.message?.imageMessage) {
          messageType = 'image';
        } else if (msg.message?.reactionMessage) {
          messageType = 'reaction';
        } else if (!text && msg.message) {
          messageType = 'other';
        }

        const senderJid = msg.key.participant || msg.key.remoteJid || '';
        // Cache push name for the sender so member-matching UIs can show real names
        if (senderJid && msg.pushName && !msg.key.fromMe) {
          if (this.pushNameByJid.size >= WhatsAppClient.MAX_PUSH_NAME_CACHE) {
            // Simple FIFO eviction — drop oldest insertion order
            const firstKey = this.pushNameByJid.keys().next().value;
            if (firstKey) this.pushNameByJid.delete(firstKey);
          }
          this.pushNameByJid.set(senderJid, msg.pushName);
        }

        const buffered: BufferedMessage = {
          id: msg.key.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          chatJid,
          chatName,
          senderJid,
          senderName: msg.pushName || '',
          text,
          timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
          isFromMe: msg.key.fromMe ?? false,
          type: messageType,
        };

        this.onMessageCallback?.(buffered);
      }
    });
  }

  // ── Groups ───────────────────────────────────────────────────────────────

  private async fetchGroups(): Promise<void> {
    if (!this.socket) return;

    try {
      const groups = await this.socket.groupFetchAllParticipating();

      this.allGroups.clear();
      this.groupNameToJid.clear();

      for (const [jid, metadata] of Object.entries(groups)) {
        this.allGroups.set(jid, metadata.subject);
        this.groupNameToJid.set(metadata.subject.toLowerCase(), jid);
      }

      console.log(`[WhatsApp] Fetched ${this.allGroups.size} groups`);
    } catch (error) {
      console.error('[WhatsApp] Error fetching groups:', error);
    }
  }

  getGroups(): Array<{ jid: string; name: string }> {
    return Array.from(this.allGroups.entries()).map(([jid, name]) => ({ jid, name }));
  }

  findGroupJid(groupName: string): string | null {
    // Exact match only — partial matching is a security risk (wrong group delivery)
    return this.groupNameToJid.get(groupName.toLowerCase()) ?? null;
  }

  /** Re-fetch groups from WhatsApp (useful when groups change) */
  async refreshGroups(): Promise<void> {
    await this.fetchGroups();
  }

  /**
   * Fetch the participants of a WhatsApp group with as much identity as we have.
   *
   * For each participant we surface:
   *  - `id`: stable JID Baileys uses to address them (could be `@s.whatsapp.net` or `@lid`)
   *  - `phoneNumber`: digits only, where derivable. With LID-only members this can be empty.
   *  - `pushName`: WhatsApp display name, from our cache of inbound messages
   *  - `isAdmin`: whether they're an admin/super-admin in the group
   *
   * Note: profile picture URLs are intentionally omitted here — fetching them
   * requires one round-trip per member which is slow. The matching UI can
   * lazy-load them per-member if needed.
   */
  async getGroupParticipants(chatJid: string): Promise<Array<{
    id: string;
    phoneNumber: string;
    pushName: string;
    isAdmin: boolean;
  }> | null> {
    if (!this.socket) return null;
    if (!chatJid.endsWith('@g.us')) return null;
    try {
      const meta = await this.socket.groupMetadata(chatJid);
      const participants = meta.participants ?? [];
      return participants.map(p => {
        const id = p.id || '';
        // Phone number: derive from the @s.whatsapp.net side, or look up via our LID cache
        let phoneNumber = '';
        if (id.endsWith('@s.whatsapp.net')) {
          phoneNumber = id.split('@')[0] || '';
        } else if (id.endsWith('@lid')) {
          const lidNumber = id.split('@')[0] || '';
          phoneNumber = this.lidToPhone.get(lidNumber) ?? '';
        }
        const pushName = this.pushNameByJid.get(id) ?? '';
        const adminTag = (p as { admin?: string | null }).admin ?? null;
        return {
          id,
          phoneNumber,
          pushName,
          isAdmin: adminTag === 'admin' || adminTag === 'superadmin',
        };
      });
    } catch (err) {
      console.warn('[WhatsApp] groupMetadata failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ── LID ↔ Phone Resolution ─────────────────────────────────────────────

  /** Index a contact's LID ↔ phone mapping from contacts.upsert event data */
  private indexContactLid(contact: { id: string; jid?: string; lid?: string }): void {
    let phoneJid: string | undefined;
    let lidJid: string | undefined;

    // contact.id can be either format
    if (contact.id?.endsWith('@s.whatsapp.net')) {
      phoneJid = contact.id;
    } else if (contact.id?.endsWith('@lid')) {
      lidJid = contact.id;
    }

    // Explicit fields override
    if (contact.jid) phoneJid = contact.jid;
    if (contact.lid) lidJid = contact.lid;

    if (phoneJid && lidJid) {
      const phone = phoneJid.split('@')[0];
      const lid = lidJid.split('@')[0];
      this.lidToPhone.set(lid, phone);
      this.phoneToLid.set(phone, lid);
    }
  }

  /** Resolve a LID number to a phone number (from cached contacts) */
  resolveLidToPhone(lidNumber: string): string | null {
    return this.lidToPhone.get(lidNumber) ?? null;
  }

  /** Resolve a phone number to a LID number (from cached contacts) */
  resolvePhoneToLid(phoneNumber: string): string | null {
    return this.phoneToLid.get(phoneNumber) ?? null;
  }

  /** Check if a JID is a LID (Linked Identity) JID */
  static isLidJid(jid: string): boolean {
    return isLidUser(jid) ?? false;
  }

  /**
   * Look up a phone number on WhatsApp to get its LID mapping.
   * Also caches the mapping for future use.
   * @param phone - Phone number without suffix (e.g. "447999605999")
   */
  async lookupPhoneOnWhatsApp(phone: string): Promise<{ jid: string; exists: boolean; lid?: string } | null> {
    if (!this.socket) return null;
    try {
      const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
      const results = await this.socket.onWhatsApp(jid);
      if (!results || results.length === 0) return null;
      const result = results[0];

      // Cache the LID mapping if available
      const lidStr = result.lid ? String(result.lid) : undefined;
      if (lidStr) {
        const lidNumber = lidStr.split('@')[0];
        this.lidToPhone.set(lidNumber, phone);
        this.phoneToLid.set(phone, lidNumber);
      }

      return {
        jid: result.jid,
        exists: !!result.exists,
        lid: lidStr,
      };
    } catch (err) {
      console.warn('[WhatsApp] onWhatsApp lookup failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** Get the number of cached LID ↔ phone mappings */
  getLidMappingCount(): number {
    return this.lidToPhone.size;
  }

  // ── Poll Results ────────────────────────────────────────────────────────

  /** Get aggregated poll results. Optionally filter by chatJid. */
  getPollResults(chatJid?: string): PollResultData[] {
    const results: PollResultData[] = [];

    for (const [messageId, msg] of this.pollMessages) {
      const msgChatJid = msg.key.remoteJid || '';

      // Filter by chat if requested
      if (chatJid && msgChatJid !== chatJid) continue;

      const creation = msg.message?.pollCreationMessage
        || msg.message?.pollCreationMessageV2
        || msg.message?.pollCreationMessageV3;
      if (!creation) continue;

      const options = (creation.options || []).map(o => o.optionName || '');
      const question = creation.name || '';
      const chatName = msgChatJid.endsWith('@g.us')
        ? (this.allGroups.get(msgChatJid) || msgChatJid)
        : msgChatJid;

      // Aggregate votes using Baileys utility
      const votes = getAggregateVotesInPollMessage({
        message: msg.message!,
        pollUpdates: (msg as proto.IWebMessageInfo).pollUpdates || [],
      });

      const totalVotes = votes.reduce(
        (sum: number, v: { name: string; voters: string[] }) => sum + v.voters.length,
        0,
      );

      results.push({
        messageId,
        chatJid: msgChatJid,
        chatName,
        question,
        options,
        results: votes.map((v: { name: string; voters: string[] }) => ({
          name: v.name,
          voters: v.voters,
        })),
        totalVotes,
        createdAt: msg.messageTimestamp
          ? Number(msg.messageTimestamp) * 1000
          : Date.now(),
      });
    }

    // Sort by most recent first
    results.sort((a, b) => b.createdAt - a.createdAt);
    return results;
  }

  /** Get tracked poll count */
  getPollCount(): number {
    return this.pollMessages.size;
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async sendMessage(jid: string, text: string): Promise<void> {
    await this.sendWithRetry(jid, { text });
  }

  async sendPoll(jid: string, question: string, options: string[], selectableCount = 1): Promise<void> {
    await this.sendWithRetry(jid, {
      poll: {
        name: question,
        values: options,
        selectableCount,
      },
    });
  }

  /** Send a text reply quoting a previous message */
  async sendReply(chatJid: string, text: string, quotedMsgId: string): Promise<void> {
    const stored = this.messageStore.get(quotedMsgId) || this.pollMessages.get(quotedMsgId);
    if (!stored) {
      throw new Error(`Message ${quotedMsgId} not found in store — it may have been evicted`);
    }
    await this.sendWithRetry(chatJid, { text }, { quoted: stored } as Parameters<WASocket['sendMessage']>[2]);
  }

  /** Send an emoji reaction to a message */
  async sendReaction(
    chatJid: string,
    msgId: string,
    senderJid: string,
    fromMe: boolean,
    emoji: string,
  ): Promise<void> {
    const isGroup = chatJid.endsWith('@g.us');
    await this.sendWithRetry(chatJid, {
      react: {
        text: emoji,
        key: {
          remoteJid: chatJid,
          id: msgId,
          fromMe,
          participant: isGroup ? senderJid : undefined,
        },
      },
    });
  }

  /** Send an image from a URL with optional caption */
  async sendImage(jid: string, url: string, caption?: string): Promise<void> {
    await this.sendWithRetry(jid, {
      image: { url },
      caption: caption || undefined,
    });
  }

  /** Send a document/file from a URL */
  async sendDocument(jid: string, url: string, filename: string, mimetype?: string): Promise<void> {
    await this.sendWithRetry(jid, {
      document: { url },
      mimetype: mimetype || 'application/octet-stream',
      fileName: filename,
    });
  }

  /** Look up a stored message key by ID (for reactions/replies) */
  getStoredMessageKey(msgId: string): { remoteJid: string; id: string; fromMe: boolean; participant?: string } | null {
    const msg = this.messageStore.get(msgId) || this.pollMessages.get(msgId);
    if (!msg?.key) return null;
    return {
      remoteJid: msg.key.remoteJid || '',
      id: msg.key.id || '',
      fromMe: msg.key.fromMe ?? false,
      participant: msg.key.participant || undefined,
    };
  }

  private async sendWithRetry(
    jid: string,
    content: Parameters<WASocket['sendMessage']>[1],
    options?: Parameters<WASocket['sendMessage']>[2] | number,
    maxRetries = 3,
  ): Promise<void> {
    // Backwards compat: if options is a number, it's maxRetries from old callers
    const sendOptions = typeof options === 'number' ? undefined : options;
    const retries = typeof options === 'number' ? options : maxRetries;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (!this.socket) throw new Error('Not connected');
        await this.socket.sendMessage(jid, content, sendOptions ?? undefined);
        this.lastSuccessfulOperation = Date.now();
        this.reconnectAttempts = 0;
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[WhatsApp] Send attempt ${attempt}/${maxRetries} failed:`, errorMessage);

        const isConnectionError =
          errorMessage.includes('not connected') ||
          errorMessage.includes('Connection Closed') ||
          errorMessage.includes('timed out') ||
          errorMessage.includes('ECONNRESET');

        if (isConnectionError && attempt < maxRetries) {
          console.log('[WhatsApp] Connection error, refreshing...');
          await this.refreshConnection();
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        } else if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          throw error;
        }
      }
    }
  }

  // ── Connection Health ────────────────────────────────────────────────────

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastInboundEvent = Date.now();
    this.keepaliveInterval = setInterval(async () => {
      if (!this.socket || !this.isConnected) return;

      // Zombie detection: if no inbound Baileys events for 90s, the socket
      // is read-dead (TCP accepts writes but reads are stalled). Force refresh.
      const inboundAge = Date.now() - this.lastInboundEvent;
      if (inboundAge > WhatsAppClient.INBOUND_STALE_THRESHOLD_MS) {
        console.warn(`[WhatsApp] Zombie connection detected — no inbound events for ${Math.round(inboundAge / 1000)}s, refreshing...`);
        this.refreshConnection().catch(console.error);
        return;
      }

      try {
        await this.socket.sendPresenceUpdate('available');
        this.lastSuccessfulOperation = Date.now();
      } catch (error) {
        console.warn('[WhatsApp] Keepalive failed:', error instanceof Error ? error.message : error);

        const timeSinceLastSuccess = Date.now() - this.lastSuccessfulOperation;
        if (timeSinceLastSuccess > WhatsAppClient.STALE_CONNECTION_THRESHOLD_MS) {
          console.log('[WhatsApp] Connection stale (outbound), refreshing...');
          this.refreshConnection().catch(console.error);
        }
      }
    }, WhatsAppClient.KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  private async refreshConnection(): Promise<void> {
    if (this.isReconnecting) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return;
    }

    if (this.reconnectAttempts >= WhatsAppClient.MAX_RECONNECT_ATTEMPTS) {
      console.error('[WhatsApp] Max reconnect attempts reached');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    console.log(`[WhatsApp] Refreshing connection (${this.reconnectAttempts}/${WhatsAppClient.MAX_RECONNECT_ATTEMPTS})...`);

    try {
      this.stopKeepalive();
      if (this.socket) {
        try { this.socket.end(undefined); } catch { /* ignore */ }
        this.socket = null;
      }
      this.isConnected = false;
      this.fullyInitialized = false;
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.connect();
    } finally {
      this.isReconnecting = false;
    }
  }

  // ── Status ───────────────────────────────────────────────────────────────

  isReady(): boolean {
    return this.isConnected && this.socket !== null && this.fullyInitialized;
  }

  getState(): ConnectionState {
    if (this.isReconnecting) return 'reconnecting';
    if (this.isConnected && this.fullyInitialized) return 'connected';
    if (this.socket && !this.isConnected) return 'connecting';
    return 'disconnected';
  }

  getPhoneNumber(): string | null {
    return this.phoneNumber;
  }

  getGroupCount(): number {
    return this.allGroups.size;
  }

  getHealthInfo(): { lastSuccessMs: number; lastInboundMs: number; reconnectAttempts: number; isReconnecting: boolean } {
    return {
      lastSuccessMs: Date.now() - this.lastSuccessfulOperation,
      lastInboundMs: Date.now() - this.lastInboundEvent,
      reconnectAttempts: this.reconnectAttempts,
      isReconnecting: this.isReconnecting,
    };
  }

  // ── Poll Persistence ─────────────────────────────────────────────────────

  /** Save poll store to disk (atomic write) */
  savePolls(): void {
    if (this.pollMessages.size === 0) return;

    try {
      const entries: Array<{ id: string; data: string }> = [];
      for (const [id, msg] of this.pollMessages) {
        // Serialize protobuf to base64 for safe JSON storage
        const encoded = proto.WebMessageInfo.encode(
          proto.WebMessageInfo.fromObject(msg),
        ).finish();
        entries.push({ id, data: Buffer.from(encoded).toString('base64') });
      }

      const dir = path.dirname(this.pollPersistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmpPath = `${this.pollPersistPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify({ polls: entries, savedAt: new Date().toISOString() }));
      fs.renameSync(tmpPath, this.pollPersistPath);
      console.log(`[WhatsApp] Saved ${entries.length} polls to disk`);
    } catch (error) {
      console.error('[WhatsApp] Failed to save polls:', error);
    }
  }

  /** Load poll store from disk */
  private loadPolls(): void {
    try {
      if (!fs.existsSync(this.pollPersistPath)) return;

      const raw = fs.readFileSync(this.pollPersistPath, 'utf-8');
      const state = JSON.parse(raw) as { polls: Array<{ id: string; data: string }>; savedAt: string };

      let loaded = 0;
      for (const entry of state.polls) {
        try {
          const decoded = proto.WebMessageInfo.decode(Buffer.from(entry.data, 'base64'));
          this.pollMessages.set(entry.id, decoded);
          loaded++;
        } catch {
          console.warn(`[WhatsApp] Failed to decode poll ${entry.id}, skipping`);
        }
      }

      if (loaded > 0) {
        console.log(`[WhatsApp] Loaded ${loaded} polls from disk (saved ${state.savedAt})`);
      }
    } catch (error) {
      console.error('[WhatsApp] Failed to load polls:', error);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  private emitConnectionState(state: ConnectionState): void {
    this.onConnectionCallback?.(state);
  }

  /**
   * Slow outer-retry loop: kicks in after the inner exponential-backoff loop
   * runs out of attempts. Tries to reconnect once every OUTER_RETRY_INTERVAL_MS
   * forever, until either the connection comes back (which clears the timer)
   * or the user calls intentional disconnect / re-pairs via QR.
   *
   * This is what makes the relay self-heal from longer outages — without it,
   * a 10-minute WhatsApp/network blip would force a manual rescan.
   */
  private scheduleOuterRetry(): void {
    if (this.intentionalDisconnect) return;
    if (this.outerRetryTimer) return;
    this.outerRetryTimer = setTimeout(async () => {
      this.outerRetryTimer = null;
      if (this.intentionalDisconnect || this.isConnected) return;
      console.log(`[WhatsApp] Outer-retry: attempting reconnect after ${WhatsAppClient.OUTER_RETRY_INTERVAL_MS / 60_000}min cooldown...`);
      // Reset the inner counter so we get a fresh round of fast retries.
      this.reconnectAttempts = 0;
      this.isReconnecting = true;
      try {
        if (this.socket) {
          try { this.socket.end(undefined); } catch { /* ignore */ }
          this.socket = null;
        }
        await this.connect();
      } catch (e) {
        console.warn('[WhatsApp] Outer-retry connect failed:', (e as Error).message);
        this.scheduleOuterRetry();  // schedule another round
      } finally {
        this.isReconnecting = false;
      }
    }, WhatsAppClient.OUTER_RETRY_INTERVAL_MS);
  }

  /**
   * Graceful close — stops the socket and saves state but preserves auth.
   * Used by the daemon on SIGTERM so it can reconnect without a QR scan.
   */
  close(): void {
    this.intentionalDisconnect = true;
    this.stopKeepalive();
    this.savePolls();
    if (this.socket) {
      try { this.socket.end(undefined); } catch { /* ignore */ }
      this.socket = null;
    }
    this.isConnected = false;
    this.fullyInitialized = false;
    this.emitConnectionState('disconnected');
    console.log('[WhatsApp] Closed gracefully (auth preserved)');
  }

  /**
   * Full disconnect — wipes auth so next connect() starts fresh with a QR.
   * Used when the user explicitly disconnects from the Settings UI.
   */
  async disconnect(): Promise<void> {
    this.close();

    // Wipe auth so next connect() starts fresh with a QR
    if (fs.existsSync(this.authDir)) {
      const files = fs.readdirSync(this.authDir);
      for (const file of files) {
        try { fs.unlinkSync(path.join(this.authDir, file)); } catch { /* ignore */ }
      }
      console.log(`[WhatsApp] Cleared ${files.length} auth files on disconnect`);
    }
  }
}
