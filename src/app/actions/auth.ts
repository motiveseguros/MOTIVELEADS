"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, type ActionState } from "@/domain/validation";
export async function login(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Informe e-mail e senha válidos." };
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error)
    return {
      error:
        "Não foi possível entrar. Verifique suas credenciais e tente novamente.",
    };
  redirect("/");
}
export async function logout() {
  const db = await createClient();
  await db.auth.signOut();
  redirect("/login");
}
