import "server-only";
import type { TransportFailure } from "@/domain/whatsapp-outbound";
export type ProviderFailure = Exclude<
  TransportFailure,
  "LEASE_EXPIRED" | "ATTEMPTS_EXHAUSTED"
>;
export interface DispatchInput {
  id: string;
  text_body: string;
  recipient: string;
  phone_number_id?: string;
}
export interface MetaFailureEvidence {
  code: ProviderFailure;
  httpStatus?: number;
  errorCode?: number;
  errorSubcode?: number;
}
export type ProviderResult =
  | { status: "ACCEPTED_FAKE"; receipt: string }
  | { status: "ACCEPTED_META"; messageId: string }
  | ({ status: "FAILED" } & MetaFailureEvidence);
export type OutboundProvider =
  | { kind: "DISABLED" }
  | {
      kind: "FAKE" | "META";
      send(input: DispatchInput): Promise<ProviderResult>;
    };
export const disabledOutboundProvider: OutboundProvider = { kind: "DISABLED" };
