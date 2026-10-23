import { requireActor } from "@/lib/auth";
import { history, team, pageNumber } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { HistoryList } from "@/components/history-list";
import { Pagination } from "@/components/pagination";
export default async function History({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireActor();
  const page = pageNumber((await searchParams).page);
  const [{ events, total }, { employees }] = await Promise.all([
    history(page),
    team(),
  ]);
  return (
    <>
      <PageHeader
        title="Histórico"
        description="Rastreabilidade das ações nos leads aos quais você tem acesso."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Registro de atividades</h2>
          <span className="muted text-xs">
            Mais recentes primeiro · Horário de Brasília
          </span>
        </div>
        <HistoryList events={events} employees={employees} showLead />
        <Pagination page={page} total={total} base="/history" />
      </section>
    </>
  );
}
