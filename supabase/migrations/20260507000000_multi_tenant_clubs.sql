-- =============================================================================
-- Multi-tenant refactor: introduce clubs as the unit of tenancy.
--
-- Roadmap §12 item #1. Today every authenticated user sees every row;
-- after this migration, every domain row is scoped to a club, and users
-- only see clubs they're a member of.
--
-- Data model:
--   soccer.clubs           — one row per organising group (e.g. "TSC Football")
--   soccer.club_members    — (club_id, user_id, role) — per-club roles
--   soccer.club_players    — (club_id, player_id) — players belong to ≥1 clubs
--   soccer.players         — globally unique roster records (skills, JID etc.).
--                            Optional user_id link for future "claim your account" flow.
--   soccer.session_schedules / weekly_sessions / lineups / mom_votes /
--   team_constraints / runtime_events — all gain a club_id NOT NULL (denormalised
--                                       for RLS query speed).
--   soccer.organiser_config — DROPPED. bot_persona/timezone/enabled move into clubs;
--                             relay_url moves to edge function env var RELAY_URL.
--
-- Backfill: an existing project with z@zee.me + 49 players + the "Tuesday Night
-- Football" schedule gets all of it bundled into one club called "TSC Football",
-- z@zee.me as owner. On a fresh DB the backfill is a no-op.
-- =============================================================================

