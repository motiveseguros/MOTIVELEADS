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
  phone_number_id: z.string().regex(/^[0-9]{1,64}$/),
});
/** Technical RPCs only; no direct writes, payload overrides or raw database errors. */
export function createOutboundStore(): OutboundStore {
  const db = createAdminClient();
  return {
    async metaTarget(accountId, phoneNumberId) {
      const { data, error } = await db.rpc("whatsapp_meta_target", {
        p_account_id: accountId,
        p_phone_number_id: phoneNumberId,
      });
      if (error) throw new Error("Conta de envio não validada.");
      return data === true;
    },
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
    async acceptMeta(claim, messageId) {
      const { error } = await db.rpc("accept_meta_whatsapp_outbound", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
        p_external_message_id: messageId,
      });
      if (error) throw new Error("Aceitação Meta exige reconciliação.");
    },
    async failMeta(claim, evidence) {
      const { error } = await db.rpc("fail_meta_whatsapp_outbound_job", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
        p_failure: evidence.code,
        p_http_status: evidence.httpStatus ?? null,
        p_error_code: evidence.errorCode ?? null,
        p_error_subcode: evidence.errorSubcode ?? null,
      });
      if (error) throw new Error("Falha Meta exige reconciliação.");
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
