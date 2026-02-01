-- Server license requests from streamers
CREATE TABLE server_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  discord_avatar TEXT,
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_icon TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'payment_received', 'active', 'rejected')),
  admin_note TEXT,
  license_label TEXT DEFAULT 'Standard',
  license_price NUMERIC DEFAULT 29.99,
  license_months INT DEFAULT 1,
  server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE server_requests ENABLE ROW LEVEL SECURITY;

-- Users can read their own requests
CREATE POLICY "select_own" ON server_requests FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own requests
CREATE POLICY "insert_own" ON server_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Updates only via service_role (admin)
CREATE POLICY "update_service" ON server_requests FOR UPDATE USING (false);
