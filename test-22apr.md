# API Test Results — 22 Apr 2026

## Fixes deployed
- `max_tokens` → `max_completion_tokens` for `gpt-5-mini-2025-08-07`
- Duplicate campaign names (Nike twice) fixed with `Set` dedup in `context.ts`
- Supabase key `.trim()` added in `client.ts`, `middleware.ts`, `server.ts`

## Endpoint results

| Endpoint | Method | Payload | Result |
|---|---|---|---|
| `/api/inbox` | GET | `?creatorId=...&limit=5` | ✅ `{unreadCount, itemCount: 5}` |
| `/api/inbox/[id]/read` | PATCH | `{creatorId}` | ✅ `{ok: true}` |
| `/api/messages` | POST | `{creatorId, message}` | ✅ `{conversationId, messageId}` |
| `/api/messages/stream` | GET | `?conversationId=...` | ✅ returns messages with bot reply |
| `/api/messages/[id]/read` | PATCH | `{conversationId}` | ✅ `{ok: true}` |
| `/api/events` | POST (bad secret) | any | ✅ `{error: "unauthorized"}` 401 |
| `/api/events` | POST (wrong field) | `{event: "job.offered"}` | ✅ `{error: "unknown event type"}` 400 |
| `/api/events` | POST (correct) | `{name: "event/job.offered", data: {...}}` | ✅ `{ok: true}` |
| `/api/slack/events` | POST | `{type: "url_verification", challenge: "..."}` | ✅ `{challenge: "..."}` |

## All valid event types tested
- `event/job.offered` ✅
- `event/payment.sent` ✅
- `event/post.approved` ✅
- `event/post.rejected` ✅
- `event/warmup.reminder` ✅
- `event/viral.alert` ✅
- `event/creator.dropped` ✅

## Notes
- `/api/events` expects `name` (not `event`) and values must be prefixed `event/` e.g. `event/job.offered`
- Bot reply latency ~6s (async via `after()`)
