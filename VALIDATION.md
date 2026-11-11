# Verificação — MOTIVE LEADS

## Fase 03A homologada em staging — 11/11/2026

Código verificado: a50a62b (mesma árvore de aplicação de 6181b05), deployment Vercel READY publicado em 09/11/2026. Migration 010 já aplicada e histórico 001–010 sincronizado, conforme registro abaixo. Testes realizados pelo navegador com sessões reais de ADMIN, Bruna e Cida, usando o fluxo normal da aplicação, sem chamadas administrativas de escrita.

- ADMIN converteu a conversa real de teste OPEN e sem lead para Consórcio. Foi criado um lead, vinculado à conversa, com dois eventos: criação e conversão, ambos atribuídos ao ADMIN autenticado.
- Uma segunda aba, aberta antes da conversão, submeteu novamente o formulário após o primeiro sucesso. Retornou o mesmo lead; histórico continuou com dois eventos. A lista ADMIN passou de um registro preexistente para dois registros totais, sem segundo lead dessa conversão.
- Antes da atribuição, Bruna autenticada viu zero conversas e recebeu “Registro não encontrado” na URL direta, mantendo a sessão válida.
- ADMIN atribuiu pelo fluxo existente à Bruna disponível. Ela passou a ver a conversa, a mensagem original com texto/timestamp preservados e os três eventos do lead.
- ADMIN transferiu para Cida, ativa e compatível, confirmando explicitamente o aviso OFFLINE. O histórico passou a quatro eventos: criação, conversão, atribuição e transferência. O mesmo lead ficou Distribuído e sob responsabilidade da Cida.
- Após a transferência, Bruna voltou a ver zero conversas; URL direta retornou “Registro não encontrado” com sessão válida. Cida autenticada acessou a conversa, a mensagem original e os quatro eventos. ADMIN também manteve acesso após a transferência.

Resultado: Fase 03A homologada para o fluxo de teste solicitado. A conversa permanece OPEN, com uma mensagem original e o mesmo lead. O lead de teste permanece atribuído à Cida. Nenhum atendimento foi iniciado, nenhuma mensagem enviada e nenhum dado de contato foi editado.

Limites da evidência: esta rodada comprova UI/Auth/PostgREST/RLS com usuários reais. A consulta PostgreSQL administrativa somente leitura falhou por DNS (ENOTFOUND); portanto não foi produzida nova comparação de hashes de tabelas nem comprovação de atomicidade por falha forçada no remoto. Atomicidade e concorrência permanecem comprovadas pela auditoria local em PostgreSQL nativo abaixo, sem confundir com execução remota. Evidências operacionais e screenshots ficaram fora do Git, em work/phase03a-staging, sem copiar dados pessoais para a documentação.

Nesta conclusão foram atualizados somente README.md e VALIDATION.md. Migrations, RLS, código funcional, Meta e secrets permaneceram intactos. A suíte anterior aprovada mantém 311 testes/14 arquivos; não foi reexecutada nesta rodada operacional/documental. Verificação documental: pnpm format:check. O marco phase-03a-homologated registra esta homologação e não autoriza automaticamente a Fase 03B.

## Aplicação remota autorizada da Fase 03A — 09/11/2026

Após aprovação explícita do usuário, pnpm exec supabase db push --linked aplicou somente 202611060010_conversation_to_lead.sql, com código 0. A execução posterior de pnpm exec supabase migration list --linked confirmou as dez versões 001–010 iguais no local e no remoto. Nenhuma seed, role ou outra migration foi aplicada. Esta aplicação sucede o parecer histórico abaixo, que corretamente registrava a 010 ainda não aplicada na data de sua conclusão.

Código 03A autorizado para publicação em main pelo fluxo Git/Vercel. Nenhuma tag de homologação 03A deve ser criada nesta entrega; a homologação funcional ADMIN/AGENT em staging permanece uma etapa separada.

## Auditoria final da Fase 03A — concluída em 09/11/2026

Consulte [AUDIT_PHASE03A.md](AUDIT_PHASE03A.md) para o parecer completo. Nenhum defeito P0/P1/P2/P3 reproduzido. Concorrência comprovada com duas conexões independentes em PostgreSQL 17.11 nativo local: mesma conversa produziu 1 lead, 2 eventos e zero órfãos; segunda operação aguardou o lock e retornou o mesmo UUID. RLS, rollback e grants também verificados. Isso resolve a pendência de comprovação de locking em PostgreSQL nativo, mas não substitui homologação Auth/PostgREST e UI no Supabase.

Regressão reexecutada nesta auditoria: 311 testes/14 arquivos, lint, typecheck, build e format aprovados. Código e migrations preservados. Dry-run remoto autorizado pelo parecer limpo executado com código 0 e listou somente 202611060010_conversation_to_lead.sql. Migration 010 não foi aplicada remotamente; nenhum código publicado ou alteração na Meta. **Fase 03A apta para dry-run da migration 010.**

## Fase 03A — implementação local em 06/11/2026

Antes das mudanças da Fase 03A, o commit `f9581eb62f2be445e5f324a24d3dc9301952bcdd` e a tag `phase-02c-homologated` foram publicados no GitHub privado motiveseguros/MOTIVELEADS. `git ls-remote` confirmou main e tag no mesmo hash. O push desse marco pode disparar o deploy automático da integração Git/Vercel; não foi feita publicação do código 03A.

Implementação: migration `202611060010_conversation_to_lead.sql`, Server Action autenticada, formulário ADMIN com dados do contato e produto ativo, entrada na conversa e link de origem no histórico do lead. Uma RPC bloqueia a conversa, reaproveita create_lead, vincula o lead criado e registra a conversão na mesma transação. Repetição retorna o vínculo existente; primeira conversão prevalece. Sem alteração de perfil do contato ou das mensagens.

### Verificações executadas

- pnpm lint: aprovado, código 0.
- pnpm typecheck: aprovado, código 0.
- pnpm test: **311 testes aprovados em 14 arquivos**, incluindo 47 novos casos.
- pnpm build: aprovado, código 0; nova rota /conversations/[id]/convert compilada.
- pnpm format: aprovado, código 0.

Testes novos em conversation-conversion-database.test.ts, conversation-conversion-action.test.ts e conversation-conversion-ui.test.ts; mock de sessão atualizado em whatsapp-ui.test.ts. Cobrem criação/vínculo/auditoria, produto inativo/inexistente, campos inválidos, conversa fechada/ausente, repetição com dados diferentes, retorno do mesmo lead após fechamento, ingresso duplicado sem alteração, ausência de escrita direta, FK existente, ADMIN/AGENT/inativo/anon/service_role, grants/search_path, autorização antes de retornar um vínculo existente e RLS após atribuição, transferência e inativação.

Falhas forçadas na criação de auditoria, atualização do vínculo e auditoria da conversão reverteram integralmente leads, lead_events e conversa; snapshots também preservaram contacts, messages e webhook_events. A aplicação de 010 sobre banco em 009 com dados inbound existentes preservou todos os registros. As outras suítes aplicaram 001→010 do zero; regressões das Fases 01/02A e HMAC continuaram passando.

Ação de servidor testada com cliente/RPC simulados: validação antes do cliente, rejeição sem ADMIN, lista explícita de argumentos (não aceita lead_id, assignee ou actor_id), erro interno sanitizado e redirecionamento para o lead. Renderização estática testou dados preenchidos, produto ativo, indisponibilidade sem catálogo e ausência da ação para AGENT/conversa fechada/vinculada. ActionForm existente mantém botão desabilitado enquanto pending. Revisão React manteve autenticação no servidor, labels e estados de erro/carregamento sem dependências novas.

