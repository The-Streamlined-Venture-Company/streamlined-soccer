-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own profile" ON soccer.app_users;
DROP POLICY IF EXISTS "Users can update their own profile" ON soccer.app_users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON soccer.app_users;
DROP POLICY IF EXISTS "Admins can update user roles" ON soccer.app_users;

-- Enable RLS
ALTER TABLE soccer.app_users ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile
CREATE POLICY "Users can view their own profile"
  ON soccer.app_users FOR SELECT
  USING (auth.uid() = id);

-- Admins can view all profiles  
CREATE POLICY "Admins can view all profiles"
  ON soccer.app_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM soccer.app_users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can update their own profile (except role)
CREATE POLICY "Users can update their own profile"
  ON soccer.app_users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can update any profile including roles
CREATE POLICY "Admins can update all profiles"
  ON soccer.app_users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM soccer.app_users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Allow inserts from the trigger (service role)
CREATE POLICY "Service can insert profiles"
  ON soccer.app_users FOR INSERT
  WITH CHECK (true);;
