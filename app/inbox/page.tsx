"use client"

import { useState, useCallback, useEffect } from "react"
import { createClient } from "@/utils/supabase/client"
import {
  CREATOR_ID,
  InboxItem,
  ThreadGroup,
  groupIntoThreads,
  InboxRow,
  DigestCard,
  SupportChat,
  DetailScreen,
} from "@/components/inbox/shared"

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState<ThreadGroup | null>(null)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportChatKey, setSupportChatKey] = useState(0)
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

  useEffect(() => { loadInbox() }, [loadInbox])

  // Realtime: per-creator broadcast channel for instant inbox updates
  useEffect(() => {
    const channel = supabase
      .channel(`inbox:${CREATOR_ID}`)
      .on("broadcast", { event: "new_item" }, ({ payload }: { payload: InboxItem }) => {
        setItems((prev) => {
          if (payload.entity_type === "post_batch") {
            const exists = prev.find((i) => i.entity_type === "post_batch" && !i.read_at)
            if (exists) return prev.map((i) => (i.id === exists.id ? payload : i))
          }
          return [payload, ...prev]
        })
        setUnreadCount((c) => c + 1)
      })
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
    setSupportOpen(false)
    setActiveGroup(group)
  }

  const threads = groupIntoThreads(items)

  return (
    <div className="flex h-screen bg-white font-sans">

      {/* ── Left sidebar ────────────────────────────────────── */}
      <aside className="w-80 shrink-0 border-r border-gray-100 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <a href="/" className="text-lg font-black tracking-tight text-gray-900">8x</a>
              <span className="text-gray-300">/</span>
              <h1 className="text-sm font-semibold text-gray-900">Inbox</h1>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <span className="text-xs font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                  {unreadCount} unread
                </span>
              )}
              <button
                onClick={() => { setActiveGroup(null); setSupportChatKey((k) => k + 1); setSupportOpen(true) }}
                className="text-xs font-medium text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-full transition-colors"
              >
                + New Chat
              </button>
            </div>
          </div>
        </div>

        {/* 8x Support entry — always visible */}
        <button
          onClick={() => { setActiveGroup(null); setSupportOpen(true) }}
          className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-gray-100 transition-colors ${supportOpen && !activeGroup ? "bg-blue-50" : "hover:bg-gray-50"}`}
        >
          <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700">8x Support</p>
            <p className="text-xs text-gray-400 truncate mt-0.5">Ask about pay, posts, or your campaign</p>
          </div>
        </button>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-24 text-sm text-gray-400">Loading...</div>
          )}
          {!loading && threads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
              <p className="text-sm">No messages yet</p>
            </div>
          )}
          {!loading && threads.map((group) =>
            group.item.entity_type === "post_batch" ? (
              <DigestCard
                key={group.key}
                item={group.item}
                active={activeGroup?.key === group.key}
                onRead={() => handleGroupClick(group)}
              />
            ) : (
              <InboxRow
                key={group.key}
                group={group}
                active={activeGroup?.key === group.key}
                onClick={() => handleGroupClick(group)}
              />
            )
          )}
        </div>
      </aside>

      {/* ── Right panel ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {supportOpen && !activeGroup ? (
          <SupportChat key={`new-support-${supportChatKey}`} title="8x Support" onClose={() => setSupportOpen(false)} />
        ) : !activeGroup ? (
          <EmptyState />
        ) : activeGroup.type === "support" ? (
          <SupportChat key={activeGroup.key} conversationId={activeGroup.item.thread_id ?? undefined} title="8x Support" onClose={() => { setActiveGroup(null); setSupportOpen(false) }} />
        ) : activeGroup.type === "chat" ? (
          <SupportChat key={activeGroup.key} conversationId={activeGroup.item.thread_id ?? undefined} title={activeGroup.title} senderLabel={activeGroup.title} onClose={() => setActiveGroup(null)} />
        ) : activeGroup.type === "system" || activeGroup.item.entity_type ? (
          <DetailScreen item={activeGroup.item} onBack={() => setActiveGroup(null)} />
        ) : (
          <EmptyState />
        )}
      </main>

    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-gray-50 text-gray-400">
      <p className="text-sm font-medium">Select a thread to view</p>
      <p className="text-xs text-gray-300">Your messages, payments, and campaign updates live here</p>
    </div>
  )
}
