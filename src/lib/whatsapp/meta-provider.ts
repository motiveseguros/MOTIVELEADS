import "server-only";
import { z } from "zod";
import {
  disabledOutboundProvider,
  type DispatchInput,
  type OutboundProvider,
  type ProviderResult,
} from "./outbound-provider";
const configSchema = z.object({
  WHATSAPP_OUTBOUND_PROVIDER: z.literal("META"),
  WHATSAPP_OUTBOUND_EXECUTION_ENABLED: z.literal("true"),
  WHATSAPP_ACCESS_TOKEN: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\s]+$/),
  WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v[0-9]+\.[0-9]+$/),
  WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID: z.string().regex(/^[0-9]{1,64}$/),
});
export function metaExecutionConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const result = configSchema.safeParse(env);
  return result.success ? result.data : null;
}
const idSchema = z
  .string()
  .max(256)
  .regex(/^wamid\.[A-Za-z0-9+/=_-]+$/);
const acceptedSchema = z.object({
  error: z.never().optional(),
  messaging_product: z.literal("whatsapp").optional(),
  messages: z.array(z.object({ id: idSchema })).length(1),
});
const integer = z.number().int().min(0).max(2147483647);
const errorSchema = z.object({
  error: z.object({ code: integer, error_subcode: integer.optional() }),
});
const inputSchema = z.object({
  id: z.uuid(),
  phone_number_id: z.string().regex(/^[0-9]{1,64}$/),
  recipient: z.string().regex(/^[0-9]{8,15}$/),
  text_body: z.string().min(1).max(4096),
});
export const META_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 65_536;
async function boundedJson(response: Response): Promise<unknown> {
  if (
    Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES ||
    !response.body
  )
    throw new Error("Invalid response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("Invalid response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** One bounded POST, no retries, redirects or provider text in results/errors. */
export class MetaWhatsAppProvider {
  readonly kind = "META" as const;
  #config: NonNullable<ReturnType<typeof metaExecutionConfig>>;
  constructor(env: Record<string, string | undefined> = process.env) {
    const config = metaExecutionConfig(env);
    if (!config) throw new Error("Transporte Meta não habilitado/configurado.");
    this.#config = config;
  }
  async send(input: DispatchInput): Promise<ProviderResult> {
    const parsed = inputSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.phone_number_id !==
        this.#config.WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID
    )
      return { status: "FAILED", code: "PERMANENT_REJECTION" };
    const data = parsed.data,
      controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ProviderResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: "FAILED", code: "NETWORK_UNCERTAIN" });
      }, META_TIMEOUT_MS);
    });
    const attempt = async (): Promise<ProviderResult> => {
      let response: Response;
      try {
        response = await fetch(
          "https://graph.facebook.com/" +
            this.#config.WHATSAPP_GRAPH_API_VERSION +
            "/" +
            data.phone_number_id +
            "/messages",
          {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + this.#config.WHATSAPP_ACCESS_TOKEN,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: data.recipient,
              type: "text",
              text: { body: data.text_body, preview_url: false },
            }),
          },
        );
      } catch {
        return { status: "FAILED", code: "NETWORK_UNCERTAIN" };
      }
      let json: unknown;
      try {
        json = await boundedJson(response);
      } catch {
        return {
          status: "FAILED",
          code: controller.signal.aborted
            ? "NETWORK_UNCERTAIN"
            : "PROVIDER_EXCEPTION",
        };
      }
      if (response.ok) {
        const accepted = acceptedSchema.safeParse(json);
        return accepted.success
          ? { status: "ACCEPTED_META", messageId: accepted.data.messages[0].id }
          : { status: "FAILED", code: "PROVIDER_EXCEPTION" };
      }
      const error = errorSchema.safeParse(json);
      if (!error.success)
        return { status: "FAILED", code: "PROVIDER_EXCEPTION" };
      const code =
        response.status === 429 ||
        [4, 17, 32, 613, 130429, 131048, 131056].includes(error.data.error.code)
          ? "RATE_LIMITED"
          : response.status >= 500
            ? "TEMPORARY_UNAVAILABLE"
            : response.status >= 400
              ? "PERMANENT_REJECTION"
              : "PROVIDER_EXCEPTION";
      return {
        status: "FAILED",
        code,
        httpStatus: response.status,
        errorCode: error.data.error.code,
        errorSubcode: error.data.error.error_subcode,
      };
    };
    try {
      return await Promise.race([attempt(), timeout]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
export function createOutboundProvider(
  env: Record<string, string | undefined> = process.env,
): OutboundProvider {
  return metaExecutionConfig(env)
    ? new MetaWhatsAppProvider(env)
    : disabledOutboundProvider;
}
