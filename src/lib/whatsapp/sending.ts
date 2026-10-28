import "server-only";
import { z } from "zod";
import type {
  SendTextInput,
  SendTextResult,
  WhatsAppProvider,
} from "./contracts";
const inputSchema = z.object({
  phoneNumberId: z.string().regex(/^[0-9]{1,64}$/),
  recipientWaId: z.string().min(1).max(128),
  text: z.string().min(1).max(4096),
});
/** No real provider is installed in Phase 02A. Does not create a SENT row or simulate success. */
export async function sendWhatsAppText(
  input: SendTextInput,
  provider?: WhatsAppProvider,
): Promise<SendTextResult> {
  if (!provider) throw new Error("Envio WhatsApp não configurado nesta fase.");
  const result = await provider.sendText(inputSchema.parse(input));
  return z
    .object({ externalMessageId: z.string().min(1).max(256) })
    .parse(result);
}
