import { afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import {
  runOutboundOnce,
  type OutboundStore,
} from "../src/lib/whatsapp/outbound-worker";
import type { OutboundProvider } from "../src/lib/whatsapp/outbound-provider";
const claim = { id: randomUUID(), claim_token: randomUUID(), attempts: 1 };
const input = {
  id: claim.id,
  text_body: "Pergunta fictícia",
  recipient: "15550000001",
};
function fixtures() {
  const store: OutboundStore = {
    claim: vi.fn(async () => claim),
    begin: vi.fn(async () => input),
    acceptFake: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  const send = vi.fn(async () => ({
    status: "ACCEPTED_FAKE" as const,
    receipt: randomUUID(),
  }));
  const provider: OutboundProvider = { kind: "FAKE", send };
  return { store, provider, send };
}
afterEach(() => vi.unstubAllEnvs());
describe("03B2A worker isolado", () => {
  it("DISABLED não reivindica, inicializa tentativa nem usa rede", async () => {
    const { store } = fixtures();
    const network = vi.spyOn(globalThis, "fetch");
    try {
      expect(await runOutboundOnce(randomUUID(), store)).toBe("DISABLED");
      expect(store.claim).not.toHaveBeenCalled();
      expect(store.begin).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it.each(["production", "development"])(
    "FAKE recusado fora de test: %s",
    async (env) => {
      vi.stubEnv("NODE_ENV", env);
      const { store, provider, send } = fixtures();
      await expect(
        runOutboundOnce(randomUUID(), store, provider),
      ).rejects.toThrow("restrito");
      expect(store.claim).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("sem job não chama provider", async () => {
    const { store, provider, send } = fixtures();
    vi.mocked(store.claim).mockResolvedValue(null);
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe("IDLE");
    expect(send).not.toHaveBeenCalled();
  });
  it("begin bloqueado por desativação não chama provider", async () => {
    const { store, provider, send } = fixtures();
    vi.mocked(store.begin).mockResolvedValue(null);
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe("HELD");
    expect(send).not.toHaveBeenCalled();
  });
  it("begin com resposta perdida nunca permite send", async () => {
    const { store, provider, send } = fixtures();
    vi.mocked(store.begin).mockRejectedValue(new Error("fixture"));
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "RECOVERY_REQUIRED",
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("claim → begin → fake → registro respeita ordem e token", async () => {
    const { store, provider, send } = fixtures();
    const receipt = randomUUID();
    send.mockResolvedValue({ status: "ACCEPTED_FAKE", receipt });
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "RECORDED",
    );
    expect(store.begin).toHaveBeenCalledWith(claim);
    expect(send).toHaveBeenCalledWith(input);
    expect(store.acceptFake).toHaveBeenCalledWith(claim, receipt);
    expect(vi.mocked(store.begin).mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.acceptFake).mock.invocationCallOrder[0],
    );
  });
  it("exceção do provider vira categoria incerta, sem body/erro bruto", async () => {
    const { store, provider, send } = fixtures();
    send.mockRejectedValue(new Error("private fixture provider response"));
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "RECORDED",
    );
    expect(store.fail).toHaveBeenCalledWith(claim, "PROVIDER_EXCEPTION");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("falha de commit após aceitação não repete envio", async () => {
    const { store, provider, send } = fixtures();
    vi.mocked(store.acceptFake).mockRejectedValue(new Error("fixture"));
    expect(await runOutboundOnce(randomUUID(), store, provider)).toBe(
      "RECOVERY_REQUIRED",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.fail).not.toHaveBeenCalled();
  });
  it("resultado transitório é entregue ao SQL sem loop local", async () => {
    const { store } = fixtures();
    const send = vi.fn(async () => ({
      status: "FAILED" as const,
      code: "RATE_LIMITED" as const,
    }));
    expect(
      await runOutboundOnce(randomUUID(), store, { kind: "FAKE", send }),
    ).toBe("RECORDED");
    expect(store.fail).toHaveBeenCalledWith(claim, "RATE_LIMITED");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
