/**
 * JWT Authentication Middleware
 *
 * Validates Supabase JWTs for multi-tenant cloud mode.
 * In single-tenant mode, this is not used (API key auth is sufficient).
 *
 * Validation:
 *   1. Extract Bearer token from Authorization header
 *   2. Verify HMAC-SHA256 signature against JWT secret (cryptographic!)
 *   3. Decode and validate claims: exp, iss, aud, role, sub
 *
 * Supabase uses HS256 (HMAC-SHA256) for JWT signing. The secret is
 * available from the Supabase dashboard or SUPABASE_JWT_SECRET env var.
 * When no secret is configured, falls back to claim-only validation
 * with a warning — suitable for development but NOT for production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

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
  /** JWT secret for HS256 signature verification. Required for production. */
  jwtSecret?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** UUID v4 pattern for validating userId (sub claim) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify an HS256 JWT signature using the provided secret.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifyHS256Signature(token: string, secret: string): boolean {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;

  const signingInput = token.slice(0, lastDot);
  const providedSig = token.slice(lastDot + 1);

  // Compute expected signature
  const expectedSig = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  // Timing-safe comparison — both must be buffers of equal length
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  const providedBuf = Buffer.from(providedSig, 'utf-8');

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Decode a base64url-encoded JWT segment.
 */
function decodeB64Url(b64url: string): string {
  const normalized = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

/**
 * Validate the JWT header's algorithm claim.
 * Rejects tokens that don't use HS256 — prevents algorithm confusion attacks.
 */
function validateJwtHeader(token: string): boolean {
  try {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) return false;

    const headerJson = decodeB64Url(token.slice(0, dotIndex));
    const header = JSON.parse(headerJson) as { alg?: string; typ?: string };
    return header.alg === 'HS256';
  } catch {
    return false;
  }
}

/**
 * Decode a JWT payload (base64 decode, no signature check).
 * Returns the payload or null if malformed.
 */
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

// ── Middleware ────────────────────────────────────────────────────────────────

/** Logged once per process to avoid spam */
let signatureWarningLogged = false;

/**
 * Create Express middleware that validates JWT Bearer tokens.
 * Attaches userId and jwtPayload to the request.
 */
export function createJwtAuthMiddleware(config?: JwtAuthConfig): (req: Request, res: Response, next: NextFunction) => void {
  const expectedAudience = config?.expectedAudience ?? 'authenticated';
  const expectedIssuer = config?.expectedIssuer;
  const jwtSecret = config?.jwtSecret;

  if (!jwtSecret && !signatureWarningLogged) {
    signatureWarningLogged = true;
    console.warn('[jwtAuth] WARNING: No JWT secret configured — signature verification DISABLED. Set SUPABASE_JWT_SECRET for production.');
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7); // Remove 'Bearer '

    if (!token) {
      res.status(401).json({ success: false, error: 'Empty token' });
      return;
    }

    // ── Algorithm validation (defense-in-depth against alg confusion) ─────
    if (!validateJwtHeader(token)) {
      res.status(401).json({ success: false, error: 'Unsupported token algorithm — only HS256 is accepted' });
      return;
    }

    // ── Signature verification (cryptographic) ────────────────────────────
    if (jwtSecret) {
      if (!verifyHS256Signature(token, jwtSecret)) {
        res.status(401).json({ success: false, error: 'Invalid token signature' });
        return;
      }
    }

    // ── Decode payload ────────────────────────────────────────────────────
    const payload = decodeJwtPayload(token);

    if (!payload) {
      res.status(401).json({ success: false, error: 'Malformed JWT' });
      return;
    }

    // ── Claim validation ──────────────────────────────────────────────────

    // Require expiration — missing or zero exp is rejected
    if (!payload.exp || typeof payload.exp !== 'number') {
      res.status(401).json({ success: false, error: 'Token missing expiration' });
      return;
    }

    // Check expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      res.status(401).json({ success: false, error: 'Token expired' });
      return;
    }

    // Validate issuer if configured
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      res.status(401).json({ success: false, error: 'Invalid token issuer' });
      return;
    }

    // Validate audience
    if (expectedAudience && payload.aud !== expectedAudience) {
      res.status(401).json({ success: false, error: 'Invalid token audience' });
      return;
    }

    // Validate role — REQUIRE 'authenticated' (reject anon, service_role, or missing)
    if (payload.role !== 'authenticated') {
      res.status(403).json({ success: false, error: 'Invalid token role' });
      return;
    }

    // Require sub (userId) and validate UUID format
    if (!payload.sub || typeof payload.sub !== 'string') {
      res.status(401).json({ success: false, error: 'Token missing sub claim' });
      return;
    }

    if (!UUID_PATTERN.test(payload.sub)) {
      res.status(401).json({ success: false, error: 'Invalid sub claim format' });
      return;
    }

    // Attach to request
    (req as AuthenticatedRequest).userId = payload.sub;
    (req as AuthenticatedRequest).jwtPayload = payload;

    next();
  };
}

/**
 * Extract userId from a validated JWT token string (no middleware needed).
 * When jwtSecret is provided, verifies the signature first.
 * Returns null if the token is invalid or expired.
 */
export function extractUserId(token: string, jwtSecret?: string): string | null {
  // Validate algorithm header
  if (!validateJwtHeader(token)) return null;

  // Verify signature if secret provided
  if (jwtSecret && !verifyHS256Signature(token, jwtSecret)) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // Require expiration
  if (!payload.exp || typeof payload.exp !== 'number') return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSec) return null;

  // Require authenticated role
  if (payload.role !== 'authenticated') return null;

  // Validate UUID format
  if (!payload.sub || !UUID_PATTERN.test(payload.sub)) return null;

  return payload.sub;
}
