# MOTIVE LEADS — Fase 01

Central interna de captação, gerenciamento e distribuição de leads da Motive Corretora.

Implementação em Next.js App Router, TypeScript strict, Tailwind CSS 4, componentes shadcn/ui, Supabase PostgreSQL/Auth/RLS, ESLint e Git. Não há WhatsApp, Meta Cloud API ou chatbot nesta fase.

## Estado da entrega

O código da Fase 01 está implementado. A execução conectada exige um projeto Supabase e as variáveis abaixo. Nenhuma credencial foi incluída. Sem configuração, a aplicação apresenta uma tela de orientação; não existe modo de autenticação simulado.

Os testes de banco executam as migrations reais no PostgreSQL embarcado PGlite, com roles e auth.uid() de teste. Eles validam políticas e funções SQL, mas não substituem homologação de Supabase Auth, cookies, PostgREST e navegação autenticada no ambiente de destino. Consulte [VALIDATION.md](VALIDATION.md) para resultados e limites da verificação.

## Setup

Requisitos: Node.js 22.12+ (validado com Node 24), pnpm, Git e Supabase CLI. Para Supabase local, Docker também é necessário.

1. Entre nesta pasta e execute:
   ```sh
   pnpm install --frozen-lockfile
   ```
2. Copie .env.example para .env.local e preencha as variáveis.
3. Aplique as migrations, crie o primeiro administrador e inicie a aplicação, conforme abaixo.

### Variáveis de ambiente

| Variável                             | Onde é usada                | Valor                                            |
| ------------------------------------ | --------------------------- | ------------------------------------------------ |
| NEXT_PUBLIC_SUPABASE_URL             | SSR/proxy                   | URL do projeto Supabase                          |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | SSR/proxy; pode ser pública | Publishable key do projeto                       |
| SUPABASE_SERVICE_ROLE_KEY            | Exclusivamente no servidor  | Service role do projeto para provisionar acessos |

Somente as duas primeiras podem ser públicas. O módulo da service role importa server-only. Nunca prefixe essa chave com NEXT_PUBLIC, registre seu valor em logs ou a inclua no Git. .env.local está ignorado.

### Banco local

```sh
supabase start
supabase db reset
```

Use a URL e as chaves do ambiente local em .env.local. db reset é apenas para o banco local de desenvolvimento e apaga seus dados.

### Banco remoto

