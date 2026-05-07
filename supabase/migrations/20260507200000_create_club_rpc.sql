-- =============================================================================
-- Phase 5: Atomic "create your first club" RPC.
--
-- Creating a club is two inserts (clubs + club_members(owner)). Doing them from
-- the client risks an orphan club if the second insert fails. Wrap them in a
-- SECURITY DEFINER function so they run as one transaction with elevated
-- privileges, then verify the caller is authenticated and use auth.uid() as
-- the owner.
-- =============================================================================

CREATE OR REPLACE FUNCTION soccer.create_club_with_owner(
  p_name text,
  p_timezone text DEFAULT 'UTC',
  p_bot_persona text DEFAULT 'Pitch Bot'
) RETURNS soccer.clubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = soccer, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_club    soccer.clubs;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  INSERT INTO soccer.clubs (name, timezone, bot_persona, enabled, created_by)
  VALUES (btrim(p_name), p_timezone, p_bot_persona, true, v_user_id)
  RETURNING * INTO v_club;

  INSERT INTO soccer.club_members (club_id, user_id, role)
  VALUES (v_club.id, v_user_id, 'owner');

  RETURN v_club;
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.create_club_with_owner(text, text, text) TO authenticated;

COMMENT ON FUNCTION soccer.create_club_with_owner(text, text, text) IS
  'Atomic onboarding helper: creates a club and makes the caller its owner. Used by the "create your first club" wizard.';
