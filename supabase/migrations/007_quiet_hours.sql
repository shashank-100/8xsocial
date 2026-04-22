-- ============================================================
-- Quiet hours per creator
-- ============================================================

-- Stored as HH:MM in creator's local timezone
ALTER TABLE creators ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT DEFAULT '22:00';
ALTER TABLE creators ADD COLUMN IF NOT EXISTS quiet_hours_end   TEXT DEFAULT '08:00';
ALTER TABLE creators ADD COLUMN IF NOT EXISTS timezone          TEXT DEFAULT 'UTC';