Comparação com a tag 02C confirmou **migrations 001–009 intactas**. Nenhuma política RLS ou grant de tabela foi alterado; somente EXECUTE da nova RPC é concedido a authenticated, com require_admin no corpo. Varredura de arquivos candidatos ao Git contra os valores privados de .env.local: zero ocorrências. Inspeção dos 17 arquivos JavaScript de .next/static: nenhum valor privado nem referência às variáveis secretas administrativas. O CA público já versionado não contém chave privada.

### Pendências de homologação 03A

- A migration 010 está apenas local. Nenhum banco remoto foi conectado ou alterado nesta implementação; nenhum db push executado.
- PGlite executa PostgreSQL embarcado em uma conexão: retry sequencial passou, mas contenção de duas sessões reais não foi comprovada. Homologar duas conversões simultâneas da mesma conversa: mesmo lead, um CREATED e um CONVERTED_FROM_CONVERSATION. O FOR UPDATE foi revisado, não classificado como teste concorrente aprovado.
- Homologar Auth/PostgREST, navegação do formulário e persistência em staging depois de revisar/aplicar 010 e publicar o código. Os testes locais de UI usam renderização estática e não substituem um teste de navegador autenticado da nova tela.
- Não converter automaticamente a conversa real de teste nem alterar a atribuição de Bruna. Meta, webhook, secrets, número oficial, envio e chatbot permaneceram sem alterações.

Arquivos da Fase 03A: README.md, AGENTS.md, VALIDATION.md; migration 010; src/app/actions/conversations.ts; src/app/(panel)/conversations/[id]/page.tsx e convert/page.tsx; src/components/history-list.tsx; src/domain/types.ts e validation.ts; src/lib/database.types.ts; os três novos arquivos tests/conversation-conversion-*.test.ts e tests/whatsapp-ui.test.ts.

## Fase 02C homologada com tráfego real de teste — 06/11/2026

Escopo concluído: número de TESTE da Meta → webhook de staging → pipeline autenticado/RPC Supabase → interface ADMIN, com negação de acesso à conversa sem lead para Bruna. Não representa homologação de número oficial, envio, chatbot ou publicação do app.

### Associação app/WABA

GET /v27.0/1169885138706340/subscribed_apps no Graph API Explorer inicialmente listou somente WA DevX Webhook Events 1P App (2202427980234937). Após confirmação explícita do usuário, POST no mesmo endpoint retornou success=true. O GET seguinte confirmou MOTIVE LEADS (1139169371917116) em data[].whatsapp_business_api_data.id e preservou o app interno. Access token não foi gravado no repositório, incluído em evidências ou exibido no chat; após a consulta, o campo do Explorer foi limpo.

### Entrega real e persistência

O usuário enviou do WhatsApp pessoal para +1 (555) 156-4835 o texto de teste “opa motive webhook 01”. A sessão ADMIN no staging mostrou a conversa e exatamente uma mensagem recebida, sem lead. Auditoria PostgreSQL administrativa somente leitura, com CA/TLS verificado e transação revertida, confirmou WABA 1169885138706340, Phone Number ID 1519898697862586, conta active=true, 1 contato correspondente, conversa OPEN, lead_id=NULL, 1 mensagem INBOUND/text/RECEIVED e 1 webhook_event correlacionado com processed_at preenchido e processing_error=NULL. Nenhuma mensagem foi inserida manualmente durante esta homologação.

Timestamp da Meta: 06/11/2026 10:53:45 America/Sao_Paulo; gravação: 10:53:49.750, cerca de 4,75 segundos depois. O recebimento pelo pipeline implantado exige HMAC válido; não foi capturado isoladamente o status HTTP deste POST nos logs da Vercel, pois houve entrega bem-sucedida e não foi necessário iniciar a investigação de falha.

### RLS com sessão real de Bruna

Sessão identificada na interface como Bruna Caldeira — Agente: /conversations retornou zero registros. A primeira tentativa de acesso direto coincidiu com perda de autenticação e foi considerada inconclusiva. Após novo login, repetiu-se a lista vazia e o endereço direto da mesma conversa exibiu “Registro não encontrado” / “Ele pode não existir ou estar fora do seu acesso”, com Bruna ainda identificada no cabeçalho. Ao retornar ao dashboard, a sessão permaneceu autenticada. Assim, a negação final não foi confundida com ausência de login.

Evidências locais fora do Git, em ../../work/: meta-waba-subscription-confirmed-20261106.png, meta-inbound-admin-20261106.png, meta-inbound-db-audit-20261106.json, meta-inbound-bruna-list-20261106.png e meta-inbound-bruna-denied-20261106.png. Dados pessoais não foram copiados para esta documentação.

Nenhuma alteração de código, migrations, RLS, atribuição ou leads; nenhuma publicação/redeploy, envio pela Cloud API, número oficial ou chatbot. Apenas README.md e VALIDATION.md atualizados ao concluir. Suite anterior: 264 testes aprovados; não foi reexecutada neste teste operacional sem alteração de código. As pendências históricas de subscribed_apps e entrega real registradas em 05/11 estão resolvidas neste escopo.

## Correção autorizada do WABA e configuração Meta — 05/11/2026

O painel autenticado do app MOTIVE LEADS (1139169371917116) confirmou: WABA/identificação da conta de mensagens 1169885138706340, Phone Number ID 1519898697862586 e número de teste +1 (555) 156-4835. O ID anteriormente informado como WABA, 1281001924190390, é o portfólio empresarial. Os registros históricos abaixo descrevem a configuração anterior, agora substituída.

Após confirmação explícita do usuário, foi corrigido somente whatsapp_accounts.waba_id da conta META TEST NUMBER no projeto frhivqlldgakifqdfpyv. Transação com CA/TLS verificado, advisory lock e row lock, validação exata dos valores anteriores, active=true e ausência de contatos relacionados. UPDATE limitado ao UUID e identidade anterior; uma linha retornada e COMMIT confirmado. Recibo local fora do repositório: ../../work/meta-test-waba-correction-receipt.json, com estado anterior sem credenciais. Nenhuma outra conta, mensagem, lead, migration ou política RLS alterada.

Lista restrita do provisionador, variável WHATSAPP_TEST_WABA_ID no .env.local ignorado e exemplos atualizados. Acrescentado teste que recusa o ID do portfólio como WABA; não foi criado fallback para alterar identidades divergentes automaticamente.

Callback https://motive-leads-staging.vercel.app/api/webhooks/whatsapp salvo na Meta com o verify token existente, sem expor o valor. Após retornar à configuração, URL persistida, token mascarado e tabela de campos visíveis. Messages estava automaticamente assinado; desmarcados os nove campos extras automaticamente assinados. Estado final: somente messages Assinado, versão v27.0. Evidências locais em ../../work/meta-webhook-callback-salvo.png e ../../work/meta-webhook-messages-assinado.png.

Checagem HTTP independente: GET válido 200 e challenge idêntico; token inválido 403; POST JSON sem assinatura 403. Não foi enviado payload suportado, mensagem ou chamada de envio. Nenhum access token criado. App não publicado; painel informa limitação a webhooks de teste do painel enquanto não publicado. Não foi verificado subscribed_apps separadamente nem homologado recebimento ponta a ponta Meta→RPC→banco.

Validação local: pnpm lint, pnpm typecheck, pnpm test, pnpm build e pnpm format aprovados. 264 testes aprovados em 11 arquivos.

## Execução autorizada do provisionamento remoto — 05/11/2026

