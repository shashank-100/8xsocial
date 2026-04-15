# Creator Support Bot — Engineering Assignment Submission

---

## 1. Architecture Overview

### How the bot decides what to answer vs. escalate

Every incoming message is classified into one of three intents by the LLM:

- **DATA** — answerable using the creator's actual data (pay rate, warmup status, videos posted, etc.)
- **GENERAL** — answerable using static instructions (Spark Codes, bank/Stripe setup, warmup process)
- **ESCALATE** — must be routed to a human

The classification happens inside a single OpenAI function call (`support_response`). The model is given the full creator + campaign context and a strict set of rules. It cannot free-text respond — it must call the tool with `{ intent, response }`. This forces structured output and prevents hallucination.

### How it fetches and injects context

Before the LLM is called, two Supabase queries run:

1. `SELECT * FROM creators WHERE id = $1` — fetches creator data
2. `SELECT * FROM campaigns WHERE id = $creator.campaign_id` — fetches their campaign

Both are injected into the system prompt as structured sections (CREATOR DATA, CAMPAIGN DATA). Fields that are `null` are injected as-is — the LLM is instructed to escalate rather than guess.

### Where the bot logic runs in the request lifecycle

```
Creator DMs bot on Slack
        ↓
POST /api/slack — returns 200 immediately (< 100ms)
        ↓
next/server after() — defers bot processing past HTTP response
        ↓
findCreatorBySlackId() → findOrCreateConversation() → saveMessage()
        ↓
getContext() → callLLM() → thread.post(response)
        ↓
saveMessage() + logResponse()
```

Slack requires a 200 response within 3 seconds. The LLM call takes 2–8 seconds. Using `after()` from Next.js, the bot responds immediately and processes the message asynchronously — the creator sees a reply appear in their DM a few seconds later.

### How multi-campaign creators are handled

The `creators` table has a single `campaign_id` FK. Each creator belongs to one campaign at a time. The context loader (`lib/bot/context.ts`) always fetches the current campaign from that FK — no ambiguity.

If a creator is moved between campaigns, the next message will automatically pull the new campaign context. No caching, no stale data.

---

## 2. Prompt Engineering

### System prompt design

The system prompt has four sections:

1. **Role** — sets tone ("helpful teammate, not corporate FAQ")
2. **CREATOR DATA** — personalized fields injected from DB (pay, warmup, bank status, etc.)
3. **CAMPAIGN DATA** — campaign-specific fields (platforms, quota, brief URL, hashtags)
4. **STATIC INSTRUCTIONS** — same for all creators (Spark Codes, Stripe setup, warmup process)
5. **DECISION RULES** — explicit escalation triggers and intent classification rules

### Context injection format

```
## CREATOR DATA (verified, from database — do NOT make up values)
- Name: Sarah
- Pay: $500 per month
- Contract signed: yes
- Bank account connected: yes
- Warmup status: in_progress (day 7)
- Videos posted: 4
- Total paid to date: $0.00
- Last posted: 4/10/2026

## CAMPAIGN DATA
- Brand: Nike
- Platforms: TikTok, Instagram
- Video quota: 8 videos total
- Posting frequency: 2x per week
- Content format: short-form lifestyle content
- Hashtags: #nike, #justdoit
- Campaign brief: https://...
```

Null fields are passed as-is (e.g. `Pay: NOT SET — pay rate has not been configured yet`). The model is instructed to escalate when a null field is needed to answer.

### Hallucination prevention

- Tool use is forced (`tool_choice: { type: "function", name: "support_response" }`) — the model cannot free-text respond
- The system prompt explicitly says: "Only use the data provided above. Never fabricate or estimate."
- Null fields trigger escalation rather than guessing
- The fallback path (no tool call returned) defaults to ESCALATE, not a fabricated answer

### Example prompt → response pairs

**Example 1 — DATA intent**

> Creator: "How much do I get paid?"

```json
{
  "intent": "DATA",
  "response": "You're on $500/month! 💸 Payments go out once your bank account is connected and after your first video is approved. You've posted 4 so far — keep it up!"
}
```

---

