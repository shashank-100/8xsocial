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
            {unreadCount > 0 && (
              <span className="text-xs font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                {unreadCount} unread
              </span>
            )}
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-24 text-sm text-gray-400">Loading...</div>
          )}
          {!loading && threads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
              <span className="text-3xl">📭</span>
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
        {!activeGroup ? (
          <EmptyState />
        ) : activeGroup.type === "support" ? (
          <SupportChat />
        ) : activeGroup.type === "system" || activeGroup.item.entity_type ? (
          <DetailScreen item={activeGroup.item} />
        ) : (
          <EmptyState />
        )}
      </main>

    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-gray-50 text-gray-400">
      <span className="text-5xl">💬</span>
      <p className="text-sm font-medium">Select a thread to view</p>
      <p className="text-xs text-gray-300">Your messages, payments, and campaign updates live here</p>
    </div>
  )
}
