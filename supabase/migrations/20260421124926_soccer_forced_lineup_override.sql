ALTER TABLE soccer.weekly_sessions
  ADD COLUMN IF NOT EXISTS forced_lineup_player_ids JSONB;

COMMENT ON COLUMN soccer.weekly_sessions.forced_lineup_player_ids IS
  'Optional: manually-specified array of player.id UUIDs. When set, team_gen uses these exact players and skips the voter-mapping + top-N fallback paths. Used for one-off manual lineups.';;
