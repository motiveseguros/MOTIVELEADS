import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { catalog, team, listLeads, pageNumber } from "@/lib/data";
import { PageHeader } from "./page-header";
import { Button } from "./ui/button";
import { Field, SelectField } from "./fields";
import { LeadsTable } from "./leads-table";
import { Pagination } from "./pagination";
import { statusValues, statusLabels, type LeadStatus } from "@/domain/types";
export type LeadSearch = { page?: string; status?: string; q?: string };
export async function LeadsPage({
  search,
  onlyNew = false,
}: {
  search: LeadSearch;
  onlyNew?: boolean;
}) {
  const actor = await requireActor();
  const page = pageNumber(search.page);
  const status = onlyNew
    ? "NEW"
    : statusValues.includes(search.status as LeadStatus)
      ? (search.status as LeadStatus)
      : undefined;
  const q = (search.q ?? "").slice(0, 120);
  const [{ leads, total }, products, { employees }] = await Promise.all([
    listLeads(page, status, q),
    catalog(),
    team(),
  ]);
  return (
    <>
      <PageHeader
        title={onlyNew ? "Novos leads" : "Todos os leads"}
        description={
          onlyNew
            ? "Oportunidades que aguardam um responsável."
            : actor.profile.role === "ADMIN"
              ? "Acompanhe a jornada de cada oportunidade."
              : "Aqui você encontra somente os leads atribuídos a você."
        }
        action={
          actor.profile.role === "ADMIN" ? (
            <Button asChild>
              <Link href="/leads/create">
                <Plus />
                Cadastrar lead
              </Link>
            </Button>
          ) : undefined
        }
      />
      <section className="panel">
        <form className="filters" method="get">
          <Field
            label="Buscar lead"
            name="q"
            placeholder="Nome do contato"
            defaultValue={q}
            maxLength={120}
          />
          {!onlyNew && (
            <SelectField
              label="Status"
              name="status"
              defaultValue={status ?? ""}
            >
              <option value="">Todos os status</option>
              {statusValues.map((v) => (
                <option value={v} key={v}>
                  {statusLabels[v]}
                </option>
              ))}
            </SelectField>
          )}
          <Button variant="outline">
            <Search />
            Filtrar
          </Button>
        </form>
        {onlyNew && actor.profile.role === "AGENT" && (
          <p className="notice m-5 bg-secondary">
            Novos leads ficam com a administração até serem atribuídos. Consulte
            seus leads em Todos os Leads.
          </p>
        )}
        <LeadsTable leads={leads} products={products} employees={employees} />
        <Pagination
          page={page}
          total={total}
          base={onlyNew ? "/leads/new" : "/leads"}
          params={{ q, ...(status ? { status } : {}) }}
        />
      </section>
    </>
  );
}
