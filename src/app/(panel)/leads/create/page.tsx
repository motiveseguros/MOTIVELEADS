import { notFound } from "next/navigation";
import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { catalog } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { Field, SelectField } from "@/components/fields";
import { createLead } from "@/app/actions/leads";
export default async function CreateLead() {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN") notFound();
  const products = (await catalog()).filter((p) => p.active);
  return (
    <>
      <PageHeader
        title="Cadastrar lead"
        description="Registre uma oportunidade. A atribuição será feita no próximo passo."
        action={
          <Link href="/leads" className="text-link">
            ← Voltar aos leads
          </Link>
        }
      />
      <section className="panel max-w-3xl">
        <div className="panel-body">
          <ActionForm action={createLead} label="Criar oportunidade">
            <div className="form-grid">
              <Field
                label="Nome completo *"
                name="name"
                required
                minLength={2}
                maxLength={120}
              />
              <Field
                label="Telefone *"
                name="phone"
                type="tel"
                required
                minLength={8}
                maxLength={25}
              />
              <Field label="E-mail" name="email" type="email" maxLength={254} />
              <SelectField
                label="Produto de interesse *"
                name="product_id"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Selecione o produto
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <Field label="Cidade" name="city" maxLength={120} />
              <Field label="UF" name="state" maxLength={2} placeholder="SP" />
            </div>
            <label className="field">
              <span>Observações</span>
              <textarea
                name="notes"
                maxLength={5000}
                placeholder="Informações relevantes para o atendimento"
              />
            </label>
            {!products.length && (
              <p className="notice error">
                Cadastre um produto ativo antes de criar leads.
              </p>
            )}
          </ActionForm>
        </div>
      </section>
    </>
  );
}
