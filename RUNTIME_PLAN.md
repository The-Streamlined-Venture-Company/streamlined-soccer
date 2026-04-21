# Streamlined Soccer — Runtime Plan

Living doc for the auto-organiser runtime. Update as phases land and decisions change.

## Vision

A way for people to organise their recreational sports with WhatsApp.
Currently single-club / single-user (zee), built on a soccer-specific schema.
Long-term goal: multi-tenant SaaS, sport-agnostic.

## Architecture

```
Vercel (streamlined-soccer)        Soccer Supabase                Railway
  ┌──────────────────────┐         (jgjjnpofbpvekdvdzbgb)       ┌────────────────┐
  │  Vite React app      │         ┌─────────────────────┐      │ soccer-whatsapp│
  │  - Settings UI       │ ─reads─▶│ schema: soccer      │      │  -relay        │
  │  - /approve/:token   │         │ + Edge Functions    │ ─HTTP▶│ Baileys        │──▶ WhatsApp
  │  - Test panel        │         │ + pg_cron           │      │ Multi-tenant   │
  └──────────────────────┘         └─────────────────────┘      └────────────────┘
            │                                ▲
            └────── reads/writes ────────────┘
```

Soccer DB is single-tenant. Relay is multi-tenant per Supabase user (each user
pairs their own WhatsApp). Cron lives in Supabase Edge Functions, mints user
JWTs on the fly to call the relay as the chosen organiser.

## Soccer schema (key tables)

| Table | Purpose |
|---|---|
| `organiser_config` | Single-row global config: master enable, timezone, bot persona, relay URL, alert channel |
| `session_schedules` | One row per recurring session (e.g. "Tuesday Night Football") with all timing/poll/MoM/team-gen settings + the WhatsApp group JID for that session |
| `weekly_sessions` | Per-week instance of a `session_schedules`. State machine: `pending → callout_sent → followup_sent → morning_nudge_sent → teams_pending_approval → teams_posted → mom_sent → mom_closed`. Caches signup counts. |
| `runtime_events` | Append-only debug/audit log of every cron decision, send, error |
| `lineups` | Persisted teams; has `approval_token` so an organiser can review/edit at `/approve/:token` |
| `players` | Roster + per-player stats (shooting/passing/etc — soccer-specific for now) |

## Runtime

- pg_cron job `runtime-tick` fires **every minute**
- Calls Supabase Edge Function `runtime-tick` with the service-role key
- Edge function:
  1. Reads `organiser_config` (skips if `enabled = false`)
  2. Reads enabled `session_schedules`
  3. For each, decides what fires this minute (in the org's timezone)
  4. Executes implemented workflows; logs dry-run for the rest
  5. Refreshes signup counts for active `weekly_sessions` from `/polls`
- Sends via the relay using a JWT minted with `SUPABASE_JWT_SECRET` (fetched via `soccer.get_jwt_secret()` RPC backed by Vault)
- Sender userId = first row in `app_users` with role `admin` or `organiser`

## Where the secrets live

| Secret | Storage |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function runtime env (auto-injected) + Vault `service_role_key` for pg_cron |
| `SUPABASE_JWT_SECRET` | Vault `jwt_secret`, fetched at runtime via `soccer.get_jwt_secret()` RPC |
| Relay URL | `organiser_config.relay_url` |
| Whapi tokens | N/A — using self-hosted Baileys relay, not Whapi |

## Phase status

| # | Phase | Status |
|---|---|---|
| 1 | Runtime foundation: cron + dry-run logging | ✅ done |
| 2 | Wire call-out poll to actually fire via relay | ✅ done |
| 4 | Signup tracking — read poll votes back into `weekly_sessions` | ✅ done |
| 3 | Confirmation DM (self-DM poll, "no" skips week) | ▶ in progress |
| 5 | Nudges — follow-up DMs + morning group nudge | pending |
| 6 | Team gen + approval (auto-balance, approval link, post on confirm) | pending |
| 7 | MoM poll + results | pending |
| — | Multi-tenant refactor (`clubs` concept) | deferred |
| — | Sport-agnostic refactor | deferred |
| — | Onboarding flow for new users | deferred |

## Key implementation notes / gotchas

- **Self-DM polls work** — relay can deliver a poll to the paired user's own JID (`{phone}@s.whatsapp.net`); the user can vote in WhatsApp's "Message Yourself" chat and the relay's `/polls` captures the vote. Verified Phase 4.
- **Relay `/polls` response shape** — option labels are in `poll.options` as bare strings; vote data is in `poll.results: [{ name, voters: string[] }]`. Vote count = `voters.length`. (Not `voteCount` as I initially typed it.)
- **Idempotency** — `weekly_sessions(session_schedule_id, match_date)` UNIQUE constraint blocks duplicate sends for the same week.
- **JWT minting** — HS256 with project's JWT secret, claims: `iss=<supabase>/auth/v1`, `aud=authenticated`, `role=authenticated`, `sub=<user_id>`, 5-min expiry.
- **Timezone** — `organiser_config.timezone` (IANA). All `*_dow` and `*_time` fields interpreted in this zone. Cron runs in UTC; function compares using `Intl.DateTimeFormat`.
- **Match date for new weekly_sessions** — computed as next `kickoff_dow` on or after today (in TZ). Stored as `kickoff_at` UTC timestamp (approximation — does NOT yet correctly convert local time to UTC, treats kickoff_time as if it were UTC. Fix when timezone matters.)
- **Sender JWT routing** — runtime always sends as `app_users` first admin/organiser row. When multi-tenant lands this becomes per-club.

## File layout

```
streamlined-soccer/
  RUNTIME_PLAN.md             ← this file
  whatsapp-relay/             ← Baileys relay (deployed to Railway)
  components/admin/           ← Settings UI, SessionEditor, TestPanel, ApprovalPage
  hooks/                      ← useOrganiserConfig, useSessionSchedules, useApprovalLineup
  lib/                        ← relayClient, sampleMessages, messageFormat
  contexts/DirtyChangesContext.tsx  ← floating Save bar
```

Edge Function source lives in Supabase: `runtime-tick` (current version: 8).

## Open questions / future work

- Re-balance after late drop-outs (Phase 6 edge case)
- Holiday weeks / one-off skips (`session_overrides` table — designed but not built)
- "+1 / guest" tracking for non-rostered players
- Re-tries for transient relay failures (currently swallows + logs)
- Locking down RLS once multi-tenant lands

## Useful queries

```sql
-- Latest tick activity
select occurred_at, kind, summary
from soccer.runtime_events
order by occurred_at desc limit 20;

-- This week's signup count
select s.name, w.match_date, w.state, w.signups_in, w.signups_out, w.signups_maybe
from soccer.weekly_sessions w
join soccer.session_schedules s on s.id = w.session_schedule_id
where w.kickoff_at > now()
order by w.kickoff_at;

-- Force-fire any pending workflow by adjusting the schedule's *_time to now+90s
```