-- ── 1. Drop existing RLS policies (we're rewriting all of them) ─────────────
DROP POLICY IF EXISTS "Authenticated users have full access to app_users" ON soccer.app_users;
DROP POLICY IF EXISTS "Authenticated users have full access to players" ON soccer.players;
DROP POLICY IF EXISTS "Authenticated users have full access to lineups" ON soccer.lineups;
DROP POLICY IF EXISTS "organisers_select_config" ON soccer.organiser_config;
DROP POLICY IF EXISTS "organisers_update_config" ON soccer.organiser_config;
DROP POLICY IF EXISTS "admins_insert_config" ON soccer.organiser_config;
DROP POLICY IF EXISTS "organisers_read_session_schedules" ON soccer.session_schedules;
DROP POLICY IF EXISTS "organisers_write_session_schedules" ON soccer.session_schedules;
DROP POLICY IF EXISTS "organisers_read_lineups" ON soccer.lineups;
DROP POLICY IF EXISTS "organisers_write_lineups" ON soccer.lineups;
DROP POLICY IF EXISTS "organisers_read_weekly_sessions" ON soccer.weekly_sessions;
DROP POLICY IF EXISTS "organisers_write_weekly_sessions" ON soccer.weekly_sessions;
DROP POLICY IF EXISTS "organisers_read_runtime_events" ON soccer.runtime_events;
DROP POLICY IF EXISTS "organisers_read_constraints" ON soccer.team_constraints;
DROP POLICY IF EXISTS "organisers_write_constraints" ON soccer.team_constraints;

-- ── 2. clubs table ──────────────────────────────────────────────────────────
CREATE TABLE soccer.clubs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'UTC',
  bot_persona   text NOT NULL DEFAULT 'Pitch Bot',
  enabled       boolean NOT NULL DEFAULT false,
  alert_channel text NOT NULL DEFAULT 'in_app'
                CHECK (alert_channel IN ('in_app','email','whatsapp_dm','push')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_clubs_enabled ON soccer.clubs(enabled) WHERE enabled = true;

CREATE TRIGGER tr_clubs_updated_at
  BEFORE UPDATE ON soccer.clubs
  FOR EACH ROW EXECUTE FUNCTION soccer.update_updated_at_column();

-- ── 3. club_members (per-club role) ─────────────────────────────────────────
CREATE TYPE soccer.club_role AS ENUM ('owner', 'organiser', 'member');

CREATE TABLE soccer.club_members (
  club_id    uuid NOT NULL REFERENCES soccer.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       soccer.club_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX idx_club_members_user ON soccer.club_members(user_id);
CREATE INDEX idx_club_members_org_role ON soccer.club_members(club_id, role)
  WHERE role IN ('owner', 'organiser');

-- ── 4. club_players (many-to-many roster join) ──────────────────────────────
CREATE TABLE soccer.club_players (
  club_id   uuid NOT NULL REFERENCES soccer.clubs(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES soccer.players(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (club_id, player_id)
);
CREATE INDEX idx_club_players_player ON soccer.club_players(player_id);

-- ── 5. players: optional user_id link for future "claim your account" ───────
ALTER TABLE soccer.players
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_players_user_id_unique
  ON soccer.players(user_id) WHERE user_id IS NOT NULL;

-- ── 6. Add club_id to club-scoped tables (nullable for now → backfill → NOT NULL) ─
ALTER TABLE soccer.session_schedules ADD COLUMN club_id uuid REFERENCES soccer.clubs(id) ON DELETE CASCADE;
ALTER TABLE soccer.weekly_sessions   ADD COLUMN club_id uuid REFERENCES soccer.clubs(id) ON DELETE CASCADE;
ALTER TABLE soccer.lineups           ADD COLUMN club_id uuid REFERENCES soccer.clubs(id) ON DELETE CASCADE;
ALTER TABLE soccer.mom_votes         ADD COLUMN club_id uuid REFERENCES soccer.clubs(id) ON DELETE CASCADE;
ALTER TABLE soccer.team_constraints  ADD COLUMN club_id uuid REFERENCES soccer.clubs(id) ON DELETE CASCADE;
ALTER TABLE soccer.runtime_events    ADD COLUMN club_id uuid REFERENCES soccer.clubs(id) ON DELETE CASCADE;

-- ── 7. Backfill — only on existing project (z@zee.me + organiser_config row) ─
DO $$
DECLARE
  v_user_id uuid;
  v_club_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'z@zee.me';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'z@zee.me not found — skipping backfill (fresh DB)';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM soccer.organiser_config WHERE id = 1) THEN
    RAISE NOTICE 'No organiser_config row — skipping backfill';
    RETURN;
  END IF;

  -- Create the TSC Football club from the existing organiser_config row
  INSERT INTO soccer.clubs (name, timezone, bot_persona, enabled, alert_channel, created_by)
  SELECT 'TSC Football', timezone, bot_persona, enabled, alert_channel, v_user_id
    FROM soccer.organiser_config WHERE id = 1
  RETURNING id INTO v_club_id;

  -- z@zee.me is the owner
  INSERT INTO soccer.club_members (club_id, user_id, role)
  VALUES (v_club_id, v_user_id, 'owner');

  -- Every existing player → TSC Football
  INSERT INTO soccer.club_players (club_id, player_id, added_by)
  SELECT v_club_id, p.id, v_user_id FROM soccer.players p;

  -- All scheduled rows → TSC Football
  UPDATE soccer.session_schedules SET club_id = v_club_id WHERE club_id IS NULL;
  UPDATE soccer.weekly_sessions   SET club_id = v_club_id WHERE club_id IS NULL;
  UPDATE soccer.lineups           SET club_id = v_club_id WHERE club_id IS NULL;
  UPDATE soccer.mom_votes         SET club_id = v_club_id WHERE club_id IS NULL;
  UPDATE soccer.team_constraints  SET club_id = v_club_id WHERE club_id IS NULL;
  UPDATE soccer.runtime_events    SET club_id = v_club_id WHERE club_id IS NULL;
END $$;

-- ── 8. NOT NULL where it's required ─────────────────────────────────────────
-- session_schedules + downstream are required to belong to a club.
-- runtime_events stays NULLABLE because cron-level/system-wide events have no club.
ALTER TABLE soccer.session_schedules ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE soccer.weekly_sessions   ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE soccer.lineups           ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE soccer.mom_votes         ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE soccer.team_constraints  ALTER COLUMN club_id SET NOT NULL;

-- ── 9. Indexes for query performance ────────────────────────────────────────
CREATE INDEX idx_session_schedules_club  ON soccer.session_schedules(club_id, enabled);
CREATE INDEX idx_weekly_sessions_club    ON soccer.weekly_sessions(club_id, kickoff_at DESC);
CREATE INDEX idx_lineups_club            ON soccer.lineups(club_id);
CREATE INDEX idx_mom_votes_club          ON soccer.mom_votes(club_id);
CREATE INDEX idx_team_constraints_club   ON soccer.team_constraints(club_id);
CREATE INDEX idx_runtime_events_club     ON soccer.runtime_events(club_id, occurred_at DESC)
  WHERE club_id IS NOT NULL;

-- ── 10. Helper functions for RLS (SECURITY DEFINER avoids recursive RLS) ────
CREATE OR REPLACE FUNCTION soccer.is_club_member(p_club_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = soccer, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM soccer.club_members
     WHERE club_id = p_club_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION soccer.is_club_organiser(p_club_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = soccer, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM soccer.club_members
     WHERE club_id = p_club_id AND user_id = auth.uid()
       AND role IN ('owner', 'organiser')
  );
$$;

CREATE OR REPLACE FUNCTION soccer.user_clubs()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = soccer, public
AS $$
  SELECT club_id FROM soccer.club_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION soccer.is_club_member(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION soccer.is_club_organiser(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION soccer.user_clubs() TO authenticated;

-- ── 11. RLS policies ────────────────────────────────────────────────────────
ALTER TABLE soccer.clubs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE soccer.club_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE soccer.club_players    ENABLE ROW LEVEL SECURITY;

-- clubs
CREATE POLICY "clubs_member_read" ON soccer.clubs
  FOR SELECT USING (soccer.is_club_member(id));
CREATE POLICY "clubs_owner_update" ON soccer.clubs
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM soccer.club_members
             WHERE club_id = soccer.clubs.id AND user_id = auth.uid() AND role = 'owner')
  );
CREATE POLICY "clubs_owner_delete" ON soccer.clubs
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM soccer.club_members
             WHERE club_id = soccer.clubs.id AND user_id = auth.uid() AND role = 'owner')
  );
CREATE POLICY "clubs_anyone_create" ON soccer.clubs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- club_members: members read same-club; first-row insert allowed (creator becomes owner);
-- subsequent member changes by owner/organiser only.
CREATE POLICY "club_members_member_read" ON soccer.club_members
  FOR SELECT USING (soccer.is_club_member(club_id));
CREATE POLICY "club_members_first_owner_insert" ON soccer.club_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND role = 'owner'
    AND NOT EXISTS (
      SELECT 1 FROM soccer.club_members existing
       WHERE existing.club_id = club_members.club_id
    )
  );
CREATE POLICY "club_members_organiser_insert" ON soccer.club_members
  FOR INSERT WITH CHECK (soccer.is_club_organiser(club_id));
CREATE POLICY "club_members_organiser_update" ON soccer.club_members
  FOR UPDATE USING (soccer.is_club_organiser(club_id))
  WITH CHECK (soccer.is_club_organiser(club_id));
CREATE POLICY "club_members_organiser_delete" ON soccer.club_members
  FOR DELETE USING (soccer.is_club_organiser(club_id));

-- club_players: members read; organisers write
CREATE POLICY "club_players_member_read" ON soccer.club_players
  FOR SELECT USING (soccer.is_club_member(club_id));
CREATE POLICY "club_players_organiser_write" ON soccer.club_players
  FOR ALL USING (soccer.is_club_organiser(club_id))
  WITH CHECK (soccer.is_club_organiser(club_id));

-- players: visible if you're a member of any club this player is in, OR it's your own record
CREATE POLICY "players_member_read" ON soccer.players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM soccer.club_players cp
       WHERE cp.player_id = soccer.players.id
         AND soccer.is_club_member(cp.club_id)
    )
    OR user_id = auth.uid()
  );