Por solicitação explícita do usuário, foi adicionado o alias pnpm provision:whatsapp:test para o mesmo script do comando pnpm provision:whatsapp e executado em terminal interativo. A confirmação exata incluiu o projeto frhivqlldgakifqdfpyv e Phone Number ID 1519898697862586. O script manteve CA configurada e rejectUnauthorized=true, transação, locks e proteções de identidade.

Resultado: código 0 após COMMIT. A releitura da própria conta dentro da transação retornou name=META TEST NUMBER, waba_id=1281001924190390, phone_number_id=1519898697862586, display_phone_number=+1 (555) 156-4835 e active=true. O script não diferencia criação de reutilização na saída; não se afirma qual ocorreu.

Não houve DELETE, alteração de fixture MOTIVE HOMOLOGACAO ou outras contas pelo script, migrations/RLS, conexão à API Meta, envio ou chatbot. Nenhuma credencial foi impressa ou versionada. A execução remota foi deliberadamente autorizada neste pedido, após a criação/testes locais descritos abaixo.

## Provisionamento controlado do número de teste — 05/11/2026

Criados scripts/provision-whatsapp-test-account.mjs e scripts/lib/whatsapp-test-provisioning.mjs; comando pnpm provision:whatsapp. Schema conferido na migration 006: id UUID com default, name text (1–120), waba_id/phone_number_id text numérico (1–64), phone_number_id único, display_phone_number text (1–40), active boolean. Testes executam todas as migrations 001–009 reais no PGlite local.

O script lê apenas as cinco variáveis de configuração administrativa/teste solicitadas. O par WABA 1281001924190390 / Phone Number ID 1519898697862586 e o telefone +1 (555) 156-4835 foram explicitamente autorizados pelo usuário como número de teste; estão protegidos por lista restrita além da validação de formato. Nenhuma chamada à Meta é feita para verificar/provisionar essas informações. A identificação da conta de mensagens não foi usada porque não integra as colunas necessárias.

Antes de qualquer conexão, exige TTY e frase exata com project-ref/phone_number_id. Sem confirmação, pipe/flags ou configuração válida não conecta. Reutiliza o carregador de CA existente, ssl.ca com rejectUnauthorized=true; não aceita parâmetros sobrescrevendo TLS e não imprime URL, senha, secrets ou erros brutos. Não precisa de SUPABASE_SECRET_KEY, App Secret ou access token.

Provisionamento em transação, advisory lock e row lock, com INSERT restrito à conta e UPDATE por UUID + name + WABA + Phone Number ID esperados. Conflitos de identidade/nome e UUID da fixture são recusados. Consultas leem somente a conta pelo phone_number_id único. Atualiza display/active somente se divergirem; repetição exata não toca updated_at. Saída final contém apenas os cinco campos solicitados. Não há DELETE, alteração de outras contas nem escrita em contatos, conversas, mensagens ou eventos.

30 testes permanentes novos cobrem configuração incompleta/insegura, destino não autorizado, fixture, confirmação anterior à conexão, encerramento da conexão em falha, erros sanitizados, idempotência integral, atualização restrita, colisões e rollback após INSERT/UPDATE. Os testes não abrem banco remoto. Locks de concorrência foram inspecionados no SQL; simultaneidade com conexões PostgreSQL reais não foi homologada.

| Comando        | Resultado                                     |
| -------------- | --------------------------------------------- |
| pnpm lint      | Aprovado, código 0                            |
| pnpm typecheck | Aprovado, código 0                            |
| pnpm test      | 263 testes aprovados em 11 arquivos, código 0 |
| pnpm build     | Aprovado, código 0                            |
| pnpm format    | Aprovado, código 0                            |

Arquivos desta etapa: scripts/provision-whatsapp-test-account.mjs, scripts/lib/whatsapp-test-provisioning.mjs, tests/whatsapp-provisioning.test.mjs, package.json, .env.example, README.md, AGENTS.md e VALIDATION.md. Os três valores do número de teste foram preparados no .env.local ignorado pelo Git; credenciais existentes foram preservadas. Alterações documentais anteriores da publicação 02C1 foram mantidas. next-env.d.ts foi restaurado após regeneração pelo build.

Nenhum script remoto foi executado, nenhum banco/conta remota alterado, nenhuma migration criada ou editada e nenhuma alteração de RLS. Sem Meta, número oficial, envio, chatbot, push ou deploy nesta tarefa. Para provisionar, o operador deve executar pnpm provision:whatsapp na raiz do projeto e confirmar o destino exibido.

## Publicação autorizada da Fase 02C1 — 05/11/2026

WHATSAPP_APP_SECRET cadastrado como Secret em Production do projeto motive-leads-staging, equipe MOTIVE (motive20), sem log do valor. Implementação previamente validada com 233 testes registrada no commit `748a049f309e44fc3e63c3415c8e57eacd38dd1c` e enviada ao repositório privado motiveseguros/MOTIVELEADS. Nenhuma credencial incluída no commit; .env.local permaneceu ignorado.

O push não apresentou novo deploy na listagem consultada; foi solicitado explicitamente um deploy Git do mesmo SHA. Deployment `dpl_4usgtDF1JJwGmX6gALbSFrZqxm2i`: READY, target production no projeto de staging, build reportado de 16 segundos. Alias confirmado: https://motive-leads-staging.vercel.app.

Verificação HTTP no alias público: POST sem assinatura = 403; assinatura incorreta = 403; assinatura válida sobre `{}` = 400 por payload não suportado (autenticação aceita antes do parser, sem RPC); GET challenge com token correto = 200 e corpo exato. Nenhum payload válido para ingestão foi enviado, nenhum banco/migration/RLS alterado e nenhuma conexão Meta realizada.

Este registro e a atualização do README são documentação local posterior ao commit implantado. Os registros anteriores abaixo preservam o estado observado em cada etapa.

## Fase 02C1 — autenticação HMAC local — 05/11/2026

Implementado autenticador isolado server-only em src/lib/whatsapp/signature.ts, conectado à rota Node.js existente. Usa createHmac("sha256", App Secret textual) sobre o Uint8Array original e timingSafeEqual entre digests de 32 bytes. O header deve ter exatamente sha256= mais 64 caracteres hexadecimais; formato e tamanho são verificados antes de decodificar hex/comparar. App Secret é resolvido por requisição e não é substituído por verify token ou access token.

A leitura limitada a 3 MiB já existente foi preservada: chunks são concatenados sem decodificação, normalização ou reserialização. Só após HMAC válido ocorre UTF-8, JSON.parse, parser e persistência pela RPC existente. GET foi preservado integralmente. Assinatura ausente/malformada/incorreta retorna 403; segredo ausente/vazio ou falha de autenticação retorna 503. Guardas de transporte anteriores continuam 415/413/400; payload autenticado inválido retorna 400 e falha de persistência retorna 503, sempre sanitizados. Não foram adicionados logs de requisição.

29 testes novos em tests/whatsapp-signature.test.ts: vetor conhecido RFC 4231; sucesso pela rota real, parser real e camada de persistência real com cliente/RPC substituídos localmente; dez formas de assinatura rejeitada; ausência do segredo; não utilização do verify token; alteração de um byte; JSON equivalente com bytes diferentes; Unicode/whitespace e chunks dividindo UTF-8; hex maiúsculo; payload/JSON inválido autenticado; falha sanitizada da RPC; limites por tamanho real, Content-Length e header subestimado; GET e ausência de logs sensíveis. Spies confirmam que as rejeições não chamam JSON.parse, parser, createAdminClient ou RPC. Nenhuma conexão de teste usa Supabase remoto. O teste antigo de POST fechado foi atualizado para configurar explicitamente App Secret ausente.

Validação final executada sequencialmente:

