import { after } from "next/server"
import { findOrCreateConversation, saveMessage, tagEscalated, getMessages } from "@/lib/bot/conversation"
import { getContext } from "@/lib/bot/context"
import { callLLM } from "@/lib/bot/llm"
import { sendSlackAlert } from "@/lib/bot/slack"
import { logResponse } from "@/lib/bot/log"

// POST /api/messages — store user message, trigger bot async
export async function POST(req: Request) {
  const { creatorId, message, conversationId } = await req.json()

  // 1. Find or create conversation
  const conversation = await findOrCreateConversation(creatorId, conversationId)

  // 2. Store user message immediately
  const userMsg = await saveMessage(conversation.id, "user", message)

  // 3. Process bot response AFTER response is sent (non-blocking)
  after(async () => {
    try {
      const context = await getContext(creatorId)
      const result = await callLLM(context, message)

      if (result.intent === "ESCALATE") {
        const payInfo = context.creator.pay_rate
          ? `$${context.creator.pay_rate} ${context.creator.pay_structure === "per_video" ? "per video" : "per month"}`
          : null
        await sendSlackAlert(creatorId, message, {
          creatorName: context.creator.name,
          campaignName: context.campaign.brand_name,
          payInfo,
          bankConnected: context.creator.bank_connected,
          conversationId: conversation.id,
        })
        await tagEscalated(conversation.id)
      }

      await saveMessage(conversation.id, "assistant", result.response)
      await logResponse(creatorId, message, result.response, result.intent === "ESCALATE")
    } catch (err) {
      console.error("[bot] processing failed:", err)
    }
  })

  // 4. Return 202 immediately — creator doesn't wait for Claude
  return Response.json(
    { conversationId: conversation.id, messageId: userMsg.id },
    { status: 202 }
  )
}

// GET /api/messages?conversationId=xxx — poll for messages
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get("conversationId")

  if (!conversationId) {
    return Response.json({ error: "conversationId required" }, { status: 400 })
  }

  const messages = await getMessages(conversationId)
  return Response.json({ messages })
}
