# MOTIVE LEADS — Fase 02C1: autenticação do webhook

Central interna de captação, gerenciamento e distribuição de leads da Motive Corretora.

Implementação em Next.js App Router, TypeScript strict, Tailwind CSS 4, componentes shadcn/ui, Supabase PostgreSQL/Auth/RLS, ESLint e Git. A Fase 02A acrescenta infraestrutura local de conversas; não há conexão real à Meta, envio, chatbot ou coleta automática.

## Estado da entrega

As Fases 01 e 02A foram homologadas pelo usuário no Supabase remoto. A Fase 02B foi homologada em staging pelo usuário. A Fase 02C1 foi publicada no staging em 05/11/2026, commit `748a049`, com autenticação HMAC dos POSTs. A Meta, o número oficial e o recebimento real ainda não foram conectados. O marco Git da Fase 02A é a tag `phase-02a-homologated`, commit `251d478`. A execução conectada exige as variáveis abaixo. Nenhuma credencial foi incluída no repositório. Sem configuração, a aplicação apresenta uma tela de orientação; não existe modo de autenticação simulado.

Os testes de banco executam as migrations reais no PostgreSQL embarcado PGlite, com roles e auth.uid() de teste. Eles validam políticas e funções SQL, mas não substituem homologação de Supabase Auth, cookies, PostgREST e navegação autenticada no ambiente de destino. Consulte [VALIDATION.md](VALIDATION.md) para resultados e limites da verificação.

## Staging público — Vercel

URL: https://motive-leads-staging.vercel.app

Projeto `motive-leads-staging`, equipe MOTIVE (`motive20`), conectado ao repositório privado `motiveseguros/MOTIVELEADS`. O primeiro deploy foi criado a partir de `251d478`, branch `main`, usando o preset Next.js e comandos padrão. A branch `main` é a branch de produção da Vercel neste projeto de staging; novos pushes podem disparar deployments automaticamente.

Somente estas variáveis foram cadastradas no ambiente **Production** do projeto de staging:

| Variável                               | Tipo Vercel |
| -------------------------------------- | ----------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Config      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Config      |
| `SUPABASE_SECRET_KEY`                  | Secret      |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`        | Secret      |
| `WHATSAPP_APP_SECRET`                  | Secret      |

O verify token é um segredo próprio para o GET de challenge, gerado com 32 bytes aleatórios e mantido no `.env.local` ignorado pelo Git e como Secret na Vercel. Não é access token da Meta. O endpoint futuro é `https://motive-leads-staging.vercel.app/api/webhooks/whatsapp`; ainda não foi cadastrado na Meta.

A secret permanece server-side e não pode ter prefixo `NEXT_PUBLIC_`. `WHATSAPP_HOMOLOGATION_DATABASE_URL` e `SUPABASE_DATABASE_CA_PATH` ficam exclusivamente no ambiente administrativo local. Não executar `vercel env pull` sobre `.env.local`, pois pode sobrescrever a configuração local e não recupera Secrets de Production. Preview e Development não receberam credenciais nesta configuração.

A URL é pública, mas o painel exige autenticação Supabase. O staging publicado da Fase 02C1 exige HMAC antes de processar POSTs em `/api/webhooks/whatsapp`. Assinatura ausente/inválida retorna 403; App Secret ausente retorna 503. GET de challenge não habilita POST. O deploy não aplica migrations nem executa scripts de homologação. Não houve alteração de schema, RLS ou integração Meta. Consulte VALIDATION.md para verificações e limites.

## Fase 02C1 — autenticação HMAC do POST

`src/lib/whatsapp/signature.ts` é server-only e usa `createHmac` e `timingSafeEqual` do [crypto nativo do Node](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b), sem dependências novas. A rota Node.js lê WHATSAPP_APP_SECRET no momento da requisição. O segredo é a chave textual do HMAC, sem decodificar como hex ou remover espaços. Ausência, vazio ou somente whitespace falham fechados em qualquer ambiente.

O header X-Hub-Signature-256 deve ter exatamente `sha256=` seguido de 64 caracteres hexadecimais. A validação de formato/tamanho ocorre antes de converter o digest para 32 bytes; a comparação é timing-safe entre buffers do mesmo tamanho. Headers duplicados combinados são recusados. O corpo é lido uma vez como stream de bytes, limitado a 3 MiB por Content-Length e contagem real, e concatenado sem transformação. Só após assinatura válida ocorre decodificação UTF-8, JSON.parse, parser de domínio e RPC de ingestão existente. Mudança de whitespace, representação Unicode ou de um byte exige nova assinatura.