| Comando        | Resultado                                     |
| -------------- | --------------------------------------------- |
| pnpm lint      | Aprovado, código 0                            |
| pnpm typecheck | Aprovado, código 0                            |
| pnpm test      | 233 testes aprovados em 10 arquivos, código 0 |
| pnpm build     | Aprovado, código 0                            |
| pnpm format    | Aprovado, código 0                            |

A suíte mantém 44 testes SQL da Fase 01, 63 testes de banco WhatsApp (incluindo A01/A02/F03, upgrades, RLS e atomicidade), além das regressões de UI, validação e scripts. Os testes HTTP usam requisições locais e mocks apenas na fronteira administrativa do banco; não são homologação de entrega real da Meta.

O build usou .env.local, ignorado pelo Git, com WHATSAPP_APP_SECRET exclusivamente server-side. Foram examinados os 18 arquivos de .next/static: nenhum contém os valores do App Secret, Supabase Secret ou verify token; nem a referência WHATSAPP_APP_SECRET aparece nesses assets. A varredura de 109 arquivos versionados/novos também não encontrou esses valores. Nenhuma secret foi incluída em código, testes ou documentação. next-env.d.ts, regenerado pelo build, foi restaurado ao conteúdo anterior para evitar alteração fora do escopo.

Arquivos desta fase: src/lib/whatsapp/signature.ts (novo), src/app/api/webhooks/whatsapp/route.ts, src/lib/whatsapp/contracts.ts (comentário), tests/whatsapp-signature.test.ts (novo), tests/whatsapp-webhook.test.ts, .env.example, README.md, AGENTS.md e VALIDATION.md. .env.local recebeu o segredo fora do Git; README/VALIDATION preservam também os registros locais anteriores da Fase 02B.

Vercel preparada por instruções para cadastrar WHATSAPP_APP_SECRET como Secret antes de um futuro deploy. Não houve configuração remota, commit/push, deploy, conexão Meta, cadastro de número, envio, chatbot, alteração de leads/distribuição, banco ou RLS. As nove migrations 001–009 permanecem intactas e nenhuma migration foi criada. O staging segue executando a Fase 02B com POST 503, até publicação explicitamente solicitada desta implementação.

## Challenge configurado no staging — 04/11/2026

O usuário informou que entrou como ADMIN e Bruna no endereço público para conferir Auth/RLS fora de localhost. Essa confirmação é do usuário; o agente não repetiu login com essas contas.

WHATSAPP_WEBHOOK_VERIFY_TOKEN foi gerado com 32 bytes aleatórios criptográficos, preservado no .env.local ignorado pelo Git e cadastrado como Secret somente em Production do projeto motive-leads-staging. É um segredo próprio de challenge, não access token da Meta. As variáveis administrativas PostgreSQL permanecem exclusivamente locais.

Redeploy `dpl_9WwEHjpBxBKDBjB9sxWzm7cMrzTz` READY, mesmo commit `251d4786bf7936df1db932b3f1ab0a8a08e19622`, build reportado de 39 segundos. URL estável: https://motive-leads-staging.vercel.app. Testes HTTP reais no endpoint público:

- GET com mode=subscribe, token correto e challenge fictício: 200, corpo exatamente igual ao challenge, Cache-Control: no-store.
- GET com token incorreto: 403.
- GET sem token: 403.
- POST com JSON fictício vazio: 503; o token GET não habilitou ingestão.

Nenhuma interação com a Meta, access token, mudança de código, migrations, RLS ou banco. O valor do verify token não foi impresso nem incluído nos arquivos versionados. README.md e VALIDATION.md registram esta configuração localmente, sem novo commit/push. Os resultados do primeiro deploy abaixo são históricos.

## Primeiro deploy de staging — 04/11/2026

Fase 02A encerrada como homologada por declaração do usuário. Primeiro deploy da Fase 02B na equipe MOTIVE (`motive20`), projeto `motive-leads-staging`, repositório privado `motiveseguros/MOTIVELEADS`, branch `main`, commit `251d4786bf7936df1db932b3f1ab0a8a08e19622` (tag `phase-02a-homologated`).

- Deployment: `dpl_ZmCAVZzgJPGRWg8i1a2htms1QK6j`, estado READY.
- URL estável: https://motive-leads-staging.vercel.app
- Next.js 16.4.3; build remoto e verificação TypeScript concluídos. Build reportado pela Vercel: 33 segundos. pnpm 10.28.0 selecionado automaticamente; configuração Node 26.x. O requisito aberto `engines.node >=22.12.0` gerou aviso sobre upgrades futuros, sem falha.
- Somente três variáveis em Production: URL e publishable key como Config; SUPABASE_SECRET_KEY como Secret (metadado API sensitive). Nenhuma variável administrativa PostgreSQL foi enviada.
- GET `/` redirecionou para `/login`, HTTP final 200; formulário real conferido visualmente no navegador.
- GET `/conversations` sem sessão retornou 307 para `/login`.
- POST `/api/webhooks/whatsapp` com corpo fictício `{}` retornou 503 e mensagem de autenticidade não configurada.
- Secret ausente do HTML da página de login e dos dez arquivos JavaScript referenciados por ela, todos com HTTP 200. Essa conferência se limita aos assets carregados nessa página.
- Consulta de logs de execução com level:error, entre 19:57:17 e 20:02:17 UTC, retornou zero registros. A janela inicial de uma hora não era suportada pela retenção do plano Hobby; foi usada a janela de cinco minutos. Nenhuma integração adicional de monitoramento foi configurada nesta tarefa.

Não foi realizado login com usuário real neste domínio nem retestada a operação autenticada de ADMIN/AGENT. Não houve aplicação de migrations, db push, alteração de banco/RLS, conexão Meta ou habilitação do recebimento real. Nenhuma credencial foi adicionada aos arquivos versionados. As alterações locais desta etapa são documentais (README.md e VALIDATION.md), posteriores ao commit implantado; não modificam a aplicação publicada. Os relatórios históricos abaixo preservam as limitações vigentes em suas respectivas datas.

## Vínculo administrativo autorizado da fixture — 28/10/2026

Operação solicitada explicitamente pelo usuário: localizar MOTIVE HOMOLOGACAO e um lead de Consórcio atribuído à Bruna, vincular a conversa e preparar reversão específica. A consulta remota somente leitura encontrou uma única conversa OPEN com lead_id NULL e um único lead de Consórcio em IN_PROGRESS atribuído à Bruna Caldeira ativa. A conexão utilizou o CA configurado com verificação TLS.

Após validação local, o vínculo remoto foi aplicado por conexão administrativa em transação e confirmado por releitura após COMMIT em 28/10/2026 18:08:23 UTC. Foram revalidados fixture completa, IDs, revisão, produto ativo, funcionário ativo, atribuição atual e status aberto. Houve apenas UPDATE de conversations.lead_id; updated_at foi atualizado pelo trigger existente. Lead, atribuição e histórico da Fase 01 não foram modificados. Sem migration, alteração de schema/RLS, db push, Meta ou envio.

Recibo durável salvo antes do commit em .homologation/whatsapp-lead-link.json, ignorado pelo Git, com IDs/revisões e sem credenciais. Não apagar/editar o recibo enquanto o vínculo estiver ativo. Reversão disponível via pnpm homologate:whatsapp:unlink, com confirmação interativa de projeto/conversa. Ela somente remove o vínculo registrado se fixture, lead e revisão continuarem iguais. A reversão não foi executada no remoto, pois o objetivo é manter o vínculo para homologação. O cleanup geral continua bloqueando fixture vinculada. O teste local comprova que a reversão libera o cleanup sem modificar o lead.

