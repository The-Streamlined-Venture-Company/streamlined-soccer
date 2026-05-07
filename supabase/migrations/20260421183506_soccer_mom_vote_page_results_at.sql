-- Extend get_mom_vote_page to also return when voting closes so the
-- voter-confirmation UI can say "winner announced at 22:00".
CREATE OR REPLACE FUNCTION soccer.get_mom_vote_page(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = soccer, public
AS $$
  SELECT jsonb_build_object(
    'weekly_session_id', ws.id,
    'match_date', ws.match_date,
    'voting_closed', (ws.mom_results_message_id IS NOT NULL),
    -- Compute results_at = kickoff_at + match_duration + mom_delay + mom_results_post_minutes
    'results_at', to_char(
      ws.kickoff_at
        + (s.match_duration_minutes * interval '1 minute')
        + (s.mom_delay_minutes * interval '1 minute')
        + (s.mom_results_post_minutes * interval '1 minute'),
      'YYYY-MM-DD"T"HH24:MI:SS.MSOF'
    ),
    'players', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', (p->>'player_id')::uuid,
          'name', p->>'name'
        )
        ORDER BY p->>'name'
      )
      FROM jsonb_array_elements(l.player_positions) p
    ), '[]'::jsonb)
  )
  FROM soccer.weekly_sessions ws
  LEFT JOIN soccer.lineups l ON l.id = ws.lineup_id
  LEFT JOIN soccer.session_schedules s ON s.id = ws.session_schedule_id
  WHERE ws.mom_vote_token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION soccer.get_mom_vote_page(TEXT) TO anon, authenticated;;
