import { supabaseAdmin } from "@/lib/supabase/admin"

// PATCH /api/inbox/:id/read
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const creatorId = body.creatorId

  if (!creatorId) {
    return Response.json({ error: "creatorId required" }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from("inbox_items")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("creator_id", creatorId)
    .is("read_at", null) // only update if not already read

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
