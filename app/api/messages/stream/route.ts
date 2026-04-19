import { getMessages } from "@/lib/bot/conversation"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get("conversationId")

  if (!conversationId) {
    return Response.json({ error: "conversationId required" }, { status: 400 })
  }

  let lastCount = 0
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()

      const send = (data: unknown) => {
        if (closed) return
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const poll = async () => {
        if (closed) return
        try {
          const messages = await getMessages(conversationId)
          if (messages.length !== lastCount) {
            lastCount = messages.length
            send({ messages })
          }
        } catch {
          // transient DB error — keep going
        }
        if (!closed) setTimeout(poll, 1000)
      }

      // Send current state immediately on connect
      try {
        const messages = await getMessages(conversationId)
        lastCount = messages.length
        send({ messages })
      } catch {
        // ignore
      }

      setTimeout(poll, 1000)

      req.signal.addEventListener("abort", () => {
        closed = true
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