```sh
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

As quatro migrations devem ser aplicadas em ordem. Não substitua migrations por alterações manuais no schema. Para bases já em uso, crie novas migrations, sem editar as antigas.

No projeto remoto, configure Auth para desabilitar cadastro público e usar senha mínima de 12 caracteres. O config.toml aplica essas configurações no ambiente local; ele não altera automaticamente as configurações do Auth remoto. Cadastros externos sem profile/employee ativo não recebem acesso aos dados da aplicação, mesmo se o signup estiver habilitado por engano.

### Primeiro administrador

O bootstrap utiliza a API Admin do Auth e a RPC versionada provision_employee. Recusa executar quando já existe um ADMIN. Não rode duas instâncias simultaneamente.

No PowerShell, com .env.local preenchido:

```powershell
$env:BOOTSTRAP_EMAIL = Read-Host "E-mail do administrador"
$env:BOOTSTRAP_NAME = Read-Host "Nome do administrador"
$bootstrapSecret = Read-Host "Senha (mínimo 12 caracteres)" -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new("", $bootstrapSecret).Password
try { pnpm bootstrap:admin }
finally {
  Remove-Item Env:BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_NAME -ErrorAction SilentlyContinue
  $bootstrapSecret = $null
}
```

Em outras plataformas, forneça BOOTSTRAP_EMAIL, BOOTSTRAP_NAME e BOOTSTRAP_PASSWORD apenas no ambiente do processo. Não escreva a senha em argumentos de linha de comando, no README ou em arquivos versionados.

O bootstrap deve ser executado a partir desta pasta, pois carrega .env.local. Se a criação do registro operacional falhar, o usuário Auth recém-criado é removido. Se essa compensação também falhar, o script informa o UUID para reconciliação pelo operador. Usuários Auth sem profile/employee não acessam a aplicação.

### Executar

```sh
pnpm dev
```

Abra http://localhost:3000. Produção:

```sh
pnpm build
pnpm start
```

Hospede em ambiente compatível com Next.js server-side. Defina as três variáveis no servidor de hospedagem. Não use exportação estática. Não configure cache compartilhado sobre páginas autenticadas ou respostas com Set-Cookie.

## Operação

### ADMIN

- Dashboard com novos, distribuídos, em atendimento, fechados e equipe disponível.
- Funcionários → Cadastrar funcionário cria um usuário Auth AGENT, cadastro e especialidades. A senha inicial é definida pelo administrador; compartilhe-a por canal seguro.
- Funcionários → Editar permite alterar nome, telefone, especialidades, acesso ativo e disponibilidade. O e-mail de acesso fica imutável nesta fase para evitar divergência com Auth.
- Funcionários → Produtos cadastra, renomeia e ativa/desativa produtos. Nenhuma opção de produto é fixa no frontend.
- Cadastrar lead → Abrir lead → Selecionar funcionário compatível → Atribuir.
- Transferências exigem um novo responsável disponível e compatível; o status volta para ASSIGNED.
- Histórico mostra autor, ação, estado anterior/atual, responsáveis e data/hora.

### AGENT

- Entra com o acesso fornecido pelo administrador.
- Altera a própria disponibilidade no dashboard.
- Enxerga somente seus leads; abre a oportunidade, inicia atendimento e finaliza como ganho ou perdido.
- Não administra funcionários, produtos ou atribuições.
- O menu Novos Leads permanece visível, mas fica vazio: leads NEW ainda não têm responsável e são visíveis apenas à administração.

Não há fluxo público de recuperação de senha nesta fase. O operador do projeto Supabase pode usar os recursos administrativos de Auth quando necessário.

## Regras e decisões

- Estados: NEW → ASSIGNED → IN_PROGRESS → CLOSED_WON ou CLOSED_LOST.
- Atribuição/transferência: ADMIN; produto ativo; funcionário ativo, AVAILABLE e especializado no produto. O responsável atual não é um destino válido.
- Encerrados não podem ser reabertos ou transferidos nesta fase.
- A disponibilidade é manual. Iniciar/encerrar atendimento não altera disponibilidade automaticamente e não limita a um único lead simultâneo.
- ADMIN também pode iniciar/finalizar atendimento e mudar disponibilidade de funcionários.
- Funcionários com leads abertos não podem ser desativados nem perder a especialidade correspondente; transfira primeiro.
- O administrador não pode desativar o próprio acesso.
- Produtos inativos permanecem no histórico e nos leads existentes; não recebem novos leads ou atribuições.
- A interface solicita ao menos uma especialidade no cadastro/edição de funcionário.
- Desativar funcionário revoga o acesso aos dados imediatamente via RLS, inclusive se seu token Auth ainda for válido.
- Um agente perde acesso ao lead e ao histórico assim que o lead é transferido para outro responsável.
- Datas são armazenadas em timestamptz e exibidas no fuso America/Sao_Paulo.

## Arquitetura

```text
src/
  app/
    (panel)/             dashboard, leads, funcionários, produtos e histórico
    actions/             Server Actions: validação, autorização e RPC
    login/               login Supabase Auth
  components/
    ui/                  Button/Input shadcn/ui (New York)
    ...                  formulários, navegação, tabelas e histórico
  domain/                tipos, enums operacionais e schemas Zod
  lib/
    supabase/            clientes SSR e Admin server-only
    auth.ts              autenticação e autorização no servidor
    data.ts              consultas com cliente do usuário e RLS
    database.types.ts    contrato tipado do banco/RPC
  proxy.ts               atualização de sessão e proteção preliminar
supabase/
  config.toml
  migrations/            fonte reproduzível da estrutura e das regras
scripts/
  bootstrap-admin.mjs
tests/
  database.test.ts       testes SQL de segurança e regras
  validation.test.ts    entradas de servidor
