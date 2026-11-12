vi.mock("../src/lib/whatsapp/outbound-queries", () => ({
  outboundDetail: vi.fn(async () => ({ config: null, job: null })),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/whatsapp/intake", () => ({
  intakeDetail: vi.fn(async () => null),
}));
vi.mock("../src/lib/auth", () => ({
  requireActor: vi.fn(async () => ({ profile: { role: "ADMIN" } })),
}));
vi.mock("../src/lib/whatsapp/queries", () => ({
  listConversations: vi.fn(),
  conversationDetail: vi.fn(),
}));
import {
  listConversations,
  conversationDetail,
} from "../src/lib/whatsapp/queries";
import Conversations from "../src/app/(panel)/conversations/page";
import ConversationDetail from "../src/app/(panel)/conversations/[id]/page";
const id = randomUUID(),
  contactId = randomUUID(),
  accountId = randomUUID();
const time = "2026-10-27T12:00:00Z";
const conversation = {
  id,
  whatsapp_account_id: accountId,
  contact_id: contactId,
  lead_id: null,
  status: "OPEN" as const,
  last_message_at: time,
  created_at: time,
  updated_at: time,
};
const contact = {
  id: contactId,
  whatsapp_account_id: accountId,
  wa_id: "15550000001",
  phone: "+15550000001",
  display_name: "Contato fictício",
  email: null,
  city: null,
  state: null,
  created_at: time,
  updated_at: time,
};
const message = {
  id: randomUUID(),
  conversation_id: id,
  external_message_id: "wamid.fixture",
  direction: "INBOUND" as const,
  type: "text",
  text_body: "<script>alert('example')</script>",
  status: "RECEIVED" as const,
  sent_by_profile_id: null,
  provider_timestamp: time,
  created_at: time,
  updated_at: time,
};
beforeEach(() => vi.clearAllMocks());
describe("conversas: renderização de leitura", () => {
  it("listagem mostra contato/telefone/prévia/horário e ausência de lead", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [
        {
          ...conversation,
          contact_name: contact.display_name,
          contact_phone: contact.phone,
          wa_id: contact.wa_id,
          last_message_text: "Mensagem de teste",
          last_message_type: "text",
        },
      ],
      total: 1,
    });
    const html = renderToStaticMarkup(
      await Conversations({ searchParams: Promise.resolve({}) }),
    );
    for (const text of [
      "Contato fictício",
      "+15550000001",
      "Mensagem de teste",
      "27/10/2026",
      "Ainda não convertido em lead",
      "/conversations/" + id,
    ])
      expect(html).toContain(text);
  });
  it("listagem vazia é explícita", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [],
      total: 0,
    });
    expect(
      renderToStaticMarkup(
        await Conversations({ searchParams: Promise.resolve({}) }),
      ),
    ).toContain("Nenhuma conversa disponível");
  });
  it("detalhe escapa conteúdo externo e não expõe formulário de envio", async () => {
    vi.mocked(conversationDetail).mockResolvedValue({
      conversation,
      contact,
      messages: [message],
      total: 1,
    });
    const html = renderToStaticMarkup(
      await ConversationDetail({
        params: Promise.resolve({ id }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("Ainda não convertido em lead");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<form");
  });
  it("detalhe mostra vínculo existente com lead", async () => {
    const leadId = randomUUID();
    vi.mocked(conversationDetail).mockResolvedValue({
      conversation: { ...conversation, lead_id: leadId },
      contact,
      messages: [],
      total: 0,
    });
    const html = renderToStaticMarkup(
      await ConversationDetail({
        params: Promise.resolve({ id }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("/leads/" + leadId);
    expect(html).not.toContain("Ainda não convertido em lead");
  });
});
