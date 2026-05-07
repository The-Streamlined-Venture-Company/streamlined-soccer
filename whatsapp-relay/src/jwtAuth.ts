/**
 * JWT Authentication Middleware
 *
 * Validates Supabase JWTs for multi-tenant cloud mode.
 * In single-tenant mode, this is not used (API key auth is sufficient).
 *
 * Modern Supabase projects sign tokens with ES256 (asymmetric ECDSA over P-256)
 * and publish a JWKS at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. Older
 * projects use HS256 (symmetric HMAC-SHA256) with a shared secret. We support
 * both so the same relay binary works for either.
 *
 * Resolution order per request:
 *   1. Read the JWT header `alg`. Reject anything other than ES256/HS256.
 *   2. ES256 → verify against the cached remote JWKS (refreshed by `jose`).
 *   3. HS256 → verify HMAC against `SUPABASE_JWT_SECRET`. If no secret is
 *      configured we log a one-time warning and skip signature verification —
 *      acceptable for development only.
 *   4. Validate claims: exp, iss, aud, role, sub.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload as JoseJWTPayload } from 'jose';

// ── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;          // userId
  email?: string;
  role?: string;        // 'authenticated', 'anon', 'service_role'
  exp: number;          // expiration (unix seconds)
  iat: number;          // issued at (unix seconds)
  aud?: string;         // audience — should be 'authenticated'
  iss?: string;         // issuer — should be Supabase project URL
}

/** Extended request with userId from JWT */
export interface AuthenticatedRequest extends Request {
  userId: string;
  jwtPayload: JwtPayload;
}

/** Configuration for JWT validation */
export interface JwtAuthConfig {
  /** Expected issuer (Supabase URL e.g. https://xxx.supabase.co/auth/v1) */
  expectedIssuer?: string;
  /** Expected audience — defaults to 'authenticated' */
  expectedAudience?: string;
  /** JWT secret for HS256 signature verification (legacy projects only). */
  jwtSecret?: string;
  /**
   * Supabase project URL (e.g. https://xxx.supabase.co). Required for ES256
   * verification — the JWKS is fetched from `<supabaseUrl>/auth/v1/.well-known/jwks.json`.
   */
  supabaseUrl?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** UUID v4 pattern for validating userId (sub claim) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPORTED_ALGS = new Set(['ES256', 'HS256']);

/**
 * Verify an HS256 JWT signature using the provided secret.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifyHS256Signature(token: string, secret: string): boolean {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;

  const signingInput = token.slice(0, lastDot);
  const providedSig = token.slice(lastDot + 1);

  const expectedSig = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  const providedBuf = Buffer.from(providedSig, 'utf-8');

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function decodeB64Url(b64url: string): string {
  const normalized = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

/** Read the `alg` claim from the JWT header. Returns null if malformed. */
function readJwtAlg(token: string): string | null {
  try {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) return null;
    const headerJson = decodeB64Url(token.slice(0, dotIndex));
    const header = JSON.parse(headerJson) as { alg?: string };
    return typeof header.alg === 'string' ? header.alg : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const json = decodeB64Url(parts[1]);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

// ── JWKS cache (one per supabaseUrl, lazy) ───────────────────────────────────

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(supabaseUrl);
  if (!jwks) {
    const jwksUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
    jwks = createRemoteJWKSet(jwksUrl, {
      cooldownDuration: 30_000,   // min interval between refresh attempts on miss
      cacheMaxAge: 600_000,       // 10 minutes — keys rotate rarely
    });
    jwksCache.set(supabaseUrl, jwks);
  }
  return jwks;
}

/**
 * Verify an ES256 token against the remote JWKS. Returns the payload on success.
 * Throws a string error message on any failure so the caller can return 401.
 */
async function verifyES256(token: string, supabaseUrl: string, expectedIssuer?: string, expectedAudience?: string): Promise<JoseJWTPayload> {
  const jwks = getJwks(supabaseUrl);
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ['ES256'],
    issuer: expectedIssuer,
    audience: expectedAudience,
  });
  return payload;
}

// ── Middleware ───────────────────────────────────────────────────────────────

let signatureWarningLogged = false;

/**
 * Create Express middleware that validates JWT Bearer tokens. Attaches
 * `userId` and `jwtPayload` to the request on success.
 */
