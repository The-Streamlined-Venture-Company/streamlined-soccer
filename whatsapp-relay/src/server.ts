/**
 * REST API Server — Thin HTTP layer over the WhatsApp client + message buffer
 *
 * Endpoints:
 *   GET  /health                    Health check
 *   GET  /status                    Connection state, phone, group count, QR data URL
 *   POST /connect                   Start/restart WhatsApp connection (triggers QR)
 *   GET  /groups                    List all WhatsApp groups
 *   POST /message                   Send text message { to?, groupName?, text }
 *   POST /poll                      Send poll { groupName, question, options, selectableCount? }
 *   POST /disconnect                Disconnect WhatsApp session
 *   GET  /polls                     Poll results (query: chatJid?)
 *   GET  /chats                     List chats with last message + unread count
 *   GET  /chats/:jid/messages       Message history (query: limit, before)
 *   POST /chats/:jid/read           Mark chat as read
 *   GET  /messages/search           Search messages (query: q, chatJid?)
 *   GET  /unread                    Total unread count
 *
 * Auth: X-API-Key header (env var API_KEY). Required for all non-/health requests.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import QRCode from 'qrcode';
import http from 'http';
import { timingSafeEqual } from 'node:crypto';
import type { WhatsAppClient } from './whatsapp.js';
import type { MessageBuffer } from './messageBuffer.js';
import type { TenantManager } from './tenantManager.js';
import type { ConnectionManager } from './connectionManager.js';
import type { ServerConfig, ApiResponse, ConnectionName, ConnectionStatus, MultiConnectionStatus, PollResultData, OnAuthCallback, OnAuthLogoutCallback } from './types.js';

// SharedAI is a streamlinedos-specific feature not used in the soccer build.
// Kept as a type stub so the server code compiles unchanged; instances are never
// constructed for soccer, so all `if (this.sharedAI)` branches are dead code.
interface SharedAIConnection {
  client: WhatsAppClient;
  buffer: MessageBuffer;
  qrData: string | null;
  getState(): string;
  getPhoneNumber(): string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  shutdown(): void;
  resolveUserIdFromJid(jid: string): Promise<string | null>;
  getChatsForUser(userId: string): Promise<unknown[]>;
  getMessagesForUser(userId: string, jid: string, limit: number): Promise<unknown[]>;
  updateBridgeConfig(token: string, port: number): void;
}
import { validateMessagePayload, validatePollPayload, validateReactionPayload, validateReplyPayload, validateMediaPayload, validateJid, validateAuthPayload } from './types.js';
import { createJwtAuthMiddleware, type AuthenticatedRequest } from './jwtAuth.js';

// ── Rate Limiter ──────────────────────────────────────────────────────────

interface RateLimitEntry {
  timestamps: number[];
}

class SlidingWindowRateLimiter {
  private windows: Map<string, RateLimitEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupTimer: NodeJS.Timeout;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Periodic cleanup to prevent unbounded memory growth
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.windowMs;
      for (const [key, entry] of this.windows) {
        entry.timestamps = entry.timestamps.filter(t => t > cutoff);
        if (entry.timestamps.length === 0) {
          this.windows.delete(key);
        }
      }
    }, 60_000);
    this.cleanupTimer.unref();
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }
}

// ── Server ────────────────────────────────────────────────────────────────

export class RelayServer {
  private app: express.Application;
  private httpServer: http.Server | null = null;
  private client: WhatsAppClient | null;
  private buffer: MessageBuffer | null;
  private config: ServerConfig;
  private tenantManager: TenantManager | null;
  private connectionManager: ConnectionManager | null;
  private sharedAI: SharedAIConnection | null;
  private currentQR: string | null = null;
  private messageLimiter = new SlidingWindowRateLimiter(60_000, 10); // 10 msgs/min
  private pollLimiter = new SlidingWindowRateLimiter(60_000, 5); // 5 polls/min
  private aiMessageLimiter = new SlidingWindowRateLimiter(60_000, 5); // 5 msgs/min per user on AI connection
  private onAuthCallbacks: OnAuthCallback[] = [];
  private onAuthLogoutCallbacks: OnAuthLogoutCallback[] = [];
  /** In single-tenant mode, the userId is stored from POST /auth (no JWT middleware). */
  private singleTenantUserId: string | null = null;

  constructor(
    client: WhatsAppClient | null,
    buffer: MessageBuffer | null,
    config: ServerConfig,
    tenantManager?: TenantManager,
    connectionManager?: ConnectionManager,
    sharedAI?: SharedAIConnection,
  ) {
    this.client = client;
    this.buffer = buffer;
    this.config = config;
    this.tenantManager = tenantManager ?? null;
    this.connectionManager = connectionManager ?? null;
    this.sharedAI = sharedAI ?? null;
    this.app = express();

    // Listen for QR updates from client (single-tenant, legacy mode only)
    if (this.client && !this.connectionManager) {
      this.client.onQR((qr) => {
        this.currentQR = qr;
      });
    }

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Extract the connection name from a request's query parameter.
   * Defaults to 'user' if not specified or invalid.
   */
  private getConnectionName(req: Request): ConnectionName {
    const conn = req.query.connection;
    if (conn === 'ai') return 'ai';
    return 'user';
  }

  /**
   * Check if the current request is on the SharedAI path (?connection=ai with SharedAI configured).
   */
  private isSharedAIRequest(req: Request): boolean {
    return !!(this.sharedAI && this.getConnectionName(req) === 'ai');
  }

  /**
   * Get the userId for the current request.
   * Multi-tenant: from JWT middleware. Single-tenant: from stored /auth session.
   */
  private getRequestUserId(req: Request): string | undefined {
    return (req as AuthenticatedRequest).userId ?? this.singleTenantUserId ?? undefined;
  }

  /**
   * Verify that the authenticated user owns a JID on the SharedAI connection.
   * Returns true if the JID belongs to the user, false otherwise.
   * For non-SharedAI requests, always returns true (no filtering needed).
   */
  private async verifySharedAIOwnership(req: Request, jid: string): Promise<boolean> {
    if (!this.isSharedAIRequest(req)) return true;
    const userId = this.getRequestUserId(req);
    // Single-tenant without auth: allow (only one user)
    if (!userId) return !this.config.multiTenant;
    const resolvedUserId = await this.sharedAI!.resolveUserIdFromJid(jid);
    return resolvedUserId === userId;
  }

  /**
   * Build a ConnectionStatus object for a client, with optional QR data URL.
   */
  private async buildConnectionStatus(client: WhatsAppClient, qrSource: string | null): Promise<ConnectionStatus> {
    let qrDataUrl: string | null = null;
    if (qrSource) {
      try {
        qrDataUrl = await QRCode.toDataURL(qrSource, { width: 300, margin: 2 });
      } catch {
        qrDataUrl = null;
      }
    }

    const rawState = client.getState();
    const state = (qrDataUrl && rawState === 'connecting') ? 'qr-pending' : rawState;

    return {
      state,
      phoneNumber: client.getPhoneNumber(),
      groupCount: client.getGroupCount(),
      qrDataUrl,
      health: client.getHealthInfo(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Resolve the WhatsApp client and buffer for the current request.
   *
   * Resolution order:
   *   1. ConnectionManager (Phase 25A — dual connections via ?connection=user|ai)
   *   2. TenantManager (cloud multi-tenant via JWT userId)
   *   3. Legacy single client/buffer
   *
   * @param createIfMissing If true (default), creates a tenant session if none exists.
   *   Set to false for read-only endpoints to avoid resource waste.
   */
  private resolveClientAndBuffer(req: Request, createIfMissing = true): { client: WhatsAppClient; buffer: MessageBuffer } | null {
    // Phase 25A: ConnectionManager takes priority (named connections — single-tenant daemon)
    if (this.connectionManager) {
      const connName = this.getConnectionName(req);
      const slot = this.connectionManager.get(connName);
      if (slot) {
        return { client: slot.client, buffer: slot.buffer };
      }
      // Requested connection not configured — fall through to TenantManager/legacy
      // (don't return null here; allows graceful degradation)
    }

    // Phase 25A: Shared AI connection (works in both single-tenant and multi-tenant)
    if (this.sharedAI && this.getConnectionName(req) === 'ai') {
      return { client: this.sharedAI.client, buffer: this.sharedAI.buffer };
    }

    // Multi-tenant cloud mode
    if (this.config.multiTenant && this.tenantManager) {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) return null;

      if (createIfMissing) {
        try {
          const session = this.tenantManager.getOrCreate(userId);
          return { client: session.client, buffer: session.buffer };
        } catch (err) {
          console.warn(`[Server] Failed to resolve tenant session: ${(err as Error).message}`);
          return null;
        }
      }
      // Read-only: only return existing session
      const session = this.tenantManager.get(userId);
      if (!session) return null;
      return { client: session.client, buffer: session.buffer };
    }

    // Legacy single client/buffer
    if (this.client && this.buffer) {
      return { client: this.client, buffer: this.buffer };
    }
    return null;
  }

  /** Register a callback for when auth credentials arrive */
  onAuth(callback: OnAuthCallback): void {
    this.onAuthCallbacks.push(callback);
  }

  /** Register a callback for when the user signs out */
  onAuthLogout(callback: OnAuthLogoutCallback): void {
    this.onAuthLogoutCallbacks.push(callback);
  }

  private setupMiddleware(): void {
    // Trust proxy for correct req.ip — multi-tenant (cloud) trusts first proxy, local uses none
    if (this.config.multiTenant) {
      this.app.set('trust proxy', 1);
    }

    // Security headers
    this.app.use(helmet());

    // Body limit — 256kb to accommodate large message payloads
    this.app.use(express.json({ limit: '256kb' }));

    // CORS — restrict to allowed origins
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      const allowedOrigins = this.config.allowedOrigins;

      if (allowedOrigins && allowedOrigins.length > 0 && origin) {
        if (allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
        }
        // If origin not in allowedOrigins, don't set the header (browser blocks cross-origin)
      } else if (!allowedOrigins || allowedOrigins.length === 0) {
        // No allowedOrigins configured — allow all (dev mode / backwards compat)
        res.header('Access-Control-Allow-Origin', '*');
      }

      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Auth middleware — mode-dependent
    if (this.config.multiTenant) {
      // Multi-tenant: JWT Bearer auth (skip for /health)
      const jwtMiddleware = createJwtAuthMiddleware({
        expectedIssuer: this.config.supabaseUrl ? `${this.config.supabaseUrl}/auth/v1` : undefined,
        expectedAudience: 'authenticated',
        jwtSecret: this.config.supabaseJwtSecret,
      });
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path === '/health') return next();
        // Admin endpoints use their own ADMIN_KEY auth, not JWT
        if (req.path.startsWith('/admin/')) return next();
        jwtMiddleware(req, res, next);
      });
    } else {
      // Single-tenant: API key auth — REQUIRED for all non-/health requests
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path === '/health') return next();

        // Auth hardening: if no API_KEY configured, refuse all authenticated endpoints
        if (!this.config.apiKey) {
          res.status(500).json({ success: false, error: 'Server misconfigured' } satisfies ApiResponse<never>);
          return;
        }

        const providedKey = req.headers['x-api-key'];
        if (!providedKey || typeof providedKey !== 'string') {
          res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse<never>);
          return;
        }
        // Timing-safe comparison to prevent timing attacks on the API key
        const expected = Buffer.from(this.config.apiKey, 'utf-8');
        const provided = Buffer.from(providedKey, 'utf-8');
        if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
          res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiResponse<never>);
          return;
        }
        next();
      });
    }
  }

  private setupRoutes(): void {
    // ── Health ────────────────────────────────────────────────────────────
    this.app.get('/health', (_req: Request, res: Response) => {
      // Don't expose tenant count on unauthenticated health endpoint
      res.json({ ok: true, timestamp: new Date().toISOString() });
    });

    // ── Status ───────────────────────────────────────────────────────────
    this.app.get('/status', async (req: Request, res: Response) => {
      // Phase 25A: ?connection=all returns status for ALL named connections
      if (req.query.connection === 'all' && this.connectionManager) {
        try {
          const connections: Record<string, ConnectionStatus> = {};
          for (const [name, slot] of this.connectionManager.getAll()) {
            connections[name] = await this.buildConnectionStatus(slot.client, slot.qrData);
          }
          res.json({ success: true, data: { connections } } satisfies ApiResponse<MultiConnectionStatus>);
        } catch {
          res.status(500).json({ success: false, error: 'Failed to retrieve status' });
        }
        return;
      }

      // Phase 25A: Shared AI connection status (multi-tenant) — no QR for users
      if (this.sharedAI && this.getConnectionName(req) === 'ai') {
        try {
          const status = await this.buildConnectionStatus(this.sharedAI.client, null);
          res.json({ success: true, data: status } satisfies ApiResponse<ConnectionStatus>);
        } catch {
          res.status(500).json({ success: false, error: 'Failed to retrieve status' });
        }
        return;
      }

      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved) {
        res.status(503).json({ success: false, error: 'No WhatsApp session available' });
        return;
      }

      try {
        // Determine QR source: ConnectionManager slot > TenantManager session > legacy currentQR
        let qrSource: string | null = null;
        if (this.connectionManager) {
          const connName = this.getConnectionName(req);
          const slot = this.connectionManager.get(connName);
          qrSource = slot?.qrData ?? null;
        } else if (this.config.multiTenant && this.tenantManager) {
          const userId = (req as AuthenticatedRequest).userId;
          const session = userId ? this.tenantManager.get(userId) : null;
          qrSource = session?.lastQR ?? null;
        } else {
          qrSource = this.currentQR;
        }

        const status = await this.buildConnectionStatus(resolved.client, qrSource);
        res.json({ success: true, data: status } satisfies ApiResponse<ConnectionStatus>);
      } catch {
        res.status(500).json({ success: false, error: 'Failed to retrieve status' });
      }
    });

    // ── Connect (start/restart WhatsApp session) ─────────────────────────
    this.app.post('/connect', async (req: Request, res: Response) => {
      // Phase 25A: ConnectionManager routes by ?connection=user|ai
      if (this.connectionManager) {
        const connName = this.getConnectionName(req);
        if (!this.connectionManager.has(connName)) {
          res.status(400).json({ success: false, error: `Connection '${connName}' is not configured` });
          return;
        }
        try {
          const slot = this.connectionManager.get(connName)!;
          if (slot.client.isReady()) {
            res.json({ success: true, data: { state: 'connected', connection: connName, message: 'Already connected' } });
            return;
          }
          await this.connectionManager.connect(connName);
          res.json({ success: true, data: { state: 'connecting', connection: connName, message: `Connection '${connName}' started — poll /status?connection=${connName} for QR code` } });
        } catch (error) {
          console.error(`[Server] Connect error (${connName}):`, error);
          res.status(500).json({ success: false, error: 'Failed to start connection' });
        }
        return;
      }

      // Lazy-create the tenant session on first /connect — pairing kicks off here.
      const resolved = this.resolveClientAndBuffer(req, true);
      if (!resolved) {
        res.status(503).json({ success: false, error: 'No WhatsApp session' });
        return;
      }

      try {
        if (resolved.client.isReady()) {
          res.json({ success: true, data: { state: 'connected', message: 'Already connected' } });
          return;
        }

        await resolved.client.connect();
        res.json({ success: true, data: { state: 'connecting', message: 'Connection started — poll /status for QR code' } });
      } catch (error) {
        console.error('[Server] Connect error:', error);
        res.status(500).json({ success: false, error: 'Failed to start connection' });
      }
    });

    // ── Groups ───────────────────────────────────────────────────────────
    this.app.get('/groups', (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      // SharedAI: groups not applicable (AI connection is DM-only)
      if (this.isSharedAIRequest(req)) {
        res.json({ success: true, data: [] });
        return;
      }

      const groups = resolved.client.getGroups();
      res.json({ success: true, data: groups });
    });

    // ── Group Participants ───────────────────────────────────────────────
    // Used by the soccer app's "Match WhatsApp members" onboarding — returns
    // each member of a group with push name + phone so the organiser can map
    // them to player records.
    this.app.get('/groups/:jid/participants', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      if (this.isSharedAIRequest(req)) {
        res.json({ success: true, data: [] });
        return;
      }

      const chatJid = req.params.jid;
      if (!chatJid || !chatJid.endsWith('@g.us')) {
        res.status(400).json({ success: false, error: 'Invalid group JID' });
        return;
      }

      try {
        const participants = await resolved.client.getGroupParticipants(chatJid);
        if (participants === null) {
          res.status(404).json({ success: false, error: 'Group not found or not accessible' });
          return;
        }
        res.json({ success: true, data: participants });
      } catch (error) {
        console.error('[Server] /groups/:jid/participants error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch participants' });
      }
    });

    // ── Send Message ─────────────────────────────────────────────────────
    this.app.post('/message', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      const validation = validateMessagePayload(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      // Rate limit by userId (multi-tenant) or IP (single-tenant), scoped by connection
      const connName = this.getConnectionName(req);
      const connSuffix = this.connectionManager ? `:${connName}` : '';
      const rateLimitKey = (this.config.multiTenant
        ? (req as AuthenticatedRequest).userId
        : (req.ip ?? 'unknown')) + connSuffix;

      // AI connection gets tighter rate limits (5 msgs/min vs 10 msgs/min)
      const limiter = (connName === 'ai') ? this.aiMessageLimiter : this.messageLimiter;
      const limitLabel = (connName === 'ai') ? '5' : '10';
      if (!limiter.isAllowed(rateLimitKey)) {
        res.status(429).json({ success: false, error: `Rate limit exceeded. Max ${limitLabel} messages per minute.` });
        return;
      }

      const { to, text, groupName } = req.body as { to?: string; text?: string; groupName?: string };

      try {
        let jid = to;
        if (groupName) {
          jid = resolved.client.findGroupJid(groupName) ?? undefined;
          if (!jid) {
            res.status(404).json({ success: false, error: 'Group not found' });
            return;
          }
        }

        // SharedAI: verify the target JID belongs to the requesting user
        if (jid && !(await this.verifySharedAIOwnership(req, jid))) {
          res.status(403).json({ success: false, error: 'Cannot send to this conversation' });
          return;
        }

        await resolved.client.sendMessage(jid!, text!);
        res.json({ success: true, data: { sent: true, to: jid } });
      } catch (error) {
        console.error('[Server] Send message error:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
      }
    });

    // ── Send Poll ────────────────────────────────────────────────────────
    this.app.post('/poll', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      const validation = validatePollPayload(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const connSuffix2 = this.connectionManager ? `:${this.getConnectionName(req)}` : '';
      const rateLimitKey = (this.config.multiTenant
        ? (req as AuthenticatedRequest).userId
        : (req.ip ?? 'unknown')) + connSuffix2;
      if (!this.pollLimiter.isAllowed(rateLimitKey)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 5 polls per minute.' });
        return;
      }

      const { groupName, question, options, selectableCount, to } = req.body as {
        groupName?: string;
        question?: string;
        options?: string[];
        selectableCount?: number;
        to?: string;
      };

      try {
        let jid = to;
        if (!jid && groupName) {
          jid = resolved.client.findGroupJid(groupName) ?? undefined;
          if (!jid) {
            res.status(404).json({ success: false, error: 'Group not found' });
            return;
          }
        }

        if (!jid) {
          res.status(400).json({ success: false, error: "Missing 'to' or 'groupName' field" });
          return;
        }

        // SharedAI: verify ownership
        if (!(await this.verifySharedAIOwnership(req, jid))) {
          res.status(403).json({ success: false, error: 'Cannot send to this conversation' });
          return;
        }

        await resolved.client.sendPoll(jid, question!, options!, selectableCount ?? 1);
        res.json({ success: true, data: { sent: true, groupName, question, optionCount: options!.length } });
      } catch (error) {
        console.error('[Server] Send poll error:', error);
        res.status(500).json({ success: false, error: 'Failed to send poll' });
      }
    });

    // ── React to Message ────────────────────────────────────────────────
    this.app.post('/react', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      const validation = validateReactionPayload(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const { chatJid, messageId, emoji } = req.body as { chatJid: string; messageId: string; emoji: string };

      // SharedAI: verify ownership
      if (!(await this.verifySharedAIOwnership(req, chatJid))) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      try {
        // Look up message in buffer to get sender details for the reaction key
        const bufferedMsg = resolved.buffer.findMessageById(messageId);
        const storedKey = resolved.client.getStoredMessageKey(messageId);

        const senderJid = storedKey?.participant || bufferedMsg?.senderJid || '';
        const fromMe = storedKey?.fromMe ?? bufferedMsg?.isFromMe ?? false;

        await resolved.client.sendReaction(chatJid, messageId, senderJid, fromMe, emoji);
        res.json({ success: true, data: { reacted: true, emoji } });
      } catch (error) {
        console.error('[Server] React error:', error);
        res.status(500).json({ success: false, error: 'Failed to send reaction' });
      }
    });

    // ── Reply to Message ──────────────────────────────────────────────────
    this.app.post('/reply', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      const validation = validateReplyPayload(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const connSuffix3 = this.connectionManager ? `:${this.getConnectionName(req)}` : '';
      const rateLimitKey = (this.config.multiTenant
        ? (req as AuthenticatedRequest).userId
        : (req.ip ?? 'unknown')) + connSuffix3;
      if (!this.messageLimiter.isAllowed(rateLimitKey)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 10 messages per minute.' });
        return;
      }

      const { chatJid, messageId, text } = req.body as { chatJid: string; messageId: string; text: string };

      // SharedAI: verify ownership
      if (!(await this.verifySharedAIOwnership(req, chatJid))) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      try {
        await resolved.client.sendReply(chatJid, text, messageId);
        res.json({ success: true, data: { sent: true, replied: true } });
      } catch (error) {
        console.error('[Server] Reply error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to send reply';
        res.status(500).json({ success: false, error: errorMessage });
      }
    });

    // ── Send Media ────────────────────────────────────────────────────────
    this.app.post('/media', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      const validation = validateMediaPayload(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const connSuffix3 = this.connectionManager ? `:${this.getConnectionName(req)}` : '';
      const rateLimitKey = (this.config.multiTenant
        ? (req as AuthenticatedRequest).userId
        : (req.ip ?? 'unknown')) + connSuffix3;
      if (!this.messageLimiter.isAllowed(rateLimitKey)) {
        res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 10 messages per minute.' });
        return;
      }

      const { to, groupName, type, url, caption, filename } = req.body as {
        to?: string; groupName?: string; type: 'image' | 'document';
        url: string; caption?: string; filename?: string;
      };

      try {
        let jid = to;
        if (groupName) {
          jid = resolved.client.findGroupJid(groupName) ?? undefined;
          if (!jid) {
            res.status(404).json({ success: false, error: 'Group not found' });
            return;
          }
        }
        if (!jid) {
          res.status(400).json({ success: false, error: "Missing 'to' or 'groupName' field" });
          return;
        }

        // SharedAI: verify ownership
        if (!(await this.verifySharedAIOwnership(req, jid))) {
          res.status(403).json({ success: false, error: 'Cannot send to this conversation' });
          return;
        }

        if (type === 'image') {
          await resolved.client.sendImage(jid, url, caption);
        } else {
          await resolved.client.sendDocument(jid, url, filename || 'file', undefined);
        }

        res.json({ success: true, data: { sent: true, type } });
      } catch (error) {
        console.error('[Server] Media send error:', error);
        res.status(500).json({ success: false, error: 'Failed to send media' });
      }
    });

    // ── Auth (session token for scheduler) ──────────────────────────────
    this.app.post('/auth', (req: Request, res: Response) => {
      const validation = validateAuthPayload(req.body);
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const { accessToken, refreshToken, userId } = req.body as {
        accessToken: string;
        refreshToken: string;
        userId: string;
      };

      // In multi-tenant mode, verify the body userId matches the JWT sub claim
      if (this.config.multiTenant) {
        const jwtUserId = (req as AuthenticatedRequest).userId;
        if (jwtUserId && userId !== jwtUserId) {
          res.status(403).json({ success: false, error: 'userId does not match authenticated user' });
          return;
        }
      }

      console.log(`[Server] Auth received for user ${userId.slice(0, 8)}...`);

      // Single-tenant: store userId for SharedAI endpoints (no JWT middleware to set it)
      if (!this.config.multiTenant) {
        this.singleTenantUserId = userId;
      }

      for (const cb of this.onAuthCallbacks) {
        try {
          cb({ accessToken, refreshToken, userId });
        } catch (err) {
          console.error('[Server] Auth callback error:', err);
        }
      }

      res.json({ success: true, data: { authenticated: true } });
    });

    this.app.post('/auth/logout', (req: Request, res: Response) => {
      // In multi-tenant mode, evict the specific tenant
      if (this.config.multiTenant && this.tenantManager) {
        const userId = (req as AuthenticatedRequest).userId;
        if (userId) {
          console.log(`[Server] Auth logout for user ${userId.slice(0, 8)}...`);
          this.tenantManager.evict(userId).catch(err => {
            console.error(`[Server] Tenant eviction error on logout:`, err);
          });
        }
      } else {
        console.log('[Server] Auth logout received');
        this.singleTenantUserId = null;
        for (const cb of this.onAuthLogoutCallbacks) {
          try {
            cb();
          } catch (err) {
            console.error('[Server] Auth logout callback error:', err);
          }
        }
      }

      res.json({ success: true, data: { loggedOut: true } });
    });

    // ── Disconnect ───────────────────────────────────────────────────────
    this.app.post('/disconnect', async (req: Request, res: Response) => {
      // Phase 25A: ConnectionManager routes by ?connection=user|ai
      if (this.connectionManager) {
        const connName = this.getConnectionName(req);
        try {
          await this.connectionManager.disconnect(connName);
          res.json({ success: true, data: { disconnected: true, connection: connName } });
        } catch (error) {
          console.error(`[Server] Disconnect error (${connName}):`, error);
          res.status(500).json({ success: false, error: 'Failed to disconnect' });
        }
        return;
      }

      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved) {
        res.status(503).json({ success: false, error: 'No WhatsApp session' });
        return;
      }

      try {
        await resolved.client.disconnect();
        // In multi-tenant mode, evict the tenant session
        if (this.config.multiTenant && this.tenantManager) {
          const userId = (req as AuthenticatedRequest).userId;
          await this.tenantManager.evict(userId);
        }
        res.json({ success: true, data: { disconnected: true } });
      } catch (error) {
        console.error('[Server] Disconnect error:', error);
        res.status(500).json({ success: false, error: 'Failed to disconnect' });
      }
    });

    // ── Poll Results ──────────────────────────────────────────────────────
    this.app.get('/polls', (req: Request, res: Response) => {
      // SharedAI: polls not supported on shared connection
      if (this.isSharedAIRequest(req)) {
        res.json({ success: true, data: [] } satisfies ApiResponse<PollResultData[]>);
        return;
      }

      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved || !resolved.client.isReady()) {
        res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        return;
      }

      const chatJid = req.query.chatJid as string | undefined;
      if (chatJid) {
        const jidCheck = validateJid(chatJid);
        if (!jidCheck.valid) {
          res.status(400).json({ success: false, error: jidCheck.error });
          return;
        }
      }

      const results = resolved.client.getPollResults(chatJid);
      res.json({ success: true, data: results } satisfies ApiResponse<PollResultData[]>);
    });

    // ── List Chats ───────────────────────────────────────────────────────
    this.app.get('/chats', async (req: Request, res: Response) => {
      // Phase 25A: SharedAI connection — filter chats per user
      if (this.sharedAI && this.getConnectionName(req) === 'ai') {
        try {
          const userId = this.getRequestUserId(req);
          if (userId) {
            // Multi-tenant or authenticated single-tenant: filter by user
            const chats = await this.sharedAI.getChatsForUser(userId);
            res.json({ success: true, data: chats });
          } else {
            // Single-tenant before auth: return all DM chats (only one user)
            const allChats = this.sharedAI.buffer.getChats().filter(c => !c.isGroup);
            res.json({ success: true, data: allChats });
          }
        } catch {
          res.status(500).json({ success: false, error: 'Failed to retrieve chats' });
        }
        return;
      }

      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved) {
        res.json({ success: true, data: [] });
        return;
      }

      const chats = resolved.buffer.getChats();
      res.json({ success: true, data: chats });
    });

    // ── Chat Messages ────────────────────────────────────────────────────
    this.app.get('/chats/:jid/messages', async (req: Request, res: Response) => {
      const { jid } = req.params;
      const jidCheck = validateJid(jid);
      if (!jidCheck.valid) {
        res.status(400).json({ success: false, error: jidCheck.error });
        return;
      }

      const limitNum = Number(req.query.limit);
      const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, 200) : 50;

      // Phase 25A: SharedAI connection — filter messages per user
      if (this.sharedAI && this.getConnectionName(req) === 'ai') {
        try {
          const userId = this.getRequestUserId(req);
          if (userId) {
            const messages = await this.sharedAI.getMessagesForUser(userId, jid, limit);
            res.json({ success: true, data: messages });
          } else {
            // Single-tenant before auth: return all messages for this JID
            const messages = this.sharedAI.buffer.getMessages(jid, limit);
            res.json({ success: true, data: messages });
          }
        } catch {
          res.status(500).json({ success: false, error: 'Failed to retrieve messages' });
        }
        return;
      }

      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved) {
        res.json({ success: true, data: [] });
        return;
      }

      const beforeNum = Number(req.query.before);
      const before = Number.isFinite(beforeNum) && beforeNum > 0 ? beforeNum : undefined;

      const messages = resolved.buffer.getMessages(jid, limit, before);
      res.json({ success: true, data: messages });
    });

    // ── Mark Chat Read ───────────────────────────────────────────────────
    this.app.post('/chats/:jid/read', async (req: Request, res: Response) => {
      const resolved = this.resolveClientAndBuffer(req);
      if (!resolved) {
        res.status(503).json({ success: false, error: 'No session' });
        return;
      }

      const { jid } = req.params;
      const jidCheck = validateJid(jid);
      if (!jidCheck.valid) {
        res.status(400).json({ success: false, error: jidCheck.error });
        return;
      }

      // SharedAI: verify ownership before marking read
      if (!(await this.verifySharedAIOwnership(req, jid))) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      resolved.buffer.markRead(jid);
      res.json({ success: true, data: { marked: true } });
    });

    // ── Search Messages ──────────────────────────────────────────────────
    this.app.get('/messages/search', async (req: Request, res: Response) => {
      // SharedAI: search is not supported (would leak cross-user data)
      if (this.isSharedAIRequest(req)) {
        res.status(403).json({ success: false, error: 'Search not available on shared AI connection' });
        return;
      }

      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved) {
        res.json({ success: true, data: [] });
        return;
      }

      const query = req.query.q as string;
      const chatJid = req.query.chatJid as string | undefined;

      if (!query) {
        res.status(400).json({ success: false, error: "Missing 'q' query parameter" });
        return;
      }

      if (query.length > 256) {
        res.status(400).json({ success: false, error: 'Query too long (max 256 characters)' });
        return;
      }

      if (chatJid) {
        const jidCheck = validateJid(chatJid);
        if (!jidCheck.valid) {
          res.status(400).json({ success: false, error: jidCheck.error });
          return;
        }
      }

      const results = resolved.buffer.searchMessages(query, chatJid);
      res.json({ success: true, data: results });
    });

    // ── Unread Count ─────────────────────────────────────────────────────
    this.app.get('/unread', (req: Request, res: Response) => {
      // SharedAI: unread count not supported (would aggregate all users)
      if (this.isSharedAIRequest(req)) {
        res.json({ success: true, data: { unreadCount: 0 } });
        return;
      }

      const resolved = this.resolveClientAndBuffer(req, false);
      if (!resolved) {
        res.json({ success: true, data: { unreadCount: 0 } });
        return;
      }

      const count = resolved.buffer.getUnreadCount();
      res.json({ success: true, data: { unreadCount: count } });
    });

    // ── Admin: Shared AI Connection Management ─────────────────────────
    // Operator-only endpoints protected by ADMIN_KEY header.
    // Used to connect/disconnect the shared AI WhatsApp number.

    const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
      const adminKey = this.config.adminKey;
      if (!adminKey) {
        res.status(501).json({ success: false, error: 'Admin endpoints not configured' });
        return;
      }
      const provided = req.headers['x-admin-key'];
      if (!provided || typeof provided !== 'string') {
        res.status(401).json({ success: false, error: 'Missing X-Admin-Key header' });
        return;
      }
      const expected = Buffer.from(adminKey, 'utf-8');
      const actual = Buffer.from(provided, 'utf-8');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        res.status(401).json({ success: false, error: 'Invalid admin key' });
        return;
      }
      next();
    };

    // GET /admin/ai/status — Full AI connection status including QR
    this.app.get('/admin/ai/status', adminAuth, async (_req: Request, res: Response) => {
      if (!this.sharedAI) {
        res.status(404).json({ success: false, error: 'Shared AI connection not enabled' });
        return;
      }
      try {
        const status = await this.buildConnectionStatus(this.sharedAI.client, this.sharedAI.qrData);
        res.json({ success: true, data: status });
      } catch {
        res.status(500).json({ success: false, error: 'Failed to get status' });
      }
    });

    // GET /admin/ai/qr — QR code data URL for operator scanning
    this.app.get('/admin/ai/qr', adminAuth, async (_req: Request, res: Response) => {
      if (!this.sharedAI) {
        res.status(404).json({ success: false, error: 'Shared AI connection not enabled' });
        return;
      }
      if (!this.sharedAI.qrData) {
        const state = this.sharedAI.getState();
        if (state === 'connected') {
          res.json({ success: true, data: { qr: null, message: 'Already connected', phone: this.sharedAI.getPhoneNumber() } });
        } else {
          res.json({ success: true, data: { qr: null, message: `No QR available (state: ${state}). POST /admin/ai/connect first.` } });
        }
        return;
      }
      try {
        const qrDataUrl = await QRCode.toDataURL(this.sharedAI.qrData, { width: 400, margin: 2 });
        res.json({ success: true, data: { qr: qrDataUrl } });
      } catch {
        res.status(500).json({ success: false, error: 'Failed to generate QR' });
      }
    });

    // POST /admin/ai/connect — Start/restart the shared AI connection
    this.app.post('/admin/ai/connect', adminAuth, async (_req: Request, res: Response) => {
      if (!this.sharedAI) {
        res.status(404).json({ success: false, error: 'Shared AI connection not enabled' });
        return;
      }
      try {
        if (this.sharedAI.client.isReady()) {
          res.json({ success: true, data: { state: 'connected', message: 'Already connected', phone: this.sharedAI.getPhoneNumber() } });
          return;
        }
        await this.sharedAI.connect();
        res.json({ success: true, data: { state: 'connecting', message: 'Connection started — poll GET /admin/ai/qr for QR code' } });
      } catch (error) {
        console.error('[Server] Admin AI connect error:', error);
        res.status(500).json({ success: false, error: 'Failed to start AI connection' });
      }
    });

    // POST /admin/ai/disconnect — Disconnect the shared AI connection
    this.app.post('/admin/ai/disconnect', adminAuth, async (_req: Request, res: Response) => {
      if (!this.sharedAI) {
        res.status(404).json({ success: false, error: 'Shared AI connection not enabled' });
        return;
      }
      try {
        await this.sharedAI.disconnect();
        res.json({ success: true, data: { disconnected: true } });
      } catch (error) {
        console.error('[Server] Admin AI disconnect error:', error);
        res.status(500).json({ success: false, error: 'Failed to disconnect AI connection' });
      }
    });

    // POST /admin/bridge/config — Update AI bridge config at runtime
    // Called by Electron on startup to push its new bridge token to the daemon.
    // Without this, the daemon would keep a stale/empty token from its initial config load.
    this.app.post('/admin/bridge/config', adminAuth, (req: Request, res: Response) => {
      const body = req.body as Record<string, unknown> | undefined;
      const token = body?.token;
      const port = body?.port;

      if (typeof token !== 'string' || !token || typeof port !== 'number') {
        res.status(400).json({ success: false, error: 'Missing required fields: token (string), port (number)' });
        return;
      }

      if (this.sharedAI) {
        this.sharedAI.updateBridgeConfig(token, port);
        res.json({ success: true, data: { updated: true } });
      } else {
        res.status(404).json({ success: false, error: 'Shared AI connection not enabled — bridge config not applicable' });
      }
    });

    // ── 404 ──────────────────────────────────────────────────────────────
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ success: false, error: 'Not found' });
    });
  }

  start(): void {
    const host = this.config.host || '0.0.0.0';
    this.httpServer = this.app.listen(this.config.port, host, () => {
      console.log(`[Server] Relay running on ${host}:${this.config.port}`);
      console.log(`[Server] Health: http://${host === '0.0.0.0' ? 'localhost' : host}:${this.config.port}/health`);
    });
  }

  /** Gracefully close the HTTP server and cleanup timers */
  close(): Promise<void> {
    // Clean up rate limiter timers
    this.messageLimiter.destroy();
    this.pollLimiter.destroy();
    this.aiMessageLimiter.destroy();

    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
