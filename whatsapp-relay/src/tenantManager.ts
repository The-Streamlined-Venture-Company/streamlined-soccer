/**
 * Tenant Manager — Multi-tenant WhatsApp session management
 *
 * For cloud relay mode (MULTI_TENANT=true): each user gets their own
 * WhatsAppClient + MessageBuffer, keyed by userId. Sessions are lazy-created
 * when the user first connects and evicted after extended idle.
 *
 * Key constraint: Baileys is single-connection. User connects to LOCAL
 * or CLOUD, never both. The UI enforces a clean switch.
 *
 * Data isolation: each tenant's data lives under DATA_DIR/tenants/{userId}/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WhatsAppClient } from './whatsapp.js';
import { MessageBuffer } from './messageBuffer.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TenantSession {
  userId: string;
  client: WhatsAppClient;
  buffer: MessageBuffer;
  lastActivity: number;
  dataDir: string;
  /** Latest QR payload from Baileys. Null once paired or before connect. */
  lastQR: string | null;
}

interface TenantManagerConfig {
  baseDataDir: string;
  maxIdleMs: number;
  sweepIntervalMs: number;
  maxTenants: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_IDLE_MS = 60 * 60 * 1000;      // 1 hour idle = evict (if no active schedules)
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;  // Check every 5 minutes
const DEFAULT_MAX_TENANTS = 100;                    // Railway resource limit

/** UUID v4 pattern — prevents path traversal via malicious userId */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Manager ──────────────────────────────────────────────────────────────────

export class TenantManager {
  private sessions = new Map<string, TenantSession>();
  private config: TenantManagerConfig;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private activeScheduleUserIds = new Set<string>();

