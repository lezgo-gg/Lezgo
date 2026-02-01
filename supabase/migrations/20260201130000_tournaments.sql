-- Tournois
CREATE TABLE tournaments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
  partner_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  created_by UUID,
  title TEXT NOT NULL CHECK (char_length(title) <= 100),
  description TEXT DEFAULT '',
  format TEXT NOT NULL DEFAULT '5v5'
    CHECK (format IN ('1v1', '2v2', '3v3', '5v5', 'custom')),
  max_participants INT DEFAULT 32,
  participant_count INT DEFAULT 0,
  rank_min TEXT,
  rank_max TEXT,
  prize TEXT,
  rules TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending_partner', 'in_progress', 'completed', 'cancelled')),
  is_cross_community BOOLEAN DEFAULT false,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Demandes cross-communaute
CREATE TABLE tournament_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  from_server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
  to_server_id UUID REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
  requested_by UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  message TEXT DEFAULT '',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Participants
CREATE TABLE tournament_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  team_name TEXT,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'checked_in', 'eliminated', 'winner')),
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

-- Trigger participant_count
CREATE OR REPLACE FUNCTION update_tournament_participant_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tournaments SET participant_count = participant_count + 1 WHERE id = NEW.tournament_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tournaments SET participant_count = GREATEST(0, participant_count - 1) WHERE id = OLD.tournament_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_tournament_participant_count
AFTER INSERT OR DELETE ON tournament_participants
FOR EACH ROW EXECUTE FUNCTION update_tournament_participant_count();

-- RLS
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tournaments_select_public" ON tournaments FOR SELECT USING (true);
CREATE POLICY "tournaments_insert_service" ON tournaments FOR INSERT WITH CHECK (false);
CREATE POLICY "tournaments_update_service" ON tournaments FOR UPDATE USING (false);
CREATE POLICY "tournaments_delete_service" ON tournaments FOR DELETE USING (false);

ALTER TABLE tournament_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "treq_select_public" ON tournament_requests FOR SELECT USING (true);
CREATE POLICY "treq_insert_service" ON tournament_requests FOR INSERT WITH CHECK (false);
CREATE POLICY "treq_update_service" ON tournament_requests FOR UPDATE USING (false);

ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tp_select_public" ON tournament_participants FOR SELECT USING (true);
CREATE POLICY "tp_insert_service" ON tournament_participants FOR INSERT WITH CHECK (false);
CREATE POLICY "tp_delete_service" ON tournament_participants FOR DELETE USING (false);

-- Index
CREATE INDEX idx_tournaments_server ON tournaments(server_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_treq_to_server ON tournament_requests(to_server_id);
CREATE INDEX idx_tp_tournament ON tournament_participants(tournament_id);
