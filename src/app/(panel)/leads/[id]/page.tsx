import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { catalog, team, history, pageNumber } from "@/lib/data";
import { dateTime } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Status } from "@/components/status";
import { ActionForm } from "@/components/action-form";
import { SelectField } from "@/components/fields";
import { HistoryList } from "@/components/history-list";
import { Pagination } from "@/components/pagination";
import { transitionLead } from "@/app/actions/leads";
import { AssignmentForm } from "@/components/assignment-form";
import { assignmentCandidates } from "@/domain/assignment";
export default async function LeadDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await createClient();
  const { data: lead, error } = await db
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Falha ao carregar lead.");
  if (!lead) notFound();
  const page = pageNumber((await searchParams).page);
  const [products, { employees, specialties }, { events, total }] =
    await Promise.all([catalog(), team(), history(page, id)]);
  const owner = employees.find((e) => e.id === lead.assigned_employee_id);
  const compatible = assignmentCandidates(
    employees,
    specialties,
    lead.product_id,
    lead.assigned_employee_id,
  );
  const closed = lead.status === "CLOSED_WON" || lead.status === "CLOSED_LOST";
  const product = products.find((p) => p.id === lead.product_id);
  return (
    <>
      <PageHeader
        eyebrow={"LEAD · " + lead.id.slice(0, 8).toUpperCase()}
        title={lead.name}
        description={"Cadastrado em " + dateTime(lead.created_at)}
        action={
          <Link className="text-link" href="/leads">
            ← Voltar aos leads
          </Link>
        }
      />
      <div className="detail-grid">
        <div className="space-y-6">
          <section className="panel">
            <div className="panel-heading">
              <h2>Dados da oportunidade</h2>
              <Status value={lead.status} />
            </div>
            <div className="panel-body">
              <dl className="details">
                <div>
                  <dt>Telefone</dt>
                  <dd>{lead.phone}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd>{lead.email || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Localização</dt>
                  <dd>
                    {[lead.city, lead.state].filter(Boolean).join(" / ") ||
                      "Não informada"}
                  </dd>
                </div>
                <div>
                  <dt>Produto</dt>
                  <dd>{product?.name ?? "Produto indisponível"}</dd>
                </div>
                <div>
                  <dt>Responsável</dt>
                  <dd>{owner?.name ?? "Aguardando atribuição"}</dd>
                </div>
                <div>
                  <dt>Última atribuição</dt>
                  <dd>{lead.assigned_at ? dateTime(lead.assigned_at) : "—"}</dd>
                </div>
              </dl>
              <div className="border-t border-input mt-7 pt-5">
                <h3 className="text-xs mb-3">Observações</h3>
                <p className="text-sm muted whitespace-pre-wrap wrap-break-word">
                  {lead.notes || "Nenhuma observação registrada."}
                </p>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Histórico da oportunidade</h2>
              <span className="muted text-xs">{total} ações</span>
            </div>
            <HistoryList events={events} employees={employees} />
            <Pagination page={page} total={total} base={"/leads/" + id} />
          </section>
        </div>
        <aside className="space-y-6">
          {actor.profile.role === "ADMIN" && !closed && (
            <section className="panel">
              <div className="panel-heading">
                <h2>{owner ? "Transferir lead" : "Atribuir responsável"}</h2>
              </div>
              <div className="panel-body">
                {compatible.length && product?.active ? (
                  <AssignmentForm
                    key={lead.assigned_employee_id ?? "unassigned"}
                    leadId={id}
                    currentEmployeeId={lead.assigned_employee_id}
                    employees={compatible.map(({ id, name, availability }) => ({
                      id,
                      name,
                      availability,
                    }))}
                  />
                ) : (
                  <p className="muted text-xs leading-relaxed">
                    {!product?.active
                      ? "Este produto está inativo. Ative-o antes de atribuir."
                      : "Nenhum funcionário ativo e compatível para este produto. Revise o cadastro e as especialidades da equipe."}
                  </p>
                )}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Atendimento</h2>
            </div>
            <div className="panel-body">
              {lead.status === "ASSIGNED" && (
                <ActionForm action={transitionLead} label="Iniciar atendimento">
                  <input type="hidden" name="lead_id" value={id} />
                  <input
                    type="hidden"
                    name="expected_status"
                    value={lead.status}
                  />
                  <input type="hidden" name="status" value="IN_PROGRESS" />
                  <p className="muted text-xs leading-relaxed">
                    Registre o início do atendimento desta oportunidade.
                  </p>
                </ActionForm>
              )}
              {lead.status === "IN_PROGRESS" && (
                <ActionForm
                  action={transitionLead}
                  label="Finalizar atendimento"
                >
                  <input type="hidden" name="lead_id" value={id} />
                  <input
                    type="hidden"
                    name="expected_status"
                    value={lead.status}
                  />
                  <SelectField
                    label="Resultado do atendimento"
                    name="status"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Selecione o resultado
                    </option>
                    <option value="CLOSED_WON">Ganho — negócio fechado</option>
                    <option value="CLOSED_LOST">
                      Perdido — sem fechamento
                    </option>
                  </SelectField>
                  <p className="muted text-xs">
                    Após o encerramento, este lead não poderá ser reaberto nesta
                    fase.
                  </p>
                </ActionForm>
              )}
              {lead.status === "NEW" && (
                <p className="muted text-xs">
                  Aguardando atribuição de um responsável.
                </p>
              )}
              {closed && (
                <div className="space-y-3">
                  <Status value={lead.status} />
                  <p className="muted text-xs">
                    Atendimento encerrado em {dateTime(lead.updated_at)}.
                  </p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
