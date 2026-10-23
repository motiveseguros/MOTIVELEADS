import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { catalog } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/fields";
import { saveProduct } from "@/app/actions/products";
export default async function Products() {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN") notFound();
  const products = await catalog();
  return (
    <>
      <PageHeader
        title="Produtos"
        description="O catálogo define as opções dos leads e as especialidades da equipe."
        action={
          <Link className="text-link" href="/employees">
            ← Voltar à equipe
          </Link>
        }
      />
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Catálogo de produtos</h2>
          </div>
          <div className="panel-body space-y-7">
            {products.map((p) => (
              <ActionForm
                key={p.id}
                action={saveProduct}
                label="Salvar produto"
                className="border-b border-input pb-6"
              >
                <input type="hidden" name="id" value={p.id} />
                <Field
                  label="Nome do produto"
                  name="name"
                  defaultValue={p.name}
                  required
                  maxLength={80}
                />
                <label className="check-list">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={p.active}
                  />{" "}
                  Produto ativo
                </label>
              </ActionForm>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Novo produto</h2>
          </div>
          <div className="panel-body">
            <ActionForm action={saveProduct} label="Cadastrar produto">
              <input type="hidden" name="id" value="" />
              <Field
                label="Nome *"
                name="name"
                required
                minLength={2}
                maxLength={80}
              />
              <label className="check-list">
                <input type="checkbox" name="active" defaultChecked /> Produto
                ativo
              </label>
            </ActionForm>
          </div>
        </section>
      </div>
    </>
  );
}
