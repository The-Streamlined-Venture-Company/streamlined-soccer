# Streamlined Soccer — Handoff

> Read this in order. Sections are designed to be self-contained — you can
> jump to any one once you've read the TL;DR.

---

## 1. TL;DR

A WhatsApp-native auto-organiser for weekly amateur football. The bot owns the
entire week: posts the call-out, tracks signups, nudges if numbers are low,
generates balanced teams, sends the organiser an approval link, posts a pitch
image to the group when confirmed, and runs an anonymous Man-of-the-Match vote
afterwards. **Zero touching of WhatsApp by the organiser during the week.**

**Current state (May 2026):** end-to-end flow shipped + tested on a real
group. April test (24 April 2026) ran call-out → team gen → approval → image
post → MoM web-link voting → results. **Multi-tenant phases 1–5 shipped May
2026** — the singleton `organiser_config` is gone, the data model is
club-scoped via `clubs` / `club_members` / `club_players`, the runtime
iterates clubs, and new signups go through a 3-step "create your first club"
wizard (`components/OnboardingFlow.tsx`). See §12 for what's still ahead.

**Next big chunks:** WhatsApp pairing per-club via UI, club switcher UI,
billing (Stripe), sport-agnostic refactor.

---

## 2. Architecture

```
┌─────────────────────┐     pg_cron (every 60s)     ┌──────────────────────┐
│  Supabase Postgres  │ ───────────────────────────▶│  Edge Function       │
│  (data + cron)      │                              │  runtime-tick        │
│  org jaknbli...     │ ◀──────reads/writes──────── │  (deno.serve)        │
└─────────────────────┘                              └─────────┬────────────┘
        ▲                                                      │
        │                                                      │ HTTPS (JWT)
        │ Anon key (RPC)                                       ▼
┌───────┴─────────────┐                              ┌──────────────────────┐
│  Vercel             │                              │  Railway: Baileys    │
│  Vite/React app     │ ◀────browser pairs WA──────▶│  whatsapp-relay      │
│  + /api/lineup-image│                              │  (Node + Express)    │
└─────────────────────┘                              └──────────┬───────────┘
                                                                │
                                                                ▼
                                                        WhatsApp servers
```

**Three deployments**, one repo:

1. **Soccer app (Vercel)** — Vite/React frontend. Routes:
   - `/` — main app (lineup pitch, players, organiser settings)
   - `/approve/:token` — team approval link (organiser DM destination)
   - `/confirm/:token` — weekly skip link (organiser DM destination)
   - `/mom/:token` — public anonymous MoM vote page
   - `/api/lineup-image?id=<lineup_uuid>` — Vercel edge function, returns PNG of
     the pitch with shirts in formation. Posted to WhatsApp via the relay's
     `/media` endpoint.

2. **Supabase project** (id `jgjjnpofbpvekdvdzbgb` "Streamlined Tools" in
   `ap-south-1`) — Postgres + Vault + pg_cron + Edge Functions. The single
   edge function `runtime-tick` is invoked every minute by `cron.job
   runtime-tick`. It reads schedule + state, decides what (if anything) needs
   firing this minute, and calls the relay over HTTPS using a JWT minted from
   the project's JWT secret (stored in Vault, accessed via RPC
   `soccer.get_jwt_secret`).

3. **WhatsApp relay (Railway)** — multi-tenant Baileys wrapper. The soccer
   app's organiser scans a QR via the in-app Settings page → relay creates a
   per-tenant Baileys session keyed by Supabase userId, persists `auth_info` to
   a Railway volume. Every API call carries the user's Supabase JWT in
   `Authorization: Bearer …`; the relay validates against the project's
   JWT secret and routes to the correct tenant session.

   Currently deployed as `soccer-whatsapp-relay-production.up.railway.app`.
   Relay code lives at `whatsapp-relay/` inside this same repo.

---

## 3. Production URLs + Identifiers (current)

| Service | URL / ID | Owner |
|---|---|---|
| GitHub repo (canonical) | https://github.com/The-Streamlined-Venture-Company/streamlined-soccer | The Streamlined Venture Company |
| Supabase project | `thffjqfhuvwoosqcqoha` ("Streamlined Tools", ap-northeast-1) | z@zee.me |
| Supabase DB host | `db.thffjqfhuvwoosqcqoha.supabase.co` | z@zee.me |
| Vercel project | `z-5779s-projects/streamlined-soccer` (`prj_kVvmREGCjMu8zjZQHMZoFhmenVLe`) | z-5779s-projects |
| Vercel public alias | https://streamlined-soccer-cyan.vercel.app | z-5779s-projects |
| Railway project | `soccer-whatsapp-relay` | z@zee.me |
| Railway service | `soccer-whatsapp-relay` (production env) | z@zee.me |
| Relay public URL | https://soccer-whatsapp-relay-production.up.railway.app | z@zee.me |
| Bot's WhatsApp number | +44 7999 605999 (currently paired to organiser Zee) | depends on who pairs |

