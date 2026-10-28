import "server-only";
export interface EventIdentity {
  waba_id: string;
  phone_number_id: string;
  external_message_id: string;
  /** Unix seconds from the provider, validated before persistence. */
  provider_timestamp: string;
  wa_id: string;
}
export interface InboundEvent extends EventIdentity {
  kind: "inbound";
  display_name: string | null;
  type: "text";
  text_body: string;
}
export interface StatusEvent extends EventIdentity {
  kind: "status";
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
}
export type NormalizedEvent = InboundEvent | StatusEvent;
export interface ProcessingResult {
  inserted: number;
  duplicates: number;
  statuses: number;
}
/** Implement against the official signature contract before enabling the public POST. */
export interface WebhookAuthenticator {
  verify(rawBody: Uint8Array, headers: Headers): Promise<boolean>;
}
export interface SendTextInput {
  phoneNumberId: string;
  recipientWaId: string;
  text: string;
}
export interface SendTextResult {
  externalMessageId: string;
}
/** Server-side provider adapter; accepting a request is not proof of delivery. */
export interface WhatsAppProvider {
  sendText(input: SendTextInput): Promise<SendTextResult>;
}
