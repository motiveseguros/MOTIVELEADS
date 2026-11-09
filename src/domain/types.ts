export type Role = "ADMIN" | "AGENT";
export const availabilityValues = [
  "AVAILABLE",
  "BUSY",
  "AWAY",
  "OFFLINE",
] as const;
export type Availability = (typeof availabilityValues)[number];
export const statusValues = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;
export type LeadStatus = (typeof statusValues)[number];
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export interface Profile {
  id: string;
  role: Role;
  created_at: string;
}
export interface Employee {
  id: string;
  profile_id: string;
  name: string;
  email: string;
  phone: string;
  availability: Availability;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export interface Product {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}
export interface EmployeeProduct {
  employee_id: string;
  product_id: string;
}
export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  product_id: string;
  notes: string;
  status: LeadStatus;
  assigned_employee_id: string | null;
  assigned_at: string | null;
}
export interface LeadEvent {
  id: string;
  lead_id: string;
  actor_id: string;
  action: string;
  data: Json;
  created_at: string;
}
export interface Actor {
  profile: Profile;
  employee: Employee;
}
export const statusLabels: Record<LeadStatus, string> = {
  NEW: "Novo",
  ASSIGNED: "Distribuído",
  IN_PROGRESS: "Em atendimento",
  CLOSED_WON: "Ganho",
  CLOSED_LOST: "Perdido",
};
export const availabilityLabels: Record<Availability, string> = {
  AVAILABLE: "Disponível",
  BUSY: "Ocupado",
  AWAY: "Ausente",
  OFFLINE: "Offline",
};
export const eventLabels: Record<string, string> = {
  CREATED: "Lead criado",
  CONVERTED_FROM_CONVERSATION: "Conversa convertida em lead",
  ASSIGNED: "Lead atribuído",
  TRANSFERRED: "Lead transferido",
  STARTED: "Atendimento iniciado",
  FINISHED: "Atendimento finalizado",
  STATUS_CHANGED: "Status alterado",
};
