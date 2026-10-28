import { createWebhookHandlers } from "@/lib/whatsapp/webhook";
import { persistWebhookEvents } from "@/lib/whatsapp/processing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Deliberately no authenticator until the official signature adapter is implemented.
// Setting the GET verify token alone never enables POST persistence.
const handlers = createWebhookHandlers({
  verifyToken: () => process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  persist: persistWebhookEvents,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
