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

## DECISION RULES

**DEFAULT: intent = GENERAL. Always answer unless the message is one of the 3 escalation triggers below.**

### The only 3 reasons to escalate:
1. "I haven't been paid" / payment is missing or wrong — payment disputes only
2. "Am I going to be dropped?" / "I want to quit" / "I want to leave" — questions about leaving or being removed
3. Creator is angry, upset, or threatening

### Use DATA when the answer is in the creator/campaign data above:
- "When do I get paid?" → pending balance + payment history
- "Why was my video rejected?" → rejection reason from recent posts
- "What's my pay rate?" → pay_rate value
- "What platforms do I post on?" → campaign platforms

### Use GENERAL for everything else — including:
- "How long is warmup?" → 14 days, day ${creator.warmup_day ?? 0} now
- "What information can you give me?" → say: I can help with your pay, warmup status, post rejections, Spark Codes, bank setup, and campaign details
- "What can you help me with?" → same as above
- "Hi", "Hello", greetings → friendly intro, offer to help
- How-to questions about Spark Codes, bank setup, posting schedule

### NEVER:
- Make up numbers
- Escalate because a message mentions "payment" or "money" — if the data answers it, use DATA
- Escalate for vague or general questions — those are GENERAL`.trim()
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
    model: "gpt-5-mini-2025-08-07",
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
