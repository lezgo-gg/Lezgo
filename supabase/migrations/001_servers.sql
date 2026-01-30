-- ============================================================
-- DuoFind: Servers, Server Members & LFG Posts
-- ============================================================

-- 1. Servers table
CREATE TABLE servers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT UNIQUE NOT NULL,
  guild_name TEXT NOT NULL,
  guild_icon TEXT,
  owner_discord_id TEXT,
  duoq_channel_id TEXT,
  invite_url TEXT,
  member_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Server members (join table)
CREATE TABLE server_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, user_id)
);

-- 3. LFG posts
CREATE TABLE lfg_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  wanted_role TEXT,
  note TEXT DEFAULT '' CHECK (char_length(note) <= 200),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Trigger: auto-update member_count on servers
CREATE OR REPLACE FUNCTION update_server_member_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE servers SET member_count = member_count + 1, updated_at = NOW() WHERE id = NEW.server_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE servers SET member_count = GREATEST(0, member_count - 1), updated_at = NOW() WHERE id = OLD.server_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_server_member_count
AFTER INSERT OR DELETE ON server_members
FOR EACH ROW EXECUTE FUNCTION update_server_member_count();

-- 5. RLS Policies

-- servers: public read, bot-only write (service_role)
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "servers_select_public"
  ON servers FOR SELECT
  USING (true);

CREATE POLICY "servers_insert_service"
  ON servers FOR INSERT
  WITH CHECK (false); -- only service_role bypasses RLS

CREATE POLICY "servers_update_service"
  ON servers FOR UPDATE
  USING (false); -- only service_role bypasses RLS

-- server_members: public read, user can join/leave for themselves
ALTER TABLE server_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "server_members_select_public"
  ON server_members FOR SELECT
  USING (true);

CREATE POLICY "server_members_insert_own"
  ON server_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "server_members_delete_own"
  ON server_members FOR DELETE
  USING (auth.uid() = user_id);

-- lfg_posts: public read, user can create/delete their own
ALTER TABLE lfg_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lfg_posts_select_public"
  ON lfg_posts FOR SELECT
  USING (true);

CREATE POLICY "lfg_posts_insert_own"
  ON lfg_posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "lfg_posts_delete_own"
  ON lfg_posts FOR DELETE
  USING (auth.uid() = user_id);
