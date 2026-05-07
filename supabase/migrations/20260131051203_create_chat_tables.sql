
-- Chat threads table
CREATE TABLE soccer.chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE soccer.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES soccer.chat_threads(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_chat_threads_user_id ON soccer.chat_threads(user_id);
CREATE INDEX idx_chat_threads_updated_at ON soccer.chat_threads(updated_at DESC);
CREATE INDEX idx_chat_messages_thread_id ON soccer.chat_messages(thread_id);
CREATE INDEX idx_chat_messages_created_at ON soccer.chat_messages(created_at);

-- RLS policies
ALTER TABLE soccer.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE soccer.chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can only see their own threads
CREATE POLICY "Users can view own threads" ON soccer.chat_threads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own threads" ON soccer.chat_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own threads" ON soccer.chat_threads
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own threads" ON soccer.chat_threads
  FOR DELETE USING (auth.uid() = user_id);

-- Users can only see messages in their own threads
CREATE POLICY "Users can view messages in own threads" ON soccer.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM soccer.chat_threads 
      WHERE id = thread_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages in own threads" ON soccer.chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM soccer.chat_threads 
      WHERE id = thread_id AND user_id = auth.uid()
    )
  );
;
