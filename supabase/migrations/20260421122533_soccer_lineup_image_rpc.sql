-- Public read for image rendering. UUIDs aren't enumerable, and once teams are
-- posted to WhatsApp the data is public anyway, so this is safe.
CREATE OR REPLACE FUNCTION soccer.get_lineup_for_image(p_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = soccer, public
AS $$
  SELECT jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'status', l.status,
    'match_date', l.match_date,
    'player_positions', l.player_positions,
    'session', jsonb_build_object(
      'name', s.name,
      'kickoff_dow', s.kickoff_dow,
      'kickoff_time', s.kickoff_time,
      'pitch_label', s.pitch_label
    )
  )
  FROM soccer.lineups l
  LEFT JOIN soccer.session_schedules s ON s.id = l.session_schedule_id
  WHERE l.id = p_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION soccer.get_lineup_for_image(UUID) TO anon, authenticated;;