-- Insert: any organiser of any club may create a new player record. They're expected
-- to also insert a club_players row immediately after.
CREATE POLICY "players_organiser_insert" ON soccer.players
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM soccer.club_members
             WHERE user_id = auth.uid() AND role IN ('owner', 'organiser'))
  );
-- Update: organisers of any club this player is in, OR the player themselves (claimed)
CREATE POLICY "players_organiser_update" ON soccer.players
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM soccer.club_players cp
       WHERE cp.player_id = soccer.players.id
         AND soccer.is_club_organiser(cp.club_id)
    )
    OR user_id = auth.uid()
  );
-- Delete: organisers of any club this player is in
CREATE POLICY "players_organiser_delete" ON soccer.players
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM soccer.club_players cp
       WHERE cp.player_id = soccer.players.id
         AND soccer.is_club_organiser(cp.club_id)
    )
  );

-- session_schedules: members read, organisers write
CREATE POLICY "schedules_member_read" ON soccer.session_schedules
  FOR SELECT USING (soccer.is_club_member(club_id));
CREATE POLICY "schedules_organiser_write" ON soccer.session_schedules
  FOR ALL USING (soccer.is_club_organiser(club_id))
  WITH CHECK (soccer.is_club_organiser(club_id));

-- weekly_sessions
CREATE POLICY "weekly_sessions_member_read" ON soccer.weekly_sessions
  FOR SELECT USING (soccer.is_club_member(club_id));
