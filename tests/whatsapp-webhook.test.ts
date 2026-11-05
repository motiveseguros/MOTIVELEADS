import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/whatsapp/processing", () => ({
  persistWebhookEvents: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getClaims: async () => ({ data: null, error: null }) },
  })),
}));
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { createWebhookHandlers } from "../src/lib/whatsapp/webhook";
import { parseWebhook } from "../src/lib/whatsapp/parsing";
import { sendWhatsAppText } from "../src/lib/whatsapp/sending";
import { GET, POST } from "../src/app/api/webhooks/whatsapp/route";
import { persistWebhookEvents } from "../src/lib/whatsapp/processing";
import { inboundEvent, webhookPayload } from "./fixtures/whatsapp";
const url = "http://localhost/api/webhooks/whatsapp";
const request = (payload: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
function configured() {
  const persist = vi
    .fn()
    .mockResolvedValue({ inserted: 1, duplicates: 0, statuses: 0 });
  const verify = vi.fn().mockResolvedValue(true);
  return {
    persist,
    verify,
    handlers: createWebhookHandlers({
      verifyToken: () => "test-verification-only",
      authenticator: { verify },
      persist,
    }),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("challenge e fronteira HTTP", () => {
  it("GET real sem token configurado retorna 503", async () => {
    vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "");
    expect((await GET(new Request(url))).status).toBe(503);
  });
  it("GET devolve somente challenge com mode/token corretos", async () => {
    vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "test-verification-only");
    const response = await GET(
      new Request(
        url +
          "?hub.mode=subscribe&hub.verify_token=test-verification-only&hub.challenge=12345",
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each([
    "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
    "?hub.mode=unsubscribe&hub.verify_token=test-verification-only&hub.challenge=1",
    "?hub.mode=subscribe&hub.verify_token=test-verification-only",
    "?hub.mode=subscribe&hub.verify_token=test-verification-only&hub.challenge=1&hub.challenge=2",
  ])("challenge inválido é recusado: %s", async (query) => {
    const { handlers } = configured();
    expect((await handlers.GET(new Request(url + query))).status).toBe(403);
  });
  it("POST sem App Secret permanece fechado mesmo configurando token de GET", async () => {
    vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "test-verification-only");
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    expect((await POST(request(webhookPayload()))).status).toBe(503);
    expect(persistWebhookEvents).not.toHaveBeenCalled();
  });
  it("autenticador recebe bytes exatos antes de qualquer transformação", async () => {
    const { handlers, verify, persist } = configured();
    const raw = "  " + JSON.stringify(webhookPayload(), null, 2) + "\n";
    const response = await handlers.POST(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "fixture-only",
        },
        body: raw,
      }),
    );
    expect(response.status).toBe(200);
    expect(verify.mock.calls[0][0]).toEqual(new TextEncoder().encode(raw));
    expect(verify.mock.calls[0][1].get("x-hub-signature-256")).toBe(
      "fixture-only",
    );
    expect(persist).toHaveBeenCalledWith([inboundEvent()]);
  });
  it("assinatura recusada não interpreta JSON nem persiste", async () => {
    const { handlers, verify, persist } = configured();
    verify.mockResolvedValue(false);
    const response = await handlers.POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(response.status).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });
  it("falha do autenticador não libera o processamento", async () => {
    const { handlers, verify, persist } = configured();
    verify.mockRejectedValue(new Error("internal detail"));
    const response = await handlers.POST(request(webhookPayload()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal detail");
    expect(persist).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { object: "unknown" },
    { object: "whatsapp_business_account", entry: [] },
  ])(
    "payload desconhecido/malformado não chama persistência",
    async (payload) => {
      const { handlers, persist } = configured();
      expect((await handlers.POST(request(payload))).status).toBe(400);
      expect(persist).not.toHaveBeenCalled();
    },
  );
  it("JSON malformado não persiste", async () => {
    const { handlers, persist } = configured();
    expect(
      (
        await handlers.POST(
          new Request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });
  it("content-type incorreto e tamanho excedido não autenticam ou persistem", async () => {
    const { handlers, verify, persist } = configured();
    expect(
      (await handlers.POST(new Request(url, { method: "POST", body: "{}" })))
        .status,
    ).toBe(415);
    expect(
      (
        await handlers.POST(
          new Request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "x".repeat(3 * 1024 * 1024 + 1),
          }),
        )
      ).status,
    ).toBe(413);
    expect(verify).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  it("erro de persistência retorna 503 sem detalhes internos", async () => {
    const { handlers, persist } = configured();
    persist.mockRejectedValue(new Error("sensitive database detail"));
    const response = await handlers.POST(request(webhookPayload()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive");
  });
});
describe("parser normalizado", () => {
  it("aceita texto e descarta campos estranhos/secrets e IDs internos", () => {
    const payload = webhookPayload();
    const augmented = {
      ...payload,
      access_token: "fictional-do-not-persist",
      lead_id: "invented",
      actor_id: "invented",
    };
    expect(parseWebhook(augmented)).toEqual([inboundEvent()]);
  });
  it("parseia callbacks sem depender da ordem de entrega", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "10001",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "20001" },
                statuses: [
                  {
                    id: "wamid.out",
                    status: "read",
                    timestamp: "1793066400",
                    recipient_id: "15550000001",
                  },
                  {
                    id: "wamid.out",
                    status: "sent",
                    timestamp: "1793066300",
                    recipient_id: "15550000001",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(
      parseWebhook(payload).map((e) => (e.kind === "status" ? e.status : null)),
    ).toEqual(["READ", "SENT"]);
  });
  it("recusa todo lote se uma mensagem não for texto", () => {
    const payload = webhookPayload();
    payload.entry[0].changes[0].value.messages.push({
      ...payload.entry[0].changes[0].value.messages[0],
      id: "wamid.bad",
      type: "image",
    });
    expect(() => parseWebhook(payload)).toThrow();
  });
  it("contato deve corresponder ao remetente e não pode ser ambíguo", () => {
    const payload = webhookPayload();
    payload.entry[0].changes[0].value.contacts[0].wa_id = "other";
    expect(() => parseWebhook(payload)).toThrow("divergente");
    const duplicate = webhookPayload();
    duplicate.entry[0].changes[0].value.contacts.push(
      duplicate.entry[0].changes[0].value.contacts[0],
    );
    expect(() => parseWebhook(duplicate)).toThrow("ambíguos");
  });
  it("limita timestamps e quantidade total de eventos", () => {
    const payload = webhookPayload();
    payload.entry[0].changes[0].value.messages[0].timestamp = "999999999999";
    expect(() => parseWebhook(payload)).toThrow();
    const big = webhookPayload();
    big.entry = Array.from({ length: 2 }, () => ({
      ...big.entry[0],
      changes: Array.from({ length: 51 }, () => big.entry[0].changes[0]),
    }));
    expect(() => parseWebhook(big)).toThrow("limite");
  });
});
describe("contrato de envio", () => {
  it("sem provider lança erro; nunca simula envio", async () => {
    await expect(
      sendWhatsAppText({
        phoneNumberId: "20001",
        recipientWaId: "15550000001",
        text: "teste",
      }),
    ).rejects.toThrow("não configurado");
  });
  it("adapter de teste recebe entrada validada e retorna ID externo", async () => {
    const sendText = vi
      .fn()
      .mockResolvedValue({ externalMessageId: "wamid.fixture" });
    expect(
      await sendWhatsAppText(
        { phoneNumberId: "20001", recipientWaId: "15550000001", text: "teste" },
        { sendText },
      ),
    ).toEqual({ externalMessageId: "wamid.fixture" });
    await expect(
      sendWhatsAppText(
        {
          phoneNumberId: "invalid",
          recipientWaId: "15550000001",
          text: "teste",
        },
        { sendText },
      ),
    ).rejects.toThrow();
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});

describe("limite de sessão no proxy", () => {
  it("somente rota exata do webhook ignora sessão; painel segue protegido", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "test-public-placeholder",
    );
    const webhook = await proxy(new NextRequest(url));
    expect(webhook.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
    const panel = await proxy(
      new NextRequest("http://localhost/conversations"),
    );
    expect(panel.status).toBe(307);
    expect(panel.headers.get("location")).toBe("http://localhost/login");
    const unrelated = await proxy(new NextRequest(url + "-other"));
    expect(unrelated.status).toBe(307);
  });
});
