# Fase 03B2A — relatório para revisão

Data: 12/11/2026. Base homologada: `phase-03b1-homologated`, `e0cc6e7`. Branch: `phase-03b2a-review`. Esta entrega é local e para revisão; não é homologação remota da 012.

## Escopo e implantação

Única migration nova: `202611120012_whatsapp_outbound_outbox.sql`. Nenhuma migration 001–011 alterada. Nenhum db push, configuração Meta/Vercel, credencial de envio, chamada Cloud API, mudança na main ou tag. O vercel.json inclui somente o bloqueio de Preview da branch de revisão, mantendo o bloqueio anterior da 03B1. O runtime continua com provider DISABLED e nenhum executor automático.

## Modelo

| Estrutura                          | Campos e garantias                                                                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whatsapp_outbound_transport_config | whatsapp_account_id PK/FK; mode DISABLED/LIVE; generation; activated_at; activation_draft_sequence; updated_at. Ausência equivale a DISABLED. Fronteira obrigatória quando generation > 0.                                                                                  |
| whatsapp_outbound_jobs             | id; draft_id UNIQUE/FK; account/conversation/contact FKs; activation_generation; status; attempts 0–5; available_at; locked_at; lease_expires_at; claim_token; dispatch_started_at; provider_kind; provider_message_id UNIQUE; last_error_code enum; created_at/updated_at. |
| whatsapp_outbound_events           | id; account/job FKs; actor_id; action; generation; draft_boundary; attempt; error_code enum; created_at. Atores humanos somente nas ações administrativas; eventos técnicos com actor_id NULL.                                                                              |

Índices: jobs QUEUED por status/available_at/created_at, conta/geração, conversation, leases PROCESSING; eventos por conta/data e job/data. Constraints de status exigem lease/token em PROCESSING e evidência fake explícita em ACCEPTED. Nenhuma tabela nova admite escrita direta das roles da API.

Draft continua DRAFT e não contém autorização de envio. Job não é message. ACCEPTED nesta fase só pode conter provider_kind=FAKE e recibo `fake:<UUID>`; não é wamid, não comprova entrega e nunca cria messages OUTBOUND. A migration não implementa aceitação Meta. A UI rotula a simulação explicitamente.

## Ativação e prova de zero replay

1. ADMIN ativo chama set_whatsapp_outbound_transport. Conta FOR UPDATE serializa com a ingestão antes da alocação de sequence; config é bloqueada em seguida.
2. DISABLED → LIVE grava MAX(sequence) dos drafts daquela conta, activated_at e nova generation, com auditoria atômica. LIVE → LIVE não avança a fronteira nem duplica evento.
3. A ativação não cria jobs. Somente o trigger AFTER INSERT do draft pode fazê-lo: conta ativa, mode LIVE e sequence maior que a fronteira.
4. Não existe operação de varredura, backfill, INSERT de job acessível pela API, reativação de backlog ou seleção de drafts DRAFT para envio.
5. Desativação bloqueia enqueue/claim/begin. Nova ativação cria outra geração. Jobs QUEUED antigos ficam retidos e podem ser cancelados explicitamente; não são retomados pela reativação.

O teste de upgrade aplica 001–011, cria seis drafts por ingestão, aplica 012, compara os drafts e ativa: **zero jobs**. Testes adicionais comprovam que só o próximo draft enfileira, que drafts do período desligado não enfileiram retroativamente, que contas têm fronteiras independentes e que duplicatas não recriam draft/job. Atualizar um draft histórico também não dispara o trigger INSERT-only.

Essa garantia cobre os caminhos autorizados da aplicação. O proprietário/superusuário do banco continua capaz de alterar dados/schema; não se afirma proteção contra intervenção administrativa arbitrária.

## Funções, grants e RLS

Todas as oito funções novas são SECURITY DEFINER com search_path vazio, referências a tabelas/funções próprias qualificadas e sem SQL dinâmico.

