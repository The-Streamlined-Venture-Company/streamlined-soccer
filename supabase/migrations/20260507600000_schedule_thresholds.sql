-- =============================================================================
-- Per-schedule thresholds: separate "nudge" and "cancel" floors.
--
-- Before: `min_players` was used as the nudge threshold. There was no
-- explicit "cancel below this" — the runtime would dutifully generate teams
-- even with 4 confirmed players for a 12-player session.
--
-- Now:
--   nudge_below_players   — fire a nudge if signups_in is strictly below this
--   cancel_below_players  — at team_gen time, if signups_in is below this,
--                           the runtime posts a cancellation message and
--                           sets state='cancelled' instead of generating teams
--
-- `min_players` stays for backwards compat but is no longer read by the
-- runtime. Both new columns default to the existing `min_players` value
-- on each row so behaviour is unchanged for existing schedules until the
-- organiser tweaks them.
-- =============================================================================

ALTER TABLE soccer.session_schedules
  ADD COLUMN IF NOT EXISTS nudge_below_players  int,
  ADD COLUMN IF NOT EXISTS cancel_below_players int;

UPDATE soccer.session_schedules
   SET nudge_below_players  = COALESCE(nudge_below_players,  min_players),
       cancel_below_players = COALESCE(cancel_below_players, min_players);

ALTER TABLE soccer.session_schedules
  ALTER COLUMN nudge_below_players  SET NOT NULL,
  ALTER COLUMN cancel_below_players SET NOT NULL;

ALTER TABLE soccer.session_schedules
  ALTER COLUMN nudge_below_players  SET DEFAULT 8,
  ALTER COLUMN cancel_below_players SET DEFAULT 8;

ALTER TABLE soccer.session_schedules
  ADD CONSTRAINT session_schedules_nudge_below_players_check
    CHECK (nudge_below_players >= 0 AND nudge_below_players <= 50),
  ADD CONSTRAINT session_schedules_cancel_below_players_check
    CHECK (cancel_below_players >= 0 AND cancel_below_players <= 50),
  ADD CONSTRAINT session_schedules_threshold_order_check
    CHECK (cancel_below_players <= nudge_below_players);

COMMENT ON COLUMN soccer.session_schedules.nudge_below_players IS
  'Threshold for sending a nudge message. If signups_in < this at the nudge time, the bot prods the group to confirm.';
COMMENT ON COLUMN soccer.session_schedules.cancel_below_players IS
  'Threshold below which the bot auto-cancels the game at team-generation time. Should be <= nudge_below_players.';
