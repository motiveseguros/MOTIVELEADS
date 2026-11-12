import "server-only";
import type { TransportFailure } from "@/domain/whatsapp-outbound";
/** Only failures known NOT to have been accepted may be retried. Unknown results are reconciled. */
export type ProviderFailure = Exclude<
  TransportFailure,
  "LEASE_EXPIRED" | "ATTEMPTS_EXHAUSTED"
>;
export interface DispatchInput {
  id: string;
  text_body: string;
  recipient: string;
}
export type ProviderResult =
  | { status: "ACCEPTED_FAKE"; receipt: string }
  | { status: "FAILED"; code: ProviderFailure };
export type OutboundProvider =
  | { kind: "DISABLED" }
  | { kind: "FAKE"; send(input: DispatchInput): Promise<ProviderResult> };
/** The only application provider. FAKE implementations exist in tests, never a deployed factory. */
export const disabledOutboundProvider: OutboundProvider = { kind: "DISABLED" };
