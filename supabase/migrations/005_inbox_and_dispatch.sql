-- ============================================================
-- Unified inbox, message dispatch (idempotency), payments, posts
-- ============================================================

-- Payments table (for bot context + event triggers)
CREATE TABLE IF NOT EXISTS payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id),
  amount      INTEGER NOT NULL,  -- cents
  video_count INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_creator_id
  ON payments (creator_id, created_at DESC);

-- Posts table (for bot context + event triggers)
CREATE TABLE IF NOT EXISTS posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  campaign_id      UUID REFERENCES campaigns(id),
  platform         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  video_url        TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_creator_id
  ON posts (creator_id, created_at DESC);

-- Inbox items — unified feed for all surfaces
CREATE TABLE IF NOT EXISTS inbox_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                  CHECK (type IN ('system', 'chat', 'support')),
  thread_id     UUID,         -- conversation_id for chat/support
  preview       TEXT,         -- short display text
  entity_type   TEXT,         -- 'payment' | 'post' | 'campaign' | 'job' | null
  entity_id     UUID,         -- deep-link target
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_inbox_creator_created
  ON inbox_items (creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_unread
  ON inbox_items (creator_id)
  WHERE read_at IS NULL;

-- Unique index prevents duplicate in-app deliveries per event+channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_idempotency
  ON inbox_items (creator_id, (metadata->>'idempotency_key'))
  WHERE metadata->>'idempotency_key' IS NOT NULL;

-- Message dispatch — idempotency for outbound channels
CREATE TABLE IF NOT EXISTS message_dispatch (
  idempotency_key  TEXT PRIMARY KEY,
  -- format: "{event_type}:{source_id}:{channel}"
  -- e.g.   "payment.sent:pay_123:email"
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_status
  ON message_dispatch (status, created_at)
  WHERE status = 'pending';
