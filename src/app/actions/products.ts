"use server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { productSchema, type ActionState } from "@/domain/validation";
import { result } from "@/lib/action-result";
export async function saveProduct(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const p = productSchema.safeParse({
    ...Object.fromEntries(form),
    active: form.get("active") === "on",
  });
  if (!p.success) return { error: p.error.issues[0].message };
  const db = await createClient();
  return result(
    (
      await db.rpc("save_product", {
        p_id: p.data.id || null,
        p_name: p.data.name,
        p_active: p.data.active,
      })
    ).error,
  );
}
