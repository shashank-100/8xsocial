import { supabaseAdmin } from "@/lib/supabase/admin"

export async function findCreatorBySlackId(slackUserId: string) {
  const { data } = await supabaseAdmin
    .from("creators")
    .select("*")
    .eq("slack_user_id", slackUserId)
    .single()

  return data ?? null
}