CREATE POLICY "weekly_sessions_organiser_write" ON soccer.weekly_sessions
  FOR ALL USING (soccer.is_club_organiser(club_id))
  WITH CHECK (soccer.is_club_organiser(club_id));

-- lineups
CREATE POLICY "lineups_member_read" ON soccer.lineups
  FOR SELECT USING (soccer.is_club_member(club_id));
CREATE POLICY "lineups_organiser_write" ON soccer.lineups
  FOR ALL USING (soccer.is_club_organiser(club_id))
  WITH CHECK (soccer.is_club_organiser(club_id));

-- mom_votes: read by members; writes only happen via SECURITY DEFINER RPC
CREATE POLICY "mom_votes_member_read" ON soccer.mom_votes
  FOR SELECT USING (soccer.is_club_member(club_id));

-- team_constraints
CREATE POLICY "team_constraints_member_read" ON soccer.team_constraints
  FOR SELECT USING (soccer.is_club_member(club_id));
CREATE POLICY "team_constraints_organiser_write" ON soccer.team_constraints
  FOR ALL USING (soccer.is_club_organiser(club_id))
  WITH CHECK (soccer.is_club_organiser(club_id));

-- runtime_events: club members can read their own club's events; system events
-- (club_id IS NULL) are visible to any authenticated user (debugging convenience).
-- Writes are service-role-only — no INSERT policy.
CREATE POLICY "runtime_events_member_read" ON soccer.runtime_events
  FOR SELECT USING (
    (club_id IS NOT NULL AND soccer.is_club_member(club_id))
    OR (club_id IS NULL AND auth.uid() IS NOT NULL)
  );

-- app_users: users can read/update only their own row
CREATE POLICY "app_users_self_read" ON soccer.app_users
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "app_users_self_update" ON soccer.app_users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── 12. Update cast_mom_vote RPC to populate the new club_id column ─────────
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 13. Drop organiser_config (replaced by columns on clubs) ────────────────
DROP TABLE soccer.organiser_config CASCADE;

-- ── 14. Grant the new tables to authenticator roles ─────────────────────────
GRANT ALL ON soccer.clubs        TO service_role, authenticated, anon;
GRANT ALL ON soccer.club_members TO service_role, authenticated, anon;
GRANT ALL ON soccer.club_players TO service_role, authenticated, anon;

-- ── 15. Comments for future maintainers ─────────────────────────────────────
COMMENT ON TABLE soccer.clubs IS
  'One row per organising group. Replaces the old singleton organiser_config (id=1).';
COMMENT ON TABLE soccer.club_members IS
  'Per-club role assignment. A user may be member of many clubs with different roles in each.';
COMMENT ON TABLE soccer.club_players IS
  'Many-to-many: players (global roster records) ↔ clubs they belong to.';
COMMENT ON COLUMN soccer.players.user_id IS
  'Optional: when a player "claims" their account, this links the player record to an auth.users row. Until then, players are pure data records managed by an organiser.';
COMMENT ON FUNCTION soccer.is_club_member(uuid) IS
  'RLS helper: true if auth.uid() is a member of the given club. SECURITY DEFINER to bypass recursive RLS on club_members.';
COMMENT ON FUNCTION soccer.is_club_organiser(uuid) IS
  'RLS helper: true if auth.uid() has owner or organiser role in the given club.';
