/**
 * Seed mock data for local/staging demo.
 * Uses the hardcoded CREATOR_ID from shared.tsx.
 * Run: npx tsx scripts/seed-mock-data.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env.local") })

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CREATOR_ID = "00000000-0000-0000-0000-000000000002"
const CAMPAIGN_ID = "00000000-0000-0000-0000-000000000010"
const SUPPORT_CONV_ID = "00000000-0000-0000-0000-000000000020"
const BRAND_CONV_ID   = "00000000-0000-0000-0000-000000000021"

async function seed() {
  console.log("Seeding mock data...")

  // ── Campaign ────────────────────────────────────────────────
  await supabase.from("campaigns").upsert({
    id: CAMPAIGN_ID,
    brand_name: "Nike",
    platforms: ["TikTok", "Instagram"],
    posting_frequency: "2x per week",
    video_quota: 8,
    content_format: "15–30s vertical video",
    hashtags: ["#JustDoIt", "#Nike"],
    active: true,
  }, { onConflict: "id" })
  console.log("✓ campaign")

  // ── Creator ─────────────────────────────────────────────────
  await supabase.from("creators").upsert({
    id: CREATOR_ID,
    name: "Jordan Lee",
    email: "jordan@example.com",
    campaign_id: CAMPAIGN_ID,
    pay_rate: 40,
    pay_structure: "per_video",
    contract_signed: true,
    bank_connected: true,
    warmup_status: "in_progress",
    warmup_day: 7,
    total_videos_posted: 5,
    total_paid: 16000, // cents = $160
    timezone: "America/Los_Angeles",
    quiet_hours_start: "22:00",
    quiet_hours_end: "08:00",
  }, { onConflict: "id" })
  console.log("✓ creator")

  // ── creator_campaigns join ───────────────────────────────────
  await supabase.from("creator_campaigns").upsert({
    creator_id: CREATOR_ID,
    campaign_id: CAMPAIGN_ID,
    active: true,
  }, { onConflict: "creator_id,campaign_id" })
  console.log("✓ creator_campaigns")

  // ── Payments ─────────────────────────────────────────────────
  await supabase.from("payments").upsert([
    {
      id: "00000000-0000-0000-0000-000000000031",
      creator_id: CREATOR_ID,
      campaign_id: CAMPAIGN_ID,
      amount: 8000,
      video_count: 2,
      status: "paid",
      paid_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000032",
      creator_id: CREATOR_ID,
      campaign_id: CAMPAIGN_ID,
      amount: 4000,
      video_count: 1,
      status: "pending",
      paid_at: null,
    },
  ], { onConflict: "id" })
  console.log("✓ payments")

  // ── Posts ────────────────────────────────────────────────────
  await supabase.from("posts").upsert([
    {
      id: "00000000-0000-0000-0000-000000000041",
      creator_id: CREATOR_ID,
      campaign_id: CAMPAIGN_ID,
      platform: "TikTok",
      status: "approved",
      reviewed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000042",
      creator_id: CREATOR_ID,
      campaign_id: CAMPAIGN_ID,
      platform: "Instagram",
      status: "rejected",
      rejection_reason: "Video too short — minimum 15 seconds required",
      reviewed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ], { onConflict: "id" })
  console.log("✓ posts")

  // ── Support conversation + messages ─────────────────────────
  await supabase.from("conversations").upsert({
    id: SUPPORT_CONV_ID,
    creator_id: CREATOR_ID,
    type: "support",
    status: "open",
    escalated: false,
    mode: "bot",
    campaign_id: CAMPAIGN_ID,
    last_message_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  }, { onConflict: "id" })

  await supabase.from("messages").upsert([
    {
      id: "00000000-0000-0000-0000-000000000051",
      conversation_id: SUPPORT_CONV_ID,
      role: "user",
      content: "Hey, when do I get paid for my last video?",
      created_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000052",
      conversation_id: SUPPORT_CONV_ID,
      role: "assistant",
      content: "Hey Jordan! Your most recent payment of $80 for 2 videos was sent 3 days ago and should be in your bank account already. You also have a $40 payment for 1 video that's currently pending — that'll process within 2–3 business days. Let me know if anything looks off!",
      created_at: new Date(Date.now() - 34 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000053",
      conversation_id: SUPPORT_CONV_ID,
      role: "user",
      content: "Got it, thanks! Also why was my Instagram post rejected?",
      created_at: new Date(Date.now() - 33 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000054",
      conversation_id: SUPPORT_CONV_ID,
      role: "assistant",
      content: "Your Instagram post was rejected because it was too short — the campaign requires a minimum of 15 seconds. Just re-record with a bit more content and resubmit. Your TikTok post from the same day was approved, so you're on the right track!",
      created_at: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000055",
      conversation_id: SUPPORT_CONV_ID,
      role: "user",
      content: "Perfect, will do. How many more videos do I need to post this week?",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000056",
      conversation_id: SUPPORT_CONV_ID,
      role: "assistant",
      content: "You're on a 2x per week schedule for Nike. You've posted 5 videos total so far out of your 8-video quota. You're in good shape — just 3 more to hit your quota for the campaign!",
      created_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    },
  ], { onConflict: "id" })
  console.log("✓ support conversation + messages")

  // ── Brand chat conversation + messages ──────────────────────
  await supabase.from("conversations").upsert({
    id: BRAND_CONV_ID,
    creator_id: CREATOR_ID,
    type: "campaign",
    status: "open",
    escalated: false,
    mode: "human",
    campaign_id: CAMPAIGN_ID,
    last_message_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "id" })

  await supabase.from("messages").upsert([
    {
      id: "00000000-0000-0000-0000-000000000061",
      conversation_id: BRAND_CONV_ID,
      role: "human",
      content: "Hey Jordan! Love the TikTok you posted yesterday 🔥 The lighting and energy were exactly what we were looking for.",
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000062",
      conversation_id: BRAND_CONV_ID,
      role: "user",
      content: "Thanks so much! Really glad it landed well. I had a lot of fun with it.",
      created_at: new Date(Date.now() - 4.5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000063",
      conversation_id: BRAND_CONV_ID,
      role: "human",
      content: "Quick heads up — we're launching a new colorway next week. Can you work in a mention of the Air Max 97 in your next video? The brief has details.",
      created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000064",
      conversation_id: BRAND_CONV_ID,
      role: "user",
      content: "Absolutely, I'll check the brief now and work it in. Should I still use the same hashtags?",
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000065",
      conversation_id: BRAND_CONV_ID,
      role: "human",
      content: "Yes, keep #JustDoIt and #Nike. Also add #AirMax97 for this one specifically.",
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  ], { onConflict: "id" })
  console.log("✓ brand chat conversation + messages")

  // ── Inbox items ──────────────────────────────────────────────
  await supabase.from("inbox_items").upsert([
    // Support thread
    {
      id: "00000000-0000-0000-0000-000000000071",
      creator_id: CREATOR_ID,
      type: "support",
      thread_id: SUPPORT_CONV_ID,
      preview: "You're on a 2x per week schedule for Nike. You've posted 5 videos...",
      read_at: null,
      created_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
      metadata: {},
    },
    // Brand chat
    {
      id: "00000000-0000-0000-0000-000000000072",
      creator_id: CREATOR_ID,
      type: "chat",
      thread_id: BRAND_CONV_ID,
      preview: "Nike: Yes, keep #JustDoIt and #Nike. Also add #AirMax97...",
      read_at: null,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      metadata: { brand_name: "Nike" },
    },
    // Payment notification
    {
      id: "00000000-0000-0000-0000-000000000073",
      creator_id: CREATOR_ID,
      type: "system",
      thread_id: null,
      preview: "You've been paid $80.00 for 2 videos",
      entity_type: "payment",
      entity_id: "00000000-0000-0000-0000-000000000031",
      read_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { idempotency_key: "payment.sent:00000000-0000-0000-0000-000000000031:in-app", event_type: "payment.sent" },
    },
    // Post rejected notification
    {
      id: "00000000-0000-0000-0000-000000000074",
      creator_id: CREATOR_ID,
      type: "system",
      thread_id: null,
      preview: "Your Instagram post was rejected: Video too short — minimum 15 seconds required",
      entity_type: "post",
      entity_id: "00000000-0000-0000-0000-000000000042",
      read_at: null,
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { idempotency_key: "post.rejected:00000000-0000-0000-0000-000000000042:in-app", event_type: "post.rejected" },
    },
    // Post approved digest
    {
      id: "00000000-0000-0000-0000-000000000075",
      creator_id: CREATOR_ID,
      type: "system",
      thread_id: null,
      preview: "Your TikTok post was approved",
      entity_type: "post_batch",
      entity_id: "00000000-0000-0000-0000-000000000041",
      read_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { idempotency_key: "post.approved:00000000-0000-0000-0000-000000000041:in-app", event_type: "post.approved", count: 1 },
    },
  ], { onConflict: "id" })
  console.log("✓ inbox items")

  console.log("\nDone! Visit /inbox to see mock data.")
  console.log(`Creator ID: ${CREATOR_ID}`)
}

seed().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
