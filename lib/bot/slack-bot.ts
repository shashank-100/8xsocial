import { Chat } from "chat"
import { createSlackAdapter } from "@chat-adapter/slack"
import { MemoryStateAdapter } from "./state-adapter"
import { findCreatorBySlackId } from "./creator-lookup"
import { findOrCreateConversation, saveMessage, tagEscalated } from "./conversation"
import { getContext } from "./context"
import { callLLM } from "./llm"
import { logResponse } from "./log"
import { sendSlackAlert } from "./slack"

type DmThreadState = { conversationId?: string }

// Singleton via globalThis — survives Next.js hot-reloads in dev
// so handlers are only registered once per process.
const g = globalThis as typeof globalThis & { __chatBot?: Chat }

function createBot(): Chat {
  const bot = new Chat({
    userName: "8x-support",
    adapters: { slack: createSlackAdapter() }, // reads SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET from env
    state: new MemoryStateAdapter(),
    dedupeTtlMs: 600_000, // 10 min dedup window to absorb Slack retries on cold starts
  })

  bot.onDirectMessage(async (thread, message) => {
    const slackUserId = message.author.userId
    const userText = message.text

    // 1. Look up creator by Slack user ID
    const creator = await findCreatorBySlackId(slackUserId)
    if (!creator) {
      await thread.post(
        "Hey! You're not registered as a creator in this program yet. " +
        "Reach out to your campaign manager to get set up."
      )
      return
    }

    // 2. Show typing indicator while pipeline runs
    await thread.startTyping()

    // 3. Reuse existing DB conversation for this DM thread (persisted in thread state)
    const threadState = await thread.state as DmThreadState | null
    const dbConversation = await findOrCreateConversation(
      creator.id,
      threadState?.conversationId
    )
    if (!threadState?.conversationId) {
      await thread.setState({ conversationId: dbConversation.id })
    }

    // 4. Save user message to DB
    await saveMessage(dbConversation.id, "user", userText)

    // 5. Run LLM pipeline
    try {
      const context = await getContext(creator.id)
      const result = await callLLM(context, userText)

      // 6. Handle escalation
      if (result.intent === "ESCALATE") {
        const payInfo = context.creator.pay_rate
          ? `$${context.creator.pay_rate} ${context.creator.pay_structure === "per_video" ? "per video" : "per month"}`
          : null

        await Promise.all([
          tagEscalated(dbConversation.id),
          sendSlackAlert(creator.id, userText, {
            creatorName: context.creator.name,
            campaignName: context.campaign.brand_name,
            payInfo,
            bankConnected: context.creator.bank_connected,
            conversationId: dbConversation.id,
          }),
        ])
      }

      // 7. Reply in DM
      await thread.post(result.response)

      // 8. Persist bot reply + log
      await saveMessage(dbConversation.id, "assistant", result.response)
      await logResponse(creator.id, userText, result.response, result.intent === "ESCALATE")
    } catch (err) {
      console.error("[slack-bot] pipeline failed:", err)
      await thread.post(
        "Sorry, I'm having a moment. A team member will follow up with you shortly."
      )
      await logResponse(creator.id, userText, "[LLM_ERROR]", true)
    }
  })

  return bot
}

export function getBot(): Chat {
  if (!g.__chatBot) {
    g.__chatBot = createBot()
  }
  return g.__chatBot
}
