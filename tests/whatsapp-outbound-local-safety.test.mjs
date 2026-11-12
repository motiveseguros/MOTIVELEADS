import { describe, it, expect } from "vitest";
import { localOutboundUrl } from "./support/outbound-postgres.mjs";
describe("harness recusa remoto/URL ambígua antes de conectar", () => {
  it.each([
    undefined,
    "invalid",
    "postgresql://example.com:5432/motive_outbound_test_x",
    "postgresql://127.0.0.1:5432/postgres",
    "postgresql://127.0.0.1/motive_outbound_test_x",
    "postgresql://127.0.0.1:5432/motive_outbound_test_x?host=remote",
    "postgresql://127.0.0.1:5432/motive_outbound_test_x#x",
    "https://127.0.0.1:5432/motive_outbound_test_x",
  ])("recusa %s", (url) => expect(() => localOutboundUrl(url)).toThrow());
  it("aceita somente alvo local explícito", () => {
    const url = "postgresql://127.0.0.1:55443/motive_outbound_test_unit";
    expect(localOutboundUrl(url)).toBe(url);
  });
});