Validação isolada com ambiente fictício, sem copiar .env.local/certificado/recibo: pnpm lint, pnpm typecheck, pnpm test, pnpm build, pnpm format e pnpm format:check aprovados, código 0. **204 testes em 9 arquivos**, incluindo 8 novos casos de vínculo/reversão, alvo divergente, revisão alterada, recibo de outro projeto, falha de persistência do recibo e preservação do lead/histórico. Migrations 001–009 idênticas por SHA-256.

Evidências locais: ../vinculo-homologacao/; resultado remoto contém apenas IDs operacionais, revisão e confirmação, sem secrets. Essa confirmação comprova a alteração SQL e sua releitura, não representa teste de login/UI da Bruna ou integração Meta.

## TLS dos scripts PostgreSQL com CA oficial — 28/10/2026

Homologação e cleanup usam o runtime compartilhado com SUPABASE_DATABASE_CA_PATH obrigatório. O caminho pode ser absoluto ou relativo à raiz do projeto. Antes de criar Client, o arquivo deve existir, ser um arquivo legível e conter certificado PEM válido. Erros de leitura/formato são sanitizados, sem conteúdo do certificado, paths, connection string, senha ou secret.

O Client recebe ssl com ca igual ao conteúdo do arquivo e rejectUnauthorized true. A conexão administrativa não depende de sslmode=require: a URL é decomposta em campos e não é passada ao driver como connectionString. Os parâmetros aceitos anteriormente não substituem ssl. O diagnóstico sanitizado existente permanece intacto; não há fallback que desabilite TLS.

Validação executada em cópia dos fontes com variáveis fictícias, sem copiar .env.local ou o certificado do usuário: pnpm lint, pnpm typecheck, pnpm test, pnpm build, pnpm format e pnpm format:check aprovados, código 0. **196 testes em 9 arquivos**: 10 testes novos de CA, 2 casos de configuração ausente/vazia e regressões anteriores aprovadas. Testes do certificado usam CA público incluído no Node, sem rede. Evidências em ../tls-homologacao/.

Nenhuma homologação ou cleanup remoto foi executado nesta alteração. Migrations 001–009 permanecem idênticas por SHA-256; RLS, regras de negócio, banco e integração Meta não foram alterados. A conexão TLS real permanece para execução manual com o CA oficial configurado pelo operador.

## Diagnóstico temporário PostgreSQL — 28/10/2026

Habilitado somente em scripts/homologate-whatsapp-remote.mjs. Em falha de db.connect(), expõe apenas name/code reconhecidos, mensagem sanitizada por padrões fixos e classificação provável. Conteúdo variável e mensagens não reconhecidas são ocultados; nenhum stack, cause, detail, host, usuário, senha ou secret é repassado. O cleanup mantém o diagnóstico anterior. TLS verificado e confirmação interativa permanecem obrigatórios.

Validação em cópia local dos fontes com ambiente fictício e sem .env.local: lint, typecheck, test, build, format e format:check aprovados (código 0). **184 testes em 8 arquivos**, incluindo 13 testes novos de classificação, mensagens com credenciais e campos extras maliciosos. Logs em ../diagnostico-postgresql/.

pnpm homologate foi executado no projeto e retornou código 1: "Execute em terminal interativo; confirmação por pipe ou flag não é aceita." O executor de terminal interativo também falhou com erro 740 do Windows. A execução parou antes da conexão administrativa; nenhum diagnóstico de uma falha PostgreSQL real foi obtido e nenhuma operação remota foi iniciada. É necessário executar o comando em terminal interativo e confirmar o projeto para verificar a conexão real.

Migrations 001–009 preservadas por comparação SHA-256 antes/depois; nenhum schema, regra de negócio, credencial ou integração Meta alterado. Nenhum db push.

## Scripts de homologação remota controlada

Data: 28/10/2026. Criados scripts de homologação e cleanup, sem executar contra o remoto. Migrations 006–009 e contrato da RPC foram inspecionados antes das alterações. Os grants de 006 exigem conexão administrativa adicional para preparar a conta, consultar e limpar fixtures; essa opção foi aprovada pelo usuário. A ingestão permanece exclusivamente pela RPC HTTP com secret server-side.

Execução local final aprovada: **171 testes em 7 arquivos** (145 anteriores + 26 testes de segurança dos scripts).

| Comando           | Resultado            |
| ----------------- | -------------------- |
| pnpm lint         | Aprovado, código 0   |
| pnpm typecheck    | Aprovado, código 0   |
| pnpm test         | Aprovado, 171 testes |
| pnpm build        | Aprovado, código 0   |
| pnpm format       | Aprovado, código 0   |
| pnpm format:check | Aprovado, código 0   |

Validação completa executada em cópia dos arquivos próprios, com dependências instaladas offline a partir do cache local e variáveis fictícias, sem copiar .env.local ou supabase/.temp. O script não foi executado contra Supabase remoto nem contra Meta.

Testes locais cobrem: configuração ausente/insegura, projeto divergente, pooler transacional, TLS verificado, confirmação exata, recusa sem TTY, lock ocupado, liberação após erro, payload compatível com o parser, chamada somente à RPC, erros sem repassar secret, duas ingestões sem duplicar, preservação de outra conta no cleanup, conta sem ingestão, colisões, contato/mensagem/evento extra, nome/body alterados, lead vinculado e rollback de exclusões após falha forçada. Testes SQL usam migrations reais 001–009 em PGlite; HTTP é simulado. A fixture do teste de lead utiliza create_lead com ator fictício para preservar a auditoria da Fase 01.

Os dois entrypoints também foram executados em diretório temporário isolado: sem .env.local recusaram configuração; com .env.local inteiramente fictício e sem terminal interativo recusaram antes de conectar. Os diagnósticos não continham as sentinelas de secret ou senha. Não há modo --yes nem bypass de confirmação.

Arquivos criados:

- scripts/homologate-whatsapp-remote.mjs
- scripts/cleanup-whatsapp-homologation.mjs
- scripts/lib/whatsapp-homologation-fixture.mjs
- scripts/lib/whatsapp-homologation-db.mjs
- scripts/lib/whatsapp-homologation-runtime.mjs
- tests/whatsapp-homologation.test.mjs

Arquivos alterados: package.json (comandos e pg 8.23.1 como devDependency), pnpm-lock.yaml, vitest.config.ts (inclui testes .mjs), .env.example (somente variáveis opcionais vazias), README.md, AGENTS.md e VALIDATION.md. Nenhum arquivo de src/ foi alterado. Migrations 001–009 permanecem idênticas, comprovadas por hashes; nenhuma nova migration/schema/grant foi criado ou alterado.

Comandos de operação futura: pnpm homologate e pnpm homologate:whatsapp:cleanup. Consulte os pré-requisitos e valores determinísticos no README. A conexão PostgreSQL administrativa deve apontar ao mesmo projeto da API; nenhuma senha real foi adicionada ao Git. O POST permanece fechado/503 e Meta desconectada. Não há access token Meta, envio ou bot.

Logs e evidências: ../homologacao-remota-scripts/. O sucesso local não comprova conectividade, certificados, grants efetivos, Auth/PostgREST ou concorrência no Supabase real; essa homologação só ocorrerá quando o operador configurar o ambiente e confirmar os comandos.

## Correção exclusiva de F03/P3 — migration 009

Data: 28/10/2026. Escopo: normalização explícita de display_name antes de preencher contatos. Migrations 001–008 preservadas. Nenhuma alteração de RLS, autorização, identidade da mensagem, POST fechado/503 ou regras da Fase 01. Nenhum db push, conexão Meta ou credencial nova.

