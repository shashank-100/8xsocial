# Creator Support Bot

An AI-powered support bot that auto-responds to creator questions on the 8x platform. Answers are personalized using the creator's real data — pay rate, warmup status, campaign details — and the bot knows when to escalate to a human.

## Stack

- **Next.js 16** (App Router)
- **Supabase** (PostgreSQL)
- **OpenAI** (structured tool use for intent classification)
- **Slack** (escalation webhooks)
- **Vitest** (unit tests)

## How it works

1. Creator sends a message → stored in DB → `202` returned immediately
2. Bot runs in the background (`next/server after()`) — fetches creator + campaign context, calls LLM
3. LLM classifies intent: `DATA` / `GENERAL` / `ESCALATE`
4. Bot reply saved to DB — client polls and displays it
5. If `ESCALATE` — Slack alert sent to support team, conversation tagged

## Project structure

```
app/api/messages/route.ts     # POST (send message) + GET (poll for replies)
lib/bot/
  context.ts                  # Fetches creator + campaign from Supabase
  llm.ts                      # Builds system prompt, calls LLM, returns { intent, response }
  conversation.ts             # DB helpers: find/create conversation, save messages, tag escalated
  slack.ts                    # Slack webhook escalation alert
  log.ts                      # Logs every bot response to bot_logs table
supabase/migrations/
  001_initial_schema.sql      # Full schema: campaigns, creators, conversations, messages, bot_logs
__tests__/bot/
  pipeline.test.ts            # Unit tests for the message pipeline
```

## Setup

```bash
npm install
```

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
SLACK_WEBHOOK_URL=...        # optional — escalation alerts
NEXT_PUBLIC_APP_URL=...      # used in Slack deep links
```

Run migrations in your Supabase project, then:

```bash
npm run dev
```

## Tests

```bash
npm test
```

## API

```
POST /api/messages
  Body: { creatorId, message, conversationId? }
  Returns: 202 { conversationId, messageId }

GET /api/messages?conversationId=xxx
  Returns: { messages: Message[] }
```