```

O proxy atualiza a sessão; cada ação também exige identidade verificada pelo Auth e perfil ativo consultado no banco. Os layouts protegem navegação, mas não são a única autorização.

As regras críticas de atribuição e transição têm fonte de verdade no PostgreSQL. Server Actions validam tipos/formato com Zod e chamam RPCs; o cliente comum usa as credenciais do usuário. A service role é usada somente no cadastro de acessos, após requireAdmin(), e no bootstrap.

Leitura usa RLS; escrita direta em tabelas é revogada para anon/authenticated, inclusive para ADMIN. RPCs SECURITY DEFINER têm search_path vazio, qualificam objetos explicitamente e verificam o ator. Funções privadas ficam no schema app_private, não exposto pela API.

Atribuição e transição bloqueiam o lead com FOR UPDATE; atribuição também bloqueia o funcionário. A página envia o responsável/status esperado para detectar operações feitas sobre dados desatualizados. O trigger de auditoria participa da mesma transação: não há atribuição sem histórico nem histórico de uma atribuição abortada.

O provisionamento de usuário Auth e funcionário cruza duas APIs e não pode ser uma única transação PostgreSQL. A criação de profile/employee/especialidades é atômica; falhas provocam tentativa de exclusão compensatória do novo Auth user. Falhas de compensação exigem reconciliação operacional.

## Modelo de dados

| Tabela            | Responsabilidade e relações                                                  |
| ----------------- | ---------------------------------------------------------------------------- |
| profiles          | id = auth.users.id; role ADMIN/AGENT; created_at                             |
| employees         | profile_id único; nome, e-mail, telefone, disponibilidade, ativo, timestamps |
| products          | catálogo extensível, nome único, ativo, created_at                           |
| employee_products | relação N:N, chave composta employee_id/product_id                           |
| leads             | contato, localização, produto, observações, status, responsável e timestamps |
| lead_events       | lead_id, actor_id, ação, dados JSONB, created_at; imutável pela aplicação    |

Índices cobrem status, responsável/status, criação de leads, histórico por lead/data e especialidades por produto. FK mantém integridade; CHECK mantém consistência entre status e atribuição.

Migrations:

1. 202610230001_foundation.sql — enums, tabelas, índices, RLS e auditoria.
2. 202610230002_operations.sql — RPCs autorizadas para leads, equipe e catálogo.
3. 202610230003_initial_products.sql — Seguro Auto e Consórcio.
4. 202610230004_bootstrap_privileges.sql — leitura mínima para o bootstrap.

Os tipos TypeScript refletem o schema versionado. Ao alterá-lo, sincronize database.types.ts e execute typecheck; é possível substituir o contrato por tipos gerados com supabase gen types typescript, mantendo a camada de domínio.

## Testes e qualidade

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

O teste de banco cria um PostgreSQL PGlite temporário em memória, aplica todas as migrations e executa consultas com SET ROLE authenticated/anon e identidade de teste. Não usa credenciais reais, mocks da lógica SQL ou o banco de produção.

Cobertura: leitura RLS, acesso por UUID, proibição de escrita direta/elevação de privilégio, auditoria, compatibilidade de produto, disponibilidade, transferência, mudanças de status, acesso inativo e validação de entrada. A detecção de dados desatualizados é testada; concorrência de múltiplas conexões deve ser homologada no Supabase de destino.

Versões são fixadas em package.json e pnpm-lock.yaml. ESLint 9 e TypeScript 5.9 foram escolhidos por compatibilidade declarada com os plugins usados pelo Next. O pnpm autoriza apenas os scripts de build de dependências declarados em pnpm-workspace.yaml.

## Homologação no Supabase de destino

1. Aplique migrations, configure Auth e crie ADMIN pelo bootstrap.
2. Entre como ADMIN, confira dashboard, crie dois agentes com especialidades e deixe um disponível.
3. Crie um lead fictício, abra, atribua ao agente compatível e confira responsável/histórico.
4. Em outro navegador, entre como AGENT, altere disponibilidade, abra seu lead, inicie e finalize (teste ganho e perdido em leads distintos).
5. Tente abrir o UUID de um lead do outro agente e confirme ausência de acesso.
6. Teste transferência de lead aberto, falta de especialidade, agente indisponível, acesso inativo e dois administradores tentando atribuir simultaneamente.
7. Confira cookies, renovação/expiração de sessão, logout, navegação responsiva e mensagens de erro.

## Evolução para WhatsApp

Somente arquitetura/documentação nesta fase. Nenhuma tabela, credencial, SDK, webhook ou automação WhatsApp foi implementada.

Uma fase futura pode adicionar whatsapp_accounts, conversations e messages por migrations próprias. Conversations deve referenciar leads e contas; mensagens devem referenciar conversations e identificadores externos únicos para idempotência. O adaptador do provedor deve ficar em uma camada server-only separada e chamar o domínio existente por operações autorizadas. Defina RLS, retenção, webhooks autenticados e deduplicação nessa fase. Não coloque regras de distribuição dentro do adaptador.

## Limites atuais

- Sem integração WhatsApp, chatbot, distribuição automática, campanhas, importação ou métricas adicionais.
- Histórico e leads têm paginação de 25 registros. Equipe/catálogo atendem à escala inicial; se ultrapassarem o limite PostgREST (1000 no config local), implemente paginação dessas consultas antes de ampliar a operação.
- Atualização após ações e navegação; sem Supabase Realtime nesta fase.
- Sem deploy remoto ou conexão com um projeto Supabase nesta entrega.
