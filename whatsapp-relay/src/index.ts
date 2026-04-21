/**
 * WhatsApp Relay Server — Entry Point (Streamlined Soccer)
 *
 * Thin always-on relay: Baileys connection + REST API.
 * Each authenticated user gets their own isolated WhatsApp session.
 *
 * Auth flow:
 *   1. User sends JWT in Authorization: Bearer header from the soccer app
 *   2. Server validates JWT against Supabase, resolves tenant session via TenantManager
 *   3. First call creates a session; user scans QR from the soccer app's Connect WhatsApp page
 *   4. Subsequent calls send from the user's own paired number
 */

import { RelayServer } from './server.js';
import { TenantManager } from './tenantManager.js';
import { ConnectionManager } from './connectionManager.js';
import type { ServerConfig } from './types.js';

// ── Configuration ──────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3100;
const API_KEY = process.env.API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || './data';
const MULTI_TENANT = process.env.MULTI_TENANT !== 'false'; // default true for soccer
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : undefined;

// Startup guards
if (!MULTI_TENANT && !API_KEY) {
  console.error('[Relay] FATAL: API_KEY environment variable is required in single-tenant mode.');
  process.exit(1);
}

if (MULTI_TENANT && !SUPABASE_URL) {
  console.error('[Relay] FATAL: SUPABASE_URL is required in multi-tenant mode.');
  process.exit(1);
}

if (MULTI_TENANT && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[Relay] FATAL: SUPABASE_SERVICE_ROLE_KEY is required in multi-tenant mode.');
  process.exit(1);
}

if (MULTI_TENANT && !SUPABASE_JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[Relay] FATAL: SUPABASE_JWT_SECRET is required in production multi-tenant mode.');
    process.exit(1);
  }
  console.warn('[Relay] WARNING: SUPABASE_JWT_SECRET not set — JWT signature verification DISABLED.');
}

if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[Relay] FATAL: PORT must be a valid port number (1-65535).');
  process.exit(1);
}

// ── Initialize ─────────────────────────────────────────────────────────────

const HOST = process.env.HOST || (MULTI_TENANT ? '0.0.0.0' : '127.0.0.1');

const config: ServerConfig = {
  port: PORT,
  host: HOST,
  apiKey: API_KEY,
  supabaseUrl: SUPABASE_URL || undefined,
  supabaseAnonKey: SUPABASE_ANON_KEY || undefined,
  supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY || undefined,
  supabaseJwtSecret: SUPABASE_JWT_SECRET || undefined,
  dataDir: DATA_DIR,
  allowedOrigins: ALLOWED_ORIGINS,
  multiTenant: MULTI_TENANT,
  adminKey: ADMIN_KEY || undefined,
};

// Store refs for ordered shutdown
let server: RelayServer | null = null;
let tenantManager: TenantManager | null = null;
let connectionManager: ConnectionManager | null = null;

// ── Start ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[Relay] WhatsApp Relay Server starting...');
  console.log(`[Relay] Mode: ${MULTI_TENANT ? 'MULTI-TENANT (cloud)' : 'SINGLE-TENANT (local)'}`);
  console.log(`[Relay] Port: ${PORT}`);
  console.log(`[Relay] Data dir: ${DATA_DIR}`);
  console.log(`[Relay] Supabase: ${SUPABASE_URL ? 'configured' : 'not configured'}`);
  console.log(`[Relay] CORS origins: ${ALLOWED_ORIGINS ? ALLOWED_ORIGINS.join(', ') : 'all (dev mode)'}`);

  if (MULTI_TENANT) {
    tenantManager = new TenantManager(DATA_DIR);
    server = new RelayServer(null, null, config, tenantManager, undefined);
    server.start();
    console.log(`[Relay] Multi-tenant relay ready! (${tenantManager.activeTenantCount} tenants)`);
  } else {
    connectionManager = new ConnectionManager({
      baseDataDir: DATA_DIR,
      connections: ['user'],
    });
    server = new RelayServer(null, null, config, undefined, connectionManager);
    server.start();
    await connectionManager.connectAll();
    console.log('[Relay] Ready!');
  }
}

// ── Graceful Shutdown ──────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Relay] ${signal} received. Shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[Relay] Shutdown timed out after 15s, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  try {
    if (server) {
      console.log('[Relay] Closing HTTP server...');
      await server.close();
    }
  } catch (err) {
    console.error('[Relay] Error closing HTTP server:', err);
  }

  if (MULTI_TENANT && tenantManager) {
    console.log('[Relay] Shutting down all tenants...');
    await tenantManager.shutdownAll();
  } else if (connectionManager) {
    console.log('[Relay] Shutting down all connections...');
    connectionManager.shutdownAll();
  }

  console.log('[Relay] Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  console.error('[Relay] Fatal error:', error);
  process.exit(1);
});
