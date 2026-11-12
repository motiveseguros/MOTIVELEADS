export type IntakeStatus = "ACTIVE" | "COMPLETE" | "CANCELLED";
export type IntakeStep =
  "NAME" | "PRODUCT" | "LOCATION" | "EMAIL" | "SUPPLEMENTAL" | "COMPLETE";
export interface IntakeSession {
  id: string;
  conversation_id: string;
  status: IntakeStatus;
  current_step: IntakeStep;
  name: string | null;
  product_id: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  supplemental_notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
export interface IntakeTurn {
  message_id: string;
  session_id: string;
  step_before: IntakeStep;
  step_after: IntakeStep;
  outcome: "STARTED" | "ACCEPTED" | "INVALID" | "BLOCKED" | "COMPLETE";
  created_at: string;
}
export interface OutboundDraft {
  id: string;
  sequence: number;
  session_id: string;
  in_reply_to_message_id: string;
  text_body: string;
  status: "DRAFT";
  created_at: string;
}
export const intakeStepLabels: Record<IntakeStep, string> = {
  NAME: "Nome",
  PRODUCT: "Produto",
  LOCATION: "Localidade",
  EMAIL: "E-mail",
  SUPPLEMENTAL: "Informações adicionais",
  COMPLETE: "Concluída",
};
