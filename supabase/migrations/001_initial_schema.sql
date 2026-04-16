-- ============================================================
-- Initial schema for creator support bot
-- ============================================================

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name        TEXT NOT NULL,
  brief_url         TEXT,
  platforms         TEXT[] NOT NULL DEFAULT '{}',
  posting_frequency TEXT,
  video_quota       INTEGER,
  content_format    TEXT,
  hashtags          TEXT[] DEFAULT '{}',
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Creators
CREATE TABLE IF NOT EXISTS creators (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT,
  email               TEXT UNIQUE NOT NULL,
  campaign_id         UUID REFERENCES campaigns(id),
  pay_rate            INTEGER,                               -- dollars
  pay_structure       TEXT CHECK (pay_structure IN ('per_video', 'monthly')),
  contract_signed     BOOLEAN NOT NULL DEFAULT false,
  bank_connected      BOOLEAN NOT NULL DEFAULT false,
  warmup_status       TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (warmup_status IN ('not_started', 'in_progress', 'complete')),
  warmup_day          INTEGER NOT NULL DEFAULT 0,
  total_videos_posted INTEGER NOT NULL DEFAULT 0,
  total_paid          INTEGER NOT NULL DEFAULT 0,           -- cents
  last_posted_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creators_campaign_id
  ON creators (campaign_id);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id     UUID NOT NULL REFERENCES creators(id),
  type           TEXT NOT NULL DEFAULT 'support'
                   CHECK (type IN ('support', 'campaign')),
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'resolved', 'escalated')),
  escalated      BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_creator_id
  ON conversations (creator_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON messages (conversation_id, created_at);

-- Bot logs (observability)
CREATE TABLE IF NOT EXISTS bot_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id   UUID REFERENCES creators(id),
  message      TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  escalated    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_creator_id
  ON bot_logs (creator_id);

CREATE INDEX IF NOT EXISTS idx_bot_logs_escalated
  ON bot_logs (escalated, created_at);
