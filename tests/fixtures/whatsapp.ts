import type { InboundEvent } from "../../src/lib/whatsapp/contracts";
export function inboundEvent(
  overrides: Partial<InboundEvent> = {},
): InboundEvent {
  return {
    kind: "inbound",
    waba_id: "10001",
    phone_number_id: "20001",
    wa_id: "15550000001",
    external_message_id: "wamid.test.1",
    provider_timestamp: "1793066400",
    display_name: "Contato de teste",
    type: "text",
    text_body: "Olá, preciso de informações.",
    ...overrides,
  };
}
export function webhookPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "10001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                phone_number_id: "20001",
                display_phone_number: "15550000000",
              },
              contacts: [
                { wa_id: "15550000001", profile: { name: "Contato de teste" } },
              ],
              messages: [
                {
                  from: "15550000001",
                  id: "wamid.test.1",
                  timestamp: "1793066400",
                  type: "text",
                  text: { body: "Olá, preciso de informações." },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
