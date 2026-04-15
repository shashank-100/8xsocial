import { describe, it, expect, vi, beforeEach } from "vitest"

// --- Mocks ---
vi.mock("chat", () => {
  const handlers: Record<string, Function> = {}
  function MockChat() {
    return {
      onDirectMessage(handler: Function) { handlers["directMessage"] = handler },
      webhooks: { slack: vi.fn() },
      __handlers: handlers,
    }
  }
  return { Chat: MockChat }
})

vi.mock("@chat-adapter/slack", () => ({
  createSlackAdapter: vi.fn(() => ({})),
}))

vi.mock("@/lib/bot/state-adapter", () => ({
  MemoryStateAdapter: function () { return {} },
}))

vi.mock("@/lib/bot/creator-lookup", () => ({ findCreatorBySlackId: vi.fn() }))
vi.mock("@/lib/bot/conversation", () => ({
  findOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
  tagEscalated: vi.fn(),
}))
vi.mock("@/lib/bot/context", () => ({ getContext: vi.fn() }))
vi.mock("@/lib/bot/llm", () => ({ callLLM: vi.fn() }))
vi.mock("@/lib/bot/slack", () => ({ sendSlackAlert: vi.fn() }))
vi.mock("@/lib/bot/log", () => ({ logResponse: vi.fn() }))

import { findCreatorBySlackId } from "@/lib/bot/creator-lookup"
import { findOrCreateConversation, saveMessage, tagEscalated } from "@/lib/bot/conversation"
import { getContext } from "@/lib/bot/context"
import { callLLM } from "@/lib/bot/llm"
import { sendSlackAlert } from "@/lib/bot/slack"
import { logResponse } from "@/lib/bot/log"

const SLACK_USER_ID = "U0ABC123"
const CREATOR_ID = "creator-uuid-123"
const CONV_ID = "conv-uuid-456"

const mockCreator = {
  id: CREATOR_ID,
  name: "Test Creator",
  slack_user_id: SLACK_USER_ID,
  pay_rate: 500,
  pay_structure: "monthly",
  bank_connected: true,
}

const mockContext = {
  creator: {
    id: CREATOR_ID,
    name: "Test Creator",
    pay_rate: 500,
    pay_structure: "monthly",
    bank_connected: true,
  },
  campaign: {
    brand_name: "Nike",
    platforms: ["TikTok"],
    video_quota: 8,
    posting_frequency: "2x per week",
    content_format: "short-form video",
    hashtags: ["#nike"],
    brief_url: null,
  },
}

const mockConversation = { id: CONV_ID, creator_id: CREATOR_ID, status: "open", escalated: false }
const mockMessage = { id: "msg-1", conversation_id: CONV_ID, role: "user", content: "" }

// Build a fake thread object
function makeThread(state: Record<string, unknown> | null = null) {
  return {
    state: Promise.resolve(state),
    setState: vi.fn(),
    startTyping: vi.fn(),
    post: vi.fn(),
    channelId: "slack:DABC123",
  }
}

function makeMessage(text: string) {
  return {
    author: { userId: SLACK_USER_ID, fullName: "Test Creator", isBot: false, isMe: false, userName: "testcreator" },
    text,
  }
}

// Get the onDirectMessage handler from the bot singleton
async function getHandler() {
  // Reset singleton between tests
  const g = globalThis as Record<string, unknown>
  delete g.__chatBot

  const { getBot } = await import("@/lib/bot/slack-bot")
  const bot = getBot() as unknown as { __handlers: Record<string, Function> }
  return bot.__handlers["directMessage"]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findOrCreateConversation).mockResolvedValue(mockConversation)
  vi.mocked(saveMessage).mockResolvedValue(mockMessage)
  vi.mocked(getContext).mockResolvedValue(mockContext)
})

