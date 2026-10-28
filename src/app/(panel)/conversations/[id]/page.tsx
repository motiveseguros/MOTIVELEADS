import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { pageNumber } from "@/lib/data";
import { conversationDetail } from "@/lib/whatsapp/queries";
import { messageStatusLabels } from "@/domain/whatsapp";
import { dateTime } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
export default async function ConversationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const page = pageNumber((await searchParams).page);
  const detail = await conversationDetail(id, page);
  if (!detail) notFound();
  const { conversation, contact, messages, total } = detail;
  return (
    <>
      <PageHeader
        eyebrow="CONVERSA"
        title={contact.display_name || "Contato sem nome"}
        description={
          conversation.status === "OPEN"
            ? "Conversa aberta"
            : "Conversa encerrada"
        }
        action={
          <Link className="text-link" href="/conversations">
            ← Voltar às conversas
          </Link>
        }
      />
      <div className="detail-grid">
        <section className="panel min-w-0">
          <div className="panel-heading">
            <h2>Histórico de mensagens</h2>
            <span className="muted text-xs">{total} mensagens</span>
          </div>
          <div className="panel-body">
            <p className="muted text-xs mb-5">
              Somente leitura. A primeira página mostra as mensagens mais
              recentes.
            </p>
            {!messages.length ? (
              <div className="empty">
                <h3>Nenhuma mensagem disponível</h3>
              </div>
            ) : (
              <ol className="space-y-4" aria-label="Mensagens da conversa">
                {[...messages].reverse().map((message) => (
                  <li
                    key={message.id}
                    className={
                      "rounded-lg border border-input p-4 " +
                      (message.direction === "OUTBOUND" ? "bg-muted/30" : "")
                    }
                  >
                    <div className="flex flex-wrap justify-between gap-2 text-xs muted mb-3">
                      <span>
                        {message.direction === "INBOUND"
                          ? "Contato · Recebida"
                          : "Equipe · Saída"}
                      </span>
                      <time
                        dateTime={
                          message.provider_timestamp ?? message.created_at
                        }
                      >
                        {dateTime(
                          message.provider_timestamp ?? message.created_at,
                        )}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap wrap-break-word text-sm">
                      {message.text_body ?? "Mensagem do tipo " + message.type}
                    </p>
                    <p className="muted text-xs mt-3">
                      {messageStatusLabels[message.status]}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <Pagination page={page} total={total} base={"/conversations/" + id} />
        </section>
        <aside className="space-y-6">
          <section className="panel">
            <div className="panel-heading">
              <h2>Informações do contato</h2>
            </div>
            <div className="panel-body">
              <dl className="details">
                <div>
                  <dt>Nome</dt>
                  <dd>{contact.display_name || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Telefone</dt>
                  <dd>{contact.phone || "Não informado"}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd>{contact.email || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Localização</dt>
                  <dd>
                    {[contact.city, contact.state]
                      .filter(Boolean)
                      .join(" / ") || "Não informada"}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Oportunidade</h2>
            </div>
            <div className="panel-body">
              {conversation.lead_id ? (
                <Link
                  className="text-link"
                  href={"/leads/" + conversation.lead_id}
                >
                  Ver lead associado →
                </Link>
              ) : (
                <>
                  <p className="text-sm font-semibold">
                    Ainda não convertido em lead
                  </p>
                  <p className="muted text-xs mt-3">
                    Este contato ainda não possui uma oportunidade cadastrada.
                  </p>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
