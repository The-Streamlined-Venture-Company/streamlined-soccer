-- =============================================================================
-- Per-session toggles for every automated message.
--
-- Until now several outbound messages had no kill switch. The auto-cancel
-- "game called off" post is the headline example — it fires the moment
-- signups dip below `cancel_below_players` at team-gen time, and the
-- organiser had no way to opt out short of cranking the threshold to 0.
--
-- This migration adds explicit booleans for every message that goes to
-- the group, the organiser, or the players. Existing toggles are kept:
--   - confirmation_enabled  (DM with skip-link, day before call-out)
--   - nudge_enabled         (group nudge if signups < nudge floor)
--   - mom_enabled           (Man-of-the-Match voting message)
--
-- New:
--   - callout_enabled         — group call-out poll. Defaults TRUE.
--                               (When false, no signups can come in. Useful
--                               for pausing without disabling the schedule.)
--   - team_post_enabled       — pitch image post when teams are confirmed.
--                               Defaults TRUE.
--   - auto_cancel_enabled     — auto-post a "game called off" message when
--                               signups < cancel_below_players at team-gen.
--                               Defaults FALSE (opt-in) so it never fires
--                               by surprise. The threshold setting still
--                               displays / drives nudge copy.
--   - mom_results_enabled     — group post announcing the MoM winner.
--                               Defaults TRUE; only relevant if mom_enabled.
--   - approval_dm_enabled     — DM to organiser with the lineup approval link.
--                               Defaults TRUE; only relevant if
--                               team_gen_require_approval.
-- =============================================================================

ALTER TABLE soccer.session_schedules
  ADD COLUMN IF NOT EXISTS callout_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS team_post_enabled     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_cancel_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mom_results_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_dm_enabled   boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN soccer.session_schedules.callout_enabled IS
  'If false, the weekly call-out poll is suppressed (no signups will be collected). The schedule itself can still be enabled.';
COMMENT ON COLUMN soccer.session_schedules.team_post_enabled IS
  'If false, the pitch image post is suppressed. Lineups will still be generated; you would need to share manually.';
COMMENT ON COLUMN soccer.session_schedules.auto_cancel_enabled IS
  'If false, the bot never auto-posts a "game called off" message even when signups are below cancel_below_players. Default false — opt-in.';
COMMENT ON COLUMN soccer.session_schedules.mom_results_enabled IS
  'If false, the MoM winner post is suppressed even after voting closes.';
COMMENT ON COLUMN soccer.session_schedules.approval_dm_enabled IS
  'If false, the organiser is not DMed when a lineup is generated. Combined with team_gen_require_approval=true this would mean the lineup never auto-confirms unless force-posted.';
