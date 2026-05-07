-- Restore relay_url on clubs.
--
-- Phase 2 of the multi-tenant refactor moved relay_url to a RELAY_URL edge
-- function env var on the assumption that the relay is shared across all clubs
-- (which is true today). Reality check: the React frontend ALSO calls the
-- relay (for /status, /connect, /poll etc.), and most components receive the
-- URL via prop drilling from the organiser settings page. Maintaining two
-- sources of truth (env var for runtime, ??? for frontend) is messier than
-- just keeping the column on the clubs row.
--
-- The edge function still reads RELAY_URL as a fallback for legacy reasons,
-- but prefers club.relay_url when set.

ALTER TABLE soccer.clubs
  ADD COLUMN IF NOT EXISTS relay_url text;

-- Backfill the existing TSC Football club. New clubs default to NULL and the
-- frontend can offer a "use shared relay" prompt during onboarding (phase 5).
UPDATE soccer.clubs
   SET relay_url = 'https://soccer-whatsapp-relay-production.up.railway.app'
 WHERE relay_url IS NULL;
