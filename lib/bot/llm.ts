import OpenAI from "openai"

export interface BotResult {
  intent: "ESCALATE" | "DATA" | "GENERAL"
  response: string
}

interface Creator {
  id: string
  name: string | null
  pay_rate: number | null
  pay_structure: "per_video" | "monthly" | null
  contract_signed: boolean
  bank_connected: boolean
  warmup_status: "not_started" | "in_progress" | "complete"
  warmup_day: number | null
  total_videos_posted: number
  total_paid: number // cents
  last_posted_at: string | null
}

interface Campaign {
  brand_name: string
  brief_url: string | null
  platforms: string[]
  posting_frequency: string | null
  video_quota: number | null
  content_format: string | null
  hashtags: string[] | null
}

interface Payment {
  amount: number
  status: string
  paid_at: string | null
  video_count: number
}

interface Post {
  platform: string
  status: string
  rejection_reason: string | null
  reviewed_at: string | null
}

function buildSystemPrompt(
  creator: Creator,
  campaign: Campaign,
  recentPayments?: Payment[],
  recentPosts?: Post[],
  pendingBalance?: number
): string {
  const payInfo = creator.pay_rate
    ? `$${creator.pay_rate} ${creator.pay_structure === "per_video" ? "per video" : "per month"}`
    : null

  const totalPaidDollars = (creator.total_paid / 100).toFixed(2)
  const pendingDollars = pendingBalance ? (pendingBalance / 100).toFixed(2) : "0.00"

  const paymentsSection =
    recentPayments && recentPayments.length > 0
      ? recentPayments
          .map(
            (p) =>
              `  - $${(p.amount / 100).toFixed(2)} for ${p.video_count} video${p.video_count !== 1 ? "s" : ""} — ${p.status}${p.paid_at ? ` (paid ${new Date(p.paid_at).toLocaleDateString()})` : ""}`
          )
          .join("\n")
      : "  (no recent payments)"

  const postsSection =
    recentPosts && recentPosts.length > 0
      ? recentPosts
          .map(
            (p) =>
              `  - ${p.platform}: ${p.status}${p.rejection_reason ? ` — reason: "${p.rejection_reason}"` : ""}${p.reviewed_at ? ` (reviewed ${new Date(p.reviewed_at).toLocaleDateString()})` : ""}`
          )
          .join("\n")
      : "  (no recent posts)"

  return `You are a friendly, concise support assistant for creators in the ${campaign.brand_name} campaign program. Your name is 8x Support. Reply like a helpful teammate — warm, brief, no corporate speak.

## CREATOR DATA (verified, from database — do NOT make up values)
- Name: ${creator.name ?? "unknown"}
- Pay rate: ${payInfo ?? "NOT SET — pay rate has not been configured yet"}
- Contract signed: ${creator.contract_signed ? "yes" : "no"}
- Bank account connected: ${creator.bank_connected ? "yes" : "no"}
- Warmup status: ${creator.warmup_status} (day ${creator.warmup_day ?? 0} of 14)
- Videos posted: ${creator.total_videos_posted}
- Total paid to date: $${totalPaidDollars}
- Pending balance: $${pendingDollars}
- Last posted: ${creator.last_posted_at ? new Date(creator.last_posted_at).toLocaleDateString() : "never"}

## RECENT PAYMENTS (last 3)
${paymentsSection}

## RECENT POSTS (last 3)
${postsSection}

## CAMPAIGN DATA
- Brand: ${campaign.brand_name}
- Platforms: ${campaign.platforms.join(", ")}
- Video quota: ${campaign.video_quota ?? "not set"} videos total
- Posting frequency: ${campaign.posting_frequency ?? "not set"}
- Content format: ${campaign.content_format ?? "not specified"}
- Hashtags to use: ${campaign.hashtags?.join(", ") ?? "none specified"}
- Campaign brief: ${campaign.brief_url ?? "not available"}

## STATIC KNOWLEDGE BASE

**Warmup process:** Warmup takes 14 days. You post normally during warmup — TikTok uses this period to establish your account baseline. Current day: ${creator.warmup_day ?? 0} of 14.

**Spark Codes (TikTok):** TikTok Studio → Creator Marketplace → My Profile → Spark Code. Share the code with your brand contact. Codes expire after 7 days, so generate close to your posting date.

**Bank / Stripe setup:** Creator dashboard → Payments → Connect Bank → Stripe. Have your routing + account number ready. Takes 2–3 business days after first payment.

**How payments work:** You earn based on your pay rate per approved video (or monthly). Payments are processed after posts are approved.

## HOW TO RESPOND

Step 1 — Is this an escalation? Set intent = ESCALATE only for:
- Payment DISPUTE: "I haven't been paid", "my payment is missing/wrong"
- Wants to QUIT or asks if being DROPPED: "I want to leave", "am I getting dropped"
- ANGRY or THREATENING: "this is bullshit", "I'm done"

Step 2 — Can the answer be found in the data above? Set intent = DATA and answer with exact values:
- "When do I get paid?" → use Pending balance + Recent payments
- "Why was my video rejected?" → use rejection_reason from Recent posts
- "What's my pay rate?" → use Pay rate
- "How many videos have I posted?" → use Videos posted
- "What platforms do I post on?" → use Campaign platforms
- "What's my pending balance?" → use Pending balance
- "When did I last post?" → use Last posted
- "Is my bank connected?" → use Bank account connected

Step 3 — Everything else: set intent = GENERAL. Answer using the static knowledge base or give a helpful overview:
- "How long is warmup?" / "When do I start posting?" → warmup explanation + current day
- "How do Spark Codes work?" → Spark Code steps
- "How do I connect my bank?" → Stripe setup steps
- "What information can you give me?" / "What can you help with?" / greetings → overview of what you can help with
- Any other how-to or general question → answer from static knowledge

Never escalate for a vague or general question. Never make up numbers.`.trim()
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function callLLM(
  context: {
    creator: Creator
    campaign: Campaign
    recentPayments?: Payment[]
    recentPosts?: Post[]
    pendingBalance?: number
  },
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<BotResult> {
  const { creator, campaign, recentPayments, recentPosts, pendingBalance } = context

  const systemPrompt = buildSystemPrompt(creator, campaign, recentPayments, recentPosts, pendingBalance)

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "support_response",
          description: "Classify the creator's message and generate a reply",
          parameters: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                enum: ["ESCALATE", "DATA", "GENERAL"],
                description:
                  "ONLY escalate for payment disputes, drop risk, or anger. DATA if answerable from creator/campaign data. GENERAL for static how-to questions or anything else.",
              },
              response: {
                type: "string",
                description:
                  "The actual message text to send to the creator — write it out in full, do not describe or summarize what to say. Warm and concise. If escalating, say you will connect them with the team.",
              },
            },
            required: ["intent", "response"],
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "support_response" } },
  })

  const toolCall = res.choices?.[0]?.message?.tool_calls?.[0]
  if (toolCall && "function" in toolCall) {
    const result = JSON.parse(toolCall.function.arguments) as BotResult
    // If model escalates with no response, it's confused not a real escalation — answer instead
    if (result.intent === "ESCALATE" && !result.response?.trim()) {
      return {
        intent: "GENERAL",
        response: `Hey! I can help with your pay, warmup status, post rejections, Spark Codes, bank setup, and campaign details for ${context.campaign.brand_name}. What would you like to know?`,
      }
    }
    return result
  }

  return {
    intent: "GENERAL",
    response: `Hey! I can help with your pay, warmup status, post rejections, Spark Codes, bank setup, and campaign details. What would you like to know?`,
  }
}
