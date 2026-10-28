import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { pageNumber } from "@/lib/data";
import { listConversations } from "@/lib/whatsapp/queries";
import { dateTime } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
export default async function Conversations({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireActor();
  const page = pageNumber((await searchParams).page);
  const { conversations, total } = await listConversations(page);
  return (
    <>
      <PageHeader
        title="Conversas"
        description="Contatos e mensagens das conversas disponíveis para você."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Caixa de conversas</h2>
          <span className="muted text-xs">Somente leitura</span>
        </div>
        {!conversations.length ? (
          <div className="empty">
            <MessageSquare size={30} />
            <h3>Nenhuma conversa disponível</h3>
            <p>
              As conversas aparecerão aqui quando estiverem disponíveis para o
              seu acesso.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Contato / telefone</th>
                  <th>Última mensagem</th>
                  <th>Horário</th>
                  <th>Status</th>
                  <th>Lead</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        className="strong-link"
                        href={"/conversations/" + c.id}
                      >
                        {c.contact_name || "Contato sem nome"}
                      </Link>
                      <small>
                        {c.contact_phone || "Telefone não informado"}
                      </small>
                    </td>
                    <td>
                      <p className="max-w-80 truncate">
                        {c.last_message_text ||
                          (c.last_message_type
                            ? "Mensagem: " + c.last_message_type
                            : "Sem mensagens")}
                      </p>
                    </td>
                    <td className="tabular-nums muted">
                      {c.last_message_at ? dateTime(c.last_message_at) : "—"}
                    </td>
                    <td>{c.status === "OPEN" ? "Aberta" : "Encerrada"}</td>
                    <td>
                      {c.lead_id ? (
                        <Link
                          className="text-link"
                          href={"/leads/" + c.lead_id}
                        >
                          Ver lead associado
                        </Link>
                      ) : (
                        <span className="muted">
                          Ainda não convertido em lead
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} base="/conversations" />
      </section>
    </>
  );
}
