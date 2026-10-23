import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { isConfigured } from "./supabase/config";
import type { Actor } from "@/domain/types";
export const requireActor = cache(async (): Promise<Actor> => {
  if (!isConfigured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const [{ data: profile }, { data: employee }] = await Promise.all([
    db.from("profiles").select("*").eq("id", user.id).single(),
    db.from("employees").select("*").eq("profile_id", user.id).single(),
  ]);
  if (!profile || !employee?.active) redirect("/login?disabled=1");
  return { profile, employee };
});
export async function requireAdmin() {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN")
    throw new Error("Acesso administrativo necessário.");
  return actor;
}
