-- =============================================================================
-- Drop the "auto" mom_method value.
--
-- "auto" was a misleading no-op: there is no auto-selection logic in
-- runtime-tick. Every schedule with mom_method='auto' silently fell through
-- to the per-player WhatsApp poll DM path (same as 'whatsapp_poll'). The user
-- decided weeks ago that the per-player DM path doesn't reliably aggregate
-- results, so the right behaviour is to default to 'web_link'.
--
-- This migration:
--   1. Migrates every existing 'auto' row to 'web_link' (the safe default).
--   2. Updates the CHECK constraint so 'auto' is no longer accepted.
-- =============================================================================

UPDATE soccer.session_schedules
   SET mom_method = 'web_link'
 WHERE mom_method = 'auto';

ALTER TABLE soccer.session_schedules
  DROP CONSTRAINT IF EXISTS session_schedules_mom_method_check;

ALTER TABLE soccer.session_schedules
  ADD CONSTRAINT session_schedules_mom_method_check
  CHECK (mom_method IN ('whatsapp_poll', 'web_link', 'organiser_dm'));

-- New schedules also default to 'web_link' — flip the column default.
ALTER TABLE soccer.session_schedules
  ALTER COLUMN mom_method SET DEFAULT 'web_link';

COMMENT ON COLUMN soccer.session_schedules.mom_method IS
  'How to collect Man-of-the-Match votes: web_link (recommended — anonymous one-tap link in group), whatsapp_poll (DM each player a poll, results aggregation is unreliable), organiser_dm (one poll DM''d to the organiser).';
