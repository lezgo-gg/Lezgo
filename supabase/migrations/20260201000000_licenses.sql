-- ============================================================
-- Licenses: Add license columns to servers table
-- ============================================================

ALTER TABLE servers ADD COLUMN IF NOT EXISTS licensed BOOLEAN DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS license_label TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS license_price NUMERIC;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS license_started_at TIMESTAMPTZ;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ;
