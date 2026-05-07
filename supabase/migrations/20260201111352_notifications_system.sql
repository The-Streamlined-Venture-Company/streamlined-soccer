-- ============================================
-- NOTIFICATION & SCHEDULING SYSTEM
-- Part 1 of Streamlined Soccer Roadmap
-- ============================================

-- ============================================
-- SCHEDULES: Recurring job definitions
-- ============================================
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'Europe/London',
  message_type TEXT NOT NULL,
  message_template JSONB NOT NULL,
  channels TEXT[] NOT NULL,
  recipients JSONB NOT NULL,
  requires_confirmation BOOLEAN DEFAULT true,
  confirmation_cron TEXT,
  confirmation_channel TEXT DEFAULT 'in_app',
  auto_approve_minutes INT DEFAULT 60,
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_next_run
  ON schedules(next_run_at)
  WHERE enabled = true;

-- ============================================
-- CONFIRMATIONS: Pending owner approvals
-- ============================================
CREATE TABLE IF NOT EXISTS confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  status TEXT DEFAULT 'pending',
  asked_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  auto_approve_at TIMESTAMPTZ,
  UNIQUE(schedule_id, run_date)
);

CREATE INDEX IF NOT EXISTS idx_confirmations_pending
  ON confirmations(auto_approve_at)
  WHERE status = 'pending';

-- ============================================
-- OUTBOX: Notification queue
-- ============================================
CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message_data JSONB NOT NULL,
  send_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox(send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_failed
  ON outbox(created_at)
  WHERE status = 'failed';

-- ============================================
-- USER_NOTIFICATIONS: In-app inbox
-- ============================================
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  action_type TEXT,
  action_data JSONB,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications(user_id, created_at DESC)
  WHERE read = false;

-- ============================================
-- CHANNEL_CONFIG: API keys & settings per channel
-- ============================================
CREATE TABLE IF NOT EXISTS channel_config (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO channel_config (id, display_name, config) VALUES
  ('in_app', 'In-App Notification', '{}'),
  ('email', 'Email (Resend)', '{"endpoint": "https://api.resend.com/emails"}'),
  ('whatsapp', 'WhatsApp (Streamlined Assistant)', '{"endpoint": "TBD"}'),
  ('sms', 'SMS (Twilio)', '{"endpoint": "https://api.twilio.com"}')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedules" ON schedules
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create schedules" ON schedules
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own schedules" ON schedules
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own schedules" ON schedules
  FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "Users can view own confirmations" ON confirmations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM schedules
      WHERE schedules.id = confirmations.schedule_id
      AND schedules.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own confirmations" ON confirmations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM schedules
      WHERE schedules.id = confirmations.schedule_id
      AND schedules.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own outbox items" ON outbox
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM schedules
      WHERE schedules.id = outbox.schedule_id
      AND schedules.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own notifications" ON user_notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON user_notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can view channel config" ON channel_config
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_channel_config_updated_at
  BEFORE UPDATE ON channel_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();;
