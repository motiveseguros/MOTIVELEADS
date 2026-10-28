import type { Json } from "./types";
export type ConversationStatus = "OPEN" | "CLOSED";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageStatus =
  "RECEIVED" | "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
export interface WhatsAppAccount {
  id: string;
  name: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export interface Contact {
  id: string;
  whatsapp_account_id: string;
  wa_id: string;
  phone: string | null;
  display_name: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
  updated_at: string;
}
export interface Conversation {
  id: string;
  whatsapp_account_id: string;
  contact_id: string;
  lead_id: string | null;
  status: ConversationStatus;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Message {
  id: string;
  conversation_id: string;
  external_message_id: string | null;
  direction: MessageDirection;
  type: string;
  text_body: string | null;
  status: MessageStatus;
  sent_by_profile_id: string | null;
  provider_timestamp: string | null;
  created_at: string;
  updated_at: string;
}
export interface WebhookEvent {
  id: string;
  provider: "WHATSAPP";
  event_key: string;
  payload: Json;
  received_at: string;
  processed_at: string | null;
  processing_error: string | null;
}
export const messageStatusLabels: Record<MessageStatus, string> = {
  RECEIVED: "Recebida",
  PENDING: "Pendente",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falhou",
};

export interface ConversationInbox extends Conversation {
  contact_name: string | null;
  contact_phone: string | null;
  wa_id: string;
  last_message_text: string | null;
  last_message_type: string | null;
}