**Repo consolidation (May 2026):** the canonical repo is now
`The-Streamlined-Venture-Company/streamlined-soccer`. Vercel auto-deploys from
its `main` branch (push to `main` → ~30s build → live on
`streamlined-soccer-cyan.vercel.app`). Earlier work bounced between this org
repo and a personal fork (`zsection/streamlined-soccer`); the personal fork is
archived as a read-only safety net. The Jan 2026 head of the org repo
(an abandoned `html-to-image` experiment) was preserved on
`legacy/jan-2026-image-export` before being overwritten — and its core fix was
cherry-picked back into `main` (`de5a073`).

**During account migration, all 4 services need to be re-created on the new
accounts.** The repo can stay on GitHub or move; the rest must be re-deployed
because they're tenant-scoped to specific accounts.

---

## 4. Account Migration Playbook

This is the playbook to run when moving to fresh Supabase + Vercel + Railway
accounts. Repo can stay on GitHub or be re-created — same steps either way.

### 4.1. Pre-migration: capture state from old project

Before tearing anything down on the old accounts, **dump the data you want to
keep**. You'll likely want to migrate the `players` table at minimum (their
ratings, aliases, whatsapp_phone numbers). Tonight's session schedule + weekly
sessions are testing artefacts — fine to recreate.

```sql
-- Run in old project's SQL editor; export each as JSON or CSV
SELECT * FROM soccer.players;
SELECT * FROM soccer.session_schedules;
SELECT * FROM soccer.organiser_config;
SELECT * FROM soccer.team_constraints;       -- empty in current project but kept for future
```

The `weekly_sessions`, `lineups`, `mom_votes`, `runtime_events` tables are
ephemeral — let them regenerate.

### 4.2. New Supabase project

1. **Create project.** Pick a region close to organisers (Dubai users → Mumbai
   `ap-south-1` works well, or `me-central-1`).

2. **Note the new project ref + URL + anon key + service role key + JWT secret.**
   You'll find them in Project Settings → API. Keep these private — record
   them in your password manager and **never** commit them to the repo.

3. **Apply all migrations in order.** Migrations are checked into
   `supabase/migrations/` (the names match the list in §6 below). The
   `supabase` CLI does this with `supabase db push --linked`, OR you can
   replay each migration's SQL via `mcp__supabase__apply_migration` if using
   an LLM agent. There are 35 migrations — apply in version-number order.

4. **Stash the JWT secret in Vault** (the runtime needs it to mint user JWTs
   for relay calls). In the SQL editor:
   ```sql
   SELECT vault.create_secret(
     '<paste your project JWT secret here>',
     'jwt_secret_for_user_token_minting',
     'Used by soccer.get_jwt_secret() to mint per-user JWTs for the relay'
   );
   ```
   Then verify the RPC works:
   ```sql
   SELECT length(soccer.get_jwt_secret()) AS secret_len;  -- should be 88
   ```

5. **Stash the service role key in Vault** (the cron job uses it to call the
   edge function):
   ```sql
   SELECT vault.create_secret(
     '<paste service role key here>',
     'service_role_key',
     'Used by pg_cron to authenticate runtime-tick invocations'
   );
   ```

6. **Set up the cron job:**
   ```sql
   SELECT cron.schedule(
     'runtime-tick',
     '* * * * *',
     $$
     select net.http_post(
       url := 'https://<NEW_PROJECT_REF>.supabase.co/functions/v1/runtime-tick',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || (
           select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
         ),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object('source', 'cron')
     );
     $$
   );
   ```

7. **Deploy the edge function:**
   ```bash
   cd /path/to/streamlined-soccer
   SUPABASE_ACCESS_TOKEN=<your-personal-access-token> \
     npx supabase functions deploy runtime-tick \
     --project-ref <NEW_PROJECT_REF> --use-api
   ```

8. **Set the function's env vars** (Project Settings → Functions → Secrets):
   - `APP_URL` — the Vercel URL where the soccer app lives (without trailing
     slash). Defaults to `https://streamlined-soccer-cyan.vercel.app` if not
     set, but **you should override this** to the new Vercel project's URL,
     otherwise pitch images, approval links, MoM vote links etc. will all
     point at the old project.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

9. **Restore data** — import `players`, `session_schedules`, `organiser_config`
   rows from the old project (CSV → SQL `INSERT`s, or via the Supabase
   dashboard Table editor).

10. **Create a Supabase auth user** (your organiser account). Either sign up
    via the soccer app once it's deployed, OR insert via the SQL editor:
    ```sql
    -- After signing up via the app, give yourself organiser role:
    UPDATE soccer.app_users SET role = 'admin' WHERE email = '<your-email>';
    ```
    The runtime-tick function picks the first admin/organiser as the
    "sender" — i.e. the WhatsApp account it speaks from. If multiple
    organisers exist, it picks one arbitrarily.

### 4.3. New Railway project (relay)

1. **Create new Railway project.** Add a single service from the GitHub repo
   pointing at the `whatsapp-relay/` subdirectory. Railway auto-detects the
   Dockerfile.

