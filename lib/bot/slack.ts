export interface SlackAlertContext {
  creatorName: string | null
  campaignName: string
  payInfo: string | null
  bankConnected: boolean
  conversationId: string
}

// Returns the Slack message ts (used as thread_ts for replies)
export async function sendSlackAlert(
  creatorId: string,
  message: string,
  ctx: SlackAlertContext
): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim()
  const channelId = process.env.SLACK_CHANNEL_ID?.trim()

  if (!botToken || !channelId) {
    console.warn("[slack] SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not set — skipping alert")
    return null
  }

  const name = ctx.creatorName ?? creatorId

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      channel: channelId,
      text: [
        `:rotating_light: *Escalation — ${name} needs human support*`,
        `*Campaign:* ${ctx.campaignName}`,
        `*Message:* "${message}"`,
        ``,
        `*Creator snapshot:*`,
        `• Pay: ${ctx.payInfo ?? "not set"} | Bank connected: ${ctx.bankConnected ? "yes" : "no"}`,
        ``,
        `↩ *Reply in this thread* — your reply will appear in the creator's chat`,
      ].join("\n"),
    }),
  })

  const data = await res.json()
  if (!data.ok) {
    console.error("[slack] chat.postMessage failed:", data.error)
    return null
  }

  // ts is the message timestamp — used as thread_ts for replies
  return data.ts as string
}
