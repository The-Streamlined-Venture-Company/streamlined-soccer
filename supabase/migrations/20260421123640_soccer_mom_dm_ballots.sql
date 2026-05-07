-- Per-player MoM DM polls are tracked in this JSONB column.
-- Each ballot: {recipient_player_id, recipient_jid, poll_message_id, option_player_ids: [...]}
-- option_player_ids preserves the order of options in the poll so we can map
-- vote index → player_id when aggregating.
ALTER TABLE soccer.weekly_sessions
  ADD COLUMN IF NOT EXISTS mom_ballots JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Remember who the organiser was asked to cover (unmapped lineup players) so
-- we only DM them once.
ALTER TABLE soccer.weekly_sessions
  ADD COLUMN IF NOT EXISTS mom_unmapped_names JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN soccer.weekly_sessions.mom_ballots IS
  'Per-player MoM DM polls. Each ballot: {recipient_player_id, recipient_jid, poll_message_id, option_player_ids[]}';
COMMENT ON COLUMN soccer.weekly_sessions.mom_unmapped_names IS
  'Names of lineup players with no whatsapp_jid — organiser was DMed to ask them manually.';;
