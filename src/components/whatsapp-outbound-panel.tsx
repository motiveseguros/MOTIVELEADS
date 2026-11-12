import {
  jobStatusLabels,
  transportFailureLabels,
  type TransportConfig,
  type OutboundJob,
} from "@/domain/whatsapp-outbound";
export function WhatsAppOutboundPanel({
  config,
  job,
}: {
  config: TransportConfig | null;
  job: OutboundJob | null;
}) {
  const held =
    job?.status === "QUEUED" &&
    (config?.mode !== "LIVE" ||
      config.generation !== job.activation_generation);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Transporte</h2>
      </div>
      <div className="panel-body">
        <dl className="details">
          <div>
            <dt>Autorização da fila</dt>
            <dd>{config?.mode === "LIVE" ? "Ativo" : "Desabilitado"}</dd>
          </div>
          <div>
            <dt>Último job da conversa</dt>
            <dd>{job ? jobStatusLabels[job.status] : "Nenhum"}</dd>
          </div>
          {job && (
            <>
              <div>
                <dt>Tentativas</dt>
                <dd>{job.attempts} / 5</dd>
              </div>
              {job.last_error_code && (
                <div>
                  <dt>Falha</dt>
                  <dd>{transportFailureLabels[job.last_error_code]}</dd>
                </div>
              )}
            </>
          )}
        </dl>
        {held && (
          <p className="text-sm mt-3">
            Job retido: transporte desabilitado ou ativação anterior. Não será
            retomado automaticamente.
          </p>
        )}
        <p className="muted text-xs mt-3">
          Envio real desabilitado nesta fase. Drafts são respostas preparadas;
          jobs não comprovam entrega.
        </p>
      </div>
    </section>
  );
}