A 009 usa o conjunto Unicode White_Space enumerado no README e no SQL. Entradas somente com esses caracteres viram NULL; nomes válidos têm apenas as bordas aparadas. Nomes existentes com conteúdo e caracteres internos são preservados. Valores históricos vazios/whitespace-only são convertidos para NULL, sem reescrever mensagem, conversa ou evento técnico. Grants e assinatura da RPC permanecem iguais; não foi necessário alterar database.types.ts.

Foram adicionados 17 testes permanentes em tests/whatsapp-database.test.ts: oito casos de whitespace com preenchimento válido posterior; três duplicatas com enriquecimento e conversa fechada; três casos de preservação de nome existente; bordas versus caracteres internos/payload; rollback no lote misto; upgrade 008→009 com correção restrita dos valores antigos e preservação do histórico. A01/A02 e Fase 01 continuam na suíte.

Execução final aprovada: **145 testes em 6 arquivos**, sendo 128 anteriores e 17 novos. Os 63 testes SQL WhatsApp incluem A01/A02, F03, upgrade 007→008 e upgrade 008→009; os 54 testes da Fase 01 continuam aprovados.

| Comando           | Resultado            |
| ----------------- | -------------------- |
| pnpm lint         | Aprovado, código 0   |
| pnpm typecheck    | Aprovado, código 0   |
| pnpm test         | Aprovado, 145 testes |
| pnpm build        | Aprovado, código 0   |
| pnpm format       | Aprovado, código 0   |
| pnpm format:check | Aprovado, código 0   |

As validações de aplicação foram executadas numa cópia fiel dos arquivos próprios, com dependências locais, variáveis fictícias e sem .env.local ou supabase/.temp. A formatação final também foi executada no projeto. Nenhuma credencial real foi lida/usada e nenhum serviço remoto foi acessado.

A reprodução independente do F03 confirma que string vazia, espaços, "\t\n" e NBSP resultam em NULL e depois em "Nome válido". Os cenários originais A01/A02 continuam aprovados: duplicata com nome NULL junto de inédita resulta em duplicates=1/inserted=1; evento atrasado preserva "Nome atual". O upgrade 008→009 converte só nomes antigos sem conteúdo para NULL, preserva integralmente contato com nome útil, mensagens, conversas e eventos, e permite enriquecimento por duplicata.

Hashes SHA-256 confirmam migrations 001–008 idênticas à auditoria final. A comparação estrutural da RPC confirma que os demais trechos da 008 permanecem iguais, após desconsiderar somente a normalização. Não foram alterados RLS, grants, autenticação, regras de leads ou callbacks.

Arquivos desta correção: supabase/migrations/202610270009_whatsapp_display_name_whitespace.sql (novo), tests/whatsapp-database.test.ts, README.md, AGENTS.md e VALIDATION.md. Logs e evidências locais: ../correcao-f03/. Nenhuma migration remota foi aplicada; nenhum db push, conexão Meta ou credencial nova.

PGlite não comprova concorrência entre conexões independentes nem homologação Auth/PostgREST. As pendências de homologação real da auditoria continuam abertas; esta correção não ativa o POST.

## Correção exclusiva de A01/A02 — migration 008

Data: 27/10/2026. Escopo: apenas idempotência inbound e preenchimento de display_name. As migrations 001–007 permanecem intactas. Não foram alteradas regras da Fase 01, RLS, interface, autenticação de webhook ou envio. POST real continua fechado com 503 sem autenticador. Nenhuma credencial Meta foi adicionada e nenhuma migration remota foi aplicada.

### Migration e regras finais

202610270008_whatsapp_ingestion_robustness.sql substitui public.ingest_whatsapp_events(jsonb) com CREATE OR REPLACE, mantendo assinatura, retorno, SECURITY DEFINER, search_path vazio e EXECUTE somente para service_role. Não adiciona tabela/coluna nem modifica registros existentes ao aplicar.

Antes, todo o payload do evento participava da comparação, inclusive display_name; o upsert substituía o nome salvo pelo recebido. Agora a identidade inbound contém kind, waba_id, phone_number_id/conta resolvida, external_message_id, wa_id, type, text_body e provider_timestamp. Todos esses campos continuam imutáveis e comparados como recebidos pela RPC; campo inesperado continua recusado. O único metadado excluído da comparação é display_name. Callbacks de status não mudam.

Nome ausente, null ou diferente permite duplicata válida com identidade idêntica, inclusive junto de mensagem inédita. Duplicata não reescreve mensagem/evento técnico nem cria conversa, mesmo fechada. Payloads históricos da 007 são comparados sem display_name, preservando seu conteúdo original.

A ingestão só preenche contacts.display_name quando o valor atual é NULL e o recebido, após btrim, é não vazio. Essa regra vale para mensagens inéditas e duplicatas válidas. Nome existente nunca é substituído/apagado, mesmo por evento posterior. String vazia/somente espaços recebida é tratada como ausência; valores vazios já armazenados não são convertidos ou sobrescritos automaticamente. O primeiro nome válido processado prevalece. Atualização posterior de perfil será operação explícita distinta futura, fora desta correção.

Toda alteração, inclusive preenchimento de nome por duplicata, participa da transação do lote. Divergência real ou falha posterior desfaz as mensagens inéditas e esse preenchimento. RLS, autorização e histórico da Fase 01 continuam preservados.

### Regressões permanentes

Foram adicionados 23 cenários em tests/whatsapp-database.test.ts:

- Nome diferente, null e chave ausente são aceitos em duplicata, junto de outra mensagem inédita; preservam mensagem e evento original.
- Corpo, remetente, tipo, timestamp e conta divergentes continuam recusados sem efeitos.
- Nome NULL, vazio recebido e somente espaços permitem primeiro preenchimento válido.
- Nome existente não é substituído por nome diferente, null, vazio ou espaços.
- Evento atrasado não regride nome, tanto em chamadas separadas quanto no lote reproduzido pela auditoria.
- Reentrega com metadado diferente/ausente não cria conversa após fechamento; duplicata pode preencher nome NULL sem reabrir conversa nem reescrever evento.
- Falha no lote misto desfaz mensagem inédita e preenchimento de nome; retry válido funciona.
- HTTP sem contacts normaliza nome ausente e resulta em duplicata válida.
- Upgrade real 001–007 → 008, com mensagem previamente persistida pela 007, aceita metadado diferente e preserva auditoria.

Os testes existentes de atomicidade, RLS, POST fechado/503 e Fase 01 permanecem. Execução final: 128 testes aprovados em 6 arquivos (105 anteriores + 23 novos).

### Reexecução dos cenários da auditoria

O script original foi executado novamente contra as oito migrations em PGlite local. A cópia de execução ficou em work; relatório e evidências originais da auditoria foram preservados.

| Cenário                                                    | Após 008                                            |
| ---------------------------------------------------------- | --------------------------------------------------- |
| Repetição exata                                            | duplicates=1, inserted=0                            |
| Mesmo ID/conteúdo, nome ausente e segunda mensagem inédita | duplicates=1, inserted=1; sem erro                  |
| Evento antigo após mensagem atual                          | display_name=Nome atual; last_message_at preservado |
| Lote a-new/z-old da auditoria                              | display_name=Nome atual                             |
| Lote com conta desconhecida                                | Falha esperada, 0 mensagens e 0 eventos persistidos |

Evidência: ../correcao-a01-a02/evidencias-reproducao.json. Não foram usados tokens, contas reais ou conexão remota.

### Validação final

Execução final sequencial, todos com código 0:

