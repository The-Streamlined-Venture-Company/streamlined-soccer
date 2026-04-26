# Agent Bootstrap

You are picking up a working WhatsApp soccer auto-organiser. Below is the
absolute minimum to get oriented; for everything else, read **`HANDOFF.md`**.

## What this is

Three deployments, one repo:

1. **Vercel** — Vite/React frontend + `/api/lineup-image` edge function
2. **Supabase** — Postgres + Vault + pg_cron + Edge Functions
   (`supabase/functions/runtime-tick/index.ts` is the heart — runs every minute)
3. **Railway** — Baileys WhatsApp relay (`whatsapp-relay/` subdir)

The runtime-tick edge function decides each minute whether to post a call-out
poll, send an approval DM, post teams, fire MoM voting, etc. — based on
`session_schedules` config + `weekly_sessions` state.

## State of play

✅ Built + tested end-to-end (April 2026):
- Weekly call-out poll
- Signup tracking from poll votes
- Optional confirmation DM (skip-link)
- One nudge if signups < min
- Team gen with auto-balanced lineups (snake-draft + linchpin/preferred-team)
- Approval flow with `/approve/:token` link
- Pitch image (vertical 1080×1920, shirt formation) auto-posted to group
- MoM voting via web link (`/mom/:token`) — anonymous, dedup-per-device
- All scheduled around the organiser's timezone

⏳ Pending (in priority order):
- Multi-tenant ("clubs") refactor → SaaS
- Sport-agnostic refactor (currently football-only)
- Self-serve onboarding
- Misc: `team_constraints` not yet wired into balancer; late-drop-out detection

## What the user owns

Their WhatsApp number is paired to the relay (one bot per Supabase user).
Their group is `Test Football` (id `120363425828216309@g.us`) for testing
and `Tuesday TSC Football @ 8pm` (`971521678254-1539657811@g.us`) for the
real Tuesday game. Schedule is "Tuesday Night Football" 20:00 Dubai, 12 players.

## Your first 5 commands when you arrive

```bash
# 1. See current state
git log --oneline -10
git status

# 2. Check what's running
curl -s -o /dev/null -w "Vercel: %{http_code}\n" https://streamlined-soccer-cyan.vercel.app/
curl -s -o /dev/null -w "Relay:  %{http_code}\n" https://soccer-whatsapp-relay-production.up.railway.app/health
```

```sql
-- 3. Check current schedule + runtime
SELECT * FROM soccer.organiser_config;
SELECT name, enabled, kickoff_dow, kickoff_time, mom_method FROM soccer.session_schedules;
SELECT (occurred_at AT TIME ZONE timezone)::text AS t, kind, summary
FROM soccer.runtime_events
CROSS JOIN (SELECT 'Asia/Dubai' AS timezone) tz
ORDER BY occurred_at DESC LIMIT 20;
```

## Critical files to skim before doing anything

1. `HANDOFF.md` — full context (this is the master doc)
2. `supabase/functions/runtime-tick/index.ts` — the entire runtime
3. `components/MomVotePage.tsx` + `components/ApprovalPage.tsx` — main UX
4. `components/admin/MatchWhatsAppMembers.tsx` — voter→player mapping
5. `whatsapp-relay/src/server.ts` — every relay endpoint
6. `whatsapp-relay/src/whatsapp.ts` — Baileys integration

## Don't trip on

- The relay rate-limits polls at **5/minute** — `fireMomPoll` already
  handles this. If you bulk-send polls outside the runtime, sleep ≥13s
  between each.
- Vercel edge cache on `/api/lineup-image` is aggressive — runtime appends
  `?v=<lineup.updated_at>`. If you change rendering code, also bump
  `updated_at` on test lineups.
- WhatsApp can invalidate the bot's session after rapid reconnects → user
  has to re-pair via the app. Auto-reconnect handles container restarts only.
- `forced_lineup_player_ids` on `weekly_sessions` overrides voter-mapping
  for a one-off lineup. Useful for testing.
- Group JIDs come in two formats: `<digits>@g.us` (new) and
  `<phone>-<timestamp>@g.us` (legacy). Both supported.

## What the user is most likely to ask

- "Why didn't X fire?" → check `runtime_events`
- "Tweak the image" → edit `api/lineup-image.tsx`, redeploy Vercel, flip a
  test lineup back to `confirmed` + bump `updated_at` to bust cache
- "Add a new schedule" → INSERT into `session_schedules`, set `enabled=true`
- "Run a custom lineup" → set `weekly_sessions.forced_lineup_player_ids`

Now go read `HANDOFF.md`.
