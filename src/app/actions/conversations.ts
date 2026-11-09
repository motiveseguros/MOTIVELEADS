"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { result } from "@/lib/action-result";
import { conversionSchema, type ActionState } from "@/domain/validation";

export async function convertConversation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = conversionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc("convert_conversation_to_lead", {
    p_conversation_id: d.conversation_id,
    p_name: d.name,
    p_phone: d.phone,
    p_email: d.email,
    p_city: d.city,
    p_state: d.state,
    p_product_id: d.product_id,
    p_notes: d.notes,
  });
  if (error) return result(error);
  if (!data) return { error: "Não foi possível concluir a conversão." };
  result(null);
  redirect("/leads/" + data);
}
