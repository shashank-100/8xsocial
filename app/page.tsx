"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { createClient } from "@/utils/supabase/client"

const CREATOR_ID = "00000000-0000-0000-0000-000000000002"

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxItem {
  id: string
  type: "system" | "chat" | "support"
  preview: string | null
  entity_type: string | null
  entity_id: string | null
  thread_id: string | null
  read_at: string | null
  created_at: string
  metadata: Record<string, unknown>
}

interface Message {
  id?: string
  role: "user" | "assistant" | "human"
  content: string
  read_at?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function itemIcon(item: InboxItem): string {
  if (item.type === "support") return "💬"
  if (item.type === "chat") return "💬"
  if (item.entity_type === "payment") return "💰"
  if (item.entity_type === "post") return "✅"
  if (item.entity_type === "post_batch") return "🎯"
  if (item.entity_type === "campaign") return "📋"
  if (item.entity_type === "job") return "🎯"
  return "📣"
}

function threadTitle(item: InboxItem): string {
  if (item.type === "support") return "8x Support"
  if (item.type === "chat") return (item.metadata?.brand_name as string) ?? "Brand"
  if (item.entity_type === "payment") return "Payment"
  if (item.entity_type === "post") return "Post Update"
  if (item.entity_type === "post_batch") return "Posts"
  if (item.entity_type === "campaign") return "Campaign"
  if (item.entity_type === "job") return "Job Offer"
  return "Notification"
}

// ─── Thread Group (for grouping chat/support by thread) ───────────────────────

interface ThreadGroup {
  key: string
  type: InboxItem["type"]
  title: string
  icon: string
  preview: string
  time: string
  unread: number
  item: InboxItem
}

function groupIntoThreads(items: InboxItem[]): ThreadGroup[] {
  const map = new Map<string, ThreadGroup>()

  for (const item of items) {
    const key = item.thread_id ?? item.id
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        key,
        type: item.type,
        title: threadTitle(item),
        icon: itemIcon(item),
        preview: item.preview ?? "New message",
        time: item.created_at,
        unread: item.read_at ? 0 : 1,
        item,
      })
    } else {
      if (item.created_at > existing.time) {
        existing.preview = item.preview ?? existing.preview
        existing.time = item.created_at
        existing.item = item
      }
      if (!item.read_at) existing.unread += 1
    }
  }

  return Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time))
}

// ─── Inbox Row ────────────────────────────────────────────────────────────────

