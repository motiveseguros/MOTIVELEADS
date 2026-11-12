import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsAppOutboundPanel } from "../src/components/whatsapp-outbound-panel";
import type {
  OutboundJob,
  TransportConfig,
} from "../src/domain/whatsapp-outbound";
const config: TransportConfig = {
  whatsapp_account_id: "fixture",
  mode: "LIVE",
  generation: 2,
  activated_at: "2026-11-12T12:00:00Z",
  activation_draft_sequence: 6,
  updated_at: "2026-11-12T12:00:00Z",
};
const job: OutboundJob = {
  id: "job",
  draft_id: "draft",
  whatsapp_account_id: "account",
  conversation_id: "conversation",
  contact_id: "contact",
  activation_generation: 2,
  status: "QUEUED",
  attempts: 1,
  available_at: config.updated_at,
  locked_at: null,
  lease_expires_at: null,
  claim_token: null,
  dispatch_started_at: null,
  provider_kind: null,
  provider_message_id: null,
  last_error_code: null,
  created_at: config.updated_at,
  updated_at: config.updated_at,
};
function html(c: TransportConfig | null, j: OutboundJob | null) {
  return renderToStaticMarkup(
    createElement(WhatsAppOutboundPanel, { config: c, job: j }),
  );
}
describe("03B2A diagnóstico sem controles de envio", () => {
  it("ausência de configuração é desabilitado, ausência de job é explícita", () => {
    const s = html(null, null);
    expect(s).toContain("Desabilitado");
    expect(s).toContain("Nenhum");
    expect(s).not.toContain("<button");
    expect(s).not.toContain("<form");
  });
  it("LIVE não é confundido com provider de envio ativo", () => {
    const s = html(config, job);
    expect(s).toContain("Ativo");
    expect(s).toContain("Na fila");
    expect(s).toContain("Envio real desabilitado");
    expect(s).toContain("jobs não comprovam entrega");
  });
  it.each(["DISABLED", "LIVE"] as const)(
    "geração anterior ou modo %s mostra job retido",
    (mode) => {
      expect(
        html({ ...config, mode }, { ...job, activation_generation: 1 }),
      ).toContain("Não será retomado automaticamente");
    },
  );
  it("aceitação FAKE é claramente simulação, sem ID do provider", () => {
    const s = html(config, {
      ...job,
      status: "ACCEPTED",
      provider_kind: "FAKE",
      provider_message_id: "fake:private-fixture",
    });
    expect(s).toContain("Aceito em simulação");
    expect(s).toContain("não enviado à Meta");
    expect(s).not.toContain("fake:private-fixture");
  });
  it("falha mostra apenas categoria sanitizada e tentativas", () => {
    const s = html(config, {
      ...job,
      status: "RECONCILIATION_REQUIRED",
      attempts: 3,
      last_error_code: "NETWORK_UNCERTAIN",
      claim_token: "private-claim",
    });
    expect(s).toContain("Reconciliação necessária");
    expect(s).toContain("Resultado de rede incerto");
    expect(s).toContain("3 / 5");
    expect(s).not.toContain("private-claim");
  });
});