2. **Set env vars** on the service:
   - `MULTI_TENANT=true`
   - `SUPABASE_URL=https://<NEW_PROJECT_REF>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=<from new Supabase>`
   - `SUPABASE_JWT_SECRET=<from new Supabase>`  ← **same secret you put in Vault** above; the relay needs it to validate JWTs minted by the runtime
   - `ALLOWED_ORIGINS=https://<your-new-vercel-url>,http://localhost:3000`
   - `PORT=8080`
   - `DATA_DIR=/app/data`

3. **Mount a Railway volume** at `/app/data` — the relay persists every
   tenant's Baileys `auth_info/` here. Without this volume, every redeploy
   would invalidate your WhatsApp session.

4. **Deploy.** Railway picks up the Dockerfile + `railway.json` automatically.
   Healthcheck path is `/health`.

5. **Note the relay's public URL** (something like
   `https://soccer-whatsapp-relay-production-XXXX.up.railway.app`). You'll
   set this in the Supabase `organiser_config.relay_url` column shortly.

6. **Auto-reconnect on startup** is built in (added April 2026). On every
   container restart, the relay scans `/app/data/tenants/*/auth_info/` and
   eagerly reconnects each tenant's Baileys session — no manual QR scan
   needed for redeploys, only for first-time pairing or WhatsApp itself
   invalidating the session.

### 4.4. New Vercel project (soccer app)

1. **Import the GitHub repo into Vercel.** Vite is auto-detected.

2. **Configure env vars** (Production):
   - `VITE_SUPABASE_URL=https://<NEW_PROJECT_REF>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<from new Supabase>`

3. **Deploy.** Vercel builds via `npm run build` (Vite), serves the SPA + the
   `/api/lineup-image` edge function automatically.

4. **(Optional) Set up a friendlier alias domain.** The original was
   `streamlined-soccer-cyan.vercel.app`. If you map a custom domain, update
   `APP_URL` on the Supabase function to match.

### 4.5. Final wiring + first pairing

1. **In Supabase**, update `soccer.organiser_config`:
   ```sql
   UPDATE soccer.organiser_config SET
     relay_url = 'https://<NEW_RAILWAY_URL>',
     timezone = 'Asia/Dubai',  -- or whatever your matches are in
     enabled = true
   WHERE id = 1;
   ```

2. **Open the new Vercel app** in a browser, sign in as the organiser, go to
   Organiser Settings → WhatsApp, hit Connect, scan the QR with the bot's
   WhatsApp account. (For Streamlined Soccer this was a dedicated bot number;
   for testing you can use your own — the bot will post from that number.)

3. **Verify** by checking Supabase `runtime_events` — within 60 seconds you
   should see ticks logged.

4. **Configure a session schedule** via Organiser Settings → Sessions, OR
   directly in SQL via INSERT into `soccer.session_schedules`. Pick the
   WhatsApp group from the dropdown (it queries `/groups` on the relay).

5. **Match WhatsApp members to players** via Players → "Match WhatsApp" tab.
   This populates each player's `whatsapp_jid` so MoM DMs / voter mapping
   work properly.

6. **Done.** From this point the runtime takes over.

---

## 5. Repo Layout

```
streamlined-soccer/
├── App.tsx                            # Top-level router + auth gate
├── api/
│   └── lineup-image.tsx               # Vercel edge fn — pitch PNG via @vercel/og
├── components/
│   ├── ApprovalPage.tsx               # /approve/:token — organiser team approval UI
│   ├── ConfirmPage.tsx                # /confirm/:token — weekly skip link
│   ├── MomVotePage.tsx                # /mom/:token — public anonymous MoM voting
│   ├── Pitch.tsx                      # Main pitch component (shirt formation)
│   ├── PlayerNode.tsx                 # Single shirt + name on the pitch
│   ├── ShirtIcon.tsx                  # SVG shirt icon (black/white variants)
│   ├── admin/
│   │   ├── PlayerManager.tsx          # Roster CRUD + "Match WhatsApp" tab toggle
│   │   ├── MatchWhatsAppMembers.tsx   # Maps group members → player records
│   │   ├── SessionEditor.tsx          # Per-schedule config (kickoff, MoM, etc.)
│   │   ├── SessionsList.tsx           # List + add/remove session schedules
│   │   ├── OrganiserSettings.tsx      # Top-level org settings + WA connection
│   │   ├── ConnectWhatsApp.tsx        # QR scan UI
│   │   ├── GroupPicker.tsx            # Dropdown of relay groups
│   │   └── TestPanel.tsx              # Dev panel for sending sample messages
│   └── ...
├── hooks/
│   ├── usePlayers.ts                  # Roster CRUD + local-storage fallback
│   ├── useSessionSchedules.ts         # Schedule CRUD
│   ├── useOrganiserConfig.ts          # Singleton config (id=1)
│   ├── useWhatsAppConnection.ts       # /status polling, /connect, QR
│   ├── useWhatsAppGroups.ts           # /groups list
│   ├── useGroupParticipants.ts        # /groups/:jid/participants
│   ├── useApprovalLineup.ts           # Load/save/confirm a pending lineup
│   ├── useWeeklySessionByToken.ts     # Confirm-page data loader
│   └── useChat.ts                     # AI chat with the player roster
├── lib/
│   ├── supabase.ts                    # Singleton supabase client
│   ├── relayClient.ts                 # Typed wrapper around relay HTTP API
│   ├── messageFormat.ts               # WhatsApp message formatting helpers
│   ├── sampleMessages.ts              # Test-panel sample generators
│   └── nameMatch.ts                   # Fuzzy name matcher (WA push name → player)
├── types/
│   └── database.ts                    # Hand-curated Supabase types
├── utils/
│   └── teamBalancer.ts                # Browser-side balancer (used in TestPanel)
├── supabase/
│   └── functions/
│       └── runtime-tick/
│           └── index.ts               # THE main runtime — Deno edge function
├── whatsapp-relay/                    # Baileys multi-tenant relay (Railway)
│   ├── Dockerfile
│   ├── railway.json
│   ├── DEPLOY.md
│   └── src/
│       ├── server.ts                  # Express HTTP server
│       ├── whatsapp.ts                # Baileys client wrapper
│       ├── tenantManager.ts           # Per-userId session isolation
│       ├── jwtAuth.ts                 # Validates Supabase JWTs on each request
│       ├── connectionManager.ts       # Single-tenant mode (rarely used)
│       ├── messageBuffer.ts           # Inbound message persistence
│       └── types.ts                   # Validation + payload types
└── HANDOFF.md                         # ← you are here
```

