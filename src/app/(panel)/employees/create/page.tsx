import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { catalog } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { EmployeeForm } from "@/components/employee-form";
export default async function CreateEmployee() {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN") notFound();
  return (
    <>
      <PageHeader
        title="Cadastrar funcionário"
        description="Crie o acesso e defina os produtos atendidos."
        action={
          <Link href="/employees" className="text-link">
            ← Voltar à equipe
          </Link>
        }
      />
      <section className="panel max-w-3xl">
        <div className="panel-body">
          <EmployeeForm products={await catalog()} />
        </div>
      </section>
    </>
  );
}
