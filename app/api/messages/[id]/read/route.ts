import { supabaseAdmin } from "@/lib/supabase/admin"

// PATCH /api/messages/:id/read — mark a message as read (for read receipts)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const conversationId = body.conversationId

  if (!conversationId) {
    return Response.json({ error: "conversationId required" }, { status: 400 })
  }

  // Only mark messages in conversations the caller owns
  const { error } = await supabaseAdmin
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("conversation_id", conversationId)
    .is("read_at", null)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
