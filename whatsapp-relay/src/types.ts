/**
 * WhatsApp Relay Server — Shared Types
 *
 * Types for the thin relay server that bridges Streamlined to WhatsApp via Baileys.
 * No AI, no business logic — just messaging primitives.
 */

// ── Message Limits ────────────────────────────────────────────────────────

export const MESSAGE_LIMITS = {
  MAX_TEXT_LENGTH: 4096,
  MAX_QUESTION_LENGTH: 256,
  MAX_OPTION_LENGTH: 100,
  MAX_OPTIONS_COUNT: 12,
  MIN_OPTIONS_COUNT: 2,
  MAX_JID_LENGTH: 64,
  MAX_GROUP_NAME_LENGTH: 128,
  MAX_TOKEN_LENGTH: 8192,
  MAX_USER_ID_LENGTH: 128,
} as const;

// ── Message Types ──────────────────────────────────────────────────────────

export type MessageType = 'text' | 'image' | 'poll' | 'reaction' | 'other';

export interface BufferedMessage {
  id: string;
  chatJid: string;
  chatName: string;
  senderJid: string;
  senderName: string;
  text: string;
  timestamp: number;
  isFromMe: boolean;
  type: MessageType;
}

export interface ChatSummary {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessage: BufferedMessage | null;
  unreadCount: number;
  lastActivity: number;
}

// ── Named Connections (Phase 25A — Dual WhatsApp) ─────────────────────────

/** Named WhatsApp connections within a single daemon process */
export type ConnectionName = 'user' | 'ai';

// ── Connection Types ───────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'qr-pending' | 'connected' | 'reconnecting';

export interface ConnectionStatus {
  state: ConnectionState;
  phoneNumber: string | null;
  groupCount: number;
  qrDataUrl: string | null;
  health: {
    lastSuccessMs: number;
    reconnectAttempts: number;
    isReconnecting: boolean;
  };
  timestamp: string;
}

/** Status of all named connections (Phase 25A) */
export interface MultiConnectionStatus {
  connections: Record<ConnectionName, ConnectionStatus>;
}

// ── Group Types ────────────────────────────────────────────────────────────

export interface WhatsAppGroup {
  jid: string;
  name: string;
}

// ── API Response ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Scheduler Types ────────────────────────────────────────────────────────

export interface ScheduledAction {
  id: string;
  templateId: string;
  templateConfig: Record<string, unknown>;
  cronExpression: string;
  nextRunAt: string;
  enabled: boolean;
}

export interface WhatsAppPollScheduleConfig {
  groupJid: string;
  groupName: string;
  question: string;
  options: string[];
  selectableCount: number;
}

// ── Poll Results ──────────────────────────────────────────────────────────

export interface PollVoteAggregate {
  name: string;
  voters: string[];  // voter JIDs
}

export interface PollResultData {
  messageId: string;
  chatJid: string;
  chatName: string;
  question: string;
  options: string[];
  results: PollVoteAggregate[];
  totalVotes: number;
  createdAt: number;
}

export interface WhatsAppMessageScheduleConfig {
  jid: string;
  text: string;
}

// ── Incoming Message Callback ──────────────────────────────────────────────

export type OnMessageCallback = (message: BufferedMessage) => void;
export type OnQRCallback = (qr: string | null) => void;
export type OnConnectionCallback = (state: ConnectionState) => void;

// ── Auth Payload ──────────────────────────────────────────────────────────

export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/** Callback fired when a valid auth payload arrives via POST /auth */
export type OnAuthCallback = (auth: AuthPayload) => void;

/** Callback fired when the user signs out via POST /auth/logout */
export type OnAuthLogoutCallback = () => void;

// ── Server Config ──────────────────────────────────────────────────────────

export interface ServerConfig {
  port: number;
  /** Host to bind to — defaults to '0.0.0.0'. Use '127.0.0.1' for loopback only (daemon mode). */
  host?: string;
  apiKey: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Supabase service role key — only used in multi-tenant cloud mode for cross-user queries */
  supabaseServiceRoleKey?: string;
  /** Supabase JWT secret for HS256 signature verification */
  supabaseJwtSecret?: string;
  dataDir: string;
  allowedOrigins?: string[];
  /** Enable multi-tenant mode (cloud relay with per-user sessions) */
  multiTenant?: boolean;
  /** Admin key for operator-only endpoints (e.g. /admin/ai/connect) */
  adminKey?: string;
}

// ── Reaction / Reply / Media Types ────────────────────────────────────────

export interface ReactionPayload {
  chatJid: string;
  messageId: string;
  emoji: string;
}

export interface ReplyPayload {
  chatJid: string;
  messageId: string;
  text: string;
}

