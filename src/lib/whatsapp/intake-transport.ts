import "server-only";
import type { OutboundDraft } from "@/domain/whatsapp-intake";

/** Deliberately separate from the state machine and persisted inbound messages. */
export interface IntakeOutboundTransport {
  dispatch(
    draft: Pick<OutboundDraft, "id" | "text_body">,
  ): Promise<{ status: "DISABLED" }>;
}
/** Phase 03B1 has no provider, network call, worker or message status mutation. */
export const disabledIntakeTransport: IntakeOutboundTransport = {
  async dispatch() {
    return { status: "DISABLED" };
  },
};