| Função                                          | EXECUTE efetivo das roles API | Proteção                                                                                   |
| ----------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| set_whatsapp_outbound_transport(uuid, mode)     | authenticated                 | require_admin no banco; ator auth.uid; conta/config bloqueadas                             |
| cancel_whatsapp_outbound_job(uuid)              | authenticated                 | require_admin; somente QUEUED/FAILED; repetição CANCELLED idempotente                      |
| claim_whatsapp_outbound_job(uuid)               | service_role                  | conta ativa/LIVE/geração vigente, disponibilidade e limite; SKIP LOCKED                    |
| begin_whatsapp_outbound_dispatch(uuid, uuid)    | service_role                  | token/lease/status, modo/geração revalidados; início único                                 |
| accept_fake_whatsapp_outbound(uuid, uuid, uuid) | service_role                  | token/lease/início; recibo UUID explicitamente FAKE; repetição do mesmo recibo idempotente |
| fail_whatsapp_outbound_job(uuid, uuid, failure) | service_role                  | token/lease/início; categoria enum fechada; nenhum erro bruto                              |
| recover_whatsapp_outbound_job(uuid)             | service_role                  | somente lease expirada; política depende do marcador de início                             |
| app_private.enqueue_new_whatsapp_draft()        | nenhuma                       | trigger interno AFTER INSERT, na transação do intake                                       |

PUBLIC/anon não executam nenhuma dessas funções. authenticated não executa funções técnicas; service_role não recebe ativação/cancelamento nem chamada direta ao trigger. O worker padrão DISABLED retorna sem acessar o store; FAKE é recusado fora de NODE_ENV=test. A RPC fake é uma operação técnica privilegiada de simulação, sem transporte externo; uma secret administrativa comprometida não deve ser tratada como usuário não confiável.

Nas três tabelas, authenticated tem somente SELECT subordinado a policy ADMIN ativo. AGENT recebe zero linhas, inclusive quando responsável pelo lead da conversa. ADMIN inativo perde leitura/ativação. anon e service_role não têm SELECT ou DML direto. Consulta da UI usa cliente da sessão, nunca secret. Campos internos do job (token/recibo) não são exibidos. Nenhuma RLS ou regra comercial anterior foi alterada.

## Locks e transação

- Ativação/desativação: conta FOR UPDATE → config FOR UPDATE. Ingestão conserva o lock antigo por conta.
- Novo draft: trigger na mesma transação, conta FOR UPDATE → config FOR SHARE → INSERT job + evento ENQUEUED.
- Claim: conta/config FOR SHARE → job FOR UPDATE SKIP LOCKED; jobs diferentes podem ser reivindicados simultaneamente.
- Begin: conta/config FOR SHARE → job FOR UPDATE. Confirma dispatch_started_at antes de chamar provider. Repetir begin com o mesmo token é recusado.
- Aceitação/falha/recuperação/cancelamento: lock do job, sem buscar locks de conta depois. A auditoria participa da mesma transação.

Falha em job ou auditoria do enqueue reverte inbound, webhook_event, contato, conversa, sessão, turno e draft. No último turno, também reverte lead, vínculo, dois eventos comerciais e COMPLETE. A migration não substitui ingest_whatsapp_events ou funções privadas do intake.

## Retry e PROCESSING abandonado

