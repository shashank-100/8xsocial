-- ============================================================
-- RLS for messages/conversations + conversation mode column
-- ============================================================

-- Add mode column to conversations (bot = default, human = agent took over)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode TEXT
  CHECK (mode IN ('bot', 'human')) DEFAULT 'bot';

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_responded BOOLEAN NOT NULL DEFAULT false;

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_items ENABLE ROW LEVEL SECURITY;

-- Drop first so re-running is safe
DROP POLICY IF EXISTS "own_conversations" ON conversations;
DROP POLICY IF EXISTS "conversation_participants" ON messages;
DROP POLICY IF EXISTS "own_inbox_items" ON inbox_items;

-- Creators see only their own conversations
CREATE POLICY "own_conversations" ON conversations
  FOR SELECT USING (creator_id = auth.uid());

-- Messages: only if you own the conversation
CREATE POLICY "conversation_participants" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.creator_id = auth.uid()
    )
  );

-- Inbox: creator sees only their own items
CREATE POLICY "own_inbox_items" ON inbox_items
  FOR SELECT USING (creator_id = auth.uid());
