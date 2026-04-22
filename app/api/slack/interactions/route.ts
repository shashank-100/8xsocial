import { createHmac } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"

function verifySlackSignature(req: Request, body: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim()
  if (!secret) return false
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? ""
  const signature = req.headers.get("x-slack-signature") ?? ""
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const sigBase = `v0:${timestamp}:${body}`
  const computed = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex")
  return computed === signature
}

export async function POST(req: Request) {
  const body = await req.text()

  if (!verifySlackSignature(req, body)) {
    return Response.json({ error: "invalid signature" }, { status: 401 })
  }

  const params = new URLSearchParams(body)
  const payload = JSON.parse(params.get("payload") ?? "{}")

  const action = payload.actions?.[0]
  if (action?.action_id !== "close_ticket") {
    return Response.json({ ok: true })
  }

  const conversationId = action.value
  const agentName = payload.user?.name ?? "Agent"

  await supabaseAdmin
    .from("conversations")
    .update({ status: "resolved" })
    .eq("id", conversationId)

  // Update the Slack message to show ticket is closed
  const botToken = process.env.SLACK_BOT_TOKEN?.trim()
  if (botToken) {
    await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: payload.message.text,
        blocks: [
          ...payload.message.blocks.filter((b: { type: string }) => b.type !== "actions"),
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `✅ *Ticket closed by ${agentName}*`,
              },
            ],
          },
        ],
      }),
    })
  }

  return Response.json({ ok: true })
}
