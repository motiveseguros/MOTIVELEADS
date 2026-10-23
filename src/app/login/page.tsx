import { Brand } from "@/components/brand";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/fields";
import { login } from "@/app/actions/auth";
import { isConfigured } from "@/lib/supabase/config";
import { LockKeyhole } from "lucide-react";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const { disabled } = await searchParams;
  const configured = isConfigured();
  return (
    <main className="login-shell">
      <section className="login-story">
        <Brand />
        <div>
          <p className="eyebrow mb-5">CONEXÕES QUE MOVEM NEGÓCIOS</p>
          <h1>
            Cada oportunidade
            <br />
            merece o<br />
            <span>próximo passo.</span>
          </h1>
          <p className="mt-6">
            Sua operação comercial em um só lugar. Do primeiro contato ao
            negócio fechado.
          </p>
        </div>
        <small className="muted">MOTIVE CORRETORA · CENTRAL DE OPERAÇÕES</small>
      </section>
      <section className="login-content">
        <div className="login-box">
          <LockKeyhole size={25} className="text-primary mb-7" />
          <p className="eyebrow">ACESSO INTERNO</p>
          <h2>Bem-vindo à operação.</h2>
          <p className="muted">Entre com seu acesso da Motive.</p>
          {disabled && (
            <p className="notice error mt-6">
              Seu acesso não está ativo. Procure o administrador.
            </p>
          )}
          {configured ? (
            <ActionForm action={login} label="Entrar na central">
              <Field
                label="E-mail corporativo"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="voce@empresa.com.br"
                required
              />
              <Field
                label="Senha"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Sua senha"
                required
                maxLength={128}
              />
            </ActionForm>
          ) : (
            <div className="notice mt-8 border border-input bg-white">
              <strong>Configuração inicial pendente</strong>
              <p className="mt-2">
                O projeto está pronto para conectar ao Supabase. Siga o README
                para configurar o ambiente, aplicar as migrations e criar o
                administrador.
              </p>
            </div>
          )}
          <p className="login-note">
            Acesso restrito à equipe autorizada.
            <br />
            Para obter ou recuperar seu acesso, procure o administrador.
          </p>
        </div>
      </section>
    </main>
  );
}