| Situação                                                            | Resultado                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Claim                                                               | PROCESSING, token novo, attempts + 1, lease de 2 minutos                                    |
| Provider DISABLED                                                   | Sem claim, begin ou rede                                                                    |
| Falha conhecida sem aceitação: RATE_LIMITED / TEMPORARY_UNAVAILABLE | QUEUED, backoff 30/60/120/240 s; no quinto claim, FAILED                                    |
| PERMANENT_REJECTION                                                 | FAILED sem retry                                                                            |
| NETWORK_UNCERTAIN / PROVIDER_EXCEPTION                              | RECONCILIATION_REQUIRED, sem claim futuro                                                   |
| Lease expirada antes de begin                                       | QUEUED com backoff e novo token no próximo claim; quinto claim vira FAILED                  |
| Lease expirada depois de begin                                      | RECONCILIATION_REQUIRED, nunca retry cego                                                   |
| Resposta de begin perdida                                           | Worker não chama provider; recuperação conservadora pelo marcador persistido                |
| Aceitação fake ocorreu mas commit/resposta se perdeu                | Worker não repete envio; resultado confirmado ou PROCESSING exige recuperação/reconciliação |

O backoff SQL tem teto de 300 segundos; na política atual, as quatro reentradas utilizam 30/60/120/240. Tentativas pré-dispatch abandonadas também consomem o limite. Não há reaper, scheduler ou loop infinito instalado. Um begin bloqueado por desativação deixa o claim aguardando expiração/recuperação; a geração antiga continua retida. Desativar depois de begin não desfaz uma operação já iniciada.

**Network side effect + commit PostgreSQL não são uma transação única.** Não há promessa de exactly-once externo. A futura 03B2B precisa de evidência real, reconciliação e deadline do provider compatível com a lease, sem reaproveitar recibos fake.

## Testes e concorrência real

Validação final dos comandos registrada em VALIDATION.md. Testes novos: banco (fronteira/upgrade/rollback/grants/RLS/retry/fencing), worker (DISABLED, FAKE, perda de resposta, erro sanitizado), UI (diagnóstico somente leitura e sem simular envio), guardas do harness local. Regressões 01–03B1 e HMAC preservadas.

PostgreSQL nativo **17.11**, cluster local descartável, múltiplas conexões TCP independentes. 001–012 aplicadas a banco vazio; roles/auth.uid de teste. Isso não substitui Auth/PostgREST do Supabase.

| Cenário nativo                    | Resultado observado                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Dois workers, mesmo job           | Segundo retorna NULL enquanto o primeiro mantém lock; um claim efetivo                            |
| Primeiro claim faz rollback       | Job pode ser reivindicado, attempts final 1                                                       |
| Jobs diferentes                   | Ambos reivindicados antes de qualquer commit; dois ACCEPTED_FAKE, zero messages OUTBOUND          |
| Webhook duplicado simultâneo      | Lock observado; um inbound, um draft, um job; segunda RPC duplicates=1                            |
| Draft duplicado                   | Constraint 23505, permanece um job                                                                |
| Ativação simultânea               | Uma generation/fronteira e um evento; zero jobs históricos                                        |
| Draft vence ativação              | Draft histórico; zero jobs                                                                        |
| Ativação vence draft              | Um job da nova geração                                                                            |
| Desativação vence claim           | Claim NULL                                                                                        |
| Claim vence desativação           | Claim existe; begin posterior bloqueado                                                           |
| Falha forçada no enqueue          | Zero contatos/conversas/mensagens/webhook_events parciais; evento anterior de ativação preservado |
| Backend encerrado antes de begin  | Lease avançada só na fixture; QUEUED com backoff/token novo                                       |
| Backend encerrado depois de begin | RECONCILIATION_REQUIRED; nenhum novo claim                                                        |

**13 cenários nativos da outbox aprovados**, sem deadlock permanente ou timeout inesperado. **7 cenários nativos anteriores do intake aprovados** com 012 aplicada, incluindo corrida auto/manual e rollback do vencedor. Os testes de crash encerram o backend PostgreSQL e encurtam apenas a lease da fixture para não esperar dois minutos.

## Medição local de carga

Duas conexões, 40 operações por cenário, PostgreSQL 17.11 local em Windows, transport LIVE somente nas fixtures; sem rede Meta, HTTP, TLS remoto ou tempo de provider. Medição curta, sem comparação de capacidade/SLO com produção.

