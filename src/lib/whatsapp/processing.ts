import "server-only";
import { createAdminClient } from "../supabase/admin";
import { z } from "zod";
import type { NormalizedEvent, ProcessingResult } from "./contracts";
const resultSchema = z.object({
  inserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  statuses: z.number().int().nonnegative(),
});
/** Trusted server entry point, after raw-body authenticity verification. The RPC owns the transaction. */
export async function persistWebhookEvents(
  events: NormalizedEvent[],
): Promise<ProcessingResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("ingest_whatsapp_events", {
    p_events: events.map((event) => ({ ...event })),
  });
  if (error) throw new Error("Não foi possível processar o webhook.");
  return resultSchema.parse(data);
}
