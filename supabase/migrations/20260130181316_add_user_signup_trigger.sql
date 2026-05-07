-- Function to handle new user signup
CREATE OR REPLACE FUNCTION soccer.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO soccer.app_users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users to create app_users entry
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION soccer.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA soccer TO authenticated;
GRANT ALL ON soccer.app_users TO authenticated;
GRANT ALL ON soccer.players TO authenticated;
GRANT ALL ON soccer.lineups TO authenticated;;