---

## 6. Database Schema (`soccer.*`)

Tables and their purpose:

| Table | Rows of note | Purpose |
|---|---|---|
| `app_users` | Mirrors `auth.users`, adds `role` | Who's allowed in. RLS-gated. |
| `organiser_config` | One row, `id=1` | Singleton: relay URL, timezone, enabled flag, bot persona. |
| `session_schedules` | One row per recurring weekly session | "Tuesday Night Football": when to call out, kickoff time, target/min players, MoM method, etc. |
| `weekly_sessions` | One per scheduled match per week | This week's instance: state machine, signups, voter JIDs, lineup_id, MoM ballots. UNIQUE(schedule_id, match_date). |
| `lineups` | One per generated lineup | `player_positions` JSONB (12 player cards), approval_token, status, posted_at. |
| `players` | Your roster | Skills (shooting, passing, etc.), `whatsapp_jid`, `whatsapp_phone`, `aliases`. |
| `team_constraints` | (currently empty) | Future: "always together" / "never together" pair constraints for the balancer. Schema exists, balancer doesn't read it yet. |
| `mom_votes` | One per anonymous web vote | `weekly_session_id`, `voted_for_player_id`, `voter_fingerprint`. UNIQUE(session, fingerprint) for dedup. |
| `runtime_events` | Append-only log | Every cron tick + every fire/error. Read this to debug "why didn't X happen?". |
| `chat_threads` / `chat_messages` | AI chat with roster | Independent from the auto-organiser. |

**Key state machine — `weekly_sessions.state` enum:**

```
pending
  → confirmation_sent     (organiser DM with skip link sent)
    → confirmation_declined  (organiser tapped Skip)
  → callout_sent          (group poll posted)
    → morning_nudge_sent  (low-signups nudge sent)
    → followup_sent       (legacy; kept for compatibility)
    → teams_pending_approval  (lineup created, awaiting confirm)
      → teams_posted      (image posted to group)
        → mom_sent        (MoM poll/link sent)
          → mom_closed    (results announced in group)
  cancelled
```

Once a state is reached, prior steps skip themselves on subsequent ticks.
Idempotency is via these state checks plus per-stage sentinels
(`mom_message_id`, `team_post_message_id`, etc.).

**Key columns added recently** (Phase 6+):

- `players.whatsapp_jid` (UNIQUE WHERE NOT NULL) — canonical handle for vote
  matching + DM sending.
- `players.whatsapp_phone` — display-friendly digits.
- `players.discovered_via` — `'manual'` (organiser added) | `'whatsapp_auto'`
  (created from "Match Members" UI).
