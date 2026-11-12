import "server-only";
import {
  disabledOutboundProvider,
  type OutboundProvider,
  type DispatchInput,
  type ProviderFailure,
  type ProviderResult,
} from "./outbound-provider";
export interface JobClaim {
  id: string;
  claim_token: string;
  attempts: number;
}
export interface OutboundStore {
  claim(accountId: string): Promise<JobClaim | null>;
  begin(claim: JobClaim): Promise<DispatchInput | null>;
  acceptFake(claim: JobClaim, receipt: string): Promise<void>;
  fail(claim: JobClaim, code: ProviderFailure): Promise<void>;
}
export type WorkerResult =
  "DISABLED" | "IDLE" | "HELD" | "RECORDED" | "RECOVERY_REQUIRED";
/** One attempt, no polling/retry loop. SQL owns leases, fencing and backoff.
 * There is intentionally no route, cron or automatic caller in 03B2A.
 */
export async function runOutboundOnce(
  accountId: string,
  store: OutboundStore,
  provider: OutboundProvider = disabledOutboundProvider,
): Promise<WorkerResult> {
  if (provider.kind === "DISABLED") return "DISABLED";
  if (process.env.NODE_ENV !== "test")
    throw new Error("Provider FAKE restrito aos testes.");
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
  let result: ProviderResult;
  try {
    result = await provider.send(input);
  } catch {
    result = { status: "FAILED", code: "PROVIDER_EXCEPTION" };
  }
  try {
    if (result.status === "ACCEPTED_FAKE")
      await store.acceptFake(claim, result.receipt);
    else await store.fail(claim, result.code);
    return "RECORDED";
  } catch {
    return "RECOVERY_REQUIRED";
  }
}
