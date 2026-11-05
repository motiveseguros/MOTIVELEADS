import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc })),
}));
vi.mock("../src/lib/whatsapp/parsing", { spy: true });
import { createAdminClient } from "../src/lib/supabase/admin";
import { parseWebhook } from "../src/lib/whatsapp/parsing";
import { createMetaWebhookAuthenticator } from "../src/lib/whatsapp/signature";
import { GET, POST } from "../src/app/api/webhooks/whatsapp/route";
import { inboundEvent, webhookPayload } from "./fixtures/whatsapp";

const appSecret = "fictional-app-secret-only-for-tests";
const verifyToken = "different-fictional-get-token";
const url = "http://localhost/api/webhooks/whatsapp";
const result = { inserted: 1, duplicates: 0, statuses: 0 };
const sign = (body: string, key = appSecret) =>
  "sha256=" +
  createHmac("sha256", key).update(Buffer.from(body, "utf8")).digest("hex");
const request = (body: string, signature: string | null = sign(body)) =>
  new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature === null ? {} : { "X-Hub-Signature-256": signature }),
    },
    body,
  });
function expectNoProcessing() {
  expect(parseWebhook).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.stubEnv("WHATSAPP_APP_SECRET", appSecret);
  vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", verifyToken);
  rpc.mockResolvedValue({ data: result, error: null });
  // The real persistence module uses the mocked client; never contact Supabase.
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("HMAC Meta e rota POST real", () => {
  it("confere vetor conhecido HMAC-SHA256 (RFC 4231, caso 2)", async () => {
    const authenticator = createMetaWebhookAuthenticator(() => "Jefe");
    expect(
      await authenticator.verify(
        new TextEncoder().encode("what do ya want for nothing?"),
        new Headers({
          "X-Hub-Signature-256":
            "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        }),
      ),
    ).toBe(true);
  });
  it("assinatura correta passa pelo parser e pela RPC existentes", async () => {
    const response = await POST(request(JSON.stringify(webhookPayload())));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(parseWebhook).toHaveBeenCalledTimes(1);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ingest_whatsapp_events", {
      p_events: [inboundEvent()],
    });
  });
  it.each([
    ["ausente", null],
    ["vazio", ""],
    ["incorreto", "sha256=" + "0".repeat(64)],
    ["algoritmo diferente", "sha1=" + "0".repeat(64)],
    ["prefixo maiúsculo", "SHA256=" + "0".repeat(64)],
    ["hex inválido", "sha256=" + "g".repeat(64)],
    ["hex truncado", "sha256=" + "0".repeat(63)],
    ["hex excedido", "sha256=" + "0".repeat(65)],
    ["digest ausente", "sha256="],
    [
      "headers duplicados",
      "sha256=" + "0".repeat(64) + ", sha256=" + "0".repeat(64),
    ],
  ])("rejeita header %s sem parser ou banco", async (_label, signature) => {
    const response = await POST(
      request(JSON.stringify(webhookPayload()), signature),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Webhook não autenticado.",
    });
    expectNoProcessing();
  });
  it("rejeição ocorre antes até do JSON.parse", async () => {
    const req = request("{invalid-json", null);
    const jsonParse = vi.spyOn(JSON, "parse");
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(jsonParse).not.toHaveBeenCalled();
    expectNoProcessing();
  });
  it.each([undefined, "", " \t\n"])(
    "App Secret ausente/vazio falha fechado: %s",
    async (secret) => {
      vi.stubEnv("WHATSAPP_APP_SECRET", secret);
      const response = await POST(request(JSON.stringify(webhookPayload())));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        message: "Não foi possível autenticar o webhook.",
      });
      expectNoProcessing();
    },
  );
  it("não usa verify token do GET como chave HMAC", async () => {
    const body = JSON.stringify(webhookPayload());
    expect((await POST(request(body, sign(body, verifyToken)))).status).toBe(
      403,
    );
    expectNoProcessing();
  });
  it("alterar exatamente um byte invalida assinatura", async () => {
    const body = JSON.stringify(webhookPayload());
    const bytes = Buffer.from(body);
    bytes[1] ^= 1;
    expect(
      (await POST(request(bytes.toString("utf8"), sign(body)))).status,
    ).toBe(403);
    expectNoProcessing();
  });
  it("JSON equivalente com bytes diferentes não reutiliza assinatura", async () => {
    const compact = JSON.stringify(webhookPayload());
    const spaced = JSON.stringify(webhookPayload(), null, 2);
    expect(JSON.parse(compact)).toEqual(JSON.parse(spaced));
    expect((await POST(request(spaced, sign(compact)))).status).toBe(403);
    expectNoProcessing();
    expect((await POST(request(spaced))).status).toBe(200);
  });
  it("preserva whitespace, unicode e chunks cortados dentro de UTF-8", async () => {
    const body = "  " + JSON.stringify(webhookPayload()) + "\n";
    const bytes = new TextEncoder().encode(body);
    const split = bytes.findIndex((byte) => byte > 127) + 1;
    expect(split).toBeGreaterThan(0);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const req = new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
      },
      body: stream,
      ...{ duplex: "half" },
    });
    expect((await POST(req)).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ingest_whatsapp_events", {
      p_events: [inboundEvent()],
    });
  });
  it("aceita representação hexadecimal maiúscula do mesmo digest", async () => {
    const body = JSON.stringify(webhookPayload());
    expect(
      (await POST(request(body, "sha256=" + sign(body).slice(7).toUpperCase())))
        .status,
    ).toBe(200);
  });
  it.each(["{", "{}"])(
    "payload autenticado mas inválido retorna 400: %s",
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        message: "Payload inválido ou não suportado.",
      });
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("falha na RPC mantém resposta sanitizada", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "private-database-detail" },
    });
    const response = await POST(request(JSON.stringify(webhookPayload())));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-database-detail");
  });
  it("limita o corpo real mesmo sem Content-Length", async () => {
    expect((await POST(request("x".repeat(3 * 1024 * 1024 + 1)))).status).toBe(
      413,
    );
    expectNoProcessing();
  });
  it("limita Content-Length antes de ler o corpo", async () => {
    const req = request("{}");
    req.headers.set("Content-Length", String(3 * 1024 * 1024 + 1));
    expect((await POST(req)).status).toBe(413);
    expectNoProcessing();
  });
  it("Content-Length menor não permite corpo acima do limite", async () => {
    const req = request("x".repeat(3 * 1024 * 1024 + 1));
    req.headers.set("Content-Length", "2");
    expect((await POST(req)).status).toBe(413);
    expectNoProcessing();
  });
  it("GET preserva challenge/200 e token incorreto/403 sem App Secret", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", undefined);
    const valid = await GET(
      new Request(
        url +
          "?hub.mode=subscribe&hub.verify_token=" +
          verifyToken +
          "&hub.challenge=12345",
      ),
    );
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe("12345");
    expect(
      (
        await GET(
          new Request(
            url +
              "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
          ),
        )
      ).status,
    ).toBe(403);
    expectNoProcessing();
  });
  it("não emite secrets, assinaturas ou payload em logs/resposta", async () => {
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    const body = JSON.stringify(webhookPayload());
    const valid = await POST(request(body));
    const invalid = await POST(request(body, "sha256=" + "0".repeat(64)));
    expect(valid.status).toBe(200);
    expect(invalid.status).toBe(403);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    const responseText = (await valid.text()) + (await invalid.text());
    expect(responseText).not.toContain(appSecret);
    expect(responseText).not.toContain(sign(body));
    expect(responseText).not.toContain(body);
  });
});