- `weekly_sessions.signup_voter_jids` — JIDs of poll-in voters (from the
  group's call-out poll).
- `weekly_sessions.unmapped_voter_jids` — voters who aren't yet matched to a
  player record.
- `weekly_sessions.forced_lineup_player_ids` — manual override; if set,
  team_gen uses these exact players instead of the voter-mapping path. Used
  for one-off custom lineups.
- `weekly_sessions.mom_ballots` — per-player DM ballot tracking (MoM via DM
  poll mode).
- `weekly_sessions.mom_vote_token` — public token for the web-link MoM page.
- `session_schedules.team_force_post_minutes_before_kickoff` — fallback
  auto-post if organiser doesn't approve in time. Default 30.

**Migrations applied** (all in `supabase/migrations/` — apply in this order
on a new project):

```
20260130175035_create_soccer_schema
20260130175643_move_league_tables_to_schema
20260130181316_add_user_signup_trigger
20260130181327_app_users_rls_policies
20260130181559_simple_rls_for_solo_use
20260131051203_create_chat_tables
20260131100326_add_pending_confirmation_status
20260131200112_create_chat_tables
20260131213844_create_players_table
20260201111352_notifications_system
20260420153324_soccer_organiser_config
20260420171415_soccer_organiser_advanced_rules
20260421013052_soccer_confirmation_relative_offset
20260421014241_soccer_mom_voting_config
20260421015011_soccer_multi_session_schedules
20260421015622_soccer_default_confirmation_day_before_4pm
20260421015937_soccer_session_team_gen_instructions
20260421023415_soccer_callout_poll_options
20260421024144_soccer_callout_poll_question
20260421030140_soccer_team_gen_require_approval
20260421033758_soccer_lineup_approval_flow
20260421045342_soccer_mom_results_minutes
20260421050832_soccer_balancer_simple_toggles
20260421051125_soccer_drop_balancer_toggles
20260421053857_soccer_runtime_foundation
20260421074358_soccer_get_jwt_secret_rpc
20260421091540_soccer_confirmation_token
20260421110035_soccer_consolidate_nudge
20260421113912_soccer_phase6_whatsapp_voter_mapping
20260421122533_soccer_lineup_image_rpc
20260421123640_soccer_mom_dm_ballots
20260421124926_soccer_forced_lineup_override
20260421125308_soccer_add_organiser_dm_mom_method
20260421183122_soccer_mom_web_link_voting
20260421183506_soccer_mom_vote_page_results_at
```

---

## 7. The runtime-tick Edge Function — what fires when

The Deno function at `supabase/functions/runtime-tick/index.ts` is invoked
every minute. On each tick it:

1. Loads `organiser_config` (the singleton). Skips if `enabled = false`.
2. Loads all enabled `session_schedules`.
3. For each schedule, computes the local day-of-week and minute-of-day in the
   organiser's timezone (default `Asia/Dubai`).
4. Compares to each schedule's various trigger times. **Each trigger fires
   exactly when its computed minute matches the current minute.** Triggers:

| Trigger | When | What |
|---|---|---|
| `confirmation_dm` | `confirmation_days_before` days before `weekly_post_dow` at `confirmation_time` | DM organiser a "still on?" link to /confirm/:token |
| `callout_poll` | `weekly_post_dow` at `weekly_post_time` | Post the In/Out poll to the WA group |
| `nudge` | `nudge_days_before` days before `kickoff_dow` at `nudge_time` | Group post if signups < min_players ("we've got X/12 — need Y more") |
| `team_gen` | `kickoff_dow` at `kickoff_time - team_gen_offset_hours*60` | Generate balanced lineup, DM approval link |
| `team_force_post` | `kickoff_dow` at `kickoff_time - team_force_post_minutes_before_kickoff` | If lineup still pending, promote to confirmed (so it auto-posts) |
| `mom_poll` | `kickoff_dow` at `kickoff_time + match_duration_minutes + mom_delay_minutes` | Send MoM poll/DMs/web link (mode-dependent) |
| `mom_results` | mom_poll time + `mom_results_post_minutes` | Aggregate votes, post winner to group |

5. Plus two non-time-triggered sweeps every tick:
   - `refreshActiveSignups` — for any session in `callout_sent` state, fetches
     the relay's `/polls?chatJid=...`, sums In/Out/Maybe counts, writes back
     `signups_in/out/maybe` + `signup_voter_jids`.
   - `postConfirmedLineups` — finds any lineup with `status='confirmed'` and
     null `posted_at`, posts the pitch image (no text, image only, with
     /api/lineup-image URL via relay's `/media`). Used both for organiser-
     confirmed lineups AND force-posted ones.

**MoM has three modes**, controlled by `session_schedules.mom_method`:

- `'web_link'` (current default) — bot posts a public link to the group;
  players vote anonymously; results aggregated from `soccer.mom_votes`.
- `'organiser_dm'` — single DM poll to the organiser with all 12 names; they
  vote on behalf of the group.
- `'auto'` — per-player DM polls (each player gets a private poll with the
  other 11 as options). Production-ready but **requires every player to have
  `whatsapp_jid` set** AND respects the relay's 5-polls/min rate limit
  (loop sleeps 13s between sends).

---

## 8. WhatsApp Identity Model (important nuance)

WhatsApp now exposes participants in two formats:

- `<digits>@s.whatsapp.net` — the classic phone-number JID. Works for DMs.
- `<digits>@lid` — the new "Linked ID". Hides the phone number from people
  who don't have the contact saved. Increasingly common.

**Implications for this app:**

- Group participants returned by Baileys' `groupMetadata` are increasingly
  `@lid` with no phone number visible to the bot.
- Poll vote payloads use whichever format WhatsApp gave that voter.
- To DM someone you need the phone number → `<digits>@s.whatsapp.net`. The
  bot can't DM via @lid reliably.
- Push names (display names) only get cached when the bot has actually seen
  that person send a message in a chat the bot is in. Most participants
  have no push name on first contact.

**The "Match WhatsApp Members" UX** (in PlayerManager) bridges this:

1. Pulls `groupMetadata.participants` from the relay's `/groups/:jid/participants`
   endpoint.
2. For each participant, fuzzy-matches the push name against player roster
   (using `lib/nameMatch.ts`).
3. Organiser one-tap-confirms each match (or creates a new player).
4. **For voter matching**, runtime-tick falls back to phone-digit matching
   when JIDs don't line up exactly (LID vs s.whatsapp.net).

For **one-time setup** when push names aren't visible (e.g. first deploy),
you can collect phone numbers manually and update via SQL:
```sql
UPDATE soccer.players
SET whatsapp_phone = '<digits-only>',
    whatsapp_jid = '<digits>@s.whatsapp.net'
WHERE id = '<player-uuid>';
```

---

## 9. Configuration matrix

| Where | Variable | Purpose | Notes |
|---|---|---|---|
| Vercel (Production) | `VITE_SUPABASE_URL` | Browser → Supabase | Public |
| Vercel (Production) | `VITE_SUPABASE_ANON_KEY` | Anon key for browser RPC + table access | Public (gated by RLS) |
| Supabase Edge Functions | `APP_URL` | Where the soccer app lives — used in approval/confirm/MoM links + image URLs | Defaults to `https://streamlined-soccer-cyan.vercel.app`. Override per-environment. |
| Supabase Edge Functions | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | Don't set manually |
| Supabase Vault (RPC accessor) | `service_role_key` | pg_cron uses this to call the edge function | Read via `vault.decrypted_secrets` in the cron command |
| Supabase Vault (RPC accessor) | `<jwt secret stored under any name>` | Edge function uses this to mint per-user JWTs for relay calls | Accessed via `soccer.get_jwt_secret()` RPC. **The secret value must equal the project's JWT secret.** |
| Railway (relay) | `MULTI_TENANT=true` | Use per-userId tenant isolation | Always true for cloud mode |
| Railway (relay) | `SUPABASE_URL` | For JWT validation | Same as above |
| Railway (relay) | `SUPABASE_SERVICE_ROLE_KEY` | For tenant ops | Same as above |
| Railway (relay) | `SUPABASE_JWT_SECRET` | **Must equal** the project's JWT secret — relay validates incoming JWTs against this | **The most common config error: this not matching the Supabase project's JWT secret → all relay requests come back 401.** |
| Railway (relay) | `ALLOWED_ORIGINS` | CORS allowlist | Comma-separated. Include the Vercel domain. |
| Railway volume | `/app/data` | Per-tenant Baileys auth_info persistence | **Must be a volume**, not container FS. Without it, every redeploy invalidates WhatsApp pairing. |
| Soccer DB | `soccer.organiser_config.relay_url` | Where edge function calls the relay | Set after Railway deploys, format: `https://...up.railway.app` (no trailing slash) |
| Soccer DB | `soccer.organiser_config.timezone` | Default `Asia/Dubai`. Affects every cron-time decision. | IANA TZ name |
| Soccer DB | `soccer.organiser_config.enabled` | Master kill switch | If false, runtime logs "disabled — skipping" and does nothing |

---

## 10. Common testing recipes

### Manually trigger a cron tick

The runtime-tick function is JWT-gated. From a terminal with `psql`:
```sql
SELECT net.http_post(
  url := 'https://<PROJECT_REF>.supabase.co/functions/v1/runtime-tick',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
    'Content-Type', 'application/json'
  ),
  body := '{"source": "manual"}'::jsonb
);
```

### Force fire a specific stage right now

The runtime fires by *clock match*. Quickest way to fire something is to
shift the schedule's relevant time to the next clean minute, then wait ≤60s.

```sql
-- e.g. fire team_gen at 18:19 (kickoff at 20:00, offset 1.6833h)
UPDATE soccer.session_schedules
SET kickoff_time = '20:00', team_gen_offset_hours = 1.6833
WHERE id = '<schedule-uuid>';
-- Reset weekly_session so team_gen doesn't skip:
UPDATE soccer.weekly_sessions
SET state = 'callout_sent', lineup_id = NULL
WHERE id = '<session-uuid>';
```

### Inject a manual lineup (skip team_gen logic entirely)

```sql
UPDATE soccer.weekly_sessions
SET forced_lineup_player_ids = '["<uuid1>","<uuid2>",...]'::jsonb,
    state = 'callout_sent',
    lineup_id = NULL
WHERE id = '<session-uuid>';
-- Then trigger team_gen as above.
```

### Re-trigger a failed MoM send

```sql
-- Reset MoM state so fireMomPoll re-fires
UPDATE soccer.weekly_sessions
SET mom_message_id = NULL,
    mom_ballots = '[]'::jsonb,
    mom_unmapped_names = '[]'::jsonb,
    mom_vote_token = NULL
WHERE id = '<session-uuid>';
-- Then bump mom_delay_minutes so the fire time matches the next minute
UPDATE soccer.session_schedules SET mom_delay_minutes = <calc>
WHERE id = '<schedule-uuid>';
```

### Re-post a lineup (e.g. for image iteration)

```sql
UPDATE soccer.lineups
SET status = 'confirmed', posted_at = NULL, updated_at = now()
WHERE id = '<lineup-uuid>';
-- Next tick (≤60s) postConfirmedLineups picks it up
```

### Tail runtime events

```sql
SELECT (occurred_at AT TIME ZONE 'Asia/Dubai')::text AS t, kind, summary
FROM soccer.runtime_events
WHERE occurred_at > now() - interval '10 minutes'
ORDER BY occurred_at DESC;
```

### Hit relay /status with a valid JWT

JWT must be HS256-signed with the project's JWT secret, claim `sub` = an
admin/organiser user UUID. There's a Python script template in the conversation
history (search for `mint_jwt`). For one-off testing, the soccer app's
ConnectWhatsApp page will hit `/status` from the browser (using the user's
session JWT) — easier than minting one manually.

---

## 11. Known issues + gotchas (don't trip on these)

1. **Relay rate-limits polls at 5/minute per user.** `fireMomPoll` (per-player
   DM mode) sleeps 13s between sends + retries 429 with 65s backoff. If you
   need to bulk-send polls outside the runtime, respect the same limit.

2. **Relay's `/poll` endpoint can decrypt votes only on polls it created itself.**
   You cannot read votes from a poll a real human created in the group from
   their phone. This is a Baileys / WhatsApp protocol limitation. If migrating
   to a new bot account, you can't pick up mid-week — start a fresh cycle.

3. **Vercel's edge cache is aggressive on /api/lineup-image.** The runtime
   appends `?v=<lineup.updated_at>` as a cache-bust to ensure rendering
   changes propagate. If you change the rendering code, **also change `updated_at`** on any
   already-posted lineup, or use a fresh lineup.

4. **The bot's WhatsApp can be invalidated by WhatsApp** (e.g. after many
   reconnect cycles in a short window). When this happens the relay drops to
   `state: qr-pending` and there's no automatic recovery — the organiser must
   re-pair via the app. Auto-reconnect handles container restarts, but not
   server-side session invalidations.

5. **Group JIDs come in two formats.** New groups use `<digits>@g.us`. Legacy
   groups use `<phone>-<timestamp>@g.us`. The relay's `JID_PATTERN` regex
   accepts both (this was a bug fix in April 2026 — see types.ts).

6. **The runtime fires by clock-minute equality, not "≥".** If for any reason
   the cron tick is delayed past its minute, that fire is missed. Cron has been
   reliable in practice — the underlying issue would be Supabase
   pg_cron + pg_net latency. Worth monitoring `runtime_events` for tick
   continuity.

7. **`runtime_events` grows unbounded.** It's append-only and currently 3MB.
   Add a retention job (e.g. delete events > 30 days) before it becomes
   gigabytes. SQL: `DELETE FROM soccer.runtime_events WHERE occurred_at <
   now() - interval '30 days';` — wrap in a daily pg_cron job.

8. **`mom_votes` should also be retained** — it accumulates one row per voter
   per match. Same retention strategy.

9. **`mom_method='auto'` (per-player DMs) requires `whatsapp_jid` populated
   on every player who's playing.** Players without it land in
   `mom_unmapped_names` and the organiser gets a separate DM listing them.
   This is by design — but if you flip back from `web_link` to `auto`, run
   the Match Members flow first.

10. **Edge function timeouts.** Supabase edge functions have a wall-clock
    limit (~150–400s depending on plan). The per-player DM loop with 12
    players = ~156s, near the edge. If you have 20+ players, switch to a
    batched approach (split sends across multiple ticks).

---

## 12. Roadmap — what's next

Tracked roughly in priority order. Items 1–4 unlock multi-tenant SaaS.

### Multi-tenant ("clubs") — ✅ Phase 1–5 shipped (May 2026)
The single-tenant `organiser_config` singleton has been replaced with a `clubs`
data model. Status by sub-item:
- ✅ `clubs` / `club_members` / `club_players` tables. Per-club role
  (`owner`/`organiser`/`member`). RLS via `is_club_member` /
  `is_club_organiser` helpers. Migration:
  `20260507000000_multi_tenant_clubs.sql` (+ `20260507100000_clubs_relay_url.sql`
  restoring `relay_url` after the env-var revert).
- ✅ `organiser_config` dropped; `bot_persona` / `timezone` / `enabled` /
  `relay_url` live on `clubs` instead.
- ✅ `runtime-tick` iterates clubs × schedules; per-club JWT/sender cache.
- ✅ Frontend: `ClubProvider` exposes the current club; `useOrganiserConfig`
  is a back-compat shim that reads from it. Onboarding wizard
  (`components/OnboardingFlow.tsx`) creates the user's first club via the
  `create_club_with_owner` RPC (`20260507200000_create_club_rpc.sql`).
- ✅ Adding a player goes through `add_player_to_club` RPC
  (`20260507210000_add_player_to_club_rpc.sql`) — atomic insert into
  `players` + `club_players` (the SELECT policy on `players` requires
  membership, so a two-step from the client doesn't work).

Still ahead (phase 6+):
- Each club has its own WhatsApp pairing on the relay. (Today the relay is
  multi-tenant by `user_id`; club pairing is implicit via the owning user.)
- Club switcher UI when a user belongs to >1 club. Currently `ClubProvider`
  picks the first club and persists a chosen `current_club_id` in
  `localStorage`, but there's no UI to switch.
- Public club URLs (`/c/:slug/...`).
- Subscription / billing (Stripe).
- Invites — today only the original owner is in `club_members`; no flow to
  add an organiser or member.

### Sport-agnostic refactor
Football is hardcoded. To support cricket/basketball/whatever:
- Rename `soccer` schema → `sports` (or `app`).
- `players.preferred_position` becomes sport-specific (a JSON or per-sport
  enum).
- Pitch image generator becomes per-sport (current code is football-only).
- Skill ratings (shooting/passing/etc.) become sport-specific.
- `clubs.sport` enum: `football | cricket | basketball | ...`.

### Onboarding flow
Today setup is manual: a developer pairs WhatsApp, configures the schedule
in SQL, etc. For self-serve:
- New user signs up → club wizard (name, sport, timezone).
- Paste the WhatsApp group invite link → bot resolves to a JID (or accepts
  invite).
- Quick player roster import (paste names, fuzzy import).
- First-week test mode (everything goes to a "Test Football" group OR
  organiser-DM only).
- "Go live" toggle that switches the destination to the real group.

### Smaller pending follow-ups
- **`team_constraints` table is unused.** Wire it into the balancer:
  pairs of player IDs that must be (a) on the same team, or (b) on
  opposite teams, or (c) excluded entirely. UI in PlayerManager.
- **Pitch image polish.** Optionally show overall_score badges on shirts
  (like the in-app pitch view does). Consider per-position formation icons.
- **Live updates on the approval page.** When the organiser is staring at
  /approve/:token and a vote count changes, refresh. Simple polling for
  now; subscribe to Realtime later.
- **Better delivery feedback.** When a DM fails (player blocked the bot,
  number invalid), surface that to the organiser. Currently we log it but
  don't notify.
- **Late drop-out flow.** After teams are posted, if someone says "out" in
  the group, the bot should detect it (text parsing or a "drop out"
  reaction) and DM the organiser to confirm a substitution.
- **Multiple sessions per week per club.** Schema supports it (each
  `session_schedules` row independent). UI mostly supports it. Runtime
  iterates schedules. But edge cases around overlapping fires need
  hardening.
- **Push-name backfill job.** A periodic relay job that fetches profile
  info for unknown participants in the bot's groups, populating push names.
  Useful for the Match Members UX.

---

## 13. The first 30 minutes for the next agent

If you're an LLM agent picking this up cold, here's the fastest path to
useful:

1. Read `HANDOFF.md` (this file).
2. Read `supabase/functions/runtime-tick/index.ts` end-to-end — it's the
   heart of the system, ~1100 lines, all decision logic + state transitions.
3. Skim `components/MomVotePage.tsx`, `components/ApprovalPage.tsx`,
   `components/admin/MatchWhatsAppMembers.tsx`. These three components
   capture 80% of the user-facing flows.
4. Skim `whatsapp-relay/src/server.ts` — every relay endpoint the runtime
   calls is here.
5. Check current state via:
   ```sql
   SELECT * FROM soccer.organiser_config;          -- is it enabled? what relay?
   SELECT name, enabled, kickoff_dow, kickoff_time FROM soccer.session_schedules;
   SELECT (occurred_at AT TIME ZONE 'Asia/Dubai')::text AS t, kind, summary
     FROM soccer.runtime_events ORDER BY occurred_at DESC LIMIT 20;
   ```
6. Verify health:
   ```bash
   curl https://<your-relay>/health           # should be 200
   curl https://<your-vercel>/                # should be 200
   ```
7. Check the tail of `whatsapp-relay/src/whatsapp.ts` for the most recently
   added Baileys integration code (this is the most fragile surface).

**Common tasks the user will likely ask for** (in rough order of likelihood):

- "Why didn't X fire?" → check `runtime_events` for the relevant minute,
  trace the decision logic in runtime-tick.
- "Add a new schedule" → INSERT into `session_schedules` (or use the UI).
  Need to also `enable=true`. Cron will pick it up next minute.
- "Tweak the pitch image" → edit `api/lineup-image.tsx`, redeploy Vercel,
  flip an existing lineup back to `confirmed` to re-post (and bump
  `updated_at` for cache-bust).
- "Run a one-off lineup with these players" → use
  `weekly_sessions.forced_lineup_player_ids`.
- "Fix WhatsApp disconnect" → user re-pairs via the app. Auto-reconnect on
  startup handles deploys, not manual invalidations.
- "Add a new player who just joined" → add via Players UI; if they were in
  the WhatsApp group during last fire, run Match Members to grab their JID.

---

## 14. Credits + lineage

- Project bootstrapped from a generic Vite/React/TypeScript/Tailwind/Supabase
  template.
- AI development partner: Claude Code (Anthropic).
- Built end-to-end in ~2 days of intensive iteration in April 2026.
- The Baileys library (https://github.com/WhiskeySockets/Baileys) is the
  WhatsApp client under the hood. Note: this is an unofficial library that
  reverse-engineers the WhatsApp Web protocol. WhatsApp can change behaviour
  at any time.

---

**Last updated: April 2026, just after the first end-to-end live run.**