  constructor(baseDataDir: string, options?: Partial<TenantManagerConfig>) {
    this.config = {
      baseDataDir,
      maxIdleMs: options?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS,
      sweepIntervalMs: options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
      maxTenants: options?.maxTenants ?? DEFAULT_MAX_TENANTS,
    };

    // Ensure tenants directory exists
    const tenantsDir = path.join(this.config.baseDataDir, 'tenants');
    if (!fs.existsSync(tenantsDir)) {
      fs.mkdirSync(tenantsDir, { recursive: true });
    }

    // Start idle sweep
    this.sweepTimer = setInterval(() => this.sweepIdle(), this.config.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  /**
   * Eagerly reload + reconnect every tenant that has persisted auth_info on disk.
   *
   * Run on relay startup so a redeploy or platform restart doesn't leave users
   * with a "0 tenants" / disconnected state until they manually open the app.
   * Failures here are logged but never throw — one bad tenant shouldn't block
   * the rest of the fleet.
   */
  async reloadPersistedSessions(): Promise<{ attempted: number; reconnected: number }> {
    const tenantsDir = path.join(this.config.baseDataDir, 'tenants');
    if (!fs.existsSync(tenantsDir)) return { attempted: 0, reconnected: 0 };

    let attempted = 0;
    let reconnected = 0;
    let entries: string[];
    try {
      entries = fs.readdirSync(tenantsDir);
    } catch (err) {
      console.warn('[TenantManager] reloadPersistedSessions readdir failed:', err);
      return { attempted: 0, reconnected: 0 };
    }

    for (const entry of entries) {
      // Filter to UUID-shaped dirs that have auth_info on disk
      if (!UUID_PATTERN.test(entry)) continue;
      const authDir = path.join(tenantsDir, entry, 'auth_info');
      if (!fs.existsSync(authDir)) continue;

      attempted++;
      try {
        const session = this.getOrCreate(entry);
        // Fire-and-forget connect — Baileys reconnects in the background.
        // We don't await per-tenant so a slow handshake doesn't block startup.
        session.client.connect().then(() => {
          reconnected++;
          console.log(`[TenantManager] Reconnected tenant ${entry.slice(0, 8)}…`);
        }).catch(err => {
          console.warn(`[TenantManager] Reconnect failed for ${entry.slice(0, 8)}…:`, err instanceof Error ? err.message : err);
        });
      } catch (err) {
        console.warn(`[TenantManager] Failed to reload ${entry.slice(0, 8)}…:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[TenantManager] reloadPersistedSessions: ${attempted} session(s) found, reconnect kicked off`);
    return { attempted, reconnected };
  }

  // ── Session Access ─────────────────────────────────────────────────────

  /**
   * Get an existing tenant session or create a new one.
   * The WhatsApp client is NOT auto-connected — caller must call client.connect().
   */
  getOrCreate(userId: string): TenantSession {
    // Validate UUID format to prevent path traversal
    if (!UUID_PATTERN.test(userId)) {
      throw new Error('Invalid userId format');
    }

    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    // Enforce max tenants
    if (this.sessions.size >= this.config.maxTenants) {
      // Evict oldest idle tenant (without active schedules)
      this.evictOldestIdle();

      if (this.sessions.size >= this.config.maxTenants) {
        throw new Error('Maximum tenant limit reached. Try again later.');
      }
    }

    // Create new tenant session
    const dataDir = path.join(this.config.baseDataDir, 'tenants', userId);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const client = new WhatsAppClient(dataDir);
    const buffer = new MessageBuffer(dataDir);

    // Wire messages to buffer
    client.onMessage((message) => {
      buffer.addMessage(message);
    });

    const session: TenantSession = {
      userId,
      client,
      buffer,
      lastActivity: Date.now(),
      dataDir,
      lastQR: null,
    };

    // Capture QR updates so /status can serve them back to the UI
    client.onQR((qr) => {
      session.lastQR = qr;
    });

    this.sessions.set(userId, session);
    console.log(`[TenantManager] Created session for user ${userId.slice(0, 8)}... (${this.sessions.size} active)`);

    return session;
  }

  /**
   * Get a tenant session without creating one. Returns null if not loaded.
   */
  get(userId: string): TenantSession | null {
    if (!UUID_PATTERN.test(userId)) return null;
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session || null;
  }

  /**
   * Mark a user as having active schedules (prevents idle eviction).
   */
  markActiveSchedule(userId: string): void {
    this.activeScheduleUserIds.add(userId);
  }

  /**
   * Clear active schedule marker for a user.
   */
  clearActiveSchedule(userId: string): void {
    this.activeScheduleUserIds.delete(userId);
  }

  // ── Eviction ───────────────────────────────────────────────────────────

  /**
   * Evict a specific tenant. Disconnects WhatsApp and persists buffer.
   * Removes from map immediately (synchronous) then cleans up async.
   */
  async evict(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) return;

    // Remove from map immediately to free the slot (prevents race with getOrCreate)
    this.sessions.delete(userId);
    this.activeScheduleUserIds.delete(userId);

    console.log(`[TenantManager] Evicting tenant ${userId.slice(0, 8)}...`);

    try {
      session.buffer.destroy();
    } catch (err) {
      console.error(`[TenantManager] Error destroying buffer for ${userId.slice(0, 8)}:`, err);
    }

    try {
      await session.client.disconnect();
    } catch (err) {
      console.error(`[TenantManager] Error disconnecting client for ${userId.slice(0, 8)}:`, err);
    }
  }

  /**
   * Sweep idle tenants. Evicts tenants that have been idle longer than maxIdleMs
   * AND don't have active schedules.
   */
  async sweepIdle(): Promise<void> {
    const now = Date.now();
    const idleCutoff = now - this.config.maxIdleMs;

    // Collect targets FIRST to avoid mutating the map during iteration
    const toEvict: string[] = [];
    for (const [userId, session] of this.sessions) {
      if (session.lastActivity < idleCutoff && !this.activeScheduleUserIds.has(userId)) {
        toEvict.push(userId);
      }
    }

    if (toEvict.length > 0) {
      console.log(`[TenantManager] Sweeping ${toEvict.length} idle tenant(s)`);
      await Promise.allSettled(toEvict.map(userId => this.evict(userId)));
    }
  }

  /**
   * Evict the oldest idle tenant that doesn't have active schedules.
   */
  private evictOldestIdle(): void {
    let oldestUserId: string | null = null;
    let oldestActivity = Infinity;

    for (const [userId, session] of this.sessions) {
      if (!this.activeScheduleUserIds.has(userId) && session.lastActivity < oldestActivity) {
        oldestActivity = session.lastActivity;
        oldestUserId = userId;
      }
    }

    if (oldestUserId) {
      // Fire-and-forget eviction
      this.evict(oldestUserId).catch(err => {
        console.error(`[TenantManager] Eviction error:`, err);
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Gracefully shut down all tenant sessions.
   */
  async shutdownAll(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    console.log(`[TenantManager] Shutting down ${this.sessions.size} tenant(s)...`);

    const evictionPromises = Array.from(this.sessions.keys()).map(userId =>
      this.evict(userId)
    );

    await Promise.allSettled(evictionPromises);
    console.log('[TenantManager] All tenants shut down');
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  get activeTenantCount(): number {
    return this.sessions.size;
  }

  get tenantUserIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}
