import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import {
  MetaWhatsAppProvider,
  createOutboundProvider,
  META_TIMEOUT_MS,
} from "../src/lib/whatsapp/meta-provider";
import {
  runOutboundOnce,
  type OutboundStore,
} from "../src/lib/whatsapp/outbound-worker";
const env = {
  WHATSAPP_OUTBOUND_PROVIDER: "META",
  WHATSAPP_OUTBOUND_EXECUTION_ENABLED: "true",
  WHATSAPP_ACCESS_TOKEN: "FAKE_TEST_ONLY_NOT_A_CREDENTIAL",
  WHATSAPP_GRAPH_API_VERSION: "v27.0",
  WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID: "20001",
};
const input = {
  id: randomUUID(),
  phone_number_id: "20001",
  recipient: "15550000001",
  text_body: "Pergunta fictícia",
};
const accepted = { messages: [{ id: "wamid.FIXTURE_ONLY_001" }] };
function mock(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("META single HTTP boundary", () => {
  it("POST versionado, alvo/body/Bearer internos e ID real da resposta", async () => {
    const f = mock(accepted);
    expect(await new MetaWhatsAppProvider(env).send(input)).toEqual({
      status: "ACCEPTED_META",
      messageId: accepted.messages[0].id,
    });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, options] = f.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v27.0/20001/messages");
    expect(options?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
    });
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.recipient,
      type: "text",
      text: { body: input.text_body, preview_url: false },
    });
  });
  it.each([
    {},
    { messages: [{ id: "wamid.CONTRADICTORY" }], error: { code: 1 } },
    { messages: [] },
    { messages: [{ id: "invalid" }] },
    { messages: [{ id: "wamid.a" }, { id: "wamid.b" }] },
    { messages: [{ id: "wamid." }] },
  ])("2xx sem evidência inequívoca exige reconciliação %j", async (body) => {
    const f = mock(body);
    expect(await new MetaWhatsAppProvider(env).send(input)).toMatchObject({
      code: "PROVIDER_EXCEPTION",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 429, 500, 503])(
    "HTTP %s explícito sem texto arbitrário",
    async (status) => {
      const f = mock(
        {
          error: {
            code: 123,
            error_subcode: 7,
            message: env.WHATSAPP_ACCESS_TOKEN,
            fbtrace_id: "PRIVATE",
          },
        },
        status,
      );
      const r = await new MetaWhatsAppProvider(env).send(input);
      expect(r).toEqual({
        status: "FAILED",
        code:
          status === 429
            ? "RATE_LIMITED"
            : status >= 500
              ? "TEMPORARY_UNAVAILABLE"
              : "PERMANENT_REJECTION",
        httpStatus: status,
        errorCode: 123,
        errorSubcode: 7,
      });
      expect(JSON.stringify(r)).not.toContain(env.WHATSAPP_ACCESS_TOKEN);
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
  it("código explícito de limite prevalece sobre HTTP 400", async () => {
    mock({ error: { code: 130429 } }, 400);
    expect(await new MetaWhatsAppProvider(env).send(input)).toMatchObject({
      code: "RATE_LIMITED",
    });
  });
  it.each([200, 503])("JSON malformado HTTP %s é incerto", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{malformed", { status }),
    );
    expect(await new MetaWhatsAppProvider(env).send(input)).toMatchObject({
      code: "PROVIDER_EXCEPTION",
    });
  });
  it("erro HTTP sem envelope Meta é incerto", async () => {
    mock({ unexpected: true }, 502);
    expect(await new MetaWhatsAppProvider(env).send(input)).toMatchObject({
      code: "PROVIDER_EXCEPTION",
    });
  });
  it.each(["ECONNRESET", "token-in-driver-error"])(
    "exceção %s nunca vaza nem repete POST",
    async (message) => {
      const f = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error(message + env.WHATSAPP_ACCESS_TOKEN));
      const log = vi.spyOn(console, "error");
      expect(await new MetaWhatsAppProvider(env).send(input)).toEqual({
        status: "FAILED",
        code: "NETWORK_UNCERTAIN",
      });
      expect(f).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    },
  );
  it("timeout de 15s aborta POST único", async () => {
    vi.useFakeTimers();
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise(() => {}));
    const p = new MetaWhatsAppProvider(env).send(input);
    await vi.advanceTimersByTimeAsync(META_TIMEOUT_MS);
    expect(await p).toMatchObject({ code: "NETWORK_UNCERTAIN" });
    expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("resposta enorme é limitada mesmo sem content-length", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(65537)),
    );
    expect(await new MetaWhatsAppProvider(env).send(input)).toMatchObject({
      code: "PROVIDER_EXCEPTION",
    });
  });
  it.each(["phone_number_id", "recipient", "text_body"] as const)(
    "entrada %s inválida não usa rede",
    async (key) => {
      const f = mock(accepted);
      expect(
        await new MetaWhatsAppProvider(env).send({ ...input, [key]: "" }),
      ).toMatchObject({ code: "PERMANENT_REJECTION" });
      expect(f).not.toHaveBeenCalled();
    },
  );
  it("outro número não usa rede", async () => {
    const f = mock(accepted);
    await new MetaWhatsAppProvider(env).send({
      ...input,
      phone_number_id: "20002",
    });
    expect(f).not.toHaveBeenCalled();
  });
  it.each(Object.keys(env))("config ausente %s falha fechada", (key) => {
    const e: Record<string, string | undefined> = { ...env };
    delete e[key];
    expect(createOutboundProvider(e).kind).toBe("DISABLED");
  });
  it.each(["v27", "27.0", "v27.0/path"])("versão inválida %s", (version) => {
    expect(
      createOutboundProvider({ ...env, WHATSAPP_GRAPH_API_VERSION: version })
        .kind,
    ).toBe("DISABLED");
  });
});
function workerFixture() {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const claim = { id: input.id, claim_token: randomUUID(), attempts: 1 };
  const store: OutboundStore = {
    metaTarget: vi.fn(async () => true),
    claim: vi.fn(async () => claim),
    begin: vi.fn(async () => input),
    acceptFake: vi.fn(async () => {}),
    acceptMeta: vi.fn(async () => {}),
    failMeta: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  return { store, claim, provider: new MetaWhatsAppProvider(env) };
}
describe("META worker gates", () => {
  it.each([
    "WHATSAPP_OUTBOUND_PROVIDER",
    "WHATSAPP_OUTBOUND_EXECUTION_ENABLED",
  ])("kill switch %s impede claim e HTTP", async (key) => {
    const { store, provider } = workerFixture();
    vi.stubEnv(key, "DISABLED");
    const f = mock(accepted);
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "DISABLED",
    );
    expect(store.claim).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
  it("conta fora do alvo não chega ao claim", async () => {
    const { store, provider } = workerFixture();
    vi.mocked(store.metaTarget).mockResolvedValue(false);
    const f = mock(accepted);
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe("HELD");
    expect(store.claim).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
  it.each(["NULL", "ERROR"])("begin %s impede HTTP", async (state) => {
    const { store, provider } = workerFixture();
    if (state === "NULL") vi.mocked(store.begin).mockResolvedValue(null);
    else vi.mocked(store.begin).mockRejectedValue(new Error("40001"));
    const f = mock(accepted);
    await runOutboundOnce(randomUUID(), store, provider);
    expect(f).not.toHaveBeenCalled();
  });
  it("aceitação chama só acceptMeta após begin", async () => {
    const { store, provider, claim } = workerFixture();
    const f = mock(accepted);
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "RECORDED",
    );
    expect(store.acceptMeta).toHaveBeenCalledWith(
      claim,
      accepted.messages[0].id,
    );
    expect(store.acceptFake).not.toHaveBeenCalled();
    expect(vi.mocked(store.begin).mock.invocationCallOrder[0]).toBeLessThan(
      f.mock.invocationCallOrder[0],
    );
  });
  it("aceitação perdida não reenvia nem registra recusa", async () => {
    const { store, provider } = workerFixture();
    vi.mocked(store.acceptMeta).mockRejectedValue(new Error("commit failed"));
    const f = mock(accepted);
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "RECOVERY_REQUIRED",
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect(store.failMeta).not.toHaveBeenCalled();
  });
  it("recusa usa somente failMeta com evidência sanitizada", async () => {
    const { store, provider, claim } = workerFixture();
    mock({ error: { code: 131047 } }, 400);
    await runOutboundOnce(randomUUID(), store, provider);
    expect(store.failMeta).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        code: "PERMANENT_REJECTION",
        errorCode: 131047,
      }),
    );
    expect(store.fail).not.toHaveBeenCalled();
  });
});

it("timeout também limita leitura do body", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new ReadableStream({ start() {} })),
  );
  const p = new MetaWhatsAppProvider(env).send(input);
  await vi.advanceTimersByTimeAsync(META_TIMEOUT_MS);
  expect(await p).toMatchObject({ code: "NETWORK_UNCERTAIN" });
});
