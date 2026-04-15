import { supabaseAdmin } from "@/lib/supabase/admin"

export async function logResponse(
  creatorId: string,
  message: string,
  response: string,
  escalated: boolean
): Promise<void> {
  await supabaseAdmin.from("bot_logs").insert({
    creator_id: creatorId,
    message,
    bot_response: response,
    escalated,
  })
}
