import "server-only";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import type { OutboundStore } from "./outbound-worker";
const claimSchema = z.object({
  id: z.uuid(),
  claim_token: z.uuid(),
  attempts: z.number().int().min(1).max(5),
});
const dispatchSchema = z.object({
  id: z.uuid(),
  text_body: z.string(),
  recipient: z.string(),
});
/** Technical RPCs only; no direct writes, payload overrides or raw database errors. */
export function createOutboundStore(): OutboundStore {
  const db = createAdminClient();
  return {
    async claim(accountId) {
      const { data, error } = await db.rpc("claim_whatsapp_outbound_job", {
        p_account_id: accountId,
      });
      if (error) throw new Error("Falha ao reivindicar job.");
      return data === null ? null : claimSchema.parse(data);
    },
    async begin(claim) {
      const { data, error } = await db.rpc("begin_whatsapp_outbound_dispatch", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
      });
      if (error) throw new Error("Falha ao iniciar tentativa.");
      return data === null ? null : dispatchSchema.parse(data);
    },
    async acceptFake(claim, receipt) {
      const { error } = await db.rpc("accept_fake_whatsapp_outbound", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
        p_receipt: receipt,
      });
      if (error) throw new Error("Falha ao registrar resultado simulado.");
    },
    async fail(claim, code) {
      const { error } = await db.rpc("fail_whatsapp_outbound_job", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
        p_failure: code,
      });
      if (error) throw new Error("Falha ao registrar categoria da tentativa.");
    },
  };
}
