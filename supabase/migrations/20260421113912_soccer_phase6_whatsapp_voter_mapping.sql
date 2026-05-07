-- Phase 6: voter→player mapping foundation
-- ──────────────────────────────────────────────────────────────────────
-- Each player gets a WhatsApp identity (phone + JID) so we can map poll
-- voters back to player records. JID is the canonical key (Baileys uses
-- it as the addressable handle); phone is for human display.

ALTER TABLE soccer.players
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_jid TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_push_name TEXT,
  ADD COLUMN IF NOT EXISTS discovered_via TEXT NOT NULL DEFAULT 'manual'
    CHECK (discovered_via IN ('manual', 'whatsapp_auto'));

-- Unique JID where set (NULL allowed for players without WhatsApp mapping yet)
CREATE UNIQUE INDEX IF NOT EXISTS players_whatsapp_jid_unique
  ON soccer.players(whatsapp_jid) WHERE whatsapp_jid IS NOT NULL;

-- Track which voters opted in this week (for team gen) + which couldn't be mapped to a player
ALTER TABLE soccer.weekly_sessions
  ADD COLUMN IF NOT EXISTS signup_voter_jids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unmapped_voter_jids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Schedule-level config for the new pieces
ALTER TABLE soccer.session_schedules
  ADD COLUMN IF NOT EXISTS team_force_post_minutes_before_kickoff INTEGER NOT NULL DEFAULT 30
    CHECK (team_force_post_minutes_before_kickoff >= 0 AND team_force_post_minutes_before_kickoff <= 240);

COMMENT ON COLUMN soccer.players.whatsapp_jid IS
  'Canonical WhatsApp handle (e.g. 971501234567@s.whatsapp.net). Set during member-matching onboarding.';
COMMENT ON COLUMN soccer.players.discovered_via IS
  'manual = added by organiser; whatsapp_auto = auto-created when a new group member appeared';
COMMENT ON COLUMN soccer.weekly_sessions.signup_voter_jids IS
  'JIDs of WhatsApp accounts that voted "in" on the call-out poll this week. Used by team gen.';
COMMENT ON COLUMN soccer.weekly_sessions.unmapped_voter_jids IS
  'Subset of signup_voter_jids with no matching player record. Surfaced on approval page.';
COMMENT ON COLUMN soccer.session_schedules.team_force_post_minutes_before_kickoff IS
  'If teams are still pending_approval this many minutes before kickoff, post them anyway.';;
