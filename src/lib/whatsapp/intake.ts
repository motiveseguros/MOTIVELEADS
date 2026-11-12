import "server-only";
import { createClient } from "../supabase/server";

/** Session client only; SQL policies restrict sessions/drafts to active ADMIN. */
export async function intakeDetail(conversationId: string) {
  const db = await createClient();
  const { data: session, error } = await db
    .from("whatsapp_intake_sessions")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw new Error("Falha ao carregar coleta automática.");
  if (!session) return null;
  const [product, draft] = await Promise.all([
    session.product_id
      ? db
          .from("products")
          .select("name")
          .eq("id", session.product_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("whatsapp_outbound_drafts")
      .select("*")
      .eq("session_id", session.id)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (product.error || draft.error)
    throw new Error("Falha ao carregar coleta automática.");
  return {
    session,
    productName: product.data?.name ?? null,
    draft: draft.data,
  };
}