Política HTTP:

- 403 para assinatura ausente, malformada ou incorreta; não chama parser, cliente administrativo nem RPC.
- 503 para App Secret ausente/vazio ou falha interna de autenticação; nunca há fallback para o verify token ou access token.
- Guardas de transporte existentes precedem autenticação: Content-Type inválido retorna 415, corpo acima de 3 MiB retorna 413 e erro de leitura retorna 400, sempre sem persistência.
- Payload autenticado com JSON/UTF-8/formato inválido retorna 400 sanitizado; falha na persistência retorna 503 sanitizado.
- Payload autenticado e suportado usa a RPC atômica existente e retorna 200 com inserted/duplicates/statuses.
- GET mantém challenge/200 e token incorreto/403; sem verify token configurado retorna 503.

Não foram adicionados logs de requisição. Nunca registrar segredo, assinatura, digest, body, dados pessoais ou erros brutos. O verify token do GET e o App Secret do POST são controles distintos.

WHATSAPP_APP_SECRET foi cadastrado como **Secret**, somente no ambiente Production do projeto separado motive-leads-staging, antes do deploy autorizado da Fase 02C1. Não usar NEXT_PUBLIC nem publicar o valor no repositório. Deployment `dpl_4usgtDF1JJwGmX6gALbSFrZqxm2i`, commit `748a049`, READY em 05/11/2026. Nenhuma configuração na Meta, número, envio ou alteração no banco foi realizada.

## Setup

Requisitos: Node.js 22.12+ (validado com Node 24), pnpm, Git e Supabase CLI. Para Supabase local, Docker também é necessário.

1. Entre nesta pasta e execute:
   ```sh
   pnpm install --frozen-lockfile
   ```
2. Copie .env.example para .env.local e preencha as variáveis.
3. Aplique as migrations, crie o primeiro administrador e inicie a aplicação, conforme abaixo.

### Variáveis de ambiente

| Variável                             | Onde é usada                | Valor                                                    |
| ------------------------------------ | --------------------------- | -------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | SSR/proxy                   | URL do projeto Supabase                                  |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | SSR/proxy; pode ser pública | Publishable key do projeto                               |
| SUPABASE_SECRET_KEY                  | Exclusivamente no servidor  | Secret key do projeto para provisionar acessos           |
| WHATSAPP_WEBHOOK_VERIFY_TOKEN        | Exclusivamente no servidor  | Segredo próprio para challenge GET                       |
| WHATSAPP_APP_SECRET                  | Exclusivamente no servidor  | App Secret para autenticação HMAC do POST; Vercel Secret |

Somente as duas primeiras podem ser públicas. O módulo administrativo importa server-only e usa SUPABASE_SECRET_KEY exclusivamente no servidor. Nunca prefixe essa chave com NEXT_PUBLIC, registre seu valor em logs ou a inclua no Git. .env.local está ignorado.