**Example 2 — GENERAL intent (static instructions)**

> Creator: "How do I set up Spark Codes?"

```json
{
  "intent": "GENERAL",
  "response": "Easy one! Go to TikTok Studio → Creator Marketplace → My Profile → Spark Code. Copy the code and send it to your brand contact. Just a heads up — codes expire after 7 days, so generate it close to when you're posting."
}
```

---

**Example 3 — ESCALATE intent**

> Creator: "I haven't been paid for my last video"

```json
{
  "intent": "ESCALATE",
  "response": "I hear you — payment issues are something I want to make sure gets sorted properly. I'm looping in the team right now and someone will follow up with you shortly. Sorry for the hassle!"
}
```

---

**Example 4 — ESCALATE due to null field**

> Creator: "How much do I get paid?" (pay_rate is null)

```json
{
  "intent": "ESCALATE",
  "response": "Your pay rate hasn't been set up yet in our system — I don't want to give you wrong info. I'm flagging this for the team and someone will sort it out for you today!"
}
```

---

## 3. Data & API Design

### Queries that run before the bot responds

1. `SELECT * FROM creators WHERE slack_user_id = $1` — creator lookup by Slack ID
2. `SELECT * FROM creators WHERE id = $1` — full creator context
3. `SELECT * FROM campaigns WHERE id = $creator.campaign_id` — campaign context
4. `INSERT INTO conversations ...` or `SELECT * FROM conversations WHERE id = $1` — find/create conversation
5. `INSERT INTO messages ...` — save user message

### Schema changes from the original

Two additions beyond the assignment's data model:

**`creators.slack_user_id TEXT UNIQUE`** — maps Slack users to creator records. Required for DM bot lookup. Indexed with a partial index (`WHERE slack_user_id IS NOT NULL`) for efficiency.

**`conversations.escalated BOOLEAN`** and **`conversations.status TEXT`** — tracks escalation state so the support team can filter open escalations in the dashboard.

**`bot_logs` table** — observability table storing every interaction:
```sql
CREATE TABLE bot_logs (
  id           UUID PRIMARY KEY,
  creator_id   UUID REFERENCES creators(id),
  message      TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  escalated    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### API route design

**`POST /api/slack`** — Slack webhook endpoint. Receives all events from Slack. Handles URL verification challenge immediately. Passes all other events to Chat SDK which verifies signature, deduplicates, and routes to `onDirectMessage`.

**`GET /api/messages?conversationId=xxx`** — Polling endpoint for fetching message history by conversation ID. Used for the support dashboard.

**`POST /api/messages`** — REST fallback for non-Slack message ingestion (e.g. web UI, testing).

---

## 4. Escalation Logic

### When the bot does NOT answer

The system prompt enforces escalation for:

| Trigger | Example |
|---------|---------|
| Payment dispute or missing payment | "I haven't been paid for my last video" |
| Wrong payment amount | "I only got $200 but should've gotten $500" |
| Creator wants to quit or leave | "I want to stop doing this" |
| Drop risk question | "Am I going to get dropped?" |
| Anger or threatening tone | "This is ridiculous, I'm done" |
| Content quality decisions | "Was my video good enough?" |
| Account bans or platform issues | "TikTok banned my account" |
| Any required field is NULL | pay_rate = null when asked about pay |
| LLM pipeline error | OpenAI timeout, DB failure |

### How escalation notification works

When intent = ESCALATE:

1. `tagEscalated(conversationId)` — updates `conversations.escalated = true`, `status = "escalated"` in DB
2. `sendSlackAlert()` — posts to the support team's Slack channel via incoming webhook with:
   - Creator name + campaign
   - Exact message they sent
   - Pay rate + bank connected status
   - Direct link to the conversation

Example alert:
```
🚨 Escalation — Sarah needs human support
Campaign: Nike
Message: "I haven't been paid for my last video"

Creator snapshot:
• Pay: $500/month | Bank connected: yes

