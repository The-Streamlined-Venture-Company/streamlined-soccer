-- =============================================================================
-- MoM voting page UX upgrades:
--   1. get_mom_vote_page also returns the session schedule name + voting
--      window in minutes (so the page can header with "Tuesday Night Football"
--      and tell voters "you have 1 hour to vote").
--   2. cast_mom_vote also returns the top-3 standings so the page can show
--      voters the leaders right after they vote — extra incentive to engage.
--      Top-3 is only revealed *after* voting (returned from cast_mom_vote, not
--      from get_mom_vote_page) — the pre-vote page stays clean of standings to
--      avoid herd-effect voting and preserve secret-ballot vibes.
-- =============================================================================

CREATE OR REPLACE FUNCTION soccer.get_mom_vote_page(
  p_token TEXT,
  p_fingerprint TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = soccer, public
AS $$
DECLARE
  v_payload JSONB;
  v_ws_id UUID;
  v_voted UUID;
  v_total INT;
  v_top JSONB;
BEGIN
  SELECT jsonb_build_object(
    'weekly_session_id', ws.id,
    'schedule_name', s.name,
    'match_date', ws.match_date,
    'voting_closed', (ws.mom_results_message_id IS NOT NULL),
    'voting_window_minutes', s.mom_results_post_minutes,
    -- Use TZH:TZM for proper ISO 8601 (+00:00 not +00) so JavaScript Date() parses it.
    'results_at', to_char(
      ws.kickoff_at
        + (s.match_duration_minutes * interval '1 minute')
        + (s.mom_delay_minutes * interval '1 minute')
        + (s.mom_results_post_minutes * interval '1 minute'),
      'YYYY-MM-DD"T"HH24:MI:SS.MSTZH:TZM'
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
  ), ws.id
  INTO v_payload, v_ws_id
  FROM soccer.weekly_sessions ws
  LEFT JOIN soccer.lineups l ON l.id = ws.lineup_id
  LEFT JOIN soccer.session_schedules s ON s.id = ws.session_schedule_id
  WHERE ws.mom_vote_token = p_token
  LIMIT 1;

  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  -- If the caller provides a fingerprint that has voted, return their pick +
  -- current standings. Pre-vote callers see neither (anonymity / no herd-effect).
  IF p_fingerprint IS NOT NULL AND length(p_fingerprint) >= 8 THEN
    SELECT voted_for_player_id INTO v_voted
      FROM soccer.mom_votes
     WHERE weekly_session_id = v_ws_id
       AND voter_fingerprint = p_fingerprint
     LIMIT 1;

    IF v_voted IS NOT NULL THEN
      SELECT COUNT(DISTINCT voter_fingerprint) INTO v_total
        FROM soccer.mom_votes
       WHERE weekly_session_id = v_ws_id;

      WITH lineup_players AS (
        SELECT (pos->>'player_id')::uuid AS player_id, pos->>'name' AS name
          FROM soccer.lineups l, jsonb_array_elements(l.player_positions) pos
         WHERE l.id = (SELECT lineup_id FROM soccer.weekly_sessions WHERE id = v_ws_id)
      ),
      vote_counts AS (
        SELECT lp.player_id, lp.name, COUNT(mv.id) AS votes
          FROM lineup_players lp
          LEFT JOIN soccer.mom_votes mv
            ON mv.weekly_session_id = v_ws_id
           AND mv.voted_for_player_id = lp.player_id
         GROUP BY lp.player_id, lp.name
      )
      SELECT jsonb_agg(
               jsonb_build_object('player_id', player_id, 'name', name, 'votes', votes)
               ORDER BY votes DESC, name ASC
             )
        INTO v_top
        FROM (
          SELECT * FROM vote_counts
           WHERE votes > 0
           ORDER BY votes DESC, name ASC
           LIMIT 3
        ) t;

      v_payload := v_payload
        || jsonb_build_object('your_vote', v_voted)
        || jsonb_build_object('total_voters', v_total)
        || jsonb_build_object('top', COALESCE(v_top, '[]'::jsonb));
    END IF;
  END IF;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.get_mom_vote_page(TEXT, TEXT) TO anon, authenticated;

-- ── cast_mom_vote also returns top-3 standings ──────────────────────────────
CREATE OR REPLACE FUNCTION soccer.cast_mom_vote(
  p_token TEXT,
  p_player_id UUID,
  p_fingerprint TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = soccer, public
AS $$
DECLARE
  ws_row RECORD;
  is_valid_player BOOLEAN;
  v_total_voters INT;
  v_top JSONB;
BEGIN
  SELECT ws.id, ws.lineup_id, ws.mom_results_message_id, ws.state, ws.club_id
    INTO ws_row
    FROM soccer.weekly_sessions ws
   WHERE ws.mom_vote_token = p_token
   LIMIT 1;

  IF ws_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF ws_row.mom_results_message_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voting_closed');
  END IF;
  IF ws_row.state IN ('cancelled', 'confirmation_declined') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_cancelled');
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM soccer.lineups l, jsonb_array_elements(l.player_positions) pos
     WHERE l.id = ws_row.lineup_id
       AND (pos->>'player_id')::uuid = p_player_id
  ) INTO is_valid_player;

  IF NOT is_valid_player THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_not_in_lineup');
  END IF;
  IF p_fingerprint IS NULL OR length(p_fingerprint) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_fingerprint');
  END IF;

  INSERT INTO soccer.mom_votes (weekly_session_id, voted_for_player_id, voter_fingerprint, club_id)
  VALUES (ws_row.id, p_player_id, p_fingerprint, ws_row.club_id)
  ON CONFLICT (weekly_session_id, voter_fingerprint)
  DO UPDATE SET voted_for_player_id = EXCLUDED.voted_for_player_id, updated_at = now();

  -- Build top-3 standings. We rank by vote count desc, then name asc for stable
  -- tiebreak. Pulls names from the lineup (not players table) so we don't leak
  -- players outside the lineup, and so display matches what the voter saw.
  SELECT COUNT(DISTINCT voter_fingerprint)
    INTO v_total_voters
    FROM soccer.mom_votes
   WHERE weekly_session_id = ws_row.id;

  WITH lineup_players AS (
    SELECT (pos->>'player_id')::uuid AS player_id, pos->>'name' AS name
      FROM soccer.lineups l, jsonb_array_elements(l.player_positions) pos
     WHERE l.id = ws_row.lineup_id
  ),
  vote_counts AS (
    SELECT lp.player_id, lp.name, COUNT(mv.id) AS votes
      FROM lineup_players lp
      LEFT JOIN soccer.mom_votes mv
        ON mv.weekly_session_id = ws_row.id
       AND mv.voted_for_player_id = lp.player_id
     GROUP BY lp.player_id, lp.name
  )
  SELECT jsonb_agg(
           jsonb_build_object('player_id', player_id, 'name', name, 'votes', votes)
           ORDER BY votes DESC, name ASC
         )
    INTO v_top
    FROM (
      SELECT * FROM vote_counts
       WHERE votes > 0
       ORDER BY votes DESC, name ASC
       LIMIT 3
    ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'total_voters', v_total_voters,
    'top', COALESCE(v_top, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.cast_mom_vote(TEXT, UUID, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION soccer.get_mom_vote_page(TEXT) IS
  'Public RPC: fetch the MoM vote page payload by token. Returns the session schedule name, lineup players, voting window, and when results post.';
COMMENT ON FUNCTION soccer.cast_mom_vote(TEXT, UUID, TEXT) IS
  'Public RPC: cast or change a MoM vote. Returns ok plus the current top-3 standings (revealed only after a successful vote — pre-vote page intentionally hides standings).';
