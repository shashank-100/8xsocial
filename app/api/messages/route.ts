import { after } from "next/server"
import { findOrCreateConversation, saveMessage, tagEscalated, getHistory, pinCampaign } from "@/lib/bot/conversation"
import { getContext } from "@/lib/bot/context"
import { callLLM } from "@/lib/bot/llm"
import { sendSlackAlert } from "@/lib/bot/slack"
import { logResponse } from "@/lib/bot/log"

async function handleResult(
  result: { intent: string; response: string },
  context: { creator: { name: string | null; pay_rate: number | null; pay_structure: string | null; bank_connected: boolean }; campaign: { brand_name: string } | null },
  creatorId: string,
  message: string,
  conversation: { id: string; slack_thread_ts?: string | null }
) {
  if (result.intent === "ESCALATE") {
    const payInfo = context.creator.pay_rate
      ? `$${context.creator.pay_rate} ${context.creator.pay_structure === "per_video" ? "per video" : "per month"}`
      : null
    const slackTs = await sendSlackAlert(creatorId, message, {
      creatorName: context.creator.name,
      campaignName: context.campaign?.brand_name ?? "Unknown",
      payInfo,
      bankConnected: context.creator.bank_connected,
      conversationId: conversation.id,
    })
    await tagEscalated(conversation.id, slackTs)
  }
  const reply = result.response || "I'm connecting you with the team right away — someone will follow up shortly."
  await saveMessage(conversation.id, "assistant", reply)
  await logResponse(creatorId, message, reply, result.intent === "ESCALATE")
}

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
      // If already escalated, forward creator message to Slack thread — don't call LLM
      if (conversation.escalated && conversation.slack_thread_ts) {
        const botToken = process.env.SLACK_BOT_TOKEN?.trim()
        const channelId = process.env.SLACK_CHANNEL_ID?.trim()
        if (botToken && channelId) {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              "content-type": "application/json; charset=utf-8",
              Authorization: `Bearer ${botToken}`,
            },
            body: JSON.stringify({
              channel: channelId,
              thread_ts: conversation.slack_thread_ts,
              text: `*Creator:* ${message}`,
            }),
          })
        }
        return
      }

      let context = await getContext(creatorId, conversation.campaign_id ?? null)

      // Multiple campaigns, no campaign pinned yet — check if creator is picking one
      if (context.campaigns) {
        const campaigns = context.campaigns as { id: string; brand_name: string }[]
        const matched = campaigns.find((c) =>
          message.toLowerCase().includes(c.brand_name.toLowerCase())
        )

        if (matched) {
          // Creator picked a campaign — pin it and answer their original question
          await pinCampaign(conversation.id, matched.id)
          context = await getContext(creatorId, matched.id)
          const history = await getHistory(conversation.id)
          const originalQuestion = history.findLast(
            (m) => m.role === "user" && !matched.brand_name.toLowerCase().includes(m.content.toLowerCase())
          )
          const questionToAnswer = originalQuestion?.content ?? message
          const result = await callLLM(
            {
              creator: context.creator,
              campaign: context.campaign!,
              recentPayments: context.recentPayments,
              recentPosts: context.recentPosts,
              pendingBalance: context.pendingBalance,
            },
            questionToAnswer,
            history
          )
          await handleResult(result, context, creatorId, questionToAnswer, conversation)
          return
        }

        // Call LLM with first campaign as fallback — it can answer creator-level + ESCALATE/GENERAL without campaign
        const history = await getHistory(conversation.id)
        const result = await callLLM(
          {
            creator: context.creator,
            campaign: campaigns[0] as never,
            recentPayments: context.recentPayments,
            recentPosts: context.recentPosts,
            pendingBalance: context.pendingBalance,
          },
          message,
          history
        )

        // Only ask "which campaign?" if the answer genuinely needs campaign-specific data
        if (result.intent === "DATA") {
          const campaignList = campaigns.map((c) => c.brand_name).join(" or ")
          const reply = `Hey! You're part of multiple campaigns — which one is this about? ${campaignList}?`
          await saveMessage(conversation.id, "assistant", reply)
          await logResponse(creatorId, message, reply, false)
          return
        }

        // ESCALATE or GENERAL — answer directly without needing campaign
        await handleResult(result, context, creatorId, message, conversation)
        return
      }

      const history = await getHistory(conversation.id)
      const result = await callLLM(
        {
          creator: context.creator,
          campaign: context.campaign!,
          recentPayments: context.recentPayments,
          recentPosts: context.recentPosts,
          pendingBalance: context.pendingBalance,
        },
        message,
        history
      )
      await handleResult(result, context, creatorId, message, conversation)
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

