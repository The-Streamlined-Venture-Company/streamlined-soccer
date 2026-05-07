
-- Players table for storing player data with skills and ratings
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'regular' CHECK (status IN ('regular', 'newbie', 'inactive')),
  preferred_position TEXT NOT NULL DEFAULT 'everywhere' CHECK (preferred_position IN ('attacking', 'midfield', 'defensive', 'everywhere')),
  
  -- Individual skills (1-10 scale)
  shooting INTEGER NOT NULL DEFAULT 5 CHECK (shooting >= 1 AND shooting <= 10),
  passing INTEGER NOT NULL DEFAULT 5 CHECK (passing >= 1 AND passing <= 10),
  ball_control INTEGER NOT NULL DEFAULT 5 CHECK (ball_control >= 1 AND ball_control <= 10),
  playmaking INTEGER NOT NULL DEFAULT 5 CHECK (playmaking >= 1 AND playmaking <= 10),
  defending INTEGER NOT NULL DEFAULT 5 CHECK (defending >= 1 AND defending <= 10),
  fitness INTEGER NOT NULL DEFAULT 5 CHECK (fitness >= 1 AND fitness <= 10),
  
  -- Computed overall score (stored for query efficiency)
  overall_score INTEGER GENERATED ALWAYS AS (
    ROUND((shooting + passing + ball_control + playmaking + defending + fitness) * 10.0 / 6)
  ) STORED,
  
  -- Key player flag - these players get distributed evenly across teams
  is_linchpin BOOLEAN NOT NULL DEFAULT false,
  
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast name lookups (case-insensitive)
CREATE INDEX idx_players_name_lower ON players (LOWER(name));

-- Index for filtering by status
CREATE INDEX idx_players_status ON players (status);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read players
CREATE POLICY "Players are viewable by everyone" ON players
  FOR SELECT USING (true);

-- Policy: Authenticated users can insert
CREATE POLICY "Authenticated users can insert players" ON players
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Policy: Authenticated users can update
CREATE POLICY "Authenticated users can update players" ON players
  FOR UPDATE TO authenticated
  USING (true);

-- Policy: Authenticated users can delete
CREATE POLICY "Authenticated users can delete players" ON players
  FOR DELETE TO authenticated
  USING (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
;
