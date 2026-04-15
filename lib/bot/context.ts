import { supabaseAdmin } from "@/lib/supabase/admin"

export async function getContext(creatorId: string) {
  const { data: creator, error: creatorError } = await supabaseAdmin
    .from("creators")
    .select("*")
    .eq("id", creatorId)
    .single()

  if (creatorError || !creator) {
    throw new Error(`Creator not found: ${creatorId}`)
  }

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("id", creator.campaign_id)
    .single()

  if (campaignError || !campaign) {
    throw new Error(`Campaign not found for creator: ${creatorId}`)
  }

  return { creator, campaign }
}
