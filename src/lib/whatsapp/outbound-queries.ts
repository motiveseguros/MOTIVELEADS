import "server-only";
import { createClient } from "../supabase/server";
/** Session client with ADMIN RLS; never use the technical secret for observability. */
export async function outboundDetail(
  conversationId: string,
  accountId: string,
) {
  const db = await createClient();
  const [config, job] = await Promise.all([
    db
      .from("whatsapp_outbound_transport_config")
      .select("*")
      .eq("whatsapp_account_id", accountId)
      .maybeSingle(),
    db
      .from("whatsapp_outbound_jobs")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(1)
      .maybeSingle(),
  ]);
  if (config.error || job.error)
    throw new Error("Falha ao carregar diagnóstico do transporte.");
  return { config: config.data, job: job.data };
}
