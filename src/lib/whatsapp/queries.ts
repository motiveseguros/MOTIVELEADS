import "server-only";
import { createClient } from "../supabase/server";
/** Always use the user session here. The secret client must never serve the inbox. */
export async function listConversations(page: number) {
  const db = await createClient();
  const { data, count, error } = await db
    .from("conversation_inbox")
    .select("*", { count: "exact" })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id")
    .range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error("Falha ao carregar conversas.");
  return { conversations: data, total: count ?? 0 };
}
export async function conversationDetail(id: string, page: number) {
  const db = await createClient();
  const { data: conversation, error } = await db
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Falha ao carregar conversa.");
  if (!conversation) return null;
  const [contact, messages] = await Promise.all([
    db
      .from("contacts")
      .select("*")
      .eq("id", conversation.contact_id)
      .maybeSingle(),
    db
      .from("messages")
      .select("*", { count: "exact" })
      .eq("conversation_id", id)
      .order("provider_timestamp", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * 25, page * 25 - 1),
  ]);
  if (contact.error || messages.error)
    throw new Error("Falha ao carregar mensagens.");
  // A transfer may revoke visibility between these requests. Never return cached contact data.
  if (!contact.data) return null;
  return {
    conversation,
    contact: contact.data,
    messages: messages.data,
    total: messages.count ?? 0,
  };
}
