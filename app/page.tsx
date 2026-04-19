"use client"

import { useState, useRef, useEffect } from "react"

const CREATOR_ID = "00000000-0000-0000-0000-000000000002"

interface Message {
  role: "user" | "assistant" | "human"
  content: string
}

const GREETING = "Hey! I'm 8x Support. Ask me anything about your campaign, pay, or posting schedule."

function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: GREETING }])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading, open])

  // SSE stream — tied to conversationId lifecycle, replaces polling
  useEffect(() => {
    if (!conversationId) return

    // Close any existing connection before opening a new one
    esRef.current?.close()

    const es = new EventSource(`/api/messages/stream?conversationId=${conversationId}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const dbMsgs = (data.messages ?? []) as { role: string; content: string }[]
        const visible = dbMsgs.filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "human"
        )

        setMessages([
          { role: "assistant", content: GREETING },
          ...visible.map((m) => ({ role: m.role as Message["role"], content: m.content })),
        ])

        // Clear spinner when bot or human agent replied
        if (visible.length > prevCountRef.current) {
          const last = visible[visible.length - 1]
          if (last?.role === "assistant" || last?.role === "human") {
            setLoading(false)
          }
          prevCountRef.current = visible.length
        }
      } catch {
        // ignore parse errors
      }
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [conversationId])

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
      // Background poll handles all message display + clears loading
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }])
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Chat window */}
      {open && (
        <div className="w-[360px] h-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center">
                <span className="text-white text-xs font-bold tracking-tight">8x</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">8x Support</p>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  <p className="text-xs text-gray-400">Online</p>
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-300 hover:text-gray-500 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
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
              </div>
            ))}
            {loading && (
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
          <div className="px-3 py-3 border-t border-gray-100 bg-white">
            <div className="flex gap-2 items-center">
              <input
                className="flex-1 px-4 py-2 rounded-full border border-gray-200 bg-gray-50 text-sm text-gray-900 outline-none focus:border-black focus:bg-white transition-colors placeholder:text-gray-400"
                placeholder="Ask me anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
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
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full bg-black shadow-lg flex items-center justify-center hover:bg-gray-800 hover:scale-105 transition-all"
      >
        {open ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>
    </div>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-white font-sans">
      {/* Nav */}
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

      {/* Hero */}
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

        {/* Grid of creator images */}
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

      <ChatWidget />
    </main>
  )
}
