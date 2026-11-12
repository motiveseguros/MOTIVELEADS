import Link from "next/link";
import {
  intakeStepLabels,
  type IntakeSession,
  type OutboundDraft,
} from "@/domain/whatsapp-intake";

export function WhatsAppIntakePanel({
  session,
  productName,
  draft,
  leadId,
}: {
  session: IntakeSession;
  productName: string | null;
  draft: OutboundDraft | null;
  leadId: string | null;
}) {
  const interrupted = !!leadId && session.status === "ACTIVE";
  const fields = [
    ["Nome", session.name],
    ["Produto", productName],
    ["Localidade", [session.city, session.state].filter(Boolean).join(" / ")],
    ["E-mail", session.email],
    [
      "Informações adicionais",
      session.supplemental_notes ??
        (session.status === "COMPLETE" ? "Nenhuma" : null),
    ],
  ];
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          {session.status === "COMPLETE"
            ? "Coleta concluída"
            : "Coleta automática"}
        </h2>
      </div>
      <div className="panel-body">
        <p className="text-sm mb-4">
          {interrupted
            ? "Coleta interrompida: conversa convertida manualmente."
            : session.status === "CANCELLED"
              ? "Coleta cancelada"
              : "Etapa atual: " + intakeStepLabels[session.current_step]}
        </p>
        <dl className="details">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="whitespace-pre-wrap wrap-break-word">
                {value || "Pendente"}
              </dd>
            </div>
          ))}
        </dl>
        {session.status === "COMPLETE" && leadId && (
          <Link
            className="text-link inline-block mt-4"
            href={"/leads/" + leadId}
          >
            Ver lead criado →
          </Link>
        )}
        {draft && !interrupted && session.status !== "CANCELLED" && (
          <div className="mt-5 rounded-lg border border-input p-3">
            <p className="text-sm font-semibold">
              Resposta preparada · não enviada
            </p>
            <p className="whitespace-pre-wrap wrap-break-word text-sm mt-2">
              {draft.text_body}
            </p>
            <p className="muted text-xs mt-3">
              O envio automático está desativado nesta fase.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
