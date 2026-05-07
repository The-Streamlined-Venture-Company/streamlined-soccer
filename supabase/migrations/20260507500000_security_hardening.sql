-- =============================================================================
-- Pre-real-test security hardening:
--   1. Rate-limit `cast_mom_vote` to 30 votes/minute per weekly_session.
--      Closed-group test tomorrow won't hit this; the bound is to make casual
--      vote-bombing from a leaked link uneconomic.
--   2. Revoke direct INSERT on `soccer.players` from `authenticated`. All
--      player creation must go through `add_player_to_club` so the lineage
--      (player → club_players) is enforced atomically. The frontend already
--      uses the RPC, so this is a defence-in-depth lockdown only.
-- =============================================================================

-- ── 1. Rate-limited cast_mom_vote ───────────────────────────────────────────
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
  v_recent_count INT;
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

  -- Rate limit: max 30 votes per session per minute. Catches spammers without
  -- impacting the legitimate flow (~12 voters in a 60-min window).
  SELECT COUNT(*) INTO v_recent_count
    FROM soccer.mom_votes
   WHERE weekly_session_id = ws_row.id
     AND created_at > now() - interval '1 minute';
  IF v_recent_count >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
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

CREATE INDEX IF NOT EXISTS mom_votes_session_recent_idx
  ON soccer.mom_votes (weekly_session_id, created_at DESC);

-- ── 2. Lock down direct INSERT on soccer.players ────────────────────────────
-- Drop the broad organiser_insert policy and force everyone through the RPC.
DROP POLICY IF EXISTS "players_organiser_insert" ON soccer.players;
REVOKE INSERT ON soccer.players FROM authenticated, anon;
-- service_role retains INSERT (used by runtime-tick for club_players, edge
-- functions, etc.) and the SECURITY DEFINER RPC `add_player_to_club` runs
-- with definer privileges so it can still insert.
