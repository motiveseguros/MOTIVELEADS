import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/domain/validation";
export function result(
  error: PostgrestError | null,
  success = "Alteração salva.",
): ActionState {
  if (error) {
    if (error.code === "P0001" || error.code === "42501")
      return { error: error.message };
    if (error.code === "23505")
      return { error: "Já existe um registro com estes dados." };
    return {
      error: "Não foi possível salvar. Verifique os dados e tente novamente.",
    };
  }
  revalidatePath("/", "layout");
  return { success };
}
