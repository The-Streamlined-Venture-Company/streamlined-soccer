# Streamlined Soccer

A WhatsApp-native auto-organiser for weekly amateur football. The bot owns the
entire week: posts the call-out, tracks signups, nudges if numbers are low,
generates balanced teams, sends the organiser an approval link, posts a pitch
image to the group when confirmed, and runs an anonymous Man-of-the-Match vote
afterwards.

**Zero touching of WhatsApp by the organiser during the week.**

---

## Architecture

Three deployments, one repo:

1. **Vite/React app** (Vercel) — organiser dashboard, approval/confirm/MoM web
   pages, and a `/api/lineup-image` edge function that renders the pitch PNG.
2. **`runtime-tick` edge function** (Supabase) — the brain. Invoked every
   minute by `pg_cron`; reads schedule + state and decides what to fire.
3. **Multi-tenant WhatsApp relay** (Railway) — Baileys wrapper. Each organiser
   pairs their WhatsApp account via QR; relay routes per-tenant.

For full architecture, data model, runtime triggers, and account migration
playbook, see [HANDOFF.md](HANDOFF.md).

---

## Run locally

**Prerequisites:** Node.js 20+, an existing Supabase project with the soccer
schema applied (see migration playbook in HANDOFF.md §4.2).

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local`:
   ```
   VITE_SUPABASE_URL=https://<project_ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

3. Run the dev server:
   ```bash
   npm run dev
   ```

4. Typecheck:
   ```bash
   npm run typecheck
   ```

5. Production build:
   ```bash
   npm run build
   ```

---

## Repo layout

```
.
├── App.tsx                       # Top-level router + auth gate
├── api/lineup-image.tsx          # Vercel edge fn — pitch PNG (@vercel/og)
├── components/                   # React UI (admin/, MomVotePage, ApprovalPage, ...)
├── hooks/                        # Data hooks (usePlayers, useOrganiserConfig, ...)
├── lib/                          # supabase client, relay client, formatters
├── supabase/
│   ├── migrations/               # 35 SQL migrations — apply in version order
│   └── functions/runtime-tick/   # The runtime — Deno edge function
├── whatsapp-relay/               # Baileys multi-tenant relay (Railway)
└── HANDOFF.md                    # Full operator handbook
```

---

## Documentation

- [HANDOFF.md](HANDOFF.md) — full architecture, account-migration playbook,
  database schema, runtime trigger reference, common testing recipes, known
  gotchas, and roadmap.
- [RUNTIME_PLAN.md](RUNTIME_PLAN.md) — historical phase-by-phase plan
  (superseded by HANDOFF for current state).
- [whatsapp-relay/DEPLOY.md](whatsapp-relay/DEPLOY.md) — relay deployment notes.

---

## Status

End-to-end shipped and tested live. Single-tenant for now (one organiser, one
club, one WhatsApp group). Multi-tenant + sport-agnostic refactor are tracked
in HANDOFF.md §12.
