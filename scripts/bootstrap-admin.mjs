import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
const config = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
    BOOTSTRAP_EMAIL: z.email(),
    BOOTSTRAP_NAME: z.string().min(2).max(120),
    BOOTSTRAP_PASSWORD: z.string().min(12).max(128),
  })
  .safeParse(process.env);
if (!config.success) {
  console.error(
    "Configure URL, SUPABASE_SECRET_KEY e BOOTSTRAP_EMAIL/NAME/PASSWORD (senha com 12+ caracteres).",
  );
  process.exit(1);
}
const env = config.data;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const existing = await db
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("role", "ADMIN");
if (existing.error) {
  console.error(
    "Não foi possível consultar o banco. Aplique as migrations e confira as variáveis.",
  );
  process.exit(1);
}
if (existing.count) {
  console.error("Já existe um ADMIN. Bootstrap recusado.");
  process.exit(1);
}
const products = await db.from("products").select("id").eq("active", true);
if (products.error) {
  console.error("Falha ao consultar o catálogo.");
  process.exit(1);
}
const created = await db.auth.admin.createUser({
  email: env.BOOTSTRAP_EMAIL,
  password: env.BOOTSTRAP_PASSWORD,
  email_confirm: true,
});
if (created.error || !created.data.user) {
  console.error(
    "Não foi possível criar o usuário. Verifique e-mail existente e política de senha.",
  );
  process.exit(1);
}
const provision = await db.rpc("provision_employee", {
  p_profile_id: created.data.user.id,
  p_name: env.BOOTSTRAP_NAME,
  p_email: env.BOOTSTRAP_EMAIL,
  p_phone: "",
  p_products: products.data.map((p) => p.id),
  p_role: "ADMIN",
});
if (provision.error) {
  const rollback = await db.auth.admin.deleteUser(created.data.user.id);
  console.error("Cadastro não concluído.");
  if (rollback.error)
    console.error(
      "Reconcilie manualmente o usuário Auth sem perfil:",
      created.data.user.id,
    );
  process.exit(1);
}
console.log("Administrador criado. Entre pela página /login.");