describe("Slack DM bot — onDirectMessage", () => {
  it("posts 'not registered' when creator not found", async () => {
    vi.mocked(findCreatorBySlackId).mockResolvedValue(null)
    const handler = await getHandler()
    const thread = makeThread()

    await handler(thread, makeMessage("How much do I get paid?"))

    expect(thread.post).toHaveBeenCalledWith(expect.stringContaining("not registered"))
    expect(callLLM).not.toHaveBeenCalled()
  })

  it("runs full pipeline and posts reply for DATA intent", async () => {
    vi.mocked(findCreatorBySlackId).mockResolvedValue(mockCreator)
    vi.mocked(callLLM).mockResolvedValue({ intent: "DATA", response: "You earn $500/month." })
    const handler = await getHandler()
    const thread = makeThread()

    await handler(thread, makeMessage("How much do I get paid?"))

    expect(thread.startTyping).toHaveBeenCalled()
    expect(callLLM).toHaveBeenCalledOnce()
    expect(thread.post).toHaveBeenCalledWith("You earn $500/month.")
    expect(saveMessage).toHaveBeenCalledWith(CONV_ID, "user", "How much do I get paid?")
    expect(saveMessage).toHaveBeenCalledWith(CONV_ID, "assistant", "You earn $500/month.")
    expect(sendSlackAlert).not.toHaveBeenCalled()
    expect(tagEscalated).not.toHaveBeenCalled()
    expect(logResponse).toHaveBeenCalledWith(CREATOR_ID, "How much do I get paid?", "You earn $500/month.", false)
  })

  it("escalates, tags conversation, and sends Slack alert on ESCALATE intent", async () => {
    vi.mocked(findCreatorBySlackId).mockResolvedValue(mockCreator)
    vi.mocked(callLLM).mockResolvedValue({ intent: "ESCALATE", response: "I'll connect you with the team." })
    const handler = await getHandler()
    const thread = makeThread()

    await handler(thread, makeMessage("I haven't been paid"))

    expect(tagEscalated).toHaveBeenCalledWith(CONV_ID)
    expect(sendSlackAlert).toHaveBeenCalledWith(
      CREATOR_ID,
      "I haven't been paid",
      expect.objectContaining({ creatorName: "Test Creator", campaignName: "Nike" })
    )
    expect(thread.post).toHaveBeenCalledWith("I'll connect you with the team.")
    expect(logResponse).toHaveBeenCalledWith(CREATOR_ID, "I haven't been paid", "I'll connect you with the team.", true)
  })

  it("posts fallback and logs error when LLM throws", async () => {
    vi.mocked(findCreatorBySlackId).mockResolvedValue(mockCreator)
    vi.mocked(callLLM).mockRejectedValue(new Error("OpenAI timeout"))
    const handler = await getHandler()
    const thread = makeThread()

    await handler(thread, makeMessage("What should I post?"))

    expect(thread.post).toHaveBeenCalledWith(expect.stringContaining("having a moment"))
    expect(logResponse).toHaveBeenCalledWith(CREATOR_ID, "What should I post?", "[LLM_ERROR]", true)
  })

  it("reuses existing conversationId from thread state on follow-up messages", async () => {
    vi.mocked(findCreatorBySlackId).mockResolvedValue(mockCreator)
    vi.mocked(callLLM).mockResolvedValue({ intent: "GENERAL", response: "Sure!" })
    const handler = await getHandler()
    const thread = makeThread({ conversationId: CONV_ID })

    await handler(thread, makeMessage("Thanks"))

    expect(findOrCreateConversation).toHaveBeenCalledWith(CREATOR_ID, CONV_ID)
    expect(thread.setState).not.toHaveBeenCalled() // already persisted
  })

  it("persists new conversationId to thread state on first message", async () => {
    vi.mocked(findCreatorBySlackId).mockResolvedValue(mockCreator)
    vi.mocked(callLLM).mockResolvedValue({ intent: "GENERAL", response: "Welcome!" })
    const handler = await getHandler()
    const thread = makeThread(null) // no existing state

    await handler(thread, makeMessage("Hello"))

    expect(findOrCreateConversation).toHaveBeenCalledWith(CREATOR_ID, undefined)
    expect(thread.setState).toHaveBeenCalledWith({ conversationId: CONV_ID })
  })
})
