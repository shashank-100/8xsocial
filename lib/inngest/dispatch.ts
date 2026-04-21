import { supabaseAdmin } from "@/lib/supabase/admin"
import { templates, type TemplateCtx } from "@/lib/templates"
import { isQuietHours } from "./quiet-hours"

async function fetchCreatorQuietHours(creatorId: string) {
  const { data } = await supabaseAdmin
    .from("creators")
    .select("quiet_hours_start, quiet_hours_end, timezone")
    .eq("id", creatorId)
    .single()
  return data ?? { quiet_hours_start: null, quiet_hours_end: null, timezone: "UTC" }
}

export async function claimDispatch(key: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("message_dispatch")
    .insert({ idempotency_key: key, status: "pending" })
    .select("idempotency_key")
    .single()
  return !!data
}

export async function markDispatched(key: string): Promise<void> {
  await supabaseAdmin
    .from("message_dispatch")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("idempotency_key", key)
}

export async function markFailed(key: string): Promise<void> {
  await supabaseAdmin
    .from("message_dispatch")
    .update({ status: "failed" })
    .eq("idempotency_key", key)
}

export async function dispatchInApp({
  creatorId,
  eventType,
  sourceId,
  ctx,
  entityType,
  entityId,
  threadId,
}: {
  creatorId: string
  eventType: string
  sourceId: string
  ctx: TemplateCtx
  entityType?: string
  entityId?: string
  threadId?: string
}): Promise<void> {
  const key = `${eventType}:${sourceId}:in-app`
  const ok = await claimDispatch(key)
  if (!ok) return

  const template = templates[eventType]
  if (!template) return

  try {
    await supabaseAdmin.from("inbox_items").insert({
      creator_id: creatorId,
      type: "system",
      thread_id: threadId ?? null,
      preview: template.preview(ctx),
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      metadata: { idempotency_key: key, event_type: eventType, source_id: sourceId },
    })
    await markDispatched(key)
  } catch (err) {
    await markFailed(key)
    throw err
  }
}

export async function dispatchEmail({
  creatorId,
  eventType,
  sourceId,
  ctx,
}: {
  creatorId: string
  eventType: string
  sourceId: string
  ctx: TemplateCtx
}): Promise<void> {
  const key = `${eventType}:${sourceId}:email`
  const ok = await claimDispatch(key)
  if (!ok) return

  const template = templates[eventType]
  if (!template || !template.channels.includes("email")) return

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[dispatch] RESEND_API_KEY not set — skipping email")
    await markFailed(key)
    return
  }

  const qh = await fetchCreatorQuietHours(creatorId)
  if (isQuietHours(qh.quiet_hours_start, qh.quiet_hours_end, qh.timezone)) {
    console.log(`[dispatch] quiet hours for ${creatorId} — skipping email ${key}`)
    await markFailed(key)
    return
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "8x <noreply@8x.social>",
        to: ctx.creatorEmail,
        subject: template.subject(ctx),
        text: template.emailBody(ctx),
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Resend error ${res.status}: ${err}`)
    }
    await markDispatched(key)
  } catch (err) {
    await markFailed(key)
    throw err
  }
}

export async function dispatchSms({
  creatorId,
  eventType,
  sourceId,
  ctx,
  toPhone,
}: {
  creatorId: string
  eventType: string
  sourceId: string
  ctx: TemplateCtx
  toPhone: string
}): Promise<void> {
  const key = `${eventType}:${sourceId}:sms`
  const ok = await claimDispatch(key)
  if (!ok) return

  const template = templates[eventType]
  if (!template?.smsBody) return

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromPhone = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromPhone) {
    console.warn("[dispatch] Twilio credentials not set — skipping SMS")
    await markFailed(key)
    return
  }

  const qh = await fetchCreatorQuietHours(creatorId)
  if (isQuietHours(qh.quiet_hours_start, qh.quiet_hours_end, qh.timezone)) {
    console.log(`[dispatch] quiet hours for ${creatorId} — skipping SMS ${key}`)
    await markFailed(key)
    return
  }

  try {
    const body = new URLSearchParams({
      From: fromPhone,
      To: toPhone,
      Body: template.smsBody(ctx),
    })
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Twilio error ${res.status}: ${err}`)
    }
    await markDispatched(key)
  } catch (err) {
    await markFailed(key)
    throw err
  }
}
