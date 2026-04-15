interface SlackAlertContext {
  creatorName: string | null
  campaignName: string
  payInfo: string | null
  bankConnected: boolean
  conversationId: string
}

export async function sendSlackAlert(
  creatorId: string,
  message: string,
  ctx: SlackAlertContext
): Promise<void> {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.warn("[slack] SLACK_WEBHOOK_URL not set — skipping alert")
    return
  }

  const name = ctx.creatorName ?? creatorId
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourapp.com"

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: [
        `🚨 *Escalation — ${name} needs human support*`,
        `*Campaign:* ${ctx.campaignName}`,
        `*Message:* "${message}"`,
        ``,
        `*Creator snapshot:*`,
        `• Pay: ${ctx.payInfo ?? "not set"} | Bank connected: ${ctx.bankConnected ? "yes" : "no"}`,
        ``,
        `→ <${appUrl}/conversations/${ctx.conversationId}|Open conversation>`,
      ].join("\n"),
    }),
  })
}
