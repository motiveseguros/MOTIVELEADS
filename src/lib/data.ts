import "server-only";
import { createClient } from "./supabase/server";
import type { LeadStatus } from "@/domain/types";
export async function catalog() {
  const db = await createClient();
  const { data, error } = await db.from("products").select("*").order("name");
  if (error) throw new Error("Falha ao carregar produtos.");
  return data;
}
export async function team() {
  const db = await createClient();
  const [employees, specialties] = await Promise.all([
    db.from("employees").select("*").order("name"),
    db.from("employee_products").select("*"),
  ]);
  if (employees.error || specialties.error)
    throw new Error("Falha ao carregar funcionários.");
  return { employees: employees.data, specialties: specialties.data };
}
export async function listLeads(page: number, status?: LeadStatus, query = "") {
  const db = await createClient();
  let request = db
    .from("leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status) request = request.eq("status", status);
  if (query)
    request = request.ilike("name", "%" + query.replace(/[%_]/g, "") + "%");
  const { data, count, error } = await request.range(
    (page - 1) * 25,
    page * 25 - 1,
  );
  if (error) throw new Error("Falha ao carregar leads.");
  return { leads: data, total: count ?? 0 };
}
export async function metrics() {
  const db = await createClient();
  const statuses = [
    "NEW",
    "ASSIGNED",
    "IN_PROGRESS",
    "CLOSED_WON",
    "CLOSED_LOST",
  ] as const;
  const counts = await Promise.all(
    statuses.map((status) =>
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    ),
  );
  const available = await db
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .eq("availability", "AVAILABLE");
  if (counts.some((r) => r.error) || available.error)
    throw new Error("Falha ao carregar indicadores.");
  return {
    new: counts[0].count ?? 0,
    assigned: counts[1].count ?? 0,
    progress: counts[2].count ?? 0,
    closed: (counts[3].count ?? 0) + (counts[4].count ?? 0),
    available: available.count ?? 0,
  };
}
export async function history(page = 1, leadId?: string) {
  const db = await createClient();
  let request = db
    .from("lead_events")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  if (leadId) request = request.eq("lead_id", leadId);
  const { data, count, error } = await request.range(
    (page - 1) * 25,
    page * 25 - 1,
  );
  if (error) throw new Error("Falha ao carregar histórico.");
  return { events: data, total: count ?? 0 };
}
export function pageNumber(value: string | undefined) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 100000 ? n : 1;
}
