"use server";
import { requireActor, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  employeeSchema,
  employeeEditSchema,
  availabilitySchema,
  type ActionState,
} from "@/domain/validation";
import { result } from "@/lib/action-result";
export async function setAvailability(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireActor();
  const p = availabilitySchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Disponibilidade inválida." };
  const db = await createClient();
  return result(
    (
      await db.rpc("set_availability", {
        p_employee_id: p.data.employee_id,
        p_availability: p.data.availability,
      })
    ).error,
  );
}
export async function createEmployee(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const p = employeeSchema.safeParse({
    ...Object.fromEntries(form),
    products: form.getAll("products"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: d.email,
    password: d.password,
    email_confirm: true,
  });
  if (error || !data.user)
    return {
      error:
        "Não foi possível criar o acesso. Verifique se o e-mail já existe e a política de senha.",
    };
  const provision = await admin.rpc("provision_employee", {
    p_profile_id: data.user.id,
    p_name: d.name,
    p_email: d.email,
    p_phone: d.phone,
    p_products: d.products,
    p_role: "AGENT",
  });
  if (provision.error) {
    const rollback = await admin.auth.admin.deleteUser(data.user.id);
    if (rollback.error)
      console.error("Reconciliation required for Auth user", data.user.id);
    return {
      error: "Cadastro não concluído. Verifique os produtos e tente novamente.",
    };
  }
  return result(
    null,
    "Funcionário cadastrado. O acesso já pode ser utilizado.",
  );
}
export async function updateEmployee(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const p = employeeEditSchema.safeParse({
    ...Object.fromEntries(form),
    active: form.get("active") === "on",
    products: form.getAll("products"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const db = await createClient();
  return result(
    (
      await db.rpc("update_employee", {
        p_id: d.id,
        p_name: d.name,
        p_phone: d.phone,
        p_active: d.active,
        p_products: d.products,
      })
    ).error,
  );
}
