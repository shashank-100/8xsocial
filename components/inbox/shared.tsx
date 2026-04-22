"use client"

import { useState, useRef, useEffect } from "react"
import { createClient } from "@/utils/supabase/client"
import {
  Headphones, MessageCircle, Wallet, CheckCircle, Layers,
  ClipboardList, Briefcase, Bell,
} from "lucide-react"

export const CREATOR_ID = "00000000-0000-0000-0000-000000000002"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InboxItem {
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

export interface Message {
  id?: string
  role: "user" | "assistant" | "human"
  content: string
  read_at?: string | null
}

export interface ThreadGroup {
  key: string
  type: InboxItem["type"]
  title: string
  icon: string
  preview: string
  time: string
  unread: number
  item: InboxItem
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ItemIcon({ item }: { item: InboxItem }) {
  const cls = "w-4 h-4"
  if (item.type === "support") return <Headphones className={cls} />
  if (item.type === "chat") return <MessageCircle className={cls} />
  if (item.entity_type === "payment") return <Wallet className={cls} />
  if (item.entity_type === "post") return <CheckCircle className={cls} />
  if (item.entity_type === "post_batch") return <Layers className={cls} />
  if (item.entity_type === "campaign") return <ClipboardList className={cls} />
  if (item.entity_type === "job") return <Briefcase className={cls} />
  return <Bell className={cls} />
}

export function threadTitle(item: InboxItem): string {
  if (item.type === "support") return "8x Support"
  if (item.type === "chat") return (item.metadata?.brand_name as string) ?? "Brand"
  if (item.entity_type === "payment") return "Payment"
  if (item.entity_type === "post") return "Post Update"
  if (item.entity_type === "post_batch") return "Posts"
  if (item.entity_type === "campaign") return "Campaign"
  if (item.entity_type === "job") return "Job Offer"
  return "Notification"
}

export function groupIntoThreads(items: InboxItem[]): ThreadGroup[] {
  const map = new Map<string, ThreadGroup>()
  for (const item of items) {
    const key = item.thread_id ?? item.id
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        key,
        type: item.type,
        title: threadTitle(item),
        icon: "",
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

// ─── InboxRow ─────────────────────────────────────────────────────────────────

export function InboxRow({
  group,
  active,
  onClick,
}: {
  group: ThreadGroup
  active?: boolean
  onClick: () => void
}) {
  const isChat = group.type === "chat" || group.type === "support"
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-gray-100 last:border-0 ${
        active ? "bg-blue-50" : "hover:bg-gray-50"
      }`}
    >
      <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center ${
        isChat ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"
      }`}>
        <ItemIcon item={group.item} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm truncate ${group.unread > 0 ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
            {group.title}
          </p>
          <p className="text-xs text-gray-400 shrink-0">{timeAgo(group.time)}</p>
        </div>
        <p className={`text-xs truncate mt-0.5 ${group.unread > 0 ? "text-gray-700" : "text-gray-400"}`}>
          {isChat ? "" : "System: "}{group.preview}
        </p>
      </div>
      {group.unread > 0 && (
        <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {group.unread > 9 ? "9+" : group.unread}
        </span>
      )}
    </button>
  )
}

// ─── DigestCard ───────────────────────────────────────────────────────────────

export function DigestCard({ item, active, onRead }: { item: InboxItem; active?: boolean; onRead: () => void }) {
  const count = (item.metadata?.count as number) ?? null
  const isDigest = item.entity_type === "post_batch" && count && count > 1
  return (
    <div
      className={`mx-4 my-2 rounded-xl p-3 flex items-start gap-3 cursor-pointer transition-colors ${
        active ? "bg-blue-50 border border-blue-200" :
        !item.read_at ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-gray-100"
      }`}
      onClick={onRead}
    >
      <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
        <ItemIcon item={item} />
      </div>
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

// ─── SupportChat ──────────────────────────────────────────────────────────────

export function SupportChat({ onClose, conversationId: initialConversationId, title, readonly }: { onClose?: () => void; conversationId?: string; title?: string; readonly?: boolean }) {
  const GREETING = "Hey! I'm 8x Support. Ask me anything about your campaign, pay, or posting schedule."
  const isSupport = !readonly
  const [messages, setMessages] = useState<Message[]>(isSupport ? [{ role: "assistant", content: GREETING }] : [])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = createClient()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading, isTyping])

  useEffect(() => {
    if (!conversationId) return
    esRef.current?.close()
    const es = new EventSource(`/api/messages/stream?conversationId=${conversationId}`)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const dbMsgs = (data.messages ?? []) as { id: string; role: string; content: string; read_at: string | null }[]
        const visible = dbMsgs.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "human")
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

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on("broadcast", { event: "typing" }, ({ payload }: { payload: { userId: string; typing: boolean } }) => {
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
    if (conversationId && val.length > 0) {
      const channel = supabase.channel(`typing:${conversationId}`)
      channel.send({ type: "broadcast", event: "typing", payload: { userId: CREATOR_ID, typing: true } })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center">
            <span className="text-white text-xs font-bold">8x</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{title ?? "8x Support"}</p>
            {isSupport && (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <p className="text-xs text-gray-400">Online</p>
              </div>
            )}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            ← Back
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            {msg.role === "human" && (
              <span className="text-xs text-blue-500 font-medium mb-1 px-1">Support Agent</span>
            )}
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-black text-white rounded-br-sm"
                : msg.role === "human"
                ? "bg-blue-50 text-blue-900 rounded-bl-sm shadow-sm border border-blue-100"
                : "bg-white text-gray-800 rounded-bl-sm shadow-sm border border-gray-100"
            }`}>
              {msg.content}
            </div>
            {msg.role === "user" && msg.read_at && (
              <span className="text-xs text-gray-400 mt-0.5 pr-1">✓ Seen</span>
            )}
          </div>
        ))}
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

      {!readonly && (
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
      )}
    </div>
  )
}

// ─── DetailScreen ─────────────────────────────────────────────────────────────

export function DetailScreen({ item, onBack }: { item: InboxItem; onBack?: () => void }) {
  const labelMap: Record<string, string> = {
    payment: "Payment", post: "Post Update", post_batch: "Posts Digest",
    campaign: "Campaign", job: "Job Offer",
  }
  const label = item.entity_type ? (labelMap[item.entity_type] ?? "Notification") : "Notification"
  const count = (item.metadata?.count as number) ?? null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
        {onBack && (
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <p className="text-sm font-semibold text-gray-900">{label}</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4 bg-gray-50">
        <div className="w-12 h-12 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center"><ItemIcon item={item} /></div>
        <p className="text-lg font-semibold text-gray-900 text-center leading-snug">
          {item.entity_type === "post_batch" && count && count > 1
            ? `${count} posts approved today`
            : (item.preview ?? "New notification")}
        </p>
        <p className="text-sm text-gray-400">{timeAgo(item.created_at)}</p>
      </div>
    </div>
  )
}
