import { after } from "next/server"
import { findOrCreateConversation, saveMessage, tagEscalated, getMessages, getHistory, pinCampaign } from "@/lib/bot/conversation"
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
      // Pass pinned campaign_id if already set on this conversation
      let context = await getContext(creatorId, conversation.campaign_id ?? null)

      // Creator is on multiple campaigns and no campaign pinned yet
      if (context.campaigns) {
        // Check if this message is the creator picking a campaign
        const matched = (context.campaigns as { id: string; brand_name: string }[]).find(
          (c) => message.toLowerCase().includes(c.brand_name.toLowerCase())
        )
        if (matched) {
          // Pin the campaign and re-fetch context with it
          await pinCampaign(conversation.id, matched.id)
          context = await getContext(creatorId, matched.id)
          // Use the original question (before "Nike"/"Adidas" reply) as the message to answer
          const priorMessages = await getHistory(conversation.id)
          const originalQuestion = priorMessages.findLast((m) => m.role === "user" && !matched.brand_name.toLowerCase().includes(m.content.toLowerCase()))
          if (originalQuestion) {
            const history = await getHistory(conversation.id)
            const result = await callLLM(
              { creator: context.creator, campaign: context.campaign! },
              originalQuestion.content,
              history
            )
            if (result.intent === "ESCALATE") {
              const { pay_rate, pay_structure } = context.creator
              const payInfo = pay_rate
                ? `$${pay_rate} ${pay_structure === "per_video" ? "per video" : "per month"}`
                : null
              const slackTs = await sendSlackAlert(creatorId, originalQuestion.content, {
                creatorName: context.creator.name,
                campaignName: context.campaign!.brand_name,
                payInfo,
                bankConnected: context.creator.bank_connected,
                conversationId: conversation.id,
              })
              await tagEscalated(conversation.id, slackTs)
            }
            const reply = result.response || "I'm connecting you with the team right away — someone will follow up shortly."
            await saveMessage(conversation.id, "assistant", reply)
            await logResponse(creatorId, originalQuestion.content, reply, result.intent === "ESCALATE")
            return
          }
        } else {
          // Still ambiguous — ask again
          const campaignList = context.campaigns.map((c: { brand_name: string }) => c.brand_name).join(" or ")
          const reply = `Hey! You're part of multiple campaigns — which one is this about? ${campaignList}?`
          await saveMessage(conversation.id, "assistant", reply)
          await logResponse(creatorId, message, reply, false)
          return
        }
      }

      const history = await getHistory(conversation.id)
      const result = await callLLM(
        { creator: context.creator, campaign: context.campaign! },
        message,
        history
      )

      if (result.intent === "ESCALATE") {
        const { pay_rate, pay_structure } = context.creator
        const payInfo = pay_rate
          ? `$${pay_rate} ${pay_structure === "per_video" ? "per video" : "per month"}`
          : null
        const slackTs = await sendSlackAlert(creatorId, message, {
          creatorName: context.creator.name,
          campaignName: context.campaign!.brand_name,
          payInfo,
          bankConnected: context.creator.bank_connected,
          conversationId: conversation.id,
        })
        await tagEscalated(conversation.id, slackTs)
      }

      const reply = result.response || "I'm connecting you with the team right away — someone will follow up shortly."
      await saveMessage(conversation.id, "assistant", reply)
      await logResponse(creatorId, message, reply, result.intent === "ESCALATE")
    } catch (err) {
      console.error("[bot] processing failed:", err)
    }
  })

  // 4. Return 202 immediately
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
