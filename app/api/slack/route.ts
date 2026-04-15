import { after } from "next/server"
import { getBot } from "@/lib/bot/slack-bot"

/**
 * POST /api/slack
 *
 * Receives all Slack events (DMs, url_verification, retries).
 * The Chat SDK handles:
 *   - URL verification challenge (instant 200 + challenge)
 *   - Signature verification (rejects tampered payloads)
 *   - Event deduplication (absorbs Slack retries)
 *   - Bot message filtering (no echo loops)
 *   - Routing to onDirectMessage handler
 *
 * after() defers the LLM pipeline past the HTTP response —
 * Slack requires a 200 within 3s, LLM calls take 2-8s.
 */
export async function POST(request: Request): Promise<Response> {
  const bot = getBot()
  return bot.webhooks.slack(request, {
    waitUntil: (promise) => after(() => promise),
  })
}