export interface MediaPayload {
  to?: string;
  groupName?: string;
  type: 'image' | 'document';
  url: string;
  caption?: string;
  filename?: string;
}

// ── Input Validation ───────────────────────────────────────────────────────

export interface MessagePayload {
  to?: string;
  text?: string;
  groupName?: string;
}

export interface PollPayload {
  to?: string;
  groupName?: string;
  question?: string;
  options?: string[];
  selectableCount?: number;
}

export interface RelayValidationResult {
  valid: boolean;
  error?: string;
}

const JID_PATTERN = /^[\d]+@(s\.whatsapp\.net|g\.us|lid)$/;

/** Validate an auth payload */
export function validateAuthPayload(body: unknown): RelayValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const payload = body as Record<string, unknown>;

  if (!payload.accessToken || typeof payload.accessToken !== 'string') {
    return { valid: false, error: "Missing 'accessToken' field" };
  }
  if (payload.accessToken.length > MESSAGE_LIMITS.MAX_TOKEN_LENGTH) {
    return { valid: false, error: 'accessToken exceeds maximum length' };
  }
  if (!payload.refreshToken || typeof payload.refreshToken !== 'string') {
    return { valid: false, error: "Missing 'refreshToken' field" };
  }
  if (payload.refreshToken.length > MESSAGE_LIMITS.MAX_TOKEN_LENGTH) {
    return { valid: false, error: 'refreshToken exceeds maximum length' };
  }
  if (!payload.userId || typeof payload.userId !== 'string') {
    return { valid: false, error: "Missing 'userId' field" };
  }
  if (payload.userId.length > MESSAGE_LIMITS.MAX_USER_ID_LENGTH) {
    return { valid: false, error: 'userId exceeds maximum length' };
  }
  // Validate UUID format for userId
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.userId)) {
    return { valid: false, error: 'Invalid userId format — expected UUID' };
  }
  // Basic JWT format check (3 dot-separated parts)
  const parts = payload.accessToken.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid accessToken format' };
  }

  return { valid: true };
}

/** Validate a WhatsApp JID format */
export function validateJid(jid: string): RelayValidationResult {
  if (!jid || typeof jid !== 'string') {
    return { valid: false, error: 'JID is required' };
  }
  if (jid.length > MESSAGE_LIMITS.MAX_JID_LENGTH) {
    return { valid: false, error: 'JID exceeds maximum length' };
  }
  if (!JID_PATTERN.test(jid)) {
    return { valid: false, error: 'Invalid JID format' };
  }
  return { valid: true };
}

/** Validate a message payload */
export function validateMessagePayload(body: unknown): RelayValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const payload = body as MessagePayload;

  if (!payload.text || typeof payload.text !== 'string') {
    return { valid: false, error: "Missing 'text' field" };
  }
  if (payload.text.length > MESSAGE_LIMITS.MAX_TEXT_LENGTH) {
    return { valid: false, error: `Text exceeds ${MESSAGE_LIMITS.MAX_TEXT_LENGTH} characters` };
  }
  if (!payload.to && !payload.groupName) {
    return { valid: false, error: "Missing 'to' or 'groupName' field" };
  }
  if (payload.to && typeof payload.to === 'string') {
    const jidResult = validateJid(payload.to);
    if (!jidResult.valid) return jidResult;
  }
  if (payload.groupName && typeof payload.groupName !== 'string') {
    return { valid: false, error: "'groupName' must be a string" };
  }
  if (payload.groupName && payload.groupName.length > MESSAGE_LIMITS.MAX_GROUP_NAME_LENGTH) {
    return { valid: false, error: 'Group name exceeds maximum length' };
  }

  return { valid: true };
}

/** Validate a reaction payload */
export function validateReactionPayload(body: unknown): RelayValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }
  const p = body as Record<string, unknown>;
  if (!p.chatJid || typeof p.chatJid !== 'string') {
    return { valid: false, error: "Missing 'chatJid' field" };
  }
  const jidResult = validateJid(p.chatJid);
  if (!jidResult.valid) return jidResult;
  if (!p.messageId || typeof p.messageId !== 'string') {
    return { valid: false, error: "Missing 'messageId' field" };
  }
  if (p.messageId.length > 128) {
    return { valid: false, error: 'messageId exceeds maximum length' };
  }
  if (!p.emoji || typeof p.emoji !== 'string') {
    return { valid: false, error: "Missing 'emoji' field" };
  }
  if (p.emoji.length > 16) {
    return { valid: false, error: 'emoji exceeds maximum length' };
  }
  return { valid: true };
}

