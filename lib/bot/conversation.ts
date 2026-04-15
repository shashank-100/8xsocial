import { supabaseAdmin } from "@/lib/supabase/admin"

export type Role = "user" | "assistant"
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

export async function tagEscalated(conversationId: string) {
  const { error } = await supabaseAdmin
    .from("conversations")
    .update({ escalated: true, status: "escalated" })
    .eq("id", conversationId)

  if (error) throw new Error(`Failed to tag escalated: ${error.message}`)
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
