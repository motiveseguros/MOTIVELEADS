export type TransportMode = "DISABLED" | "LIVE";
export type JobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "ACCEPTED"
  | "FAILED"
  | "CANCELLED"
  | "RECONCILIATION_REQUIRED";
export type TransportFailure =
  | "RATE_LIMITED"
  | "TEMPORARY_UNAVAILABLE"
  | "PERMANENT_REJECTION"
  | "NETWORK_UNCERTAIN"
  | "PROVIDER_EXCEPTION"
  | "LEASE_EXPIRED"
  | "ATTEMPTS_EXHAUSTED";
export interface TransportConfig {
  whatsapp_account_id: string;
  mode: TransportMode;
  generation: number;
  activated_at: string | null;
  activation_draft_sequence: number | null;
  updated_at: string;
}
export interface OutboundJob {
  id: string;
  draft_id: string;
  whatsapp_account_id: string;
  conversation_id: string;
  contact_id: string;
  activation_generation: number;
  status: JobStatus;
  attempts: number;
  available_at: string;
  locked_at: string | null;
  lease_expires_at: string | null;
  claim_token: string | null;
  dispatch_started_at: string | null;
  provider_kind: "FAKE" | null;
  provider_message_id: string | null;
  last_error_code: TransportFailure | null;
  created_at: string;
  updated_at: string;
}
export interface OutboundEvent {
  id: string;
  whatsapp_account_id: string;
  job_id: string | null;
  actor_id: string | null;
  action:
    | "ACTIVATED"
    | "DISABLED"
    | "ENQUEUED"
    | "CLAIMED"
    | "DISPATCH_STARTED"
    | "ACCEPTED_FAKE"
    | "RETRY_SCHEDULED"
    | "FAILED"
    | "UNCERTAIN"
    | "RECOVERED_BEFORE_DISPATCH"
    | "CANCELLED";
  generation: number;
  draft_boundary: number | null;
  attempt: number | null;
  error_code: TransportFailure | null;
  created_at: string;
}
export const jobStatusLabels: Record<JobStatus, string> = {
  QUEUED: "Na fila",
  PROCESSING: "Em processamento",
  ACCEPTED: "Aceito em simulação · não enviado à Meta",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  RECONCILIATION_REQUIRED: "Reconciliação necessária",
};
export const transportFailureLabels: Record<TransportFailure, string> = {
  RATE_LIMITED: "Limite de tentativas do provider",
  TEMPORARY_UNAVAILABLE: "Provider temporariamente indisponível",
  PERMANENT_REJECTION: "Recusa permanente",
  NETWORK_UNCERTAIN: "Resultado de rede incerto",
  PROVIDER_EXCEPTION: "Resultado do provider desconhecido",
  LEASE_EXPIRED: "Prazo da tentativa expirado",
  ATTEMPTS_EXHAUSTED: "Limite de tentativas atingido",
};