| Comando                       | Resultado                                                     |
| ----------------------------- | ------------------------------------------------------------- |
| pnpm lint                     | Aprovado                                                      |
| pnpm typecheck                | Aprovado                                                      |
| pnpm test                     | 128 testes aprovados em 6 arquivos: 105 anteriores + 23 novos |
| pnpm build                    | Aprovado; 15 rotas e proxy                                    |
| pnpm format                   | Aprovado                                                      |
| pnpm format:check (adicional) | Aprovado                                                      |

As sete migrations anteriores foram comparadas byte a byte ao estado inicial: nenhuma alteração. Código de src/, testes da Fase 01 e .env.example também foram preservados. O build carregou o .env.local existente sem editá-lo; não foi aplicado SQL remotamente. Nenhuma credencial Meta foi adicionada. A comparação da função 007/008 confirmou mudanças apenas no metadado opcional, comparação de duplicidade e preenchimento de nome; locks, status callbacks, grants e demais operações foram mantidos.

Os cenários originais foram reexecutados pelo mesmo script de auditoria, alterando somente o destino do arquivo de evidências e carregando a migration 008 adicional. Os resultados históricos da auditoria permanecem disponíveis para comparação. A autenticação real, envio, chatbot e integração Meta continuam fora de escopo.

### Arquivos do projeto alterados nesta correção

- supabase/migrations/202610270008_whatsapp_ingestion_robustness.sql (novo)
- tests/whatsapp-database.test.ts
- README.md
- AGENTS.md
- VALIDATION.md

## Histórico: entrega inicial da Fase 02A

### Registro anterior — 27/10/2026

A homologação remota da Fase 01 foi informada pelo usuário. Esta etapa executa somente verificações locais; nenhuma conexão remota, db push, registro de número ou chamada à Meta foi realizada. Migrations 001–005 foram comparadas byte a byte com o início desta tarefa e permanecem intactas.

### Entrega para revisão antes da aplicação remota

- 202610270006_whatsapp_foundation.sql: cinco tabelas (whatsapp_accounts, contacts, conversations, messages, webhook_events), enums, constraints, índices, RLS, timestamps e view conversation_inbox com security_invoker.
- 202610270007_whatsapp_ingestion.sql: ingest_whatsapp_events(jsonb), RPC exclusiva de service_role, lote transacional, idempotência, locks e status monotônicos. Não altera funções/regras de distribuição da Fase 01.
- Modelo: conta → contato → conversa → mensagens; conversa pode referenciar lead, mas ingestão nunca cria lead. Unicidade conta/wa_id, uma conversa OPEN por contato/conta, ID externo de mensagem único e event_key por provider. Sem coluna ou seed de token.
- RLS: ADMIN ativo lê contas/contatos/conversas/mensagens. AGENT ativo lê contato/conversa/mensagens apenas através de lead atualmente atribuído a ele. Sem lead: apenas ADMIN. Transferência revoga acesso do antigo agente. webhook_events e escrita direta das novas tabelas são vedados aos usuários.
- Rotas: GET/POST /api/webhooks/whatsapp; páginas /conversations e /conversations/[id]. UI somente leitura, com estado vazio, paginação, erro/carregamento herdados do painel e vínculo ou ausência de lead explícito.

### Testes adicionados

- tests/whatsapp-database.test.ts: 23 cenários SQL/HTTP→SQL. Aplicam todas as sete migrations no PGlite. Cobrem unicidade de contato, idempotência de mensagem/evento, separação de contas, conversas sem lead, RLS ADMIN/AGENT/inativo/anônimo, perda de acesso após transferência, bloqueio de RPC/escrita, status fora de ordem, conta desconhecida/inativa, payload malformado/injetado, rollback de lote e retry após falha forçada.
- tests/whatsapp-webhook.test.ts: 24 cenários de challenge, POST real fechado por padrão, preservação exata dos bytes, autenticação antes de JSON, rejeição/falha do autenticador, payload/tamanho inválido, campos permitidos, callbacks, envio não configurado e proteção do painel pelo proxy.
- tests/whatsapp-ui.test.ts: 4 cenários de renderização SSR com fixtures de teste: lista, vazio, detalhe, vínculo com lead, escape de conteúdo externo e ausência de formulário de envio.
- tests/fixtures/whatsapp.ts: dados exclusivamente fictícios; nenhum token ou número registrado.
- Os 54 testes da Fase 01 permanecem sem alteração. Total confirmado: 105 testes em 6 arquivos.

### Resultado dos comandos

Execução final sequencial concluída com código 0 em todos os comandos:

| Comando           | Resultado                                                     |
| ----------------- | ------------------------------------------------------------- |
| pnpm lint         | Aprovado                                                      |
| pnpm typecheck    | Aprovado                                                      |
| pnpm test         | 105 testes aprovados em 6 arquivos (54 existentes + 51 novos) |
| pnpm build        | Aprovado; 15 rotas, incluindo as 3 novas, e proxy             |
| pnpm format:check | Aprovado                                                      |

pnpm format foi executado antes dos checks. Foram inspecionados 17 arquivos JavaScript em .next/static: nenhuma referência às variáveis privadas Supabase/WhatsApp e nenhuma chave secreta identificada. A busca em arquivos próprios do projeto não encontrou credenciais reais nem a variável Supabase antiga. Apenas .env.example é versionado, com placeholders e verify token vazio. Nenhuma secret key foi incluída no Git.

O build carregou o .env.local já existente sem alterá-lo ou imprimir seus valores. As rotas do painel/webhook são dinâmicas; nenhum cliente foi usado para acessar o banco remoto nesta execução. next-env.d.ts foi regenerado pelo Next para os tipos do build. As demais alterações anteriores do usuário foram preservadas.

### Limites e decisões verificáveis

O POST público retorna 503 sem autenticador e não grava dados, mesmo que o token do GET seja definido. A infraestrutura de processamento foi testada com authenticators locais de teste; não se declara homologação de assinatura ou integração com a Meta. O parser suporta texto de entrada e callbacks de status; outros formatos são recusados integralmente. O verify token documentado permanece vazio no exemplo, sem access token da Meta.

A RPC confirma evento técnico e mensagem na mesma transação. Se qualquer evento falha, o lote inteiro reverte, inclusive a auditoria técnica, permitindo retry sem dados parciais. processing_error é reservado para futura infraestrutura de tentativas; erros brutos não são persistidos/logados nesta fase. Estado de entrega usa precedência PENDING < SENT < FAILED < DELIVERED < READ, não ordem de chegada. Nenhuma saída real é criada ou enviada pela aplicação.

A UI usa o cliente SSR do usuário; somente processamento autenticado futuro usa o cliente administrativo. As verificações de RLS ocorrem no PostgreSQL embarcado, não em uma conta Supabase real. Renderização SSR não equivale a inspeção visual autenticada no navegador. Locks e unicidade foram exercitados em transações locais, não com concorrência de múltiplas conexões reais.

Diretório local supabase/.temp foi excluído de Git/Prettier para preservar o vínculo de CLI do usuário fora do código versionado. Nenhum arquivo de credencial local foi modificado.

### Arquivos desta etapa

- next-env.d.ts (gerado automaticamente pelo build)
- .env.example
- .gitignore
- .prettierignore
- AGENTS.md
- README.md
- VALIDATION.md
- src/app/(panel)/conversations/[id]/page.tsx
- src/app/(panel)/conversations/page.tsx
- src/app/(panel)/layout.tsx
- src/app/api/webhooks/whatsapp/route.ts
- src/components/navigation.tsx
- src/domain/whatsapp.ts
- src/lib/database.types.ts
- src/lib/whatsapp/contracts.ts
- src/lib/whatsapp/parsing.ts
- src/lib/whatsapp/processing.ts
- src/lib/whatsapp/queries.ts
- src/lib/whatsapp/sending.ts
- src/lib/whatsapp/webhook.ts
- src/proxy.ts
- supabase/migrations/202610270006_whatsapp_foundation.sql
- supabase/migrations/202610270007_whatsapp_ingestion.sql
- tests/fixtures/whatsapp.ts
- tests/whatsapp-database.test.ts
- tests/whatsapp-ui.test.ts
- tests/whatsapp-webhook.test.ts
- vitest.config.ts

