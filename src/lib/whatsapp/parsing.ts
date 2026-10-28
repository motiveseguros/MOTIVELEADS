import "server-only";
import { z } from "zod";
import type { NormalizedEvent } from "./contracts";
const providerId = z.string().regex(/^[0-9]{1,64}$/);
const waId = z.string().min(1).max(128);
const externalId = z.string().min(1).max(256);
const timestamp = z
  .string()
  .regex(/^[0-9]{1,12}$/)
  .refine((v) => Number(v) <= 253402300799);
const inbound = z.object({
  from: waId,
  id: externalId,
  timestamp,
  type: z.literal("text"),
  text: z.object({ body: z.string().min(1).max(10000) }),
});
const status = z.object({
  id: externalId,
  recipient_id: waId,
  timestamp,
  status: z.enum(["sent", "delivered", "read", "failed"]),
});
const value = z
  .object({
    messaging_product: z.literal("whatsapp"),
    metadata: z.object({ phone_number_id: providerId }),
    contacts: z
      .array(
        z.object({
          wa_id: waId,
          profile: z.object({ name: z.string().max(120) }).optional(),
        }),
      )
      .max(100)
      .optional(),
    messages: z.array(inbound).min(1).max(100).optional(),
    statuses: z.array(status).min(1).max(100).optional(),
  })
  .refine((v) => Boolean(v.messages?.length || v.statuses?.length));
const envelope = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        id: providerId,
        changes: z
          .array(z.object({ field: z.literal("messages"), value }))
          .min(1)
          .max(100),
      }),
    )
    .min(1)
    .max(100),
});
const statuses = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
} as const;
/** Whitelist normalized fields; never persist raw headers, tokens or arbitrary payload fields. */
export function parseWebhook(payload: unknown): NormalizedEvent[] {
  const parsed = envelope.parse(payload);
  const events: NormalizedEvent[] = [];
  for (const entry of parsed.entry)
    for (const change of entry.changes) {
      const v = change.value;
      const contacts = v.contacts ?? [];
      if (new Set(contacts.map((c) => c.wa_id)).size !== contacts.length)
        throw new Error("Contatos ambíguos no webhook.");
      const identity = {
        waba_id: entry.id,
        phone_number_id: v.metadata.phone_number_id,
      };
      for (const message of v.messages ?? []) {
        const contact = contacts.find((c) => c.wa_id === message.from);
        if (contacts.length && !contact)
          throw new Error("Remetente divergente do contato.");
        events.push({
          ...identity,
          kind: "inbound",
          wa_id: message.from,
          external_message_id: message.id,
          provider_timestamp: message.timestamp,
          display_name: contact?.profile?.name ?? null,
          type: "text",
          text_body: message.text.body,
        });
      }
      for (const update of v.statuses ?? [])
        events.push({
          ...identity,
          kind: "status",
          wa_id: update.recipient_id,
          external_message_id: update.id,
          provider_timestamp: update.timestamp,
          status: statuses[update.status],
        });
      if (events.length > 100)
        throw new Error("Lote de webhook excede o limite.");
    }
  return events;
}
