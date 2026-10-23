import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  Inbox,
  UserRoundCheck,
  Headphones,
  CheckCheck,
  Users,
} from "lucide-react";
import { requireActor } from "@/lib/auth";
import { metrics, listLeads, catalog, team } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { LeadsTable } from "@/components/leads-table";
import { AvailabilityForm } from "@/components/availability-form";
import { Button } from "@/components/ui/button";
export default async function Dashboard() {
  const actor = await requireActor();
  const [counts, { leads }, products, { employees }] = await Promise.all([
    metrics(),
    listLeads(1),
    catalog(),
    team(),
  ]);
  const cards = [
    {
      label: "Novos leads",
      count: counts.new,
      icon: Inbox,
      note: "Aguardando distribuição",
    },
    {
      label: "Distribuídos",
      count: counts.assigned,
      icon: UserRoundCheck,
      note: "Com responsável definido",
    },
    {
      label: "Em atendimento",
      count: counts.progress,
      icon: Headphones,
      note: "Conversas em andamento",
    },
    {
      label: "Fechados",
      count: counts.closed,
      icon: CheckCheck,
      note: "Ganhos e perdidos",
    },
    {
      label:
        actor.profile.role === "ADMIN"
          ? "Equipe disponível"
          : "Sua disponibilidade",
      count: counts.available,
      icon: Users,
      note:
        actor.profile.role === "ADMIN"
          ? "Prontos para atender"
          : "1 disponível · 0 indisponível",
    },
  ];
  return (
    <>
      <PageHeader
        title="Visão geral da operação"
        description={
          actor.profile.role === "ADMIN"
            ? "Oportunidades, responsáveis e próximos passos. Tudo sob controle."
            : "Acompanhe seus leads e mantenha sua disponibilidade atualizada."
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
      <section className="metrics" aria-label="Indicadores">
        {cards.map(({ label, count, icon: Icon, note }) => (
          <div className="metric" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <Icon size={16} />
            </div>
            <strong>{count.toLocaleString("pt-BR")}</strong>
            <small>{note}</small>
          </div>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Últimas oportunidades</h2>
              <p className="muted mt-1 text-xs">
                Os leads mais recentes da sua operação
              </p>
            </div>
            <Link
              href="/leads"
              className="text-link inline-flex items-center gap-2"
            >
              Ver todos <ArrowUpRight size={14} />
            </Link>
          </div>
          <LeadsTable
            leads={leads.slice(0, 7)}
            products={products}
            employees={employees}
          />
        </section>
        <aside className="space-y-6">
          <section className="panel">
            <div className="panel-heading">
              <h2>Seu atendimento</h2>
            </div>
            <div className="panel-body">
              <p className="muted text-xs mb-5">
                Mantenha seu status atualizado para orientar a distribuição de
                leads.
              </p>
              <AvailabilityForm employee={actor.employee} />
            </div>
          </section>
          {actor.profile.role === "ADMIN" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Equipe disponível</h2>
                <span className="muted text-xs">{counts.available}</span>
              </div>
              <div className="panel-body">
                {employees
                  .filter((e) => e.active && e.availability === "AVAILABLE")
                  .slice(0, 6)
                  .map((e) => (
                    <div className="team-row" key={e.id}>
                      <div className="avatar">
                        {e.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p>{e.name}</p>
                        <small>Disponível para novos leads</small>
                      </div>
                    </div>
                  ))}
                {!counts.available && (
                  <p className="muted text-xs">
                    Nenhum funcionário disponível agora.
                  </p>
                )}
                <Link href="/employees" className="text-link block mt-5">
                  Gerenciar equipe →
                </Link>
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
