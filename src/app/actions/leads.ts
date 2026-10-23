"use server";
import { redirect } from "next/navigation";
import { requireActor, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  leadSchema,
  assignmentSchema,
  transitionSchema,
  type ActionState,
} from "@/domain/validation";
import { result } from "@/lib/action-result";
export async function createLead(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const p = leadSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("create_lead", {
    p_name: d.name,
    p_phone: d.phone,
    p_email: d.email,
    p_city: d.city,
    p_state: d.state,
    p_product_id: d.product_id,
    p_notes: d.notes,
  });
  if (error) return result(error);
  result(null);
  redirect("/leads/" + data);
}
export async function assignLead(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const p = assignmentSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Selecione um funcionário compatível." };
  const db = await createClient();
  return result(
    (
      await db.rpc("assign_lead", {
        p_lead_id: p.data.lead_id,
        p_employee_id: p.data.employee_id,
        p_expected_employee_id: p.data.expected_employee_id || null,
      })
    ).error,
    "Responsável atualizado e histórico registrado.",
  );
}
export async function transitionLead(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireActor();
  const p = transitionSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Status inválido." };
  const db = await createClient();
  return result(
    (
      await db.rpc("transition_lead", {
        p_lead_id: p.data.lead_id,
        p_status: p.data.status,
        p_expected_status: p.data.expected_status,
      })
    ).error,
    "Status atualizado e histórico registrado.",
  );
}
