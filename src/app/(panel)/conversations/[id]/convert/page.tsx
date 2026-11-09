import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { catalog } from "@/lib/data";
import { conversationDetail } from "@/lib/whatsapp/queries";
import { convertConversation } from "@/app/actions/conversations";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { Field, SelectField } from "@/components/fields";

export default async function ConvertConversation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  if (actor.profile.role !== "ADMIN") notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await conversationDetail(id, 1);
  if (!detail) notFound();
  const { conversation, contact } = detail;
  if (conversation.lead_id) redirect("/leads/" + conversation.lead_id);
  if (conversation.status !== "OPEN") notFound();
  const products = (await catalog()).filter((p) => p.active);
  return (
    <>
      <PageHeader
        title="Converter conversa em lead"
        description="Revise os dados da oportunidade. Depois da criação, escolha o responsável no lead."
        action={
          <Link href={"/conversations/" + id} className="text-link">
            ← Voltar à conversa
          </Link>
        }
      />
      <section className="panel max-w-3xl">
        <div className="panel-body">
          {!products.length ? (
            <p className="notice error">
              Cadastre um produto ativo antes de converter esta conversa.
            </p>
          ) : (
            <ActionForm
              action={convertConversation}
              label="Criar lead e vincular conversa"
            >
              <input type="hidden" name="conversation_id" value={id} />
              <div className="form-grid">
                <Field
                  label="Nome completo *"
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={contact.display_name ?? ""}
                />
                <Field
                  label="Telefone *"
                  name="phone"
                  type="tel"
                  required
                  minLength={8}
                  maxLength={25}
                  defaultValue={contact.phone ?? ""}
                />
                <Field
                  label="E-mail"
                  name="email"
                  type="email"
                  maxLength={254}
                  defaultValue={contact.email ?? ""}
                />
                <SelectField
                  label="Produto de interesse *"
                  name="product_id"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Selecione o produto
                  </option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label="Cidade"
                  name="city"
                  maxLength={120}
                  defaultValue={contact.city ?? ""}
                />
                <Field
                  label="UF"
                  name="state"
                  maxLength={2}
                  placeholder="SP"
                  defaultValue={contact.state ?? ""}
                />
              </div>
              <label className="field">
                <span>Observações</span>
                <textarea
                  name="notes"
                  maxLength={5000}
                  placeholder="Informações relevantes para o atendimento"
                />
              </label>
              <p className="muted text-xs">
                As mensagens permanecem nesta conversa. Os dados revisados serão
                usados no lead.
              </p>
            </ActionForm>
          )}
        </div>
      </section>
    </>
  );
}
