-- Store Slack message ts so we can map thread replies back to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS slack_thread_ts TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_slack_thread_ts
  ON conversations (slack_thread_ts)
  WHERE slack_thread_ts IS NOT NULL;
