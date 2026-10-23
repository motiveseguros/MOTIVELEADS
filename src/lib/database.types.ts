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
      profiles: Table<Profile>;
      employees: Table<Employee>;
      products: Table<Product>;
      employee_products: Table<EmployeeProduct>;
      leads: Table<Lead>;
      lead_events: Table<LeadEvent>;
    };
    Views: Record<string, never>;
    Functions: {
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
      app_role: Role;
      availability: Availability;
      lead_status: LeadStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
