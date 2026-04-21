import { supabaseAdmin } from "@/lib/supabase/admin"

// GET /api/inbox?creatorId=...&limit=50&before=<iso-date>
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const creatorId = searchParams.get("creatorId")
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100)
  const before = searchParams.get("before")

  if (!creatorId) {
    return Response.json({ error: "creatorId required" }, { status: 400 })
  }

  let query = supabaseAdmin
    .from("inbox_items")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt("created_at", before)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const unreadCount = data?.filter((i) => !i.read_at).length ?? 0

  return Response.json({ items: data ?? [], unreadCount })
}
