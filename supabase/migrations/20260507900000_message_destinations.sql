-- =============================================================================
-- Tri-state destination per automated message: 'group' / 'organiser_dm' / 'off'.
--
-- Replaces the boolean toggles introduced earlier today. Each message now has
-- a destination instead of a simple on/off, so the organiser can either:
--   - send to the group as before
--   - have the bot DM them the message (copy/paste mode for cautious testing
--     or for groups where the organiser wants final say)
--   - turn it off entirely
--
-- Some messages are inherently DM-only (confirmation, approval-DM) — for
-- those, the only valid non-off destination is 'organiser_dm'. The UI hides
-- the 'group' option for those rows.
--
-- Some messages are inherently group-only because the rest of the flow
-- depends on the artifact existing in the group:
--   - call-out poll: signup tracking reads vote counts from the group poll.
--     If we DM the call-out instead, the organiser would create the poll
--     manually and downstream wouldn't see the votes.
-- For those, 'organiser_dm' is technically allowed (DMs the organiser the
-- poll content for them to recreate manually), but the runtime warns and
-- the UI flags it as advanced/draft mode.
-- =============================================================================

-- ── Add destination columns ───────────────────────────────────────────────
ALTER TABLE soccer.session_schedules
  ADD COLUMN IF NOT EXISTS confirmation_destination text,
  ADD COLUMN IF NOT EXISTS callout_destination      text,
  ADD COLUMN IF NOT EXISTS nudge_destination        text,
  ADD COLUMN IF NOT EXISTS auto_cancel_destination  text,
  ADD COLUMN IF NOT EXISTS approval_destination     text,
  ADD COLUMN IF NOT EXISTS team_post_destination    text,
  ADD COLUMN IF NOT EXISTS mom_results_destination  text;

-- ── Backfill from existing _enabled booleans ──────────────────────────────
-- For DM-only messages: 'organiser_dm' if enabled, 'off' otherwise.
UPDATE soccer.session_schedules
   SET confirmation_destination =
         CASE WHEN COALESCE(confirmation_destination, '') = '' THEN
           CASE WHEN confirmation_enabled THEN 'organiser_dm' ELSE 'off' END
         ELSE confirmation_destination END,
       approval_destination =
         CASE WHEN COALESCE(approval_destination, '') = '' THEN
           CASE WHEN approval_dm_enabled THEN 'organiser_dm' ELSE 'off' END
         ELSE approval_destination END,
       callout_destination =
         CASE WHEN COALESCE(callout_destination, '') = '' THEN
           CASE WHEN callout_enabled THEN 'group' ELSE 'off' END
         ELSE callout_destination END,
       nudge_destination =
         CASE WHEN COALESCE(nudge_destination, '') = '' THEN
           CASE WHEN nudge_enabled THEN 'group' ELSE 'off' END
         ELSE nudge_destination END,
       auto_cancel_destination =
         CASE WHEN COALESCE(auto_cancel_destination, '') = '' THEN
           CASE WHEN auto_cancel_enabled THEN 'group' ELSE 'off' END
         ELSE auto_cancel_destination END,
       team_post_destination =
         CASE WHEN COALESCE(team_post_destination, '') = '' THEN
           CASE WHEN team_post_enabled THEN 'group' ELSE 'off' END
         ELSE team_post_destination END,
       mom_results_destination =
         CASE WHEN COALESCE(mom_results_destination, '') = '' THEN
           CASE WHEN mom_results_enabled THEN 'group' ELSE 'off' END
         ELSE mom_results_destination END;

-- ── Set NOT NULL + defaults + check constraints ───────────────────────────
ALTER TABLE soccer.session_schedules
  ALTER COLUMN confirmation_destination SET NOT NULL,
  ALTER COLUMN callout_destination      SET NOT NULL,
  ALTER COLUMN nudge_destination        SET NOT NULL,
  ALTER COLUMN auto_cancel_destination  SET NOT NULL,
  ALTER COLUMN approval_destination     SET NOT NULL,
  ALTER COLUMN team_post_destination    SET NOT NULL,
  ALTER COLUMN mom_results_destination  SET NOT NULL;

ALTER TABLE soccer.session_schedules
  ALTER COLUMN confirmation_destination SET DEFAULT 'organiser_dm',
  ALTER COLUMN callout_destination      SET DEFAULT 'group',
  ALTER COLUMN nudge_destination        SET DEFAULT 'group',
  ALTER COLUMN auto_cancel_destination  SET DEFAULT 'off',
  ALTER COLUMN approval_destination     SET DEFAULT 'organiser_dm',
  ALTER COLUMN team_post_destination    SET DEFAULT 'group',
  ALTER COLUMN mom_results_destination  SET DEFAULT 'group';

ALTER TABLE soccer.session_schedules
  ADD CONSTRAINT session_schedules_confirmation_destination_check
    CHECK (confirmation_destination IN ('off', 'organiser_dm')),
  ADD CONSTRAINT session_schedules_approval_destination_check
    CHECK (approval_destination IN ('off', 'organiser_dm')),
  ADD CONSTRAINT session_schedules_callout_destination_check
    CHECK (callout_destination IN ('off', 'group', 'organiser_dm')),
  ADD CONSTRAINT session_schedules_nudge_destination_check
    CHECK (nudge_destination IN ('off', 'group', 'organiser_dm')),
  ADD CONSTRAINT session_schedules_auto_cancel_destination_check
    CHECK (auto_cancel_destination IN ('off', 'group', 'organiser_dm')),
  ADD CONSTRAINT session_schedules_team_post_destination_check
    CHECK (team_post_destination IN ('off', 'group', 'organiser_dm')),
  ADD CONSTRAINT session_schedules_mom_results_destination_check
    CHECK (mom_results_destination IN ('off', 'group', 'organiser_dm'));

-- ── Comments ──────────────────────────────────────────────────────────────
COMMENT ON COLUMN soccer.session_schedules.confirmation_destination IS
  'Where the day-before confirmation goes. Always either organiser_dm or off — there is no group version of this message.';
COMMENT ON COLUMN soccer.session_schedules.callout_destination IS
  'group: weekly poll posted to group (signups tracked). organiser_dm: bot DMs the organiser the poll text — they post it manually, and downstream signup tracking will not work automatically. off: no call-out.';
COMMENT ON COLUMN soccer.session_schedules.nudge_destination IS
  'group: nudge message in the group. organiser_dm: bot DMs the organiser a draft of the nudge for copy/paste. off: no nudge.';
COMMENT ON COLUMN soccer.session_schedules.auto_cancel_destination IS
  'group: bot posts "called off" to the group + cancels the session. organiser_dm: bot DMs the organiser a draft "I would auto-cancel" notice + still marks cancelled. off: no auto-cancellation behaviour at all.';
COMMENT ON COLUMN soccer.session_schedules.approval_destination IS
  'Where the lineup approval prompt goes. Always either organiser_dm or off.';
COMMENT ON COLUMN soccer.session_schedules.team_post_destination IS
  'group: pitch image posted to the group. organiser_dm: image DMd to organiser for them to share. off: lineup is generated but not auto-shared anywhere.';
COMMENT ON COLUMN soccer.session_schedules.mom_results_destination IS
  'group: winner announcement posted to group. organiser_dm: bot DMs the organiser the announcement to copy/paste. off: results not auto-posted.';

-- The legacy *_enabled booleans stay around for now so older code paths
-- that haven't been updated still see something sensible. We'll drop them
-- in a follow-up after verifying nothing depends on them.
