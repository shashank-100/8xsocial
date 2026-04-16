import { supabaseAdmin } from "@/lib/supabase/admin"

export async function getContext(creatorId: string, campaignId?: string | null) {
  const { data: creator, error: creatorError } = await supabaseAdmin
    .from("creators")
    .select("*")
    .eq("id", creatorId)
    .single()

  if (creatorError || !creator) {
    throw new Error(`Creator not found: ${creatorId}`)
  }

  // If conversation is already pinned to a campaign, use that
  if (campaignId) {
    const { data: campaign, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single()

    if (error || !campaign) throw new Error(`Campaign not found: ${campaignId}`)
    return { creator, campaign, campaigns: null }
  }

  // Check creator_campaigns join table for multiple active campaigns
  const { data: creatorCampaigns } = await supabaseAdmin
    .from("creator_campaigns")
    .select("campaign_id")
    .eq("creator_id", creatorId)
    .eq("active", true)

  const campaignIds = creatorCampaigns?.map((r) => r.campaign_id) ?? []

  // Fall back to legacy single campaign_id if join table is empty
  if (campaignIds.length === 0 && creator.campaign_id) {
    campaignIds.push(creator.campaign_id)
  }

  if (campaignIds.length === 0) {
    throw new Error(`No active campaign found for creator: ${creatorId}`)
  }

  const { data: campaignRows } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .in("id", campaignIds)
    .eq("active", true)

  const activeCampaigns = campaignRows ?? []

  if (activeCampaigns.length === 0) {
    throw new Error(`No active campaign found for creator: ${creatorId}`)
  }

  // Single campaign — no ambiguity
  if (activeCampaigns.length === 1) {
    return { creator, campaign: activeCampaigns[0], campaigns: null }
  }

  // Multiple campaigns — return all so bot can ask which one
  return { creator, campaign: null, campaigns: activeCampaigns }
}
