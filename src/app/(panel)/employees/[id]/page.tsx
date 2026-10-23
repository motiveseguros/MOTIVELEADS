import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { team, catalog } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { EmployeeForm } from "@/components/employee-form";
import { AvailabilityForm } from "@/components/availability-form";
export default async function EditEmployee({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN") notFound();
  const { id } = await params;
  const [{ employees, specialties }, products] = await Promise.all([
    team(),
    catalog(),
  ]);
  const employee = employees.find((e) => e.id === id);
  if (!employee) notFound();
  return (
    <>
      <PageHeader
        title={employee.name}
        description="Dados de acesso e operação do funcionário."
        action={
          <Link href="/employees" className="text-link">
            ← Voltar à equipe
          </Link>
        }
      />
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Cadastro e especialidades</h2>
          </div>
          <div className="panel-body">
            <EmployeeForm
              employee={employee}
              products={products}
              selected={specialties
                .filter((s) => s.employee_id === id)
                .map((s) => s.product_id)}
            />
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Disponibilidade</h2>
          </div>
          <div className="panel-body">
            {employee.active ? (
              <AvailabilityForm employee={employee} />
            ) : (
              <p className="muted">
                Ative o acesso para alterar a disponibilidade.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
