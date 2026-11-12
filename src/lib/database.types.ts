import type {
  TransportMode,
  JobStatus,
  TransportFailure,
  TransportConfig,
  OutboundJob,
  OutboundEvent,
} from "@/domain/whatsapp-outbound";
import type {
  ConversationInbox,
  WhatsAppAccount,
  Contact,
  Conversation,
  Message,
  WebhookEvent,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
} from "@/domain/whatsapp";
import type { Json } from "@/domain/types";
import type {
  IntakeSession,
  IntakeTurn,
  OutboundDraft,
  IntakeStatus,
  IntakeStep,
} from "@/domain/whatsapp-intake";
import type {
  Profile,
  Employee,
  Product,
  EmployeeProduct,
  Lead,
  LeadEvent,
  Role,
  Availability,
  LeadStatus,
} from "@/domain/types";
type Table<T> = {
  Row: { [K in keyof T]: T[K] };
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};
type Fn<A, R> = { Args: A; Returns: R };
export interface Database {
  public: {
    Tables: {
      whatsapp_outbound_transport_config: Table<TransportConfig>;
      whatsapp_outbound_jobs: Table<OutboundJob>;
      whatsapp_outbound_events: Table<OutboundEvent>;
      whatsapp_intake_sessions: Table<IntakeSession>;
      whatsapp_intake_turns: Table<IntakeTurn>;
      whatsapp_outbound_drafts: Table<OutboundDraft>;
      whatsapp_accounts: Table<WhatsAppAccount>;
      contacts: Table<Contact>;
      conversations: Table<Conversation>;
      messages: Table<Message>;
      webhook_events: Table<WebhookEvent>;
      profiles: Table<Profile>;
      employees: Table<Employee>;
      products: Table<Product>;
      employee_products: Table<EmployeeProduct>;
      leads: Table<Lead>;
      lead_events: Table<LeadEvent>;
    };
    Views: {
      conversation_inbox: {
        Row: { [K in keyof ConversationInbox]: ConversationInbox[K] };
        Relationships: [];
      };
    };
    Functions: {
      set_whatsapp_outbound_transport: Fn<
        { p_account_id: string; p_mode: TransportMode },
        TransportConfig
      >;
      cancel_whatsapp_outbound_job: Fn<{ p_job_id: string }, undefined>;
      claim_whatsapp_outbound_job: Fn<{ p_account_id: string }, Json>;
      begin_whatsapp_outbound_dispatch: Fn<
        { p_job_id: string; p_claim_token: string },
        Json
      >;
      accept_fake_whatsapp_outbound: Fn<
        { p_job_id: string; p_claim_token: string; p_receipt: string },
        undefined
      >;
      fail_whatsapp_outbound_job: Fn<
        {
          p_job_id: string;
          p_claim_token: string;
          p_failure: TransportFailure;
        },
        undefined
      >;
      recover_whatsapp_outbound_job: Fn<{ p_job_id: string }, JobStatus>;
      ingest_whatsapp_events: Fn<{ p_events: Json }, Json>;
      convert_conversation_to_lead: Fn<
        {
          p_conversation_id: string;
          p_name: string;
          p_phone: string;
          p_email: string;
          p_city: string;
          p_state: string;
          p_product_id: string;
          p_notes: string;
        },
        string
      >;
      create_lead: Fn<
        {
          p_name: string;
          p_phone: string;
          p_email: string;
          p_city: string;
          p_state: string;
          p_product_id: string;
          p_notes: string;
        },
        string
      >;
      assign_lead: Fn<
        {
          p_lead_id: string;
          p_employee_id: string;
          p_expected_employee_id: string | null;
        },
        undefined
      >;
      transition_lead: Fn<
        {
          p_lead_id: string;
          p_status: LeadStatus;
          p_expected_status: LeadStatus;
        },
        undefined
      >;
      set_availability: Fn<
        { p_employee_id: string; p_availability: Availability },
        undefined
      >;
      provision_employee: Fn<
        {
          p_profile_id: string;
          p_name: string;
          p_email: string;
          p_phone: string;
          p_products: string[];
          p_role: Role;
        },
        string
      >;
      update_employee: Fn<
        {
          p_id: string;
          p_name: string;
          p_phone: string;
          p_active: boolean;
          p_products: string[];
        },
        undefined
      >;
      save_product: Fn<
        { p_id: string | null; p_name: string; p_active: boolean },
        string
      >;
    };
    Enums: {
      whatsapp_transport_mode: TransportMode;
      whatsapp_job_status: JobStatus;
      whatsapp_transport_failure: TransportFailure;
      whatsapp_intake_status: IntakeStatus;
      whatsapp_intake_step: IntakeStep;
      conversation_status: ConversationStatus;
      message_direction: MessageDirection;
      message_status: MessageStatus;
      app_role: Role;
      availability: Availability;
      lead_status: LeadStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
