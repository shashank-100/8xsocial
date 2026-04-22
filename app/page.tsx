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

// ─── Inbox Widget (floating, used on marketing page) ─────────────────────────

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
                    <InboxRow key={group.key} group={group} onClick={() => handleGroupClick(group)} />
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}

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

// ─── Marketing page ───────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-white font-sans">
      <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-100">
        <span className="text-xl font-black tracking-tight text-gray-900">8x</span>
        <div className="flex items-center gap-8 text-sm font-medium text-gray-600">
          <a href="#" className="hover:text-gray-900 transition-colors">For Brands</a>
          <a href="#" className="hover:text-gray-900 transition-colors">For Creators</a>
          <a href="/inbox" className="hover:text-gray-900 transition-colors">Inbox</a>
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
            href="/inbox"
            className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-3 rounded-full transition-colors text-sm"
          >
            Go to Creator Inbox →
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
