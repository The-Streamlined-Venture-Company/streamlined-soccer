-- =============================================================================
-- Phase 5: Atomic "add a player to my club" RPC.
--
-- Two-step (insert into players, then club_players) doesn't work from the client
-- because the players SELECT policy filters out rows the caller doesn't yet
-- belong to via club_players — so .select() after .insert() returns nothing.
-- This wraps both inserts in a SECURITY DEFINER function and returns the new
-- player row.
-- =============================================================================

CREATE OR REPLACE FUNCTION soccer.add_player_to_club(
  p_club_id uuid,
  p_player jsonb
) RETURNS soccer.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = soccer, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_player  soccer.players;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT soccer.is_club_organiser(p_club_id) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  IF p_player IS NULL OR (p_player->>'name') IS NULL OR length(btrim(p_player->>'name')) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  INSERT INTO soccer.players (
    name, status, preferred_position,
    shooting, passing, ball_control, playmaking, defending, fitness,
    is_linchpin, preferred_team, aliases, notes,
    whatsapp_phone, whatsapp_jid, whatsapp_push_name,
    discovered_via, created_by
  )
  VALUES (
    btrim(p_player->>'name'),
    COALESCE(p_player->>'status', 'regular')::soccer.player_status,
    COALESCE(p_player->>'preferred_position', 'everywhere')::soccer.preferred_position,
    COALESCE((p_player->>'shooting')::int, 5),
    COALESCE((p_player->>'passing')::int, 5),
    COALESCE((p_player->>'ball_control')::int, 5),
    COALESCE((p_player->>'playmaking')::int, 5),
    COALESCE((p_player->>'defending')::int, 5),
    COALESCE((p_player->>'fitness')::int, 5),
    COALESCE((p_player->>'is_linchpin')::boolean, false),
    COALESCE(p_player->>'preferred_team', 'any')::soccer.team_preference,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_player->'aliases')),
      ARRAY[]::text[]
    ),
    p_player->>'notes',
    p_player->>'whatsapp_phone',
    p_player->>'whatsapp_jid',
    p_player->>'whatsapp_push_name',
    COALESCE(p_player->>'discovered_via', 'manual'),
    v_user_id
  )
  RETURNING * INTO v_player;

  INSERT INTO soccer.club_players (club_id, player_id, added_by)
  VALUES (p_club_id, v_player.id, v_user_id);

  RETURN v_player;
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.add_player_to_club(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION soccer.add_player_to_club(uuid, jsonb) IS
  'Atomic helper: inserts a player record and links it to a club in one transaction. Used by the player manager UI.';
