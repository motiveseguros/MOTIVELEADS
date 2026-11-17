import "server-only";
import {
  disabledOutboundProvider,
  type OutboundProvider,
  type DispatchInput,
  type ProviderFailure,
  type ProviderResult,
} from "./outbound-provider";
import { metaExecutionConfig } from "./meta-provider";
import type { MetaFailureEvidence } from "./outbound-provider";
export interface JobClaim {
  id: string;
  claim_token: string;
  attempts: number;
}
export interface OutboundStore {
  metaTarget(accountId: string, phoneNumberId: string): Promise<boolean>;
  claim(accountId: string): Promise<JobClaim | null>;
  begin(claim: JobClaim): Promise<DispatchInput | null>;
  acceptFake(claim: JobClaim, receipt: string): Promise<void>;
  acceptMeta(claim: JobClaim, messageId: string): Promise<void>;
  failMeta(claim: JobClaim, evidence: MetaFailureEvidence): Promise<void>;
  fail(claim: JobClaim, code: ProviderFailure): Promise<void>;
}
export type WorkerResult =
  "DISABLED" | "IDLE" | "HELD" | "RECORDED" | "RECOVERY_REQUIRED";
/** One attempt, no polling/retry loop. SQL owns validity, ordering, leases and pre-dispatch recovery.
 * No route, cron or automatic caller. Explicit execution and META configuration are mandatory.
 */
export async function runOutboundOnce(
  accountId: string,
  store: OutboundStore,
  provider: OutboundProvider = disabledOutboundProvider,
): Promise<WorkerResult> {
  if (provider.kind === "DISABLED") return "DISABLED";
  if (provider.kind === "FAKE" && process.env.NODE_ENV !== "test")
    throw new Error("Provider FAKE restrito aos testes.");
  const metaConfig = provider.kind === "META" ? metaExecutionConfig() : null;
  if (provider.kind === "META" && !metaConfig) return "DISABLED";
  if (
    metaConfig &&
    !(await store.metaTarget(
      accountId,
      metaConfig.WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID,
    ))
  )
    return "HELD";
  const claim = await store.claim(accountId);
  if (!claim) return "IDLE";
  // A lost DB response is ambiguous; leave the lease for explicit recovery, never send on uncertainty.
  let input: DispatchInput | null;
  try {
    input = await store.begin(claim);
  } catch {
    return "RECOVERY_REQUIRED";
  }
  if (!input) return "HELD";
  if (
    provider.kind === "META" &&
    input.phone_number_id !==
      metaConfig?.WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID
  )
    return "RECOVERY_REQUIRED";
  let result: ProviderResult;
  try {
    result = await provider.send(input);
  } catch {
    result = { status: "FAILED", code: "PROVIDER_EXCEPTION" };
  }
  try {
    if (provider.kind === "META") {
      if (result.status === "ACCEPTED_META")
        await store.acceptMeta(claim, result.messageId);
      else if (result.status === "FAILED") await store.failMeta(claim, result);
      else return "RECOVERY_REQUIRED";
    } else if (result.status === "ACCEPTED_FAKE")
      await store.acceptFake(claim, result.receipt);
    else if (result.status === "FAILED") await store.fail(claim, result.code);
    else return "RECOVERY_REQUIRED";
    return "RECORDED";
  } catch {
    return "RECOVERY_REQUIRED";
  }
}
