import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookAuthenticator } from "./contracts";

/** Authenticate the original HTTP bytes, never decoded or reserialized JSON. */
export function createMetaWebhookAuthenticator(
  appSecret: () => string | undefined,
): WebhookAuthenticator {
  return {
    async verify(rawBody, headers) {
      // Resolve at request time: missing configuration must never allow ingestion.
      const secret = appSecret();
      if (!secret || !secret.trim()) {
        throw new Error("Autenticação do webhook não configurada.");
      }
      const signature = headers.get("x-hub-signature-256");
      // Exactly one SHA-256 digest (32 bytes / 64 hex characters).
      // Combined duplicate headers, alternate algorithms and partial hex fail here.
      if (
        !signature ||
        signature.length !== 71 ||
        !/^sha256=[0-9a-fA-F]{64}$/.test(signature)
      ) {
        return false;
      }
      const received = Buffer.from(signature.slice(7), "hex");
      const expected = createHmac("sha256", secret).update(rawBody).digest();
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    },
  };
}
