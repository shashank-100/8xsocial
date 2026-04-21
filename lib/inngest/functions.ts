import { inngest } from "./client"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { dispatchInApp, dispatchEmail, dispatchSms } from "./dispatch"
import type { TemplateCtx } from "@/lib/templates"

async function fetchCreator(creatorId: string) {
  const { data, error } = await supabaseAdmin
    .from("creators")
    .select("id, name, email, warmup_day, campaign_id")
    .eq("id", creatorId)
    .single()
  if (error || !data) throw new Error(`Creator not found: ${creatorId}`)
  return data as { id: string; name: string | null; email: string; warmup_day: number | null; campaign_id: string | null }
}

export const onPaymentSent = inngest.createFunction(
  { id: "payment-sent", triggers: [{ event: "event/payment.sent" }] },
  async ({ event }: { event: { data: { paymentId: string; creatorId: string; amount: number; videoCount: number } } }) => {
    const { paymentId, creatorId, amount, videoCount } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, amount, videoCount }
    await Promise.all([
      dispatchInApp({ creatorId, eventType: "payment.sent", sourceId: paymentId, ctx, entityType: "payment", entityId: paymentId }),
      dispatchEmail({ creatorId, eventType: "payment.sent", sourceId: paymentId, ctx }),
    ])
  }
)

export const onCreatorDropped = inngest.createFunction(
  { id: "creator-dropped", triggers: [{ event: "event/creator.dropped" }] },
  async ({ event }: { event: { data: { creatorId: string; campaignId: string; brandName: string } } }) => {
    const { creatorId, campaignId, brandName } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, brandName }
    const sourceId = `${campaignId}:${creatorId}`
    await Promise.all([
      dispatchInApp({ creatorId, eventType: "creator.dropped", sourceId, ctx, entityType: "campaign", entityId: campaignId }),
      dispatchEmail({ creatorId, eventType: "creator.dropped", sourceId, ctx }),
    ])
  }
)

export const onCampaignEnded = inngest.createFunction(
  { id: "campaign-ended-fanout", concurrency: { limit: 5 }, triggers: [{ event: "event/campaign.ended" }] },
  async ({ event, step }: { event: { data: { campaignId: string; brandName: string } }; step: { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> } }) => {
    const { campaignId, brandName } = event.data
    const { data: rows } = await supabaseAdmin
      .from("creator_campaigns")
      .select("creator_id")
      .eq("campaign_id", campaignId)
      .eq("active", true)
    const creatorIds = (rows ?? []).map((r: { creator_id: string }) => r.creator_id)
    const PAGE = 100
    for (let offset = 0; offset < creatorIds.length; offset += PAGE) {
      const page = creatorIds.slice(offset, offset + PAGE)
      await step.run(`dispatch-page-${offset}`, async () => {
        await Promise.all(
          page.map((creatorId: string) =>
            inngest.send({ name: "event/creator.dropped", data: { creatorId, campaignId, brandName } })
          )
        )
      })
    }
  }
)

export const onBaseRateChanged = inngest.createFunction(
  { id: "base-rate-changed", triggers: [{ event: "event/creator.base_rate_changed" }] },
  async ({ event }: { event: { data: { creatorId: string; oldRate: number; newRate: number; reason?: string; effectiveDate: string } } }) => {
    const { creatorId, oldRate, newRate, reason, effectiveDate } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, oldRate, newRate, reason: reason ?? null, effectiveDate }
    const sourceId = `${creatorId}:${effectiveDate}`
    await Promise.all([
      dispatchInApp({ creatorId, eventType: "creator.base_rate_changed", sourceId, ctx }),
      dispatchEmail({ creatorId, eventType: "creator.base_rate_changed", sourceId, ctx }),
    ])
  }
)

export const onPostApproved = inngest.createFunction(
  { id: "post-approved", batchEvents: { maxSize: 100, timeout: "3600s" }, triggers: [{ event: "event/post.approved" }] },
  async ({ events }: { events: { data: { postId: string; creatorId: string; platform: string } }[] }) => {
    const byCreator = new Map<string, typeof events>()
    for (const ev of events) {
      const cid = ev.data.creatorId
      if (!byCreator.has(cid)) byCreator.set(cid, [])
      byCreator.get(cid)!.push(ev)
    }
    await Promise.all(
      Array.from(byCreator.entries()).map(async ([creatorId, creatorEvents]) => {
        const creator = await fetchCreator(creatorId)
        const count = creatorEvents.length
        const firstEvent = creatorEvents[0].data
        const date = new Date().toISOString().slice(0, 10)
        const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, platform: count === 1 ? firstEvent.platform : `${count} posts` }
        await dispatchInApp({
          creatorId,
          eventType: "post.approved",
          sourceId: `${creatorId}:approved:${date}`,
          ctx,
          entityType: count === 1 ? "post" : "post_batch",
          entityId: count === 1 ? firstEvent.postId : undefined,
        })
      })
    )
  }
)

export const onPostRejected = inngest.createFunction(
  { id: "post-rejected", triggers: [{ event: "event/post.rejected" }] },
  async ({ event }: { event: { data: { postId: string; creatorId: string; platform: string; rejectionReason?: string } } }) => {
    const { postId, creatorId, platform, rejectionReason } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, platform, rejectionReason: rejectionReason ?? null }
    await Promise.all([
      dispatchInApp({ creatorId, eventType: "post.rejected", sourceId: postId, ctx, entityType: "post", entityId: postId }),
      dispatchEmail({ creatorId, eventType: "post.rejected", sourceId: postId, ctx }),
    ])
  }
)

export const onWarmupReminder = inngest.createFunction(
  { id: "warmup-reminder", triggers: [{ event: "event/warmup.reminder" }] },
  async ({ event }: { event: { data: { creatorId: string; warmupDay: number; platforms: string } } }) => {
    const { creatorId, warmupDay, platforms } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, warmupDay, platforms }
    await dispatchInApp({ creatorId, eventType: "warmup.reminder", sourceId: `${creatorId}:warmup:day${warmupDay}`, ctx })
  }
)

export const onJobOffered = inngest.createFunction(
  { id: "job-offered", triggers: [{ event: "event/job.offered" }] },
  async ({ event }: { event: { data: { jobId: string; creatorId: string; brandName: string; rate: number; deadline: string; phone?: string } } }) => {
    const { jobId, creatorId, brandName, rate, deadline, phone } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, brandName, rate, deadline }
    const dispatches: Promise<void>[] = [
      dispatchInApp({ creatorId, eventType: "job.offered", sourceId: jobId, ctx }),
      dispatchEmail({ creatorId, eventType: "job.offered", sourceId: jobId, ctx }),
    ]
    if (phone) dispatches.push(dispatchSms({ creatorId, eventType: "job.offered", sourceId: jobId, ctx, toPhone: phone }))
    await Promise.all(dispatches)
  }
)

export const onViralAlert = inngest.createFunction(
  { id: "viral-alert", triggers: [{ event: "event/viral.alert" }] },
  async ({ event }: { event: { data: { postId: string; creatorId: string; platform: string; views: number } } }) => {
    const { postId, creatorId, platform, views } = event.data
    const creator = await fetchCreator(creatorId)
    const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, platform, views: views.toLocaleString() }
    await dispatchInApp({ creatorId, eventType: "viral.alert", sourceId: postId, ctx, entityType: "post", entityId: postId })
  }
)

export const allFunctions = [
  onPaymentSent,
  onCreatorDropped,
  onCampaignEnded,
  onBaseRateChanged,
  onPostApproved,
  onPostRejected,
  onWarmupReminder,
  onJobOffered,
  onViralAlert,
]
