import "server-only";
import { timingSafeEqual } from "node:crypto";
import { parseWebhook } from "./parsing";
import type {
  NormalizedEvent,
  ProcessingResult,
  WebhookAuthenticator,
} from "./contracts";
const maxBodyBytes = 3 * 1024 * 1024;
class BodyTooLarge extends Error {}
async function readRawBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBodyBytes) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}
function response(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
interface Dependencies {
  verifyToken: () => string | undefined;
  authenticator?: WebhookAuthenticator;
  persist: (events: NormalizedEvent[]) => Promise<ProcessingResult>;
}
export function createWebhookHandlers(dependencies: Dependencies) {
  return {
    async GET(request: Request) {
      const token = dependencies.verifyToken();
      if (!token) return response(503, "Verificação WhatsApp não configurada.");
      const params = new URL(request.url).searchParams;
      const received = params.get("hub.verify_token") ?? "";
      const challenge = params.get("hub.challenge");
      const expectedBytes = Buffer.from(token);
      const receivedBytes = Buffer.from(received);
      if (
        params.getAll("hub.mode").length !== 1 ||
        params.getAll("hub.verify_token").length !== 1 ||
        params.getAll("hub.challenge").length !== 1 ||
        params.get("hub.mode") !== "subscribe" ||
        !challenge ||
        challenge.length > 1024 ||
        expectedBytes.length !== receivedBytes.length ||
        !timingSafeEqual(expectedBytes, receivedBytes)
      )
        return response(403, "Verificação recusada.");
      return new Response(challenge, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    },
    async POST(request: Request) {
      // GET verification token does NOT authenticate delivery of POST events.
      // No permissive fallback, development bypass or success simulation.
      if (!dependencies.authenticator)
        return response(503, "Autenticidade do webhook ainda não configurada.");
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        return response(415, "Envie JSON.");
      let raw: Uint8Array;
      try {
        raw = await readRawBody(request);
      } catch (error) {
        return response(
          error instanceof BodyTooLarge ? 413 : 400,
          "Corpo de requisição inválido.",
        );
      }
      try {
        if (!(await dependencies.authenticator.verify(raw, request.headers)))
          return response(403, "Webhook não autenticado.");
      } catch {
        return response(503, "Não foi possível autenticar o webhook.");
      }
      let events: NormalizedEvent[];
      try {
        // Decode/parse only AFTER the authenticator has seen the original bytes.
        events = parseWebhook(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        );
      } catch {
        return response(400, "Payload inválido ou não suportado.");
      }
      try {
        const result = await dependencies.persist(events);
        return Response.json(result, {
          headers: { "Cache-Control": "no-store" },
        });
      } catch {
        return response(
          503,
          "Webhook não processado; nenhuma alteração parcial foi confirmada.",
        );
      }
    },
  };
}
