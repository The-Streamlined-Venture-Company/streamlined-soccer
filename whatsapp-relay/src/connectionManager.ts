/**
 * Connection Manager — Named WhatsApp connections within a single process
 *
 * Phase 25A: Manages a Map<ConnectionName, ConnectionSlot> where each slot
 * holds a WhatsAppClient + MessageBuffer with fully isolated auth/data dirs.
 *
 * Two named connections:
 *   - 'user': The user's own WhatsApp (AI responds on their behalf)
 *   - 'ai':   The AI's WhatsApp number (users text the AI directly)
 *
 * The AI connection is opt-in: only created if 'ai' is in the connections list.
 * Auth directory separation ensures zero cross-contamination:
 *   - user: {baseDataDir}/auth_info/ (backward compatible, unchanged)
 *   - ai:   {baseDataDir}/ai_connection/auth_info/
 *
 * Both connections run in the same Node.js process, same port. The relay
 * server routes requests via ?connection=user|ai query parameter.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WhatsAppClient } from './whatsapp.js';
import { MessageBuffer } from './messageBuffer.js';
import type { ConnectionName } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionSlot {
  name: ConnectionName;
  client: WhatsAppClient;
  buffer: MessageBuffer;
  dataDir: string;
  /** Per-connection QR data URL (set by client's onQR callback) */
  qrData: string | null;
}

export interface ConnectionManagerConfig {
  /** Base data directory (e.g. ~/Library/Application Support/Streamlined/whatsapp-relay) */
  baseDataDir: string;
  /** Which connections to create. Default: ['user'] */
  connections: ConnectionName[];
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class ConnectionManager {
  private slots = new Map<ConnectionName, ConnectionSlot>();
  private config: ConnectionManagerConfig;

  constructor(config: ConnectionManagerConfig) {
    this.config = config;

    for (const name of config.connections) {
      const dataDir = this.resolveDataDir(name);

      // Ensure data directory exists
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const client = new WhatsAppClient(dataDir);
      const buffer = new MessageBuffer(dataDir);

      // Wire messages to buffer
      client.onMessage((message) => {
        buffer.addMessage(message);
      });

      const slot: ConnectionSlot = {
        name,
        client,
        buffer,
        dataDir,
        qrData: null,
      };

      // Track QR data per connection
      client.onQR((qr) => {
        slot.qrData = qr;
      });

      client.onConnection((state) => {
        console.log(`[ConnectionManager] ${name} connection: ${state}`);
        // Clear QR when connected or disconnected
        if (state === 'connected' || state === 'disconnected') {
          slot.qrData = null;
        }
      });

      this.slots.set(name, slot);
      console.log(`[ConnectionManager] Created '${name}' slot (dataDir: ${dataDir})`);
    }
  }

  // ── Data Directory Resolution ──────────────────────────────────────────

  /**
   * Resolve the data directory for a named connection.
   * User connection uses the base directory (backward compat).
   * AI connection uses a subdirectory to isolate auth + buffer state.
   */
  private resolveDataDir(name: ConnectionName): string {
    if (name === 'user') {
      return this.config.baseDataDir;
    }
    // AI connection: isolated subdirectory
    return path.join(this.config.baseDataDir, 'ai_connection');
  }

  // ── Access ─────────────────────────────────────────────────────────────

  /** Get a connection slot by name. Returns undefined if not configured. */
  get(name: ConnectionName): ConnectionSlot | undefined {
    return this.slots.get(name);
  }

  /** Get all connection slots as entries. */
  getAll(): Map<ConnectionName, ConnectionSlot> {
    return this.slots;
  }

  /** Get the default connection (always 'user'). */
  getDefault(): ConnectionSlot | undefined {
    return this.slots.get('user');
  }

  /** Check if a named connection exists. */
  has(name: ConnectionName): boolean {
    return this.slots.has(name);
  }

  /** Get all configured connection names. */
  getConnectionNames(): ConnectionName[] {
    return Array.from(this.slots.keys());
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Connect a specific named connection.
   * Only connects if the slot exists and has auth state (avoids dual QR race).
   * If no auth state exists, the client will generate a QR code on connect().
   */
  async connect(name: ConnectionName): Promise<void> {
    const slot = this.slots.get(name);
    if (!slot) {
      console.warn(`[ConnectionManager] Cannot connect '${name}' — slot not configured`);
      return;
    }
    console.log(`[ConnectionManager] Connecting '${name}'...`);
    await slot.client.connect();
  }

  /**
   * Connect all configured connections.
   * User connection is always connected first.
   * AI connection only auto-connects if it has existing auth state
   * (avoids showing two QR codes simultaneously on first setup).
   */
  async connectAll(): Promise<void> {
    // Always connect user first
    const userSlot = this.slots.get('user');
    if (userSlot) {
      await this.connect('user');
    }

    // AI connection: only auto-connect if auth state exists
    const aiSlot = this.slots.get('ai');
    if (aiSlot) {
      const authDir = path.join(aiSlot.dataDir, 'auth_info');
      const hasAuth = fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;
      if (hasAuth) {
        await this.connect('ai');
      } else {
        console.log('[ConnectionManager] AI connection has no auth state — skipping auto-connect (user must scan QR via Settings)');
      }
    }
  }

  /**
   * Disconnect a specific named connection (wipes auth, generates new QR on next connect).
   */
  async disconnect(name: ConnectionName): Promise<void> {
    const slot = this.slots.get(name);
    if (!slot) return;
    console.log(`[ConnectionManager] Disconnecting '${name}'...`);
    await slot.client.disconnect();
    slot.qrData = null;
  }

  /**
   * Gracefully close a specific named connection (preserves auth for reconnect).
   */
  close(name: ConnectionName): void {
    const slot = this.slots.get(name);
    if (!slot) return;
    slot.client.close();
    slot.qrData = null;
  }

  /**
   * Gracefully shut down all connections.
   * Saves buffers and closes WhatsApp sockets (preserving auth).
   */
  shutdownAll(): void {
    console.log(`[ConnectionManager] Shutting down ${this.slots.size} connection(s)...`);

    for (const [name, slot] of this.slots) {
      try {
        slot.buffer.destroy();
      } catch (err) {
        console.error(`[ConnectionManager] Error destroying '${name}' buffer:`, err);
      }

      try {
        slot.client.close();
      } catch (err) {
        console.error(`[ConnectionManager] Error closing '${name}' client:`, err);
      }

      slot.qrData = null;
    }

    console.log('[ConnectionManager] All connections shut down');
  }
}
