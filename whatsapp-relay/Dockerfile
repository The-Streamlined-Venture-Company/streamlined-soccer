##
## Soccer WhatsApp Relay — Multi-stage Docker build for Railway
##
## Build context is this package directory (streamlined-soccer/whatsapp-relay/).
##

# ── Build stage ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Install ALL dependencies (including devDependencies for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /build/dist/ ./dist/

# Create persistent data directory for WhatsApp auth state + message buffer.
# Railway: mount a volume at /app/data to persist pairing across deploys.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# ── Environment Variables (set in Railway dashboard) ─────────────────────
#
# Required (multi-tenant mode — the default for soccer):
#   MULTI_TENANT=true
#   SUPABASE_URL=https://jgjjnpofbpvekdvdzbgb.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard → Settings → API>
#   SUPABASE_JWT_SECRET=<from Supabase dashboard → Settings → API → JWT Secret>
#
# Recommended:
#   ALLOWED_ORIGINS=https://streamlined-soccer.vercel.app,http://localhost:3000
#
# Optional:
#   PORT=3100 (Railway sets this automatically)
#   ADMIN_KEY=<strong random key, min 32 chars, for operator-only endpoints>
#

CMD ["node", "dist/index.js"]