function InboxRow({
  group,
  onClick,
}: {
  group: ThreadGroup
  onClick: () => void
}) {
  const isChat = group.type === "chat" || group.type === "support"
  const previewText = isChat
    ? group.preview
    : group.preview

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-gray-100 last:border-0 hover:bg-gray-50"
    >
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-lg ${
        isChat ? "bg-gray-900 text-white" : "bg-gray-100"
      }`}>
        {isChat
          ? <span className="text-xs font-bold">{group.title.slice(0, 2).toUpperCase()}</span>
          : <span>{group.icon}</span>
        }
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm truncate ${group.unread > 0 ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
            {group.title}
          </p>
          <p className="text-xs text-gray-400 shrink-0">{timeAgo(group.time)}</p>
        </div>
        <p className={`text-xs truncate mt-0.5 ${group.unread > 0 ? "text-gray-700" : "text-gray-400"}`}>
          {isChat ? "" : "System: "}{previewText}
        </p>
      </div>

      {/* Unread badge */}
      {group.unread > 0 && (
        <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {group.unread > 9 ? "9+" : group.unread}
        </span>
      )}
    </button>
  )
}

// ─── Support Chat ─────────────────────────────────────────────────────────────

function SupportChat({ onClose }: { onClose: () => void }) {
  const GREETING = "Hey! I'm 8x Support. Ask me anything about your campaign, pay, or posting schedule."
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: GREETING }])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = createClient()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading, isTyping])

  // SSE stream for bot replies
  useEffect(() => {
    if (!conversationId) return
    esRef.current?.close()
    const es = new EventSource(`/api/messages/stream?conversationId=${conversationId}`)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const dbMsgs = (data.messages ?? []) as { id: string; role: string; content: string; read_at: string | null }[]
        const visible = dbMsgs.filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "human"
        )
        setMessages([
          { role: "assistant", content: GREETING },
          ...visible.map((m) => ({ id: m.id, role: m.role as Message["role"], content: m.content, read_at: m.read_at })),
        ])
        if (visible.length > prevCountRef.current) {
          const last = visible[visible.length - 1]
          if (last?.role === "assistant" || last?.role === "human") {
            setLoading(false)
            setIsTyping(false)
          }
          prevCountRef.current = visible.length
        }
      } catch { /* ignore */ }
    }
    return () => { es.close(); esRef.current = null }
  }, [conversationId])

  // Supabase Realtime: typing indicator broadcast (ephemeral — no DB write)
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on("broadcast", { event: "typing" }, ({ payload }: { payload: { userId: string; typing: boolean } }) => {
        // Show typing when the other side (assistant/human) is composing
        if (payload.userId !== CREATOR_ID) {
          setIsTyping(payload.typing)
          if (payload.typing) {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
            typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 4000)
          }
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, supabase])

  // Mark assistant/human messages as read when they appear
  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.id && !msg.read_at && (msg.role === "assistant" || msg.role === "human")) {
        fetch(`/api/messages/${msg.id}/read`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId }),
        }).catch(() => { /* ignore */ })
      }
    })
  }, [messages, conversationId])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setLoading(true)
    // Show creator typing broadcast to agents
    if (conversationId) {
      const channel = supabase.channel(`typing:${conversationId}`)
      channel.send({ type: "broadcast", event: "typing", payload: { userId: CREATOR_ID, typing: false } })
    }
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorId: CREATOR_ID, message: text, conversationId }),
      })
      const data = await res.json()
      if (data.conversationId) setConversationId(data.conversationId)
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }])
      setLoading(false)
    }
  }

  function handleInputChange(val: string) {
    setInput(val)
    // Broadcast typing to agents via Supabase Realtime
    if (conversationId && val.length > 0) {
      const channel = supabase.channel(`typing:${conversationId}`)
      channel.send({ type: "broadcast", event: "typing", payload: { userId: CREATOR_ID, typing: true } })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center">
            <span className="text-white text-xs font-bold">8x</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">8x Support</p>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              <p className="text-xs text-gray-400">Online</p>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
          ← Back
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            {msg.role === "human" && (
              <span className="text-xs text-blue-500 font-medium mb-1 px-1">Support Agent</span>
            )}
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-black text-white rounded-br-sm"
                  : msg.role === "human"
                  ? "bg-blue-50 text-blue-900 rounded-bl-sm shadow-sm border border-blue-100"
                  : "bg-white text-gray-800 rounded-bl-sm shadow-sm border border-gray-100"
              }`}
            >
              {msg.content}
            </div>
            {/* Read receipt for user messages */}
            {msg.role === "user" && msg.read_at && (
              <span className="text-xs text-gray-400 mt-0.5 pr-1">✓ Seen</span>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {(loading || isTyping) && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 shadow-sm px-4 py-2.5 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-100 bg-white shrink-0">
        <div className="flex gap-2 items-center">
          <input
            className="flex-1 px-4 py-2 rounded-full border border-gray-200 bg-gray-50 text-sm text-gray-900 outline-none focus:border-black focus:bg-white transition-colors placeholder:text-gray-400"
            placeholder="Ask me anything..."
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="w-9 h-9 rounded-full bg-black flex items-center justify-center disabled:opacity-30 shrink-0 hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Digest Card ──────────────────────────────────────────────────────────────

function DigestCard({ item, onRead }: { item: InboxItem; onRead: () => void }) {
  const count = (item.metadata?.count as number) ?? null
  const isDigest = item.entity_type === "post_batch" && count && count > 1

  return (
    <div
      className={`mx-4 my-2 rounded-xl p-3 flex items-start gap-3 cursor-pointer transition-colors ${
        !item.read_at ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-gray-100"
      }`}
      onClick={onRead}
    >
      <span className="text-2xl shrink-0">{itemIcon(item)}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${!item.read_at ? "font-semibold text-gray-900" : "text-gray-600"}`}>
          {isDigest ? `${count} posts approved today` : (item.preview ?? "New notification")}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">{timeAgo(item.created_at)}</p>
      </div>
      {!item.read_at && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1 shrink-0" />}
    </div>
  )
}

// ─── Detail Screen (system notifications) ────────────────────────────────────

function DetailScreen({ item, onBack }: { item: InboxItem; onBack: () => void }) {
  const labelMap: Record<string, string> = {
    payment: "Payment",
    post: "Post Update",
    post_batch: "Posts Digest",
    campaign: "Campaign",
    job: "Job Offer",
  }
  const label = item.entity_type ? (labelMap[item.entity_type] ?? "Notification") : "Notification"

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-700 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4 bg-gray-50">
        <span className="text-5xl">{itemIcon(item)}</span>
        <p className="text-base font-semibold text-gray-900 text-center leading-snug">
          {item.preview ?? "New notification"}
        </p>
        <p className="text-xs text-gray-400">{timeAgo(item.created_at)}</p>
      </div>
    </div>
  )
}

// ─── Creator Hub Widget ───────────────────────────────────────────────────────

function InboxWidget() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"inbox" | "chat" | "detail">("inbox")
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null)
  const [items, setItems] = useState<InboxItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const loadInbox = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inbox?creatorId=${CREATOR_ID}&limit=50`)
      const data = await res.json()
      setItems(data.items ?? [])
      setUnreadCount(data.unreadCount ?? 0)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && view === "inbox" && items.length === 0) loadInbox()
  }, [open, view, loadInbox, items.length])

  // Supabase Realtime: subscribe to new inbox_items for this creator
  useEffect(() => {
    const channel = supabase
      .channel(`inbox:${CREATOR_ID}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inbox_items",
          filter: `creator_id=eq.${CREATOR_ID}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newItem = payload.new as InboxItem
            setItems((prev) => [newItem, ...prev])
            setUnreadCount((c) => c + 1)
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as InboxItem
            setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
            if (updated.read_at) setUnreadCount((c) => Math.max(0, c - 1))
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase])

  async function markRead(item: InboxItem) {
    if (item.read_at) return
    await fetch(`/api/inbox/${item.id}/read`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorId: CREATOR_ID }),
    })
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)))
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  function handleGroupClick(group: ThreadGroup) {
    markRead(group.item)
    if (group.type === "chat" || group.type === "support") {
      setView("chat")
    } else {
      setSelectedItem(group.item)
      setView("detail")
    }
  }

  function goBack() {
    setView("inbox")
    setSelectedItem(null)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[380px] h-[560px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {view === "chat" ? (
            <SupportChat onClose={goBack} />
          ) : view === "detail" && selectedItem ? (
            <DetailScreen item={selectedItem} onBack={goBack} />
          ) : (
            <>
              {/* Inbox header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Messages</p>
                  {unreadCount > 0 && (
                    <p className="text-xs text-blue-500 font-medium">{unreadCount} unread</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView("chat")}
                    className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-full px-3 py-1 transition-colors"
                  >
                    Support
                  </button>
                  <button onClick={() => setOpen(false)} className="text-gray-300 hover:text-gray-500 transition-colors ml-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Inbox list */}
              <div className="flex-1 overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center h-20 text-gray-400 text-sm">Loading...</div>
                )}
                {!loading && items.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                    <span className="text-3xl">📭</span>
                    <p className="text-sm">No messages yet</p>
                    <p className="text-xs text-gray-300">We'll notify you here when something happens</p>
                  </div>
                )}
                {!loading && groupIntoThreads(items).map((group) =>
                  group.item.entity_type === "post_batch" ? (
                    <DigestCard key={group.key} item={group.item} onRead={() => markRead(group.item)} />
                  ) : (
                    <InboxRow
                      key={group.key}
                      group={group}
                      onClick={() => handleGroupClick(group)}
                    />
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Toggle button with unread badge */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full bg-black shadow-lg flex items-center justify-center hover:bg-gray-800 hover:scale-105 transition-all relative"
      >
        {open ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-white font-sans">
      <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-100">
        <span className="text-xl font-black tracking-tight text-gray-900">8x</span>
        <div className="flex items-center gap-8 text-sm font-medium text-gray-600">
          <a href="#" className="hover:text-gray-900 transition-colors">For Brands</a>
          <a href="#" className="hover:text-gray-900 transition-colors">For Creators</a>
          <a href="#" className="hover:text-gray-900 transition-colors">Blog</a>
        </div>
        <div className="flex items-center gap-4">
          <a href="#" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Log In</a>
          <a href="#" className="text-sm font-semibold bg-black text-white px-4 py-2 rounded-full hover:bg-gray-800 transition-colors">
            Get Started
          </a>
        </div>
      </nav>

      <div className="flex items-center justify-between px-8 pt-16 pb-20 max-w-7xl mx-auto">
        <div className="max-w-xl">
          <span className="inline-block text-xs font-semibold tracking-widest text-gray-500 border border-gray-200 px-3 py-1 rounded-full mb-6 uppercase">
            Managed Creator Network
          </span>
          <h1 className="text-6xl font-black leading-tight text-gray-900 mb-4">
            50k+ creators.<br />
            <span className="text-blue-500">Organic reach.</span><br />
            No ad spend.
          </h1>
          <p className="text-gray-500 text-lg leading-relaxed mb-8">
            Fresh accounts, entertainment-first content, real distribution.
            We handle sourcing, briefing, and management so you get
            millions of organic views without spending a dollar on ads.
          </p>
          <a
            href="#"
            className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-3 rounded-full transition-colors text-sm"
          >
            Get Your Creator Network →
          </a>
        </div>

        <div className="grid grid-cols-3 gap-2 w-[420px] shrink-0">
          {[
            "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=200&h=200&fit=crop",
            "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=200&h=200&fit=crop",
            "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&h=200&fit=crop",
            "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=200&h=200&fit=crop",
            "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=200&h=200&fit=crop",
            "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop",
          ].map((src, i) => (
            <div key={i} className="aspect-square rounded-xl overflow-hidden bg-gray-100">
              <img src={src} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </div>

      <InboxWidget />
    </main>
  )
}
