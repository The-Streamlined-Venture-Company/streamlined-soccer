-- Simple RLS: authenticated users can do everything for now
-- Easy to tighten up later with organization_id

-- Drop complex policies
DROP POLICY IF EXISTS "Users can view their own profile" ON soccer.app_users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON soccer.app_users;
DROP POLICY IF EXISTS "Users can update their own profile" ON soccer.app_users;
DROP POLICY IF EXISTS "Admins can update all profiles" ON soccer.app_users;
DROP POLICY IF EXISTS "Service can insert profiles" ON soccer.app_users;

-- Simple policies: authenticated = full access
CREATE POLICY "Authenticated users have full access to app_users"
  ON soccer.app_users FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Players: anyone authenticated can manage
DROP POLICY IF EXISTS "Anyone can view players" ON soccer.players;
DROP POLICY IF EXISTS "Organisers can manage players" ON soccer.players;

CREATE POLICY "Authenticated users have full access to players"
  ON soccer.players FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Lineups: anyone authenticated can manage  
DROP POLICY IF EXISTS "Anyone can view lineups" ON soccer.lineups;
DROP POLICY IF EXISTS "Users can manage own lineups" ON soccer.lineups;

CREATE POLICY "Authenticated users have full access to lineups"
  ON soccer.lineups FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);;
