import { describe, it, expect, vi, beforeEach } from "vitest"

const mockChain = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn() }
Object.values(mockChain).forEach(fn => (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockChain))
mockChain.maybeSingle.mockResolvedValue({ data: null, error: null })
mockChain.insert.mockResolvedValue({ error: null })
mockChain.update.mockResolvedValue({ error: null })
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn(() => mockChain), channel: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })) } }))

// Flush all pending microtasks + macro-tasks so after() callbacks complete
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

// Mock next/server's after() — fire the callback immediately (no real delay)
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => fn(),
}))

vi.mock("@/lib/bot/conversation", () => ({
  findOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
  tagEscalated: vi.fn(),
  getMessages: vi.fn(),
  getHistory: vi.fn().mockResolvedValue([]),
  findConversationBySlackThread: vi.fn(),
  pinCampaign: vi.fn(),
}))
vi.mock("@/lib/bot/context", () => ({ getContext: vi.fn() }))
vi.mock("@/lib/bot/llm",     () => ({ callLLM: vi.fn() }))
vi.mock("@/lib/bot/slack",   () => ({ sendSlackAlert: vi.fn().mockResolvedValue("1234567890.123456") }))
vi.mock("@/lib/bot/log",     () => ({ logResponse: vi.fn() }))

import { POST } from "@/app/api/messages/route"
import { findOrCreateConversation, saveMessage, tagEscalated } from "@/lib/bot/conversation"
import { getContext } from "@/lib/bot/context"
import { callLLM } from "@/lib/bot/llm"
import { sendSlackAlert } from "@/lib/bot/slack"
import { logResponse } from "@/lib/bot/log"

const CREATOR_ID = "creator-123"
const CONVERSATION_ID = "conv-456"
const MESSAGE_ID = "msg-789"

const mockConversation = { id: CONVERSATION_ID, creator_id: CREATOR_ID, escalated: false, status: "open" }
const mockMessage      = { id: MESSAGE_ID, conversation_id: CONVERSATION_ID, role: "user", content: "" }

const mockContext = {
  creator: {
    id: CREATOR_ID,
    name: "Test Creator",
    campaign_id: "campaign-456",
    pay_rate: 500,
    pay_structure: "monthly",
    warmup_status: "active",
    warmup_day: 3,
    bank_connected: true,
  },
  campaign: {
    id: "campaign-456",
    brand_name: "Nike",
    video_quota: 8,
    posting_frequency: "2x per week",
    platforms: ["TikTok", "Instagram"],
  },
  recentPayments: [],
  recentPosts: [],
  pendingBalance: 0,
}

function makePostRequest(body: object) {
  return new Request("http://localhost/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findOrCreateConversation).mockResolvedValue(mockConversation)
  vi.mocked(saveMessage).mockResolvedValue(mockMessage)
  vi.mocked(getContext).mockResolvedValue({ ...mockContext, campaigns: null })
})

describe("POST /api/messages", () => {
  it("Test 1: stores message and returns 202 immediately", async () => {
    vi.mocked(callLLM).mockResolvedValue({ intent: "DATA", response: "Your pay rate is $500/month." })

    const res = await POST(makePostRequest({ creatorId: CREATOR_ID, message: "How much do I get paid?" }))
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.conversationId).toBe(CONVERSATION_ID)
    expect(body.messageId).toBe(MESSAGE_ID)

    // user message saved first
    expect(saveMessage).toHaveBeenCalledWith(CONVERSATION_ID, "user", "How much do I get paid?")
  })

  it("Test 2: bot saves assistant reply after processing", async () => {
    vi.mocked(callLLM).mockResolvedValue({ intent: "DATA", response: "Your pay rate is $500/month." })

    await POST(makePostRequest({ creatorId: CREATOR_ID, message: "How much do I get paid?" }))
    await flushPromises()

    expect(callLLM).toHaveBeenCalledOnce()
    expect(saveMessage).toHaveBeenCalledWith(CONVERSATION_ID, "assistant", "Your pay rate is $500/month.")
    expect(sendSlackAlert).not.toHaveBeenCalled()
    expect(logResponse).toHaveBeenCalledWith(CREATOR_ID, "How much do I get paid?", "Your pay rate is $500/month.", false)
  })

  it("Test 3: escalation sends Slack and tags conversation", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      intent: "ESCALATE",
      response: "I'll connect you with support.",
    })

    await POST(makePostRequest({ creatorId: CREATOR_ID, message: "I haven't been paid" }))
    await flushPromises()

    expect(sendSlackAlert).toHaveBeenCalledWith(CREATOR_ID, "I haven't been paid", expect.objectContaining({
      creatorName: mockContext.creator.name ?? null,
      campaignName: mockContext.campaign.brand_name,
      conversationId: CONVERSATION_ID,
    }))
    expect(tagEscalated).toHaveBeenCalledWith(CONVERSATION_ID, expect.anything())
    expect(saveMessage).toHaveBeenCalledWith(CONVERSATION_ID, "assistant", "I'll connect you with support.")
    expect(logResponse).toHaveBeenCalledWith(CREATOR_ID, "I haven't been paid", "I'll connect you with support.", true)
  })

  it("Test 4: passes null pay_rate to Claude, saves deflection reply", async () => {
    vi.mocked(getContext).mockResolvedValue({
      ...mockContext,
      creator: { ...mockContext.creator, pay_rate: null },
      campaigns: null,
      recentPayments: [],
      recentPosts: [],
      pendingBalance: 0,
    })
    vi.mocked(callLLM).mockResolvedValue({ intent: "DATA", response: "I'll connect you with support." })

    await POST(makePostRequest({ creatorId: CREATOR_ID, message: "How much do I get paid?" }))
    await flushPromises()

    const contextArg = vi.mocked(callLLM).mock.calls[0][0]
    expect(contextArg.creator.pay_rate).toBeNull()
    expect(saveMessage).toHaveBeenCalledWith(CONVERSATION_ID, "assistant", "I'll connect you with support.")
  })

  it("resumes existing conversation when conversationId provided", async () => {
    vi.mocked(callLLM).mockResolvedValue({ intent: "GENERAL", response: "Sure!" })

    await POST(makePostRequest({ creatorId: CREATOR_ID, message: "Thanks", conversationId: CONVERSATION_ID }))

    expect(findOrCreateConversation).toHaveBeenCalledWith(CREATOR_ID, CONVERSATION_ID)
  })
})
