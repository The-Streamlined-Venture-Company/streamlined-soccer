-- Web-link MoM voting: public, anonymous, device-deduplicated
-- One token per weekly session. The token is shared (posted to the group).
-- Anyone with the link can vote ONCE per device (keyed by a client fingerprint
-- persisted in localStorage + a hash of UA/IP).

CREATE TABLE IF NOT EXISTS soccer.mom_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_session_id UUID NOT NULL REFERENCES soccer.weekly_sessions(id) ON DELETE CASCADE,
  voted_for_player_id UUID NOT NULL REFERENCES soccer.players(id) ON DELETE RESTRICT,
  voter_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (weekly_session_id, voter_fingerprint)
);
CREATE INDEX IF NOT EXISTS mom_votes_session_idx ON soccer.mom_votes(weekly_session_id);

ALTER TABLE soccer.weekly_sessions
  ADD COLUMN IF NOT EXISTS mom_vote_token TEXT UNIQUE;

-- ── Public RPC: fetch the voting page for a token (no auth) ─────────────────
-- Returns lineup + voting status. SECURITY DEFINER so unauthenticated users
-- can call it via the anon key.
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
  WHERE ws.mom_vote_token = p_token
  LIMIT 1;
$$;

-- ── Public RPC: cast / update a vote (no auth) ──────────────────────────────
-- Dedup via UNIQUE(weekly_session_id, voter_fingerprint). Users can change
-- their vote (rows updated in place) until the voting window closes.
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
BEGIN
  -- Find the weekly session by token
  SELECT ws.id, ws.lineup_id, ws.mom_results_message_id, ws.state
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

  -- Verify the player is in the lineup
  SELECT EXISTS (
    SELECT 1
    FROM soccer.lineups l,
         jsonb_array_elements(l.player_positions) pos
    WHERE l.id = ws_row.lineup_id
      AND (pos->>'player_id')::uuid = p_player_id
  ) INTO is_valid_player;

  IF NOT is_valid_player THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_not_in_lineup');
  END IF;

  IF p_fingerprint IS NULL OR length(p_fingerprint) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_fingerprint');
  END IF;

  -- Upsert vote (change vote allowed until voting closes)
  INSERT INTO soccer.mom_votes (weekly_session_id, voted_for_player_id, voter_fingerprint)
  VALUES (ws_row.id, p_player_id, p_fingerprint)
  ON CONFLICT (weekly_session_id, voter_fingerprint)
  DO UPDATE SET voted_for_player_id = EXCLUDED.voted_for_player_id, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.get_mom_vote_page(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION soccer.cast_mom_vote(TEXT, UUID, TEXT) TO anon, authenticated;

-- ── Allow 'web_link' in mom_method (already allowed) ────────────────────────
-- Already in the check constraint from earlier migrations.;
