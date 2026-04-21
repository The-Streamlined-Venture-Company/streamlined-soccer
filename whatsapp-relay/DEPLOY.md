# Soccer WhatsApp Relay — Deployment Guide

Multi-tenant WhatsApp relay for Streamlined Soccer. Each authenticated user pairs their own number via the soccer app's Settings page.

## Architecture

```
streamlined-soccer (Vercel) ──HTTPS──► this relay (Railway)
                                            │
                                            ▼
                                   Baileys ──► WhatsApp
                                            │
                                            ▼
                              Supabase (soccer project)
```

- **Per-user sessions**: each Supabase user gets their own Baileys session on the relay, isolated under `/app/data/tenants/{userId}/`
- **Auth**: soccer app passes the user's Supabase JWT in `Authorization: Bearer`; relay validates against the soccer project's JWT secret
- **Pairing**: soccer app calls `POST /connect`, polls `GET /status`, shows QR; user scans with WhatsApp → Linked Devices

## Prerequisites

- Railway account
- Supabase project `jgjjnpofbpvekdvdzbgb` (Streamlined Tools — the soccer project)

## Deploy

```bash
# From this directory (streamlined-soccer/whatsapp-relay/)
cd /Users/zee/Dev/streamlined-soccer/whatsapp-relay

# Create a new Railway project scoped to this directory
railway init   # name it: soccer-whatsapp-relay

# Set env vars
railway variables set \
  MULTI_TENANT=true \
  SUPABASE_URL=https://jgjjnpofbpvekdvdzbgb.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<from supabase dashboard> \
  SUPABASE_JWT_SECRET=<from supabase dashboard> \
  ALLOWED_ORIGINS=https://streamlined-soccer.vercel.app,http://localhost:3000

# Add a persistent volume at /app/data (Railway dashboard → Settings → Volumes, 1 GB)
# Without this, every user's pairing is lost on redeploy.

# Deploy
railway up
```

Once deployed, Railway assigns a domain like `soccer-whatsapp-relay-production.up.railway.app`. Put this into `soccer.organiser_config.relay_url` in the soccer app's settings.

## Verify

```bash
RELAY=https://<your-domain>.up.railway.app

# No auth required
curl $RELAY/health
# → {"ok": true, "timestamp": "..."}

# With a soccer user JWT
JWT=<copy from supabase.auth.getSession() in the app>
curl "$RELAY/status" -H "Authorization: Bearer $JWT"
# → first call creates the tenant session. Returns state: "connecting" with qrDataUrl.
```

The soccer app's Settings → Connect WhatsApp page does this flow automatically:
1. `POST /connect` to spin up the session
2. Poll `GET /status` for the `qrDataUrl` field
3. Render QR → user scans → connection transitions to `connected`
4. Subsequent sends use the paired number

## Troubleshooting

| Issue | Fix |
|---|---|
| Pairing lost on redeploy | Volume not mounted — add one at `/app/data` |
| 401 on /status | JWT expired or invalid; refresh the session in the app |
| 403 on send | Trying to send on behalf of a user who hasn't paired yet |
| Multiple users see each other's QRs | Not possible — TenantManager isolates by userId |
