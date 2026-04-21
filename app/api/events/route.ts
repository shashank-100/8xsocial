import { getEventQueue } from "@/lib/queue/client"

const VALID_EVENTS = new Set([
  "event/payment.sent",
  "event/creator.dropped",
  "event/campaign.ended",
  "event/creator.base_rate_changed",
  "event/post.approved",
  "event/post.rejected",
  "event/warmup.reminder",
  "event/job.offered",
  "event/viral.alert",
])

export async function POST(req: Request) {
  const secret = req.headers.get("x-events-secret")
  if (secret !== process.env.EVENTS_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { name, data } = body as { name: string; data: Record<string, unknown> }

  if (!name || !VALID_EVENTS.has(name)) {
    return Response.json({ error: "unknown event type" }, { status: 400 })
  }

  try {
    await getEventQueue().add(name, data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[events] queue.add failed:", msg)
    return Response.json({ error: "failed to enqueue event", detail: msg }, { status: 502 })
  }

  return Response.json({ ok: true })
}
