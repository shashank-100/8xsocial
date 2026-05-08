import { supabaseAdmin } from "@/lib/supabase/admin"

async function fetchPaymentsAndPosts(creatorId: string) {
  const [paymentsRes, postsRes, pendingRes] = await Promise.all([
    supabaseAdmin
      .from("payments")
      .select("amount, status, paid_at, video_count")
      .eq("creator_id", creatorId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabaseAdmin
      .from("posts")
      .select("platform, status, rejection_reason, reviewed_at")
      .eq("creator_id", creatorId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("creator_id", creatorId)
      .eq("status", "pending"),
  ])

  const pendingBalance =
    (pendingRes.data ?? []).reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)

  return {
    recentPayments: paymentsRes.data ?? [],
    recentPosts: postsRes.data ?? [],
    pendingBalance,
  }
}

export async function getContext(creatorId: string, campaignId?: string | null): Promise<{
  creator: any; campaign: any; campaigns: any; noCampaign?: boolean;
  recentPayments: any[]; recentPosts: any[]; pendingBalance: number
}> {
  const [{ data: creator, error: creatorError }, extras, creatorCampaignsRes] = await Promise.all([
    supabaseAdmin.from("creators").select("*").eq("id", creatorId).single(),
    fetchPaymentsAndPosts(creatorId),
    supabaseAdmin.from("creator_campaigns").select("campaign_id").eq("creator_id", creatorId).eq("active", true),
  ])

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
    return { creator, campaign, campaigns: null, ...extras }
  }

  // Check creator_campaigns join table for multiple active campaigns
  const { data: creatorCampaigns } = creatorCampaignsRes

  const campaignIds = [...new Set(creatorCampaigns?.map((r) => r.campaign_id) ?? [])]

  // Fall back to legacy single campaign_id if join table is empty
  if (campaignIds.length === 0 && creator.campaign_id) {
    campaignIds.push(creator.campaign_id)
  }

  if (campaignIds.length === 0) {
    return { creator, campaign: null, campaigns: null, noCampaign: true, ...extras }
  }

  const { data: campaignRows } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .in("id", campaignIds)
    .eq("active", true)

  const activeCampaigns = campaignRows ?? []

  if (activeCampaigns.length === 0) {
    return { creator, campaign: null, campaigns: null, noCampaign: true, ...extras }
  }

  // Single campaign — no ambiguity
  if (activeCampaigns.length === 1) {
    return { creator, campaign: activeCampaigns[0], campaigns: null, ...extras }
  }

  // Multiple campaigns — return all so bot can ask which one
  return { creator, campaign: null, campaigns: activeCampaigns, ...extras }
}