→ Open conversation: https://yourapp.com/conversations/conv-456
```

3. Bot replies to the creator: "I'm looping in the team right now..."

### How the human picks up where the bot left off

The support team member sees the Slack alert with full context — they don't need to look anything up. They click the conversation link, see the full message history (bot + creator), and reply directly. The `bot_logs` table shows them what the bot said so they can continue naturally.

---

## 5. Trade-offs & Edge Cases

### What the design optimizes for

- **Speed** — `after()` ensures the creator never waits for the LLM. Response time target of < 5s is met.
- **Safety** — hallucination prevention is structural (forced tool use + null escalation), not prompt-based.
- **Simplicity** — the entire bot pipeline is ~100 lines across 6 files. Easy to debug and extend.
- **Cost** — GPT-4o-mini at ~$0.001/1K tokens. A typical response uses ~500 tokens = $0.0005. Well under $0.01 target.

### What it sacrifices

- **Multi-instance state** — the in-memory `StateAdapter` doesn't survive across serverless cold starts. Slack deduplication relies on per-process state. In practice with < 100 messages/day this is fine, but a Redis adapter should replace it before scaling.
- **Conversation history** — the LLM doesn't see prior messages in the conversation. Each message is handled independently. Adding a conversation history window would improve context but increase cost and latency.

### How edge cases are handled

**Creator on multiple campaigns** — the data model has `campaign_id` as a single FK. If a creator moves campaigns, the next context load picks up the new campaign automatically. If they are truly on two campaigns simultaneously, the data model would need extending (out of scope per the assignment's simplified model).

**Bot gives wrong answer** — `bot_logs` captures every message + response + escalated flag. The support team can query wrong answers and use them to improve the system prompt. The escalated flag lets them see what the bot handled vs. escalated.

**Creator tries to manipulate the bot** — the LLM only has access to data injected in the system prompt. It cannot access external URLs, run code, or query the DB directly. Prompt injection attempts (e.g. "ignore previous instructions") are neutralized by the forced tool use schema — the model must return `{ intent, response }` with a valid enum, nothing else.

### Measuring whether the bot is actually helping

- **Escalation rate** — `SELECT COUNT(*) FROM bot_logs WHERE escalated = true` / total. Target: < 20%.
- **Coverage** — which question types does the bot handle vs. escalate? Query `bot_logs` grouped by message patterns.
- **Human override rate** — how often does the support team reply to a conversation the bot already answered? Indicates wrong answers.
- **Response time** — time between user message and assistant message in `messages` table.

---

## Bonus: Feedback Loop

Every interaction is stored in `bot_logs` with `{ message, bot_response, escalated }`. To improve the bot over time:

1. Support team marks bot responses as helpful/unhelpful (a `thumbs_up` column on `bot_logs`)
2. Weekly review of unhelpful responses → update system prompt rules
3. New escalation patterns that appear frequently → add explicit rules to the prompt

For multi-language support (9+ countries): the system prompt language can be detected from the creator's message using a lightweight classification step before calling the main LLM, then the system prompt can instruct the model to respond in that language. Creator data is language-agnostic (numbers, booleans, enums).

---

## How I Used AI

I used Claude Code throughout this assignment as an active engineering partner, not just a code generator.

**Where it helped:**
- Scaffolded the Next.js project structure and Supabase client setup instantly
- Wrote the Chat SDK state adapter (complex interface with 15+ methods) in one pass
- Caught the Vercel cold-start timeout bug and suggested the `url_verification` early-return fix
- Wrote all 11 tests with correct mock patterns for the pipeline

**Where I had to override or correct it:**
- Initially used the wrong model name (`gpt-5-mini-2025-08-07` — doesn't exist). Corrected to `gpt-4o-mini`.
- First system prompt was too generic — missing null field escalation, static instructions for Spark Codes/Stripe, and the full escalation rule set. Rewrote it with explicit rules.
- The Slack alert was initially just creator ID + message. Pushed back to include creator name, campaign, pay info, and conversation link so the support team has full context.
- Chat SDK mock in tests failed because `vi.fn().mockImplementation(() => ({}))` doesn't work as a constructor — had to switch to plain `function` syntax.

**Screenshots of interesting AI interactions:** *(attach 2-3 from your Claude/ChatGPT session)*
