import { createWebhookHandlers } from "@/lib/whatsapp/webhook";
import { persistWebhookEvents } from "@/lib/whatsapp/processing";
import { createMetaWebhookAuthenticator } from "@/lib/whatsapp/signature";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// GET verification and POST HMAC authentication use distinct server-only secrets.
const handlers = createWebhookHandlers({
  verifyToken: () => process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  authenticator: createMetaWebhookAuthenticator(
    () => process.env.WHATSAPP_APP_SECRET,
  ),
  persist: persistWebhookEvents,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
