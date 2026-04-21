import { Worker, type Job } from "bullmq"
import { Redis } from "ioredis"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { dispatchInApp, dispatchEmail, dispatchSms } from "@/lib/dispatch/dispatch"
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

async function processJob(job: Job) {
  const { name, data } = job

  switch (name) {
    case "event/payment.sent": {
      const { paymentId, creatorId, amount, videoCount } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, amount, videoCount }
      await Promise.all([
        dispatchInApp({ creatorId, eventType: "payment.sent", sourceId: paymentId, ctx, entityType: "payment", entityId: paymentId }),
        dispatchEmail({ creatorId, eventType: "payment.sent", sourceId: paymentId, ctx }),
      ])
      break
    }

    case "event/creator.dropped": {
      const { creatorId, campaignId, brandName } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, brandName }
      const sourceId = `${campaignId}:${creatorId}`
      await Promise.all([
        dispatchInApp({ creatorId, eventType: "creator.dropped", sourceId, ctx, entityType: "campaign", entityId: campaignId }),
        dispatchEmail({ creatorId, eventType: "creator.dropped", sourceId, ctx }),
      ])
      break
    }

    case "event/campaign.ended": {
      const { campaignId, brandName } = data
      const { data: rows } = await supabaseAdmin
        .from("creator_campaigns")
        .select("creator_id")
        .eq("campaign_id", campaignId)
        .eq("active", true)
      const creatorIds = (rows ?? []).map((r: { creator_id: string }) => r.creator_id)
      const { getEventQueue } = await import("./client")
      // addBulk = single Redis pipeline regardless of count — safe for 10k+
      await getEventQueue().addBulk(
        creatorIds.map((creatorId: string) => ({
          name: "event/creator.dropped",
          data: { creatorId, campaignId, brandName },
        }))
      )
      break
    }

    case "event/creator.base_rate_changed": {
      const { creatorId, oldRate, newRate, reason, effectiveDate } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, oldRate, newRate, reason: reason ?? null, effectiveDate }
      const sourceId = `${creatorId}:${effectiveDate}`
      await Promise.all([
        dispatchInApp({ creatorId, eventType: "creator.base_rate_changed", sourceId, ctx }),
        dispatchEmail({ creatorId, eventType: "creator.base_rate_changed", sourceId, ctx }),
      ])
      break
    }

    case "event/post.approved": {
      const { postId, creatorId, platform } = data
      const creator = await fetchCreator(creatorId)
      const date = new Date().toISOString().slice(0, 10)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, platform }
      await dispatchInApp({ creatorId, eventType: "post.approved", sourceId: `${creatorId}:approved:${date}`, ctx, entityType: "post", entityId: postId })
      break
    }

    case "event/post.rejected": {
      const { postId, creatorId, platform, rejectionReason } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, platform, rejectionReason: rejectionReason ?? null }
      await Promise.all([
        dispatchInApp({ creatorId, eventType: "post.rejected", sourceId: postId, ctx, entityType: "post", entityId: postId }),
        dispatchEmail({ creatorId, eventType: "post.rejected", sourceId: postId, ctx }),
      ])
      break
    }

    case "event/warmup.reminder": {
      const { creatorId, warmupDay, platforms } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, warmupDay, platforms }
      await dispatchInApp({ creatorId, eventType: "warmup.reminder", sourceId: `${creatorId}:warmup:day${warmupDay}`, ctx })
      break
    }

    case "event/job.offered": {
      const { jobId, creatorId, brandName, rate, deadline, phone } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, brandName, rate, deadline }
      const dispatches: Promise<void>[] = [
        dispatchInApp({ creatorId, eventType: "job.offered", sourceId: jobId, ctx }),
        dispatchEmail({ creatorId, eventType: "job.offered", sourceId: jobId, ctx }),
      ]
      if (phone) dispatches.push(dispatchSms({ creatorId, eventType: "job.offered", sourceId: jobId, ctx, toPhone: phone }))
      await Promise.all(dispatches)
      break
    }

    case "event/viral.alert": {
      const { postId, creatorId, platform, views } = data
      const creator = await fetchCreator(creatorId)
      const ctx: TemplateCtx = { creatorName: creator.name ?? "Creator", creatorEmail: creator.email, platform, views: views.toLocaleString() }
      await dispatchInApp({ creatorId, eventType: "viral.alert", sourceId: postId, ctx, entityType: "post", entityId: postId })
      break
    }

    default:
      throw new Error(`Unknown job type: ${name}`)
  }
}

export function startWorker() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set")
  const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker("creator-events", processJob, {
    connection,
    concurrency: 50, // no limits on Railway
  })
  worker.on("completed", (job) => console.log(`[worker] ✓ ${job.name} ${job.id}`))
  worker.on("failed", (job, err) => console.error(`[worker] ✗ ${job?.name} ${job?.id}:`, err.message))
  console.log("[worker] BullMQ worker started — concurrency: 50")
  return worker
}
