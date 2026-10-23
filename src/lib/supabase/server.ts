import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { publicConfig } from "./config";
export async function createClient() {
  const jar = await cookies();
  const { url, key } = publicConfig();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server Components cannot set cookies; proxy refreshes them. */
        }
      },
    },
  });
}
