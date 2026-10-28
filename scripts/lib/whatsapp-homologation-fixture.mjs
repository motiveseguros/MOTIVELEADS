// Fictional, stable identifiers. Never accept overrides from CLI or inbound input.
export const accountFixture = Object.freeze({
  id: "4d4f5449-5645-4000-8000-00000000002a",
  name: "MOTIVE HOMOLOGACAO",
  waba_id: "00000000000000000000000000000002",
  phone_number_id: "00000000000000000000000000000003",
  display_phone_number: "+000000000000",
  active: true,
});
export const inboundFixture = Object.freeze({
  kind: "inbound",
  waba_id: accountFixture.waba_id,
  phone_number_id: accountFixture.phone_number_id,
  external_message_id: "wamid.MOTIVE_HOMOLOGACAO.FASE02A.v1",
  provider_timestamp: "1793102400",
  wa_id: "motive-homologacao-fase02a",
  display_name: "Cliente Homologacao",
  type: "text",
  text_body: "Olá, gostaria de informações sobre consórcio.",
});
export const fixtureEventKey =
  "message:" + accountFixture.id + ":" + inboundFixture.external_message_id;
export const fixtureTimestamp = "2026-10-27T12:00:00.000Z";

export class HomologationError extends Error {}
export function requireSafe(
  condition,
  message = "Fixture divergente ou dados adicionais encontrados; operação recusada.",
) {
  if (!condition) throw new HomologationError(message);
}
