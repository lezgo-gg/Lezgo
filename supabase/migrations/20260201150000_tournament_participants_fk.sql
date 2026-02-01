-- Add FK from tournament_participants.user_id to profiles.id
-- This allows PostgREST (Supabase) to resolve the join for participant profiles
ALTER TABLE tournament_participants
  ADD CONSTRAINT tournament_participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
