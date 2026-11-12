import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { Actor } from "../src/domain/types";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/whatsapp/intake", () => ({
  intakeDetail: vi.fn(async () => null),
}));
vi.mock("../src/lib/auth", () => ({ requireActor: vi.fn() }));
vi.mock("../src/lib/data", () => ({ catalog: vi.fn(), pageNumber: () => 1 }));
vi.mock("../src/lib/whatsapp/queries", () => ({ conversationDetail: vi.fn() }));
vi.mock("../src/app/actions/conversations", () => ({
  convertConversation: vi.fn(),
}));
vi.mock("../src/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement("form", null, children, createElement("button", null, label)),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error("REDIRECT " + url);
  },
}));
import { requireActor } from "../src/lib/auth";
import { catalog } from "../src/lib/data";
import { conversationDetail } from "../src/lib/whatsapp/queries";
import ConvertConversation from "../src/app/(panel)/conversations/[id]/convert/page";
import ConversationDetail from "../src/app/(panel)/conversations/[id]/page";

const id = randomUUID(),
  contactId = randomUUID(),
  accountId = randomUUID(),
  productId = randomUUID();
const time = "2026-11-06T12:00:00Z";
const actor: Actor = {
  profile: { id: randomUUID(), role: "ADMIN", created_at: time },
  employee: {
    id: randomUUID(),
    profile_id: randomUUID(),
    name: "Admin fictício",
    email: "teste@example.com",
    phone: "",
    availability: "AVAILABLE",
    active: true,
    created_at: time,
    updated_at: time,
  },
};
const detail = {
  conversation: {
    id,
    whatsapp_account_id: accountId,
    contact_id: contactId,
    lead_id: null,
    status: "OPEN" as const,
    last_message_at: time,
    created_at: time,
    updated_at: time,
  },
  contact: {
    id: contactId,
    whatsapp_account_id: accountId,
    wa_id: "15550000001",
    phone: "+15550000001",
    display_name: "Cliente fictício",
    email: "teste@example.com",
    city: "Cidade",
    state: "SP",
    created_at: time,
    updated_at: time,
  },
  messages: [],
  total: 0,
};
const params = Promise.resolve({ id });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActor).mockResolvedValue(actor);
  vi.mocked(conversationDetail).mockResolvedValue(detail);
  vi.mocked(catalog).mockResolvedValue([
    { id: productId, name: "Produto ativo", active: true, created_at: time },
    {
      id: randomUUID(),
      name: "Produto inativo",
      active: false,
      created_at: time,
    },
  ]);
});
describe("Fase 03A: interface de conversão", () => {
  it("ADMIN recebe campos preenchidos, produto ativo e explicação do próximo passo", async () => {
    const html = renderToStaticMarkup(await ConvertConversation({ params }));
    for (const value of [
      "Cliente fictício",
      "+15550000001",
      "teste@example.com",
      "Cidade",
      "SP",
      "Produto ativo",
      "Observações",
      "Criar lead e vincular conversa",
      "escolha o responsável",
      id,
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("Produto inativo");
    expect(html).not.toContain('name="lead_id"');
  });
  it("sem produto ativo não oferece submissão", async () => {
    vi.mocked(catalog).mockResolvedValue([]);
    const html = renderToStaticMarkup(await ConvertConversation({ params }));
    expect(html).toContain("Cadastre um produto ativo");
    expect(html).not.toContain("<form");
  });
  it("AGENT não abre formulário nem consulta dados da conversa", async () => {
    vi.mocked(requireActor).mockResolvedValue({
      ...actor,
      profile: { ...actor.profile, role: "AGENT" },
    });
    await expect(ConvertConversation({ params })).rejects.toThrow("NOT_FOUND");
    expect(conversationDetail).not.toHaveBeenCalled();
  });
  it("conversa já convertida abre o lead existente", async () => {
    const lead = randomUUID();
    vi.mocked(conversationDetail).mockResolvedValue({
      ...detail,
      conversation: { ...detail.conversation, lead_id: lead },
    });
    await expect(ConvertConversation({ params })).rejects.toThrow(
      "REDIRECT /leads/" + lead,
    );
  });
  it.each(["closed", "missing", "invalid_id"])(
    "não oferece conversão para %s",
    async (reason) => {
      if (reason === "closed")
        vi.mocked(conversationDetail).mockResolvedValue({
          ...detail,
          conversation: { ...detail.conversation, status: "CLOSED" },
        });
      if (reason === "missing")
        vi.mocked(conversationDetail).mockResolvedValue(null);
      await expect(
        ConvertConversation({
          params:
            reason === "invalid_id"
              ? Promise.resolve({ id: "invalid" })
              : params,
        }),
      ).rejects.toThrow("NOT_FOUND");
    },
  );
  it.each(["admin", "agent", "closed", "linked"])(
    "entrada para conversão respeita estado %s",
    async (state) => {
      if (state === "agent")
        vi.mocked(requireActor).mockResolvedValue({
          ...actor,
          profile: { ...actor.profile, role: "AGENT" },
        });
      if (state === "closed")
        vi.mocked(conversationDetail).mockResolvedValue({
          ...detail,
          conversation: { ...detail.conversation, status: "CLOSED" },
        });
      if (state === "linked")
        vi.mocked(conversationDetail).mockResolvedValue({
          ...detail,
          conversation: { ...detail.conversation, lead_id: randomUUID() },
        });
      const html = renderToStaticMarkup(
        await ConversationDetail({ params, searchParams: Promise.resolve({}) }),
      );
      expect(html.includes("/convert")).toBe(state === "admin");
    },
  );
});