| Cenário                                                              | Operações | Total (ms) | Operações/s | p50 (ms) | p95 (ms) |
| -------------------------------------------------------------------- | --------- | ---------- | ----------- | -------- | -------- |
| Uma conversation, 40 respostas inválidas em NAME gerando drafts/jobs | 40        | 121,4      | 329,4       | 2,4      | 33,2     |
| 40 conversations na mesma conta                                      | 40        | 109,9      | 364,0       | 2,8      | 26,1     |
| 40 jobs, dois workers, begin + aceite fake                           | 40        | 74,5       | 536,9       | 3,0      | 5,9      |

A primeira linha inclui uma saudação de preparação fora das 40 operações, resultando em 41 drafts/jobs. A segunda começa em fixture limpa, com 40 drafts/jobs. A terceira processa esses 40 jobs, todos ACCEPTED_FAKE e zero messages OUTBOUND. Nenhum lock antigo foi otimizado ou removido. A serialização de ingestão por conta continua sendo limite conhecido.

Reprodução: OUTBOUND_TEST_DATABASE_URL deve apontar para um banco local vazio diferente em cada execução; rodar `pnpm test:outbound:concurrency` e `pnpm benchmark:outbound`. Para regressão antiga, outro banco local vazio e INTAKE_TEST_DATABASE_URL com `pnpm test:intake:concurrency`. Resultados brutos desta rodada permanecem fora do Git em work/phase03b2a.

## Pendências e riscos conhecidos

- Migration 012 não aplicada remotamente; UI autenticada/Auth/PostgREST da 03B2A ainda não homologados. Tests SSR e SQL não equivalem a essa validação.
- Sem adapter Meta, token, ativação remota, executor automático ou reconciliação externa. 03B2B exige revisão própria antes de qualquer envio.
- Intakes de transações HTTP diferentes seguem aquisição do lock, não reordenação retroativa por provider_timestamp. O lock por conta serializa ingestões e pode disputar brevemente com claim/begin.
- Não há garantia de ordem de entrega externa entre jobs da mesma conversa. Antes de transporte real, definir também validade/cancelamento de perguntas pendentes após avanço do intake ou conversão manual; não enviar prompts obsoletos indiscriminadamente.
- Lease fixa de dois minutos, sem heartbeat; operações futuras demoradas/ambíguas exigem reconciliação. Não permitir retry de provider que talvez tenha aceitado.
- Jobs QUEUED de gerações anteriores ficam retidos, sem operação de retomada nesta fase. Reconciliação é estado explícito, não uma função já implementada de consulta à Meta.
- Backlog de drafts históricos nunca é fila. Uma futura implementação não deve criar caminho de backfill ou transformar o receipt fake em evidência real.

## Arquivos

Novos:

- supabase/migrations/202611120012_whatsapp_outbound_outbox.sql
- src/domain/whatsapp-outbound.ts
- src/lib/whatsapp/outbound-provider.ts
- src/lib/whatsapp/outbound-worker.ts
- src/lib/whatsapp/outbound-store.ts
- src/lib/whatsapp/outbound-queries.ts
- src/components/whatsapp-outbound-panel.tsx
- tests/whatsapp-outbound-database.test.ts
- tests/whatsapp-outbound-worker.test.ts
- tests/whatsapp-outbound-ui.test.ts
- tests/whatsapp-outbound-local-safety.test.mjs
- tests/whatsapp-outbound-concurrency.mjs
- tests/support/outbound-postgres.mjs
- PHASE03B2A_REVIEW.md

Alterados:

- src/lib/database.types.ts
- src/app/(panel)/conversations/[id]/page.tsx
- tests/whatsapp-intake-database.test.ts
- tests/whatsapp-intake-ui.test.ts
- tests/whatsapp-ui.test.ts
- tests/conversation-conversion-ui.test.ts
- package.json
- vercel.json
- README.md
- AGENTS.md
- VALIDATION.md
