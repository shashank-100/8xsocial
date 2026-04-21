import { supabaseAdmin } from "@/lib/supabase/admin"

export type Role = "user" | "assistant" | "human"
export type ConversationStatus = "open" | "resolved" | "escalated"

export async function findOrCreateConversation(
  creatorId: string,
  conversationId?: string
) {
  if (conversationId) {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single()
    if (data) return data
  }

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .insert({ creator_id: creatorId, status: "open", escalated: false })
    .select()
    .single()

  if (error) throw new Error(`Failed to create conversation: ${error.message}`)
  return data
}

export async function pinCampaign(conversationId: string, campaignId: string) {
  const { error } = await supabaseAdmin
    .from("conversations")
    .update({ campaign_id: campaignId })
    .eq("id", conversationId)

  if (error) throw new Error(`Failed to pin campaign: ${error.message}`)
}

export async function saveMessage(
  conversationId: string,
  role: Role,
  content: string
) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single()

  if (error) throw new Error(`Failed to save message: ${error.message}`)
  return data
}

export async function tagEscalated(conversationId: string, slackThreadTs?: string | null) {
  const { error } = await supabaseAdmin
    .from("conversations")
    .update({
      escalated: true,
      status: "escalated",
      ...(slackThreadTs ? { slack_thread_ts: slackThreadTs } : {}),
    })
    .eq("id", conversationId)

  if (error) throw new Error(`Failed to tag escalated: ${error.message}`)
}

export async function resolveConversation(conversationId: string) {
  const { error } = await supabaseAdmin
    .from("conversations")
    .update({ status: "resolved", escalated: false })
    .eq("id", conversationId)

  if (error) throw new Error(`Failed to resolve conversation: ${error.message}`)
}

export async function findConversationBySlackThread(threadTs: string) {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("slack_thread_ts", threadTs)
    .single()
  return data
}

export async function getMessages(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`)
  return data
}

// Returns prior messages formatted for LLM context (excludes current message)
export async function getHistory(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"]) // exclude human agent messages from LLM context
    .order("created_at", { ascending: true })
    .limit(5) // cap to last 5 messages to control token cost

  if (error) throw new Error(`Failed to fetch history: ${error.message}`)
  return (data ?? []) as { role: "user" | "assistant"; content: string }[]
}