/** Validate a reply payload */
export function validateReplyPayload(body: unknown): RelayValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }
  const p = body as Record<string, unknown>;
  if (!p.chatJid || typeof p.chatJid !== 'string') {
    return { valid: false, error: "Missing 'chatJid' field" };
  }
  const jidResult = validateJid(p.chatJid);
  if (!jidResult.valid) return jidResult;
  if (!p.messageId || typeof p.messageId !== 'string') {
    return { valid: false, error: "Missing 'messageId' field" };
  }
  if (p.messageId.length > 128) {
    return { valid: false, error: 'messageId exceeds maximum length' };
  }
  if (!p.text || typeof p.text !== 'string') {
    return { valid: false, error: "Missing 'text' field" };
  }
  if (p.text.length > MESSAGE_LIMITS.MAX_TEXT_LENGTH) {
    return { valid: false, error: `Text exceeds ${MESSAGE_LIMITS.MAX_TEXT_LENGTH} characters` };
  }
  return { valid: true };
}

/** Validate a media payload */
export function validateMediaPayload(body: unknown): RelayValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }
  const p = body as Record<string, unknown>;
  if (!p.type || (p.type !== 'image' && p.type !== 'document')) {
    return { valid: false, error: "Missing or invalid 'type' field (must be 'image' or 'document')" };
  }
  if (!p.url || typeof p.url !== 'string') {
    return { valid: false, error: "Missing 'url' field" };
  }
  if (p.url.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum length' };
  }
  // Basic URL validation
  try {
    new URL(p.url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  if (!p.to && !p.groupName) {
    return { valid: false, error: "Missing 'to' or 'groupName' field" };
  }
  if (p.to && typeof p.to === 'string') {
    const jidResult = validateJid(p.to);
    if (!jidResult.valid) return jidResult;
  }
  if (p.groupName && typeof p.groupName === 'string' && p.groupName.length > MESSAGE_LIMITS.MAX_GROUP_NAME_LENGTH) {
    return { valid: false, error: 'Group name exceeds maximum length' };
  }
  if (p.caption && typeof p.caption === 'string' && p.caption.length > MESSAGE_LIMITS.MAX_TEXT_LENGTH) {
    return { valid: false, error: `Caption exceeds ${MESSAGE_LIMITS.MAX_TEXT_LENGTH} characters` };
  }
  if (p.filename && typeof p.filename === 'string' && p.filename.length > 256) {
    return { valid: false, error: 'Filename exceeds maximum length' };
  }
  return { valid: true };
}

/** Validate a poll payload */
export function validatePollPayload(body: unknown): RelayValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const payload = body as PollPayload;

  if (!payload.question || typeof payload.question !== 'string') {
    return { valid: false, error: 'Missing required field: question' };
  }
  if (payload.question.length > MESSAGE_LIMITS.MAX_QUESTION_LENGTH) {
    return { valid: false, error: `Question exceeds ${MESSAGE_LIMITS.MAX_QUESTION_LENGTH} characters` };
  }
  if (!Array.isArray(payload.options)) {
    return { valid: false, error: 'Missing required field: options (must be an array)' };
  }
  if (payload.options.length < MESSAGE_LIMITS.MIN_OPTIONS_COUNT) {
    return { valid: false, error: `Options must have at least ${MESSAGE_LIMITS.MIN_OPTIONS_COUNT} items` };
  }
  if (payload.options.length > MESSAGE_LIMITS.MAX_OPTIONS_COUNT) {
    return { valid: false, error: `Options cannot exceed ${MESSAGE_LIMITS.MAX_OPTIONS_COUNT} items` };
  }
  for (const opt of payload.options) {
    if (typeof opt !== 'string' || opt.trim().length === 0) {
      return { valid: false, error: 'All options must be non-empty strings' };
    }
    if (opt.length > MESSAGE_LIMITS.MAX_OPTION_LENGTH) {
      return { valid: false, error: `Option exceeds ${MESSAGE_LIMITS.MAX_OPTION_LENGTH} characters` };
    }
  }
  if (!payload.to && !payload.groupName) {
    return { valid: false, error: "Missing 'to' or 'groupName' field" };
  }
  if (payload.to && typeof payload.to === 'string') {
    const jidResult = validateJid(payload.to);
    if (!jidResult.valid) return jidResult;
  }
  if (payload.groupName && typeof payload.groupName === 'string' && payload.groupName.length > MESSAGE_LIMITS.MAX_GROUP_NAME_LENGTH) {
    return { valid: false, error: 'Group name exceeds maximum length' };
  }
  if (payload.selectableCount !== undefined) {
    if (typeof payload.selectableCount !== 'number' || !Number.isFinite(payload.selectableCount) || payload.selectableCount < 1) {
      return { valid: false, error: 'selectableCount must be a positive number' };
    }
    if (payload.selectableCount > payload.options.length) {
      return { valid: false, error: 'selectableCount cannot exceed number of options' };
    }
  }

  return { valid: true };
}
