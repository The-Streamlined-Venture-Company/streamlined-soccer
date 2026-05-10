-- =============================================================================
-- Editable message templates per session.
--
-- Each automated message (confirmation, nudge, auto-cancel, approval-DM,
-- team caption, MoM vote-link, MoM results) gets an optional `*_template`
-- column. NULL means "use the built-in default" — that way most users never
-- touch these and we can change defaults centrally. A non-NULL value
-- overrides the default at fire time.
--
-- Templates use the same `{variable}` placeholder convention as the existing
-- callout_poll_question (kept as-is — it's been live for weeks).
-- The runtime-tick edge function does the substitution.
--
-- Variables per template:
--   confirmation_template   : {day} {time} {pitch} {pitch_suffix} {link}
--   nudge_template          : {day} {time} {pitch} {pitch_suffix} {signups_in}
--                             {target} {need} {cancel_floor} {when}
--   auto_cancel_template    : {day} {time} {pitch} {pitch_suffix} {signups_in}
--                             {cancel_floor}
--   approval_template       : {day} {time} {pitch} {pitch_suffix} {black_count}
--                             {white_count} {total} {link} {fallback_min}
--   team_caption_template   : {day} {time} {pitch} {pitch_suffix}
--   mom_link_template       : {day} {link} {window}
--   mom_results_template    : {day} {winner} {winner_first} {winner_votes}
--                             {runner_up} {runner_up_votes} {total_votes}
--                             {runner_up_line}  -- already-formatted blank or
--                                                  "\nRunner-up: X (3 votes)"
-- =============================================================================

ALTER TABLE soccer.session_schedules
  ADD COLUMN IF NOT EXISTS confirmation_template  text,
  ADD COLUMN IF NOT EXISTS nudge_template         text,
  ADD COLUMN IF NOT EXISTS auto_cancel_template   text,
  ADD COLUMN IF NOT EXISTS approval_template      text,
  ADD COLUMN IF NOT EXISTS team_caption_template  text,
  ADD COLUMN IF NOT EXISTS mom_link_template      text,
  ADD COLUMN IF NOT EXISTS mom_results_template   text;

COMMENT ON COLUMN soccer.session_schedules.confirmation_template IS
  'Custom body for the day-before confirmation DM. NULL = built-in default. Vars: {day} {time} {pitch} {pitch_suffix} {link}';
COMMENT ON COLUMN soccer.session_schedules.nudge_template IS
  'Custom body for the low-signup nudge. NULL = built-in default. Vars: {day} {time} {pitch} {pitch_suffix} {signups_in} {target} {need} {cancel_floor} {when}';
COMMENT ON COLUMN soccer.session_schedules.auto_cancel_template IS
  'Custom body for the auto-cancel notice. NULL = built-in default. Vars: {day} {time} {pitch} {pitch_suffix} {signups_in} {cancel_floor}';
COMMENT ON COLUMN soccer.session_schedules.approval_template IS
  'Custom body for the lineup approval DM. NULL = built-in default. Vars: {day} {time} {pitch} {pitch_suffix} {black_count} {white_count} {total} {link} {fallback_min}';
COMMENT ON COLUMN soccer.session_schedules.team_caption_template IS
  'Custom WhatsApp caption attached to the lineup image. NULL = built-in default. Vars: {day} {time} {pitch} {pitch_suffix}';
COMMENT ON COLUMN soccer.session_schedules.mom_link_template IS
  'Custom body for the MoM vote-link group post. NULL = built-in default. Vars: {day} {link} {window}';
COMMENT ON COLUMN soccer.session_schedules.mom_results_template IS
  'Custom body for the MoM winner announcement. NULL = built-in default. Vars: {day} {winner} {winner_first} {winner_votes} {runner_up} {runner_up_votes} {total_votes} {runner_up_line}';
