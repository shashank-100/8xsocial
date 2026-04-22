import { Worker, type Job } from "bullmq"
import { Redis } from "ioredis"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { dispatchInApp, dispatchEmail, dispatchSms, claimDispatch, markDispatched, markFailed } from "@/lib/dispatch/dispatch"
import type { TemplateCtx } from "@/lib/templates"

async function fetchCreator(creatorId: string) {
  const { data, error } = await supabaseAdmin
    .from("creators")
    .select("id, name, email, warmup_day, timezone")
    .eq("id", creatorId)
    .single()
  if (error || !data) throw new Error(`Creator not found: ${creatorId}`)
  return data as { id: string; name: string | null; email: string; warmup_day: number | null; timezone: string | null }
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
      const key = `post.approved:${postId}:in-app`
      const claimed = await claimDispatch(key)
      if (!claimed) break

      try {
        const creator = await fetchCreator(creatorId)
        // Use creator's local timezone so the digest groups by their calendar day, not UTC
        const tz = creator.timezone ?? "UTC"
        const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }))
        nowInTz.setHours(0, 0, 0, 0)
        const startOfDay = new Date(nowInTz.getTime() - new Date().getTimezoneOffset() * 60000)

        // Check for an existing unread post_batch inbox item today — update it instead of inserting
        const { data: existing } = await supabaseAdmin
          .from("inbox_items")
          .select("id, metadata")
          .eq("creator_id", creatorId)
          .eq("entity_type", "post_batch")
          .is("read_at", null)
          .gte("created_at", startOfDay.toISOString())
          .maybeSingle()

        if (existing) {
          const count = ((existing.metadata as Record<string, unknown>)?.count as number ?? 1) + 1
          await supabaseAdmin
            .from("inbox_items")
            .update({
              preview: `${count} posts approved today`,
              metadata: { ...(existing.metadata as object), count },
            })
            .eq("id", existing.id)
        } else {
          await supabaseAdmin.from("inbox_items").insert({
            creator_id: creatorId,
            type: "system",
            preview: `Your ${platform} post was approved`,
            entity_type: "post_batch",
            entity_id: postId,
            metadata: { idempotency_key: key, event_type: "post.approved", source_id: postId, count: 1 },
          })
        }
        await markDispatched(key)
      } catch (err) {
        await markFailed(key)
        throw err
      }
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