## Histórico da Fase 01

Validação inicial: 23/10/2026. Última revalidação: 26/10/2026.

| Verificação                                    | Resultado                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ESLint (incluindo --max-warnings 0)            | Aprovado, zero erros e zero avisos                                                                       |
| TypeScript strict / tsc --noEmit               | Aprovado                                                                                                 |
| Vitest                                         | 54 testes aprovados em 3 arquivos                                                                        |
| Banco PGlite                                   | Todas as 5 migrations aplicadas com sucesso; 44 testes SQL                                               |
| Validação de entradas                          | 7 testes aprovados                                                                                       |
| next build                                     | Aprovado; 12 rotas geradas, incluindo /_not-found, e proxy                                               |
| Compatibilidade de peer dependencies           | Sem conflitos                                                                                            |
| Formatação Prettier                            | Aprovada                                                                                                 |
| Smoke HTTP (entrega inicial)                   | /login = 200; /employees sem configuração/sessão = 307 para /login                                       |
| Inspeção visual (entrega inicial)              | Tela inicial de configuração conferida no navegador local                                                |
| Segredo no bundle de cliente (entrega inicial) | 16 arquivos JavaScript inspecionados; zero referências à variável administrativa vigente naquela entrega |

## Atualização das API keys em 26/10/2026

O cliente administrativo e o schema de validação do bootstrap agora exigem SUPABASE_SECRET_KEY. O cliente administrativo mantém import "server-only"; seu uso na Server Action continua protegido por requireAdmin(). Clientes SSR e proxy continuam usando NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Não há fallback para a variável antiga nem secret key com prefixo NEXT_PUBLIC.

Verificações desta atualização:

- pnpm lint, pnpm typecheck, pnpm test, pnpm build e pnpm format concluíram com código 0. Os 54 testes existentes passaram em 3 arquivos.
- Bootstrap executado sem configuração: recusado com código 1 e mensagem que identifica SUPABASE_SECRET_KEY, antes de qualquer acesso ao banco.
- Busca em todos os 77 arquivos próprios do projeto: nenhuma referência ao nome antigo da variável. Dependências, artefatos gerados e histórico Git não fazem parte dessa contagem.
- Os 17 arquivos JavaScript de .next/static foram inspecionados após o build: nenhuma referência à variável privada atual ou anterior, nem chave secreta identificada.
- Somente .env.example é versionado; seus valores são placeholders. Nenhuma secret key real foi fornecida, adicionada ao código ou incluída no Git.
- Nenhuma mudança nas regras de negócio, RLS, migrations, dependências ou testes. Os papéis SQL service_role permanecem válidos e foram preservados. Nenhum banco remoto foi conectado.

Arquivos alterados nesta atualização: .env.example, src/lib/supabase/admin.ts, scripts/bootstrap-admin.mjs, README.md, AGENTS.md e VALIDATION.md.

## Reauditoria em 26/10/2026

Resultado da nova execução sequencial: pnpm lint, pnpm typecheck, pnpm test, pnpm build e pnpm format concluíram com código 0. Os 54 testes passaram novamente (44 SQL, 3 de seleção e 7 de validação de entradas).

A solicitação foi conferida novamente contra o código atual. O ajuste anterior já atende ao escopo; não foi necessária nova mudança de lógica ou migration duplicada. A comparação da função com a versão anterior confirmou que apenas a condição de disponibilidade e sua mensagem de erro foram alteradas; autorização, locks, especialidade, produto, atualização e auditoria foram preservados.

A confirmação da interface foi revisada no código nesta reauditoria. O teste manual do navegador descrito abaixo pertence à auditoria anterior. Nenhum banco remoto foi conectado.

Arquivos do ajuste existente:

- src/app/(panel)/leads/[id]/page.tsx
- src/components/assignment-form.tsx (novo)
- src/domain/assignment.ts (novo)
- supabase/migrations/202610230005_assignment_availability_advisory.sql (nova no ajuste anterior)
- tests/database.test.ts
- tests/assignment.test.ts (novo)
- README.md
- AGENTS.md
- VALIDATION.md

Nesta reauditoria, somente este relatório recebeu atualização de conteúdo; a execução de pnpm format pode normalizar a formatação.

## Auditoria da disponibilidade na distribuição

Escopo: atribuição e transferência manuais pelo ADMIN. A migration 202610230005_assignment_availability_advisory.sql remove apenas a exigência de AVAILABLE da RPC. Inatividade (active=false), falta de especialidade, produto inativo, lead encerrado e autorização continuam bloqueando as operações. RLS e grants não foram alterados.

Foram atualizados os cenários anteriores que recusavam BUSY/AWAY/OFFLINE. Agora há sucesso para os quatro estados, em atribuição e transferência, e falhas para inativo, incompatível, produto inativo e AGENT. O histórico é validado nas operações bem-sucedidas; uma falha forçada na inserção do evento confirma rollback integral do lead. A proibição de execução anônima também foi verificada após substituir a RPC.

Três testes de seleção verificam prioridade de AVAILABLE, inclusão dos demais estados e exclusão de destinos inválidos. As demais regressões foram preservadas.

Teste manual local do componente real, com ação substituída apenas no harness temporário de teste e dados fictícios: AVAILABLE sem alerta; BUSY/AWAY/OFFLINE com alerta; envio sem confirmação bloqueado; atribuição e transferência confirmadas; troca de destinatário limpa confirmação; reset do formulário limpa seleção. Esse teste não acessa banco remoto nem modifica o fluxo de autenticação da aplicação.

Comandos desta revisão: pnpm lint, pnpm typecheck, pnpm test, pnpm build e pnpm format. Os cinco comandos concluíram com código 0 na execução final sequencial.

## O que foi exercitado

As migrations reais foram executadas no PostgreSQL embarcado. Os testes alternaram o papel de conexão para authenticated e anon, com identidade fornecida por um auth.uid() de teste.

Foram verificados: ADMIN/AGENT, isolamento de leads/histórico/funcionários, acesso por UUID, usuário inativo, proibição de escrita direta e promoção de perfil, atribuição com produto/especialidade/disponibilidade, transferência, histórico transacional, status esperado, ganho/perda, catálogo extensível e proteção de funcionários com leads abertos.

A auditoria registra nomes no momento da ação. O cliente não pode fornecer ou alterar eventos.

## Limites da verificação

Não foram fornecidas URL/chaves de um projeto Supabase. Portanto:

- Migrations não foram aplicadas a um banco remoto.
- Login, criação de usuários Auth, renovação de cookies e chamadas PostgREST não foram homologados de ponta a ponta.
- O painel autenticado não foi inspecionado visualmente com dados de um Supabase real.
- A concorrência foi verificada por guardas de estado esperado e inspeção dos bloqueios SQL; não foi exercitada com múltiplas conexões reais.
- Não houve deploy, conta de administrador real criada ou dados de produção alterados.
- A prévia local foi encerrada ao fim da verificação. Execute pnpm dev para reabrir.

O checklist no README descreve os passos restantes para homologação no ambiente de destino. Essas pendências não devem ser interpretadas como testes aprovados.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

A execução desta entrega usou os CLIs correspondentes via Node.js do runtime local, com os mesmos argumentos dos scripts acima. Node 24.22.1 e pnpm 11.25.0.
