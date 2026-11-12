import { outboundDetail } from "../src/lib/whatsapp/outbound-queries";
vi.mock("../src/lib/whatsapp/outbound-queries", () => ({
  outboundDetail: vi.fn(async () => ({ config: null, job: null })),
}));
import { beforeEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type {
  IntakeSession,
  OutboundDraft,
} from "../src/domain/whatsapp-intake";
import { WhatsAppIntakePanel } from "../src/components/whatsapp-intake-panel";
import { HistoryList } from "../src/components/history-list";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/auth", () => ({
  requireActor: vi.fn(async () => ({ profile: { role: "ADMIN" } })),
}));
vi.mock("../src/lib/whatsapp/queries", () => ({ conversationDetail: vi.fn() }));
vi.mock("../src/lib/whatsapp/intake", () => ({ intakeDetail: vi.fn() }));
import { disabledIntakeTransport } from "../src/lib/whatsapp/intake-transport";
import { requireActor } from "../src/lib/auth";
import { intakeDetail } from "../src/lib/whatsapp/intake";
import { conversationDetail } from "../src/lib/whatsapp/queries";
import Page from "../src/app/(panel)/conversations/[id]/page";
const id = randomUUID(),
  time = "2026-11-11T12:00:00Z";
const session: IntakeSession = {
  id: randomUUID(),
  conversation_id: id,
  status: "ACTIVE",
  current_step: "NAME",
  name: null,
  product_id: null,
  city: null,
  state: null,
  email: null,
  supplemental_notes: null,
  created_at: time,
  updated_at: time,
  completed_at: null,
};
const draft: OutboundDraft = {
  id: randomUUID(),
  sequence: 1,
  session_id: session.id,
  in_reply_to_message_id: randomUUID(),
  text_body: "Qual é o seu nome?",
  status: "DRAFT",
  created_at: time,
};
beforeEach(() => vi.clearAllMocks());
describe("03B1: painel ADMIN e transporte desligado", () => {
  it("mostra etapa, campos pendentes e resposta claramente não enviada", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsAppIntakePanel, {
        session,
        productName: null,
        draft,
        leadId: null,
      }),
    );
    for (const text of [
      "Coleta automática",
      "Etapa atual: Nome",
      "Pendente",
      "não enviada",
      "envio automático está desativado",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });
  it("escapa dados coletados e rascunhos", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsAppIntakePanel, {
        session: { ...session, name: "<script>teste</script>" },
        productName: null,
        draft: { ...draft, text_body: "<img src=x onerror=alert(1)>" },
        leadId: null,
      }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>");
  });
  it("COMPLETE mostra conclusão, dados e link para o mesmo lead", () => {
    const leadId = randomUUID();
    const html = renderToStaticMarkup(
      createElement(WhatsAppIntakePanel, {
        session: {
          ...session,
          status: "COMPLETE",
          current_step: "COMPLETE",
          name: "Ana Teste",
          city: "Vitória",
          state: "ES",
          email: "teste@example.com",
          completed_at: time,
        },
        productName: "Consórcio",
        draft,
        leadId,
      }),
    );
    for (const text of [
      "Coleta concluída",
      "Ana Teste",
      "Vitória / ES",
      "Nenhuma",
      "/leads/" + leadId,
    ])
      expect(html).toContain(text);
  });
  it("vínculo manual interrompe visualmente coleta antiga sem mostrar resposta como próxima ação", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsAppIntakePanel, {
        session,
        productName: null,
        draft,
        leadId: randomUUID(),
      }),
    );
    expect(html).toContain("Coleta interrompida");
    expect(html).not.toContain("Resposta preparada");
  });
  it("AGENT não consulta nem renderiza intake", async () => {
    vi.mocked(requireActor).mockResolvedValueOnce({
      profile: { id, role: "AGENT", created_at: time },
      employee: {
        id,
        profile_id: id,
        name: "Agente teste",
        email: "agente@example.com",
        phone: "",
        availability: "AVAILABLE",
        active: true,
        created_at: time,
        updated_at: time,
      },
    });
    vi.mocked(conversationDetail).mockResolvedValueOnce({
      conversation: {
        id,
        whatsapp_account_id: id,
        contact_id: id,
        lead_id: id,
        status: "OPEN",
        last_message_at: time,
        created_at: time,
        updated_at: time,
      },
      contact: {
        id,
        whatsapp_account_id: id,
        wa_id: "15550000001",
        phone: "+15550000001",
        display_name: "Teste",
        email: null,
        city: null,
        state: null,
        created_at: time,
        updated_at: time,
      },
      messages: [],
      total: 0,
    });
    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ id }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(intakeDetail).not.toHaveBeenCalled();
    expect(outboundDetail).not.toHaveBeenCalled();
    expect(html).not.toContain("Transporte");
    expect(html).not.toContain("Coleta automática");
  });
  it("histórico automático identifica sistema sem fingir ADMIN", () => {
    const html = renderToStaticMarkup(
      createElement(HistoryList, {
        employees: [],
        events: [
          {
            id: randomUUID(),
            lead_id: id,
            actor_id: null,
            action: "CONVERTED_FROM_WHATSAPP_INTAKE",
            created_at: time,
            data: {
              source: "WHATSAPP_INTAKE",
              actor_name: "Coleta automática WhatsApp",
              conversation_id: id,
              status: "NEW",
            },
          },
        ],
      }),
    );
    expect(html).toContain("Coleta automática WhatsApp");
    expect(html).toContain("Lead criado pela coleta WhatsApp");
    expect(html).toContain("/conversations/" + id);
  });
  it("transporte não chama rede nem simula sucesso de envio", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    try {
      expect(await disabledIntakeTransport.dispatch(draft)).toEqual({
        status: "DISABLED",
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});
