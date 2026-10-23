import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, ArrowUpRight } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { team, catalog } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { AvailabilityBadge } from "@/components/status";
export default async function Employees() {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN") notFound();
  const [{ employees, specialties }, products] = await Promise.all([
    team(),
    catalog(),
  ]);
  return (
    <>
      <PageHeader
        title="Funcionários"
        description="Gerencie acessos, especialidades e disponibilidade da equipe."
        action={
          <div className="flex gap-3">
            <Button asChild variant="outline">
              <Link href="/products">Produtos</Link>
            </Button>
            <Button asChild>
              <Link href="/employees/create">
                <Plus />
                Cadastrar funcionário
              </Link>
            </Button>
          </div>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Equipe Motive</h2>
          <span className="muted text-xs">{employees.length} funcionários</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Funcionário</th>
                <th>Especialidades</th>
                <th>Disponibilidade</th>
                <th>Acesso</th>
                <th>Gerenciar</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link className="strong-link" href={"/employees/" + e.id}>
                      {e.name}
                    </Link>
                    <small>{e.email}</small>
                  </td>
                  <td>
                    {specialties
                      .filter((s) => s.employee_id === e.id)
                      .map(
                        (s) =>
                          products.find((p) => p.id === s.product_id)?.name,
                      )
                      .join(" · ") || "Sem especialidades"}
                  </td>
                  <td>
                    <AvailabilityBadge value={e.availability} />
                  </td>
                  <td>{e.active ? "Ativo" : "Inativo"}</td>
                  <td>
                    <Link
                      className="text-link inline-flex gap-2"
                      href={"/employees/" + e.id}
                    >
                      Editar <ArrowUpRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
