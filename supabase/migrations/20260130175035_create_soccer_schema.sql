
-- Create soccer schema for Streamlined Soccer app
CREATE SCHEMA IF NOT EXISTS soccer;

-- Player status and position enums
CREATE TYPE soccer.player_status AS ENUM ('regular', 'newbie', 'inactive');
CREATE TYPE soccer.preferred_position AS ENUM ('attacking', 'midfield', 'defensive', 'everywhere');
CREATE TYPE soccer.user_role AS ENUM ('admin', 'organiser', 'user');

-- Soccer-specific profiles extension (references public.profiles if exists, or standalone)
CREATE TABLE soccer.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role soccer.user_role DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players table with full skill attributes
CREATE TABLE soccer.players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status soccer.player_status DEFAULT 'regular',
  preferred_position soccer.preferred_position DEFAULT 'everywhere',
  shooting INTEGER DEFAULT 5 CHECK (shooting >= 0 AND shooting <= 10),
  passing INTEGER DEFAULT 5 CHECK (passing >= 0 AND passing <= 10),
  ball_control INTEGER DEFAULT 5 CHECK (ball_control >= 0 AND ball_control <= 10),
  playmaking INTEGER DEFAULT 5 CHECK (playmaking >= 0 AND playmaking <= 10),
  defending INTEGER DEFAULT 5 CHECK (defending >= 0 AND defending <= 10),
  fitness INTEGER DEFAULT 5 CHECK (fitness >= 0 AND fitness <= 10),
  overall_score INTEGER GENERATED ALWAYS AS (
    ROUND((shooting + passing + ball_control + playmaking + defending + fitness)::NUMERIC / 6 * 10)
  ) STORED,
  is_linchpin BOOLEAN DEFAULT FALSE,
  aliases TEXT[] DEFAULT '{}',
  notes TEXT,
  created_by UUID REFERENCES soccer.app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lineups table for saved formations
CREATE TABLE soccer.lineups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID REFERENCES soccer.app_users(id),
  player_positions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION soccer.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER update_soccer_app_users_updated_at
  BEFORE UPDATE ON soccer.app_users
  FOR EACH ROW EXECUTE FUNCTION soccer.update_updated_at_column();

CREATE TRIGGER update_soccer_players_updated_at
  BEFORE UPDATE ON soccer.players
  FOR EACH ROW EXECUTE FUNCTION soccer.update_updated_at_column();

CREATE TRIGGER update_soccer_lineups_updated_at
  BEFORE UPDATE ON soccer.lineups
  FOR EACH ROW EXECUTE FUNCTION soccer.update_updated_at_column();

-- Enable RLS
ALTER TABLE soccer.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE soccer.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE soccer.lineups ENABLE ROW LEVEL SECURITY;

-- RLS Policies for app_users
CREATE POLICY "Users can view own profile" ON soccer.app_users
  FOR SELECT USING (auth.uid()::text = id::text OR auth.uid() IS NULL);

-- RLS Policies for players (everyone can read, organiser+ can write)
CREATE POLICY "Anyone can view players" ON soccer.players
  FOR SELECT USING (true);

CREATE POLICY "Organisers can insert players" ON soccer.players
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM soccer.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'organiser')
    ) OR auth.uid() IS NULL
  );

CREATE POLICY "Organisers can update players" ON soccer.players
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM soccer.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'organiser')
    ) OR auth.uid() IS NULL
  );

CREATE POLICY "Organisers can delete players" ON soccer.players
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM soccer.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'organiser')
    ) OR auth.uid() IS NULL
  );

-- RLS Policies for lineups
CREATE POLICY "Anyone can view lineups" ON soccer.lineups
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own lineups" ON soccer.lineups
  FOR INSERT WITH CHECK (auth.uid() = created_by OR auth.uid() IS NULL);

CREATE POLICY "Users can update own lineups" ON soccer.lineups
  FOR UPDATE USING (auth.uid() = created_by OR auth.uid() IS NULL);

CREATE POLICY "Users can delete own lineups" ON soccer.lineups
  FOR DELETE USING (auth.uid() = created_by OR auth.uid() IS NULL);

-- Indexes
CREATE INDEX idx_soccer_players_name ON soccer.players(name);
CREATE INDEX idx_soccer_players_overall_score ON soccer.players(overall_score DESC);
CREATE INDEX idx_soccer_lineups_created_by ON soccer.lineups(created_by);
;