export function createJwtAuthMiddleware(
  config?: JwtAuthConfig
): (req: Request, res: Response, next: NextFunction) => void | Promise<void> {
  const expectedAudience = config?.expectedAudience ?? 'authenticated';
  const expectedIssuer = config?.expectedIssuer;
  const jwtSecret = config?.jwtSecret;
  const supabaseUrl = config?.supabaseUrl;

  if (!supabaseUrl && !jwtSecret && !signatureWarningLogged) {
    signatureWarningLogged = true;
    console.warn('[jwtAuth] WARNING: No SUPABASE_URL or SUPABASE_JWT_SECRET configured — signature verification DISABLED. Set one for production.');
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    if (!token) {
      res.status(401).json({ success: false, error: 'Empty token' });
      return;
    }

    const alg = readJwtAlg(token);
    if (!alg || !SUPPORTED_ALGS.has(alg)) {
      res.status(401).json({ success: false, error: `Unsupported token algorithm "${alg ?? 'unknown'}" — only ES256 or HS256 accepted` });
      return;
    }

    let payload: JwtPayload | null = null;

    if (alg === 'ES256') {
      if (!supabaseUrl) {
        res.status(401).json({ success: false, error: 'ES256 token received but SUPABASE_URL not configured on relay' });
        return;
      }
      try {
        const verified = await verifyES256(token, supabaseUrl, expectedIssuer, expectedAudience);
        payload = verified as unknown as JwtPayload;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'verify failed';
        res.status(401).json({ success: false, error: `ES256 verification failed: ${msg}` });
        return;
      }
    } else {
      // HS256 — legacy path. Reject if no secret is configured: with neither
      // jwtSecret nor supabaseUrl-as-fallback, accepting an HS256 token would
      // mean skipping signature verification entirely (alg-confusion bypass).
      // Modern deploys use ES256 only and shouldn't ever see an HS256 token.
      if (!jwtSecret) {
        res.status(401).json({ success: false, error: 'HS256 tokens not accepted (relay configured for ES256 only — set SUPABASE_JWT_SECRET to enable HS256)' });
        return;
      }
      if (!verifyHS256Signature(token, jwtSecret)) {
        res.status(401).json({ success: false, error: 'Invalid token signature' });
        return;
      }
      payload = decodeJwtPayload(token);
      if (!payload) {
        res.status(401).json({ success: false, error: 'Malformed JWT' });
        return;
      }
    }

    // ── Claim validation (algorithm-independent) ─────────────────────────────

    // jose has already enforced exp/iss/aud for ES256, but we re-check so the
    // HS256 fallback path goes through the same gauntlet.

    if (!payload.exp || typeof payload.exp !== 'number') {
      res.status(401).json({ success: false, error: 'Token missing expiration' });
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      res.status(401).json({ success: false, error: 'Token expired' });
      return;
    }
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      res.status(401).json({ success: false, error: 'Invalid token issuer' });
      return;
    }
    if (expectedAudience && payload.aud !== expectedAudience) {
      res.status(401).json({ success: false, error: 'Invalid token audience' });
      return;
    }
    if (payload.role !== 'authenticated') {
      res.status(403).json({ success: false, error: 'Invalid token role' });
      return;
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      res.status(401).json({ success: false, error: 'Token missing sub claim' });
      return;
    }
    if (!UUID_PATTERN.test(payload.sub)) {
      res.status(401).json({ success: false, error: 'Invalid sub claim format' });
      return;
    }

    (req as AuthenticatedRequest).userId = payload.sub;
    (req as AuthenticatedRequest).jwtPayload = payload;
    next();
  };
}

/**
 * Extract userId from a validated JWT token string (no middleware needed).
 * For HS256 tokens, optionally verifies the signature with the provided secret.
 * For ES256 tokens, signature verification is skipped — callers that need it
 * should go through the middleware. This helper is used in non-critical paths
 * (e.g. log enrichment) where claim validation is sufficient.
 * Returns null if the token is invalid or expired.
 */
export function extractUserId(token: string, jwtSecret?: string): string | null {
  const alg = readJwtAlg(token);
  if (!alg || !SUPPORTED_ALGS.has(alg)) return null;

  if (alg === 'HS256' && jwtSecret && !verifyHS256Signature(token, jwtSecret)) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  if (!payload.exp || typeof payload.exp !== 'number') return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSec) return null;
  if (payload.role !== 'authenticated') return null;
  if (!payload.sub || !UUID_PATTERN.test(payload.sub)) return null;

  return payload.sub;
}
