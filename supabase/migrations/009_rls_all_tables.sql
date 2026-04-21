-- Enable RLS on all tables that were left open

ALTER TABLE creators          ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_dispatch  ENABLE ROW LEVEL SECURITY;

-- creators: each creator reads their own row
DROP POLICY IF EXISTS "own_creator_row" ON creators;
CREATE POLICY "own_creator_row" ON creators
  FOR SELECT USING (id = auth.uid());

-- campaigns: creators see campaigns they are part of
DROP POLICY IF EXISTS "enrolled_campaigns" ON campaigns;
CREATE POLICY "enrolled_campaigns" ON campaigns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM creator_campaigns cc
      WHERE cc.campaign_id = campaigns.id
        AND cc.creator_id = auth.uid()
    )
  );

-- creator_campaigns: each creator sees their own rows
DROP POLICY IF EXISTS "own_creator_campaigns" ON creator_campaigns;
CREATE POLICY "own_creator_campaigns" ON creator_campaigns
  FOR SELECT USING (creator_id = auth.uid());

-- payments: each creator sees their own payments
DROP POLICY IF EXISTS "own_payments" ON payments;
CREATE POLICY "own_payments" ON payments
  FOR SELECT USING (creator_id = auth.uid());

-- posts: each creator sees their own posts
DROP POLICY IF EXISTS "own_posts" ON posts;
CREATE POLICY "own_posts" ON posts
  FOR SELECT USING (creator_id = auth.uid());

-- bot_logs: internal only — no public access
-- (service role bypasses RLS; no client-side policy needed)

-- message_dispatch: internal only — no public access
-- (service role bypasses RLS; no client-side policy needed)
