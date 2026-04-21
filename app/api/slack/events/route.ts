import { createHmac } from "crypto"
import { findConversationBySlackThread, saveHumanMessageWithInboxItem, resolveConversation } from "@/lib/bot/conversation"

function verifySlackSignature(req: Request, body: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim()
  if (!secret) return false

  const timestamp = req.headers.get("x-slack-request-timestamp") ?? ""
  const signature = req.headers.get("x-slack-signature") ?? ""

  // Reject requests older than 5 minutes (replay attack prevention)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const sigBase = `v0:${timestamp}:${body}`
  const computed = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex")
  return computed === signature
}

export async function POST(req: Request) {
  const body = await req.text()

  // Block actions come as form-encoded: payload={"type":"block_actions",...}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any
  if (body.startsWith("payload=")) {
    payload = JSON.parse(decodeURIComponent(body.slice("payload=".length)))
  } else {
    payload = JSON.parse(body)
  }

  // Slack URL verification challenge — respond before signature check
  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge })
  }

  // Ignore Slack retries — already handled the original
  if (req.headers.get("x-slack-retry-num")) {
    return Response.json({ ok: true })
  }

  if (!verifySlackSignature(req, body)) {
    return Response.json({ error: "invalid signature" }, { status: 401 })
  }

  // Handle Close Ticket button click
  if (payload.type === "block_actions") {
    const actions = payload.actions as { action_id: string; value: string }[]
    const closeAction = actions?.find((a) => a.action_id === "close_ticket")
    if (closeAction) {
      await resolveConversation(closeAction.value)
    }
    return Response.json({ ok: true })
  }

  const event = payload.event
  if (!event) return Response.json({ ok: true })

  console.log("[slack] event received:", JSON.stringify({
    type: event.type,
    bot_id: event.bot_id,
    subtype: event.subtype,
    thread_ts: event.thread_ts,
    ts: event.ts,
    text: event.text,
  }))

  // Filter out everything except real human messages in threads
  if (
    event.type !== "message" ||   // not a message event
    event.bot_id ||               // sent by a bot
    event.subtype ||              // join, leave, edit, delete etc.
    !event.thread_ts ||           // not in a thread
    event.thread_ts === event.ts  // is the parent message, not a reply
  ) {
    console.log("[slack] event filtered out")
    return Response.json({ ok: true })
  }

  // Look up which conversation this Slack thread belongs to
  const conversation = await findConversationBySlackThread(event.thread_ts)
  console.log("[slack] conversation lookup:", conversation?.id ?? "NOT FOUND", "thread_ts:", event.thread_ts)
  if (!conversation) return Response.json({ ok: true })

  // Save as "human" and write inbox_items row for creator's unified inbox
  await saveHumanMessageWithInboxItem(conversation.id, conversation.creator_id, event.text, "8x Support")
  console.log("[slack] saved human message to conversation:", conversation.id)

  return Response.json({ ok: true })
}
