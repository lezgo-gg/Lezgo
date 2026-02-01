-- Add Twitch OAuth data columns to server_requests
ALTER TABLE server_requests
  ADD COLUMN twitch_id TEXT,
  ADD COLUMN twitch_username TEXT,
  ADD COLUMN twitch_display_name TEXT,
  ADD COLUMN twitch_avatar TEXT,
  ADD COLUMN twitch_followers INT DEFAULT 0,
  ADD COLUMN twitch_broadcaster_type TEXT DEFAULT '',
  ADD COLUMN twitch_avg_viewers INT DEFAULT 0;

-- Remove default price (will be calculated dynamically from Twitch stats)
ALTER TABLE server_requests ALTER COLUMN license_price DROP DEFAULT;
