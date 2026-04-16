-- ============================================================
-- Multi-campaign support
-- ============================================================

-- Join table: creator ↔ campaign (many-to-many)
CREATE TABLE IF NOT EXISTS creator_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (creator_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_campaigns_creator_active
  ON creator_campaigns (creator_id)
  WHERE active = true;

-- Pin each conversation to a specific campaign
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id);