Use as chaves atuais do Supabase: publishable key (`sb_publishable_...`) para os clientes públicos/SSR e secret key (`sb_secret_...`) para o cliente administrativo e o bootstrap. Configure `SUPABASE_SECRET_KEY` em .env.local e no ambiente do servidor; não há fallback para a variável antiga. Consulte a [documentação oficial de API keys](https://supabase.com/docs/guides/getting-started/api-keys).

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

As oito migrations devem ser aplicadas em ordem em instalações novas. Em ambientes que já possuem 001–005, revise as pendentes 006–008; se 001–007 já estiverem aplicadas, a correção A01/A02 exige somente 008. Não reaplique nem edite 001–007. Não substitua migrations por alterações manuais no schema. Para bases já em uso, crie novas migrations, sem editar as antigas.

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

Hospede em ambiente compatível com Next.js server-side. Defina as três variáveis Supabase no servidor de hospedagem. WHATSAPP_WEBHOOK_VERIFY_TOKEN autentica apenas o challenge GET; WHATSAPP_APP_SECRET autentica o POST. Cadastre ambos como Secret, nunca com prefixo NEXT_PUBLIC. Não use exportação estática. Não configure cache compartilhado sobre páginas autenticadas ou respostas com Set-Cookie.

## Operação

### ADMIN

- Dashboard com novos, distribuídos, em atendimento, fechados e equipe disponível.
- Funcionários → Cadastrar funcionário cria um usuário Auth AGENT, cadastro e especialidades. A senha inicial é definida pelo administrador; compartilhe-a por canal seguro.
- Funcionários → Editar permite alterar nome, telefone, especialidades, acesso ativo e disponibilidade. O e-mail de acesso fica imutável nesta fase para evitar divergência com Auth.
- Funcionários → Produtos cadastra, renomeia e ativa/desativa produtos. Nenhuma opção de produto é fixa no frontend.
- Cadastrar lead → Abrir lead → Selecionar funcionário compatível → Atribuir.
- Transferências exigem um novo responsável ativo e compatível; o status volta para ASSIGNED.
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
- Atribuição/transferência: ADMIN; produto ativo; funcionário ativo e especializado no produto, independentemente de AVAILABLE/BUSY/AWAY/OFFLINE. O responsável atual não é um destino válido.
- Encerrados não podem ser reabertos ou transferidos nesta fase.
- A interface mostra a disponibilidade, prioriza AVAILABLE e exige confirmação explícita para BUSY, AWAY ou OFFLINE, tanto na atribuição quanto na transferência. A confirmação é operacional; a RPC aceita esses quatro estados e preserva a autorização exclusiva do ADMIN.
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
    (panel)/             dashboard, leads, funcionários, produtos, histórico e conversas
    actions/             Server Actions: validação, autorização e RPC
    login/               login Supabase Auth
    api/webhooks/whatsapp/ GET challenge e POST preparado, fechado por padrão
  components/
    ui/                  Button/Input shadcn/ui (New York)
    ...                  formulários, navegação, tabelas e histórico
  domain/                tipos, enums operacionais e schemas Zod
  lib/
    supabase/            clientes SSR e Admin server-only
    whatsapp/            contratos, parsing, webhook, processamento, envio e leitura
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

As regras críticas de atribuição e transição têm fonte de verdade no PostgreSQL. Server Actions validam tipos/formato com Zod e chamam RPCs; o cliente comum usa as credenciais do usuário. A SUPABASE_SECRET_KEY é usada no cadastro de acessos, após requireAdmin(), no bootstrap e na camada server-only de ingestão WhatsApp. Esta última só é alcançada pelo POST após validação HMAC dos bytes brutos e validação do payload. A UI de conversas usa exclusivamente a sessão do usuário e RLS.

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
5. 202610230005_assignment_availability_advisory.sql — disponibilidade informativa na atribuição/transferência, preservando bloqueios de inatividade, especialidade, produto e autorização.

6. 202610270006_whatsapp_foundation.sql — tabelas, índices, RLS, timestamps e view de conversas com security_invoker.
7. 202610270007_whatsapp_ingestion.sql — RPC de ingestão atômica, idempotência e estados de entrega monotônicos.
8. 202610270008_whatsapp_ingestion_robustness.sql — substitui somente a RPC de ingestão para corrigir A01/A02; preserva tabelas, RLS, grants e histórico existente.

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
6. Teste transferência de lead aberto, falta de especialidade, destinos BUSY/AWAY/OFFLINE com confirmação operacional, acesso inativo e dois administradores tentando atribuir simultaneamente.
7. Confira cookies, renovação/expiração de sessão, logout, navegação responsiva e mensagens de erro.

## Infraestrutura WhatsApp — Fase 02A

O fluxo preparado é **WhatsApp → Contact → Conversation → coleta futura → Lead → distribuição**. Um contato pode não ter nome, e-mail, cidade ou telefone conhecido; os requisitos de leads não foram alterados. Identificadores wa_id não numéricos permanecem identificadores, sem serem inventados como telefones.

### Modelo e segurança

| Estrutura         | Integridade e finalidade                                                             | Leitura                                                    |
| ----------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| whatsapp_accounts | WABA e phone_number_id; número único, conta inativa por padrão, sem coluna de token  | ADMIN ativo                                                |
| contacts          | Unicidade account + wa_id; dados complementares opcionais                            | ADMIN ou agente com conversa de seu lead                   |
| conversations     | Lead opcional; FK composta impede contato de outra conta; uma OPEN por contato/conta | ADMIN; AGENT somente com lead atualmente atribuído a ele   |
| messages          | ID externo único; direção, tipo, texto e status; histórico preservado                | Mesma visibilidade da conversa                             |
| webhook_events    | Unicidade provider + event_key; payload normalizado, datas e erro reservado          | Sem acesso de anon/authenticated; inspeção técnica via SQL |

A view conversation_inbox usa security_invoker=true, consulta a última mensagem e preserva RLS. A transferência de um lead revoga o acesso do antigo agente em novas consultas, incluindo mensagens e view. Uma conversa compartilhando contato com outra não herda o acesso dela. Funcionários inativos, inclusive ADMIN, não têm acesso.

Não há escrita direta para ADMIN/AGENT nessas tabelas. A única RPC nova, ingest_whatsapp_events(jsonb), tem EXECUTE apenas para service_role, SECURITY DEFINER e search_path vazio. A chave privada é restrita ao servidor; o serviço não recebe grants diretos nas tabelas novas. A Fase 02A não expõe cadastro de contas, conversão/vínculo de lead ou edição/exclusão de histórico. Fixtures SQL existem somente nos testes em memória.

### Rotas e processamento

- GET /api/webhooks/whatsapp: responde ao challenge apenas com mode=subscribe e token correto. Sem WHATSAPP_WEBHOOK_VERIFY_TOKEN retorna 503; parâmetro inválido retorna 403. O token serve apenas ao GET.
- POST /api/webhooks/whatsapp: valida HMAC-SHA256 do header X-Hub-Signature-256 com WHATSAPP_APP_SECRET sobre o Uint8Array original antes de UTF-8/JSON/parser. Assinatura ausente/malformada/incorreta retorna 403; segredo ausente ou falha de autenticação retorna 503. Não há bypass. Ver política detalhada da Fase 02C1 abaixo.
- O handler preparado limita o corpo a 3 MiB, exige JSON e valida todo o envelope/lote antes da RPC. São suportados texto de entrada e callbacks sent/delivered/read/failed; mídia, Flows e outros eventos ficam para etapas futuras e são recusados integralmente.
- A RPC resolve a conta ativa por phone_number_id **e** waba_id; resolve contato e conversa internamente. IDs locais, lead e autor nunca são aceitos do payload. Campos extras do envelope são descartados pelo parser; a RPC também recusa campos normalizados desconhecidos.
- Uma chamada processa até 100 eventos em uma transação, com bloqueios de conta em ordem fixa, constraints e unicidade. Criação de contato, conversa, mensagem e evento técnico confirma ou reverte em conjunto. Falha retorna 503 ao HTTP, permitindo retry; não grava lotes parciais nem registra erro bruto potencialmente sensível. processing_error fica reservado para uma futura fila de tentativas; nesta etapa eventos confirmados têm processed_at e erro nulo.
- Repetir a mesma mensagem não a duplica nem cria outra conversa depois do fechamento. Reutilizar o ID com conteúdo divergente ou outra conta é recusado. last_message_at nunca recua por chegada atrasada.
- Callbacks só alteram saídas conhecidas da conta e destinatário corretos. A precedência é PENDING → SENT → FAILED → DELIVERED → READ: evidência de entrega/leitura supera falha; estados atrasados não regridem. Timestamp não é usado para presumir ordem de entrega. Um status para saída desconhecida recusa o lote para retry futuro.
- webhook_events guarda somente o evento normalizado por lista de campos permitidos, sem headers, credenciais ou payload bruto arbitrário. Cada mensagem usa uma chave por conta/ID; cada status inclui também estado/timestamp. A confirmação da auditoria técnica é atômica com a mensagem.

O contrato sendWhatsAppText aceita um adapter server-only; sem adapter lança erro explícito. Não há fetch à Meta, sucesso simulado, resposta automática ou criação automática de lead.

### Correções A01/A02 — identidade da mensagem e nome do contato

A migration 008 substitui ingest_whatsapp_events(jsonb), sem editar 001–007. Antes, a comparação de todo o payload incluía display_name e o upsert priorizava o nome recebido sobre o nome salvo. Agora:

- A identidade imutável inbound é composta por kind, waba_id, phone_number_id (conta resolvida no banco), external_message_id, wa_id/remetente, type, text_body e provider_timestamp. São comparados os valores normalizados recebidos pela RPC, inclusive timestamp; não há normalização adicional de texto/timestamp para deduplicação. Campo inesperado continua recusado. Status callbacks mantêm sua lógica anterior.
- display_name é metadado opcional do contato, não identidade da mensagem. Ausência da chave, null ou nome diferente não impedem uma duplicata com identidade idêntica. Divergência real de conta, remetente, tipo, corpo ou timestamp continua recusada.
- Uma duplicata válida conta como duplicates e não impede mensagens inéditas do mesmo lote. Não reescreve o evento original nem cria mensagem/conversa, inclusive se a conversa já estiver fechada. Todo o lote permanece transacional.
- A ingestão, inclusive uma duplicata válida, só pode preencher contacts.display_name quando o valor atual é NULL e o nome recebido não é vazio. A migration 009 amplia a normalização das bordas para o conjunto explícito de whitespace descrito abaixo; string vazia/somente whitespace vira ausência. Um nome com conteúdo já existente nunca é substituído ou apagado, mesmo por eventos mais recentes.
- O primeiro nome válido processado preenche a ausência; esta política não tenta escolher o nome cronologicamente mais recente. Um evento atrasado não sobrescreve um nome existente. Atualização posterior de perfil/nome será uma operação explícita distinta em etapa futura, fora desta entrega.
- O preenchimento de nome em duplicata também participa da transação: se outra mensagem do lote falhar, ele é revertido. Payloads de webhook_events gravados antes da 008 permanecem intactos e podem ser reconhecidos como duplicatas pela regra nova.

| Nome atual | Nome recebido                | Resultado  |
| ---------- | ---------------------------- | ---------- |
| NULL       | João                         | João       |
| João       | NULL/ausente/vazio           | João       |
| João       | João Silva                   | João       |
| Nome atual | Nome antigo, evento atrasado | Nome atual |

Historicamente, nas correções A01/A02, POST permaneceu fechado com 503 sem autenticador. A autenticação HMAC é uma alteração posterior da Fase 02C1; nenhuma dessas correções muda regras da Fase 01.

### Correção F03 — whitespace no nome do contato

A migration 202610270009_whatsapp_display_name_whitespace.sql substitui somente a RPC de ingestão e corrige valores antigos sem conteúdo. As migrations 001–008 permanecem intactas. A assinatura da RPC, os grants, RLS, locks e a identidade imutável de A01/A02 não mudam.

Antes de decidir qualquer preenchimento, a RPC apara as bordas do nome recebido usando o conjunto explícito Unicode White_Space: U+0009–U+000D (incluindo tabulação, LF e CR), U+0020, U+0085, U+00A0 (NBSP), U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F e U+3000. O resultado vazio é NULL. O conjunto é declarado no SQL, sem depender de locale ou de regex implícita. Caracteres internos de nomes com conteúdo são preservados.

Assim, "\t\n", NBSP e misturas somente desses caracteres não preenchem o contato nem impedem o primeiro nome válido posterior. Nomes existentes com conteúdo nunca são aparados, apagados ou substituídos pela ingestão. A política também vale para duplicatas, sem alterar a identidade ou o payload técnico original; preenchimento e mensagens inéditas continuam na mesma transação.

Ao aplicar 009, somente nomes antigos vazios ou compostos inteiramente pelo mesmo conjunto de whitespace são convertidos para NULL. Isso desbloqueia o preenchimento de contatos atingidos pelo F03 antes da correção. Nomes com conteúdo útil permanecem byte a byte iguais; mensagens, conversas e webhook_events não são reescritos. A atualização desses contatos usa o trigger updated_at já existente. Não há atualização geral de perfil nem nova API.

### Homologação remota controlada (sem Meta)

Os scripts operacionais são exclusivos do terminal/server-side. Eles não aplicam migrations nem alteram schema, grants, RLS ou a autenticação do POST. Nenhuma homologação remota foi executada na criação destes scripts.

**Permissões existentes:** a migration 006 revoga leitura/escrita direta inclusive de service_role nas tabelas WhatsApp. A secret key permite chamar a RPC, mas não preparar a conta nem consultar/limpar fixtures. Por isso, conforme a opção aprovada, os scripts usam duas conexões ao mesmo projeto: SUPABASE_SECRET_KEY para a RPC HTTP e WHATSAPP_HOMOLOGATION_DATABASE_URL administrativa para a conta fictícia, consultas e cleanup. Não há INSERT direto em contacts, conversations ou messages.

Pré-requisitos: migrations 001–009 já implantadas e dependências locais instaladas, incluindo pg (devDependency para os scripts). Preencha somente no .env.local ignorado pelo Git:

- NEXT_PUBLIC_SUPABASE_URL: URL HTTPS padrão do projeto, https://<project-ref>.supabase.co.
- SUPABASE_SECRET_KEY: chave atual server-side sb_secret_...; nunca usar prefixo NEXT_PUBLIC.
- WHATSAPP_HOMOLOGATION_DATABASE_URL: conexão PostgreSQL administrativa direta do mesmo projeto (host db.<project-ref>.supabase.co, usuário postgres), ou pooler de sessão (host *.pooler.supabase.com, usuário postgres.<project-ref>), porta 5432, database postgres. Codifique caracteres especiais da senha na URL. Não utilize pooler transacional/porta 6543.
- SUPABASE_DATABASE_CA_PATH: caminho obrigatório para o certificado CA oficial do PostgreSQL, baixado do painel do Supabase. Exemplo: `SUPABASE_DATABASE_CA_PATH=./certs/supabase-ca.crt` em `.env.local`. Caminhos relativos são resolvidos a partir da raiz do projeto; caminhos absolutos também são aceitos. Os scripts recusam arquivo ausente, ilegível ou certificado PEM inválido com erro sanitizado. Essa variável substitui a antiga configuração opcional do CA. TLS sempre verifica o certificado; não há opção para desativar essa verificação. A `WHATSAPP_HOMOLOGATION_DATABASE_URL` pode ser informada sem `sslmode=require`: a configuração TLS vem exclusivamente de `ssl: { ca: conteúdo do arquivo, rejectUnauthorized: true }`. O driver recebe campos separados para que parâmetros da URL não substituam a configuração TLS, conforme a [documentação do node-postgres](https://node-postgres.com/features/ssl).

O próprio script carrega .env.local relativo à raiz do projeto. Não é necessário passar secrets como argumento. URLs ausentes, credenciais ausentes, destino diferente e parâmetros inseguros são recusados. Não envie credenciais no chat nem registre .env.local no Git.

| Operação                                    | Comando                          | Confirmação digitada    |
| ------------------------------------------- | -------------------------------- | ----------------------- |
| Criar/reutilizar fixture e ingerir mensagem | pnpm homologate                  | HOMOLOGAR <project-ref> |
| Limpar somente essa fixture                 | pnpm homologate:whatsapp:cleanup | LIMPAR <project-ref>    |

A URL remota e os identificadores fictícios são mostrados antes da confirmação. Não há --yes, confirmação por pipe ou escolha arbitrária de IDs/payload. A conexão só é aberta após a frase exata. Execuções simultâneas destes scripts são recusadas por advisory lock; SQL usa transações, locks e limites de tempo. Isso não substitui homologação geral de concorrência da aplicação.

Fixtures fixas em scripts/lib/whatsapp-homologation-fixture.mjs:

| Campo                | Valor                                                |
| -------------------- | ---------------------------------------------------- |
| whatsapp_accounts.id | 4d4f5449-5645-4000-8000-00000000002a                 |
| name                 | MOTIVE HOMOLOGACAO                                   |
| waba_id              | 00000000000000000000000000000002                     |
| phone_number_id      | 00000000000000000000000000000003                     |
| display_phone_number | +000000000000 (fictício; não representa número real) |
| active               | true                                                 |
| wa_id                | motive-homologacao-fase02a (não é telefone)          |
| display_name         | Cliente Homologacao                                  |
| external_message_id  | wamid.MOTIVE_HOMOLOGACAO.FASE02A.v1                  |
| provider_timestamp   | 1793102400 (2026-10-27T12:00:00Z, fixo)              |
| kind / type          | inbound / text                                       |
| text_body            | Olá, gostaria de informações sobre consórcio.        |

A conta só é reutilizada se todos os valores esperados coincidirem. Colisões não são adotadas ou sobrescritas. A RPC ingest_whatsapp_events recebe p_events com uma única mensagem e resolve os demais IDs. Repetir o comando conserva um contato, uma conversa OPEN com lead_id NULL e uma mensagem; retorna inserted=0/duplicates=1 na repetição. Não se usa Date.now() nem IDs aleatórios. O terminal exibe apenas o resumo validado dessas fixtures, texto e contagens; não mostra erros brutos, connection string ou secret.

O cleanup verifica toda a fixture dentro da transação e exclui somente IDs exatos com critérios adicionais. Conta compartilhada com dados extras, contato alterado, mensagem divergente, conversa fechada/vinculada a lead, evento extra ou estado parcial inesperado provocam recusa antes de excluir. Não há DELETE amplo, CASCADE ou limpeza por prefixo. Uma falha posterior reverte todas as exclusões. Rodar novamente após limpeza é um no-op. É permitido limpar uma conta exata que foi criada mas ainda não recebeu mensagem.

A conta é confirmada antes da chamada HTTP para não manter seu row lock enquanto a RPC aguarda. Se ocorrer falha de rede após envio, o resultado da ingestão pode ser indeterminado; a conta/fixture pode permanecer. Repetir com os mesmos IDs é seguro. Não há cleanup automático em falhas, pois a RPC pode já ter confirmado. Não modifique manualmente essa fixture; se ela divergir, os scripts recusam e exigem inspeção administrativa independente.

### Interface e limites de homologação

Conversas (/conversations) lista contato, telefone, última mensagem, horário, status e vínculo com lead. /conversations/[id] apresenta contato e histórico paginado, com indicação “Ainda não convertido em lead”. Não há formulário de resposta. ADMIN e AGENT usam as mesmas páginas com dados filtrados pelo banco, sem cliente privilegiado.

As referências de integração são a [documentação oficial Cloud API da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) e o [exemplo de recebimento do SDK oficial arquivado](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/receivingMessages/). Elas contextualizam o adapter; os testes locais da Fase 02C1 não representam entrega real pela Meta. A implementação usa crypto nativo do Node para HMAC e comparação timing-safe. Nunca usar o token de challenge para autenticar POST.

Nenhuma migration remota é executada automaticamente. Revise as migrations pendentes até 009 e VALIDATION.md antes de autorizar aplicação no ambiente de destino. Os testes usam somente payloads fictícios, PostgreSQL PGlite local e authenticators de teste; não demonstram integração real com a Meta.

## Limites atuais

- Sem integração WhatsApp, chatbot, distribuição automática, campanhas, importação ou métricas adicionais.
- Histórico, leads, conversas e mensagens têm paginação de 25 registros. Equipe/catálogo atendem à escala inicial; se ultrapassarem o limite PostgREST (1000 no config local), implemente paginação dessas consultas antes de ampliar a operação.
- Atualização após ações e navegação; sem Supabase Realtime nesta fase.
- Staging público implantado na Vercel em 04/11/2026; o usuário confirmou testes de Auth/RLS com ADMIN e Bruna nesse domínio.

### Diagnóstico temporário da conexão administrativa

`pnpm homologate` mostra, em falhas ao conectar PostgreSQL, somente `name`, `code`, mensagem sanitizada e categoria provável (`authentication`, `DNS`, `TLS`, `timeout`, `connection_refused` ou `unknown`). Somente textos/códigos reconhecidos são preservados; conteúdo variável, hosts, credenciais e detalhes desconhecidos são ocultados. Nenhum stack, cause ou objeto bruto do driver é impresso. O diagnóstico está habilitado apenas no entrypoint de homologação; a confirmação interativa e a verificação TLS continuam obrigatórias.

### Vínculo administrativo da fixture com lead existente

A operação administrativa específica de homologação pode vincular somente a conversa fictícia validada de MOTIVE HOMOLOGACAO a um lead aberto de Consórcio atualmente atribuído à Bruna ativa. Não cria lead, altera atribuição, muda RLS ou habilita integração Meta. O vínculo exige IDs previamente inspecionados, revisão exata da conversa, locks e transação; o recibo local é gravado antes do commit. A execução inicial é uma operação administrativa explicitamente autorizada, não uma funcionalidade da aplicação.

O recibo de reversão fica em `.homologation/whatsapp-lead-link.json`, ignorado pelo Git e sem credenciais. Preserve-o, inclusive após falha de commit, para inspecionar resultado indeterminado. Não o edite. Para remover somente esse vínculo, execute `pnpm homologate:whatsapp:unlink` e confirme projeto/conversa no terminal. A reversão exige a mesma fixture, lead e revisão gravados no recibo; se houve alteração posterior, interrompe sem modificar dados. Ela define somente `conversations.lead_id = NULL` (e o trigger existente atualiza updated_at), sem excluir mensagem, contato, conversa ou lead. Não execute a reversão se deseja manter o vínculo para homologação.

O cleanup geral continua recusando fixture vinculada. Após a reversão específica, pode-se executar o cleanup geral separadamente, se desejado.

## Provisionamento controlado do número de TESTE da Meta

Execute na raiz do projeto, em terminal interativo:

```sh
pnpm provision:whatsapp
```

O alias `pnpm provision:whatsapp:test` executa o mesmo script, com as mesmas confirmações e proteções.

O comando executa scripts/provision-whatsapp-test-account.mjs. Não faz chamadas à Meta, envio, ingestão de mensagens, migrations ou alterações de RLS. Usa exclusivamente PostgreSQL administrativo para a infraestrutura whatsapp_accounts. Não deve ser executado automaticamente em build, CI ou deploy.

Configure localmente:

```dotenv
WHATSAPP_TEST_WABA_ID=1169885138706340
WHATSAPP_TEST_PHONE_NUMBER_ID=1519898697862586
WHATSAPP_TEST_DISPLAY_PHONE_NUMBER=+1 (555) 156-4835
WHATSAPP_HOMOLOGATION_DATABASE_URL=
SUPABASE_DATABASE_CA_PATH=./certs/supabase-ca.crt
```

A URL administrativa deve apontar ao projeto desejado, direta ou pooler de sessão, porta 5432; o script deriva e exibe o project-ref antes de conectar. A URL deve conter a credencial local e não deve ser compartilhada/versionada. O CA deve ser o oficial do Supabase; TLS usa ca e rejectUnauthorized=true, sem depender de sslmode=require. Não precisa de SUPABASE_SECRET_KEY, App Secret ou access token. Essas variáveis de provisionamento não devem ir para a Vercel.

Somente o par WABA/Phone Number ID acima e o telefone de teste correspondente são aceitos. Essa restrição está explícita no script, além da validação dos IDs numéricos de 1–64 dígitos e display de até 40 caracteres. Outro número de teste exige revisão deliberada; trocar o .env.local não permite provisionar número oficial. A identificação da conta de mensagens mostrada pela Meta é o WABA ID (1169885138706340). O ID do portfólio empresarial (1281001924190390) não deve ser usado como WABA.

Confirme com a frase exata exibida: PROVISIONAR TESTE <project-ref> 1519898697862586. Não há --yes ou confirmação por pipe. Somente após essa confirmação o script carrega o CA e conecta.

Cria name=META TEST NUMBER e active=true. Reutiliza somente conta com o mesmo phone_number_id, waba_id e name; divergências e o UUID protegido de MOTIVE HOMOLOGACAO abortam sem alteração. Pode reativar e atualizar a apresentação do telefone da própria conta. Repetir com os mesmos valores é no-op, inclusive updated_at. Transação, advisory lock, row lock e índice único protegem consistência; falhas revertem gravações. Não há DELETE, escrita em contatos/conversas/mensagens ou alteração de outras contas.

A consulta final é limitada à própria conta e imprime apenas name, waba_id, phone_number_id, display_phone_number e active. Nunca imprime connection string, senha, secrets ou erro bruto do driver. Em falha de rede no COMMIT o resultado pode ser indeterminado; repetir com os mesmos IDs é seguro.

O comando foi validado localmente com PGlite e testes de segurança. Em 05/11/2026, após solicitação explícita do usuário, `pnpm provision:whatsapp:test` foi executado no projeto configurado: código 0 e conta de teste confirmada com active=true. Concorrência com conexões reais ainda depende de homologação operacional.

### Callback Meta configurado para staging — 05/11/2026

App MOTIVE LEADS (1139169371917116), callback https://motive-leads-staging.vercel.app/api/webhooks/whatsapp salvo após verificação com WHATSAPP_WEBHOOK_VERIFY_TOKEN. Somente messages está assinado, versão v27.0; campos extras automaticamente assinados pela Meta foram desmarcados. Nenhum access token foi criado e nenhum número oficial foi conectado. O painel informa que apps não publicados recebem apenas webhooks de teste enviados pelo painel; o app não foi publicado nesta operação.

GET com token válido: 200 e challenge exato; token inválido: 403; POST sem assinatura: 403. O estado do painel comprova callback e assinatura do campo; ainda não comprova entrega inbound até o banco nem foi consultada separadamente a associação app/WABA via subscribed_apps.

### Fase 02C homologada com tráfego real de teste — 06/11/2026

Associação do app MOTIVE LEADS (1139169371917116) à WABA 1169885138706340 confirmada por POST subscribed_apps seguido de GET. Mensagem enviada pelo usuário ao número de teste chegou ao staging e ao Supabase: contato, conversa OPEN sem lead, uma mensagem INBOUND/RECEIVED e evento processado sem erro. ADMIN visualizou; Bruna autenticada recebeu lista vazia e “Registro não encontrado” ao acessar a conversa diretamente, mantendo a sessão ativa.

As pendências de associação e entrega registradas acima em 05/11 estão resolvidas para esse teste. Evidências e limites em VALIDATION.md. Sem número oficial, envio pela Cloud API, chatbot, publicação do app, migrations ou alteração de RLS; a homologação não autoriza automaticamente ampliar esse escopo.
