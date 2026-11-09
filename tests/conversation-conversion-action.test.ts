import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("../src/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT " + url);
  },
}));
import { convertConversation } from "../src/app/actions/conversations";
const conversationId = randomUUID(),
  productId = randomUUID(),
  leadId = randomUUID();
function form() {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    conversation_id: conversationId,
    name: " Cliente fictício ",
    phone: "+15550000001",
    email: "",
    city: "",
    state: "sp",
    product_id: productId,
    notes: "Notas",
  }))
    result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: leadId, error: null });
});
describe("Fase 03A: ação de servidor", () => {
  it("envia somente os campos permitidos em uma RPC e abre o lead", async () => {
    const data = form();
    data.set("lead_id", randomUUID());
    data.set("assigned_employee_id", randomUUID());
    data.set("actor_id", randomUUID());
    await expect(convertConversation({}, data)).rejects.toThrow(
      "REDIRECT /leads/" + leadId,
    );
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "convert_conversation_to_lead",
      {
        p_conversation_id: conversationId,
        p_name: "Cliente fictício",
        p_phone: "+15550000001",
        p_email: "",
        p_city: "",
        p_state: "SP",
        p_product_id: productId,
        p_notes: "Notas",
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("sem autorização não cria cliente nem chama RPC", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Acesso negado"));
    await expect(convertConversation({}, form())).rejects.toThrow(
      "Acesso negado",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["conversation_id", "product_id", "phone", "name"])(
    "entrada inválida em %s não chama RPC",
    async (key) => {
      const data = form();
      data.set(key, "");
      expect(await convertConversation({}, data)).toHaveProperty("error");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("erro inesperado do banco é sanitizado", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "internal fixture detail" },
    });
    expect(await convertConversation({}, form())).toEqual({
      error: "Não foi possível salvar. Verifique os dados e tente novamente.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("recusa resposta sem ID", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await convertConversation({}, form())).toEqual({
      error: "Não foi possível concluir a conversão.",
    });
  });
});
