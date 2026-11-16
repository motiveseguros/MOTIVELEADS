# Fase 03B2B1 — validade e ordem, revisão local

Base: `phase-03b2a-homologated`, commit `2e2c3a5`. Data: 16/11/2026. Publicação autorizada somente na branch `phase-03b2b1-review`, com Preview bloqueado. Única migration nova: `202611160013_whatsapp_prompt_validity.sql`. Migrations 001–012 preservadas. Não houve db push, conexão remota nesta fase, alteração da main, tag, deploy, credencial ou envio Meta.

## Decisões SQL

Jobs recebem draft_sequence, validity_version e cancellation_reason. Sequência vem do identity do draft; created_at não decide precedência. O diagnóstico seleciona o último job pela mesma sequência.

Cada INSERT de draft bloqueia sua conversation e invalida jobs anteriores QUEUED/PROCESSING cujo dispatch_started_at seja NULL, inclusive com transporte desligado. A invalidação é parte da transação do inbound/intake: estado CANCELLED, motivo PROMPT_SUPERSEDED, token/lease revogados, attempts preservado e evento técnico com actor_id NULL. Drafts e mensagens não são apagados. Respostas inválidas e lotes com vários turnos seguem a mesma regra: somente o último prompt permanece elegível.

Trigger de UPDATE de conversations invalida prompts ao vincular lead ou fechar a conversa, com motivos CONVERSATION_CONVERTED e CONVERSATION_CLOSED e eventos próprios. Não substitui a RPC ADMIN-only de conversão. Falha na auditoria reverte também conversão/fechamento/inbound. Cancelamento explícito do ADMIN usa ADMIN_CANCELLED e mantém auth.uid no evento CANCELLED.

A conclusão automática invalida prompts antigos no vínculo do lead e cria depois um draft de confirmação. O predicado de validade aceita esse draft apenas para sessão COMPLETE e turno com outcome/step_after COMPLETE. Para perguntas comuns, exige conversation OPEN sem lead, sessão ACTIVE, etapa correspondente e nenhum draft mais recente. Não basta verificar lead_id NULL.

## Última barreira e ordem

Claim e begin consultam validade no banco. Begin revalida também conta ativa, modo LIVE, geração, claim/token/lease, ausência de dispatch anterior e predecessor bloqueante. Token revogado produz erro controlado 40001; estado não elegível produz NULL. O worker existente retorna sem chamar provider nos dois casos, inclusive com prova integrada ao SQL nos testes.

Predecessor é qualquer job com draft_sequence menor na mesma conversation cujo estado não seja ACCEPTED, FAILED ou CANCELLED. RECONCILIATION_REQUIRED bloqueia: não é terminal para ordem. O filtro atravessa gerações e inclui jobs legados. Um índice UNIQUE parcial impede estruturalmente dois PROCESSING na mesma conversation.

Uma tentativa já iniciada nunca é invalidada automaticamente, mesmo se chegar novo prompt, converter ou fechar a conversa. Preserva status/marcador/token/evidência. O sucessor aguarda resultado. Se begin vencer a corrida, sua autorização já foi emitida e não pode ser revogada retroativamente; uma futura chamada externa pode ocorrer depois do inbound/conversão. Se a mudança vencer, begin não autoriza. Não se promete cancelamento de efeito externo nem exactly-once.

A 013 elimina retry automático após begin: RATE_LIMITED, TEMPORARY_UNAVAILABLE e PERMANENT_REJECTION (recusas conhecidas pelo contrato atual) terminam FAILED; NETWORK_UNCERTAIN e PROVIDER_EXCEPTION exigem RECONCILIATION_REQUIRED. Expiração depois de begin também exige reconciliação. O adapter futuro deverá classificar respostas reais conservadoramente. Backoff/limite de cinco claims permanece somente para recuperação antes do dispatch. Eventos e dispatch_started_at não são apagados.

## Locks

- Ingestão mantém o lock legado de contas ordenadas, depois conversation; trigger de draft usa conversation → config SHARE → jobs em ordem de sequência.
- Claim: account SHARE → conversation UPDATE SKIP LOCKED → config SHARE → job UPDATE SKIP LOCKED. Account SHARE impede alteração de config pela ativação enquanto a candidata é escolhida.
- Begin: account SHARE → conversation UPDATE → config SHARE → job UPDATE.
- Conversão/fechamento já bloqueiam conversation; o trigger toma somente jobs, sem voltar a account/config. Aceitação/falha/recuperação/cancelamento tomam somente job e não voltam a conversation.
- Conversations ocupadas são puladas como unidade no claim, permitindo outras conversations em paralelo. Uma sessão bloqueada não leva um worker a ultrapassar o predecessor.

Essa ordem foi exercitada em PostgreSQL nativo. A serialização da ingestão por conta permanece; não foi feita otimização de throughput nesta fase.

## Upgrade 012 → 013

Jobs existentes recebem apenas sequência derivada do draft e validity_version=0 (legado retido). Os dois QUEUED da homologação não mudam status, attempts, geração, tokens ou marcador. Config e auditoria existentes ficam intactas; nenhum job/mensagem é criado, nenhuma conta fica LIVE. Cancelamentos humanos anteriores recebem o motivo ADMIN_CANCELLED.

Novos jobs recebem validity_version=1. Não há RPC para promover versão antiga; reativação não autoriza legado. Um novo inbound pode invalidar legitimamente um prompt legado ainda não iniciado, mas nunca o torna enviável. Um legado com dispatch iniciado continua exigindo conclusão/reconciliação; não há ferramenta nova de resolução nesta fase.

Se houver mais de um PROCESSING legado na mesma conversation, preflight aborta antes de alterar schema/dados. Isso evita descartar evidência para criar o índice único. Exige revisão/reconciliação explícita prévia; não é um estado encontrado nem alterado no remoto nesta entrega.

## Segurança e escopo

As três funções internas novas são SECURITY DEFINER com search_path vazio, nomes qualificados, sem SQL dinâmico e EXECUTE revogado de PUBLIC/anon/authenticated/service_role. As funções substituídas conservam grants mínimos: técnicas somente service_role, cancelamento authenticated com require_admin. RLS/tabelas comerciais e ingestão das fases anteriores não foram alteradas. ADMIN lê diagnóstico; AGENT não lê config/jobs/events; roles API não fabricam versão, sequência ou motivo.

Provider padrão DISABLED, FAKE somente em testes, nenhum executor/cron/adapter real novo. Nenhuma mensagem OUTBOUND é criada. UI continua somente diagnóstico, agora com motivo de invalidação e retenção de legado. Tipos de database.types.ts continuam sincronizados por sua importação de OutboundJob/OutboundEvent, atualizados no domínio.

## Provas

Testes permanentes cobrem A–N da especificação, upgrade com dois jobs, preflight de legado inconsistente, rollback das três invalidações, revalidação independente no begin (com triggers desativados somente na fixture local), fencing do worker pelo SQL, grants e diagnóstico.

PostgreSQL 17.11 nativo local, conexões TCP independentes: 10 novos cenários aprovados, com locks observados nos dois sentidos de begin/inbound, begin/conversão, begin/close e draft/claim; mesma conversation sem ultrapassagem; duas conversations progredindo antes dos commits. Também passaram os 13 cenários anteriores da outbox e os 7 do intake. Zero OUTBOUND, nenhum deadlock permanente ou timeout inesperado. Isso não é homologação remota Auth/PostgREST.

Reprodução: banco LOCAL vazio `motive_outbound_test_<sufixo>`, OUTBOUND_TEST_DATABASE_URL e `pnpm test:outbound:validity:concurrency`. Harness rejeita destino remoto e não lê .env.local. Logs em work/phase03b2b1 fora do Git; cluster encerrado e senha temporária descartada. Resultados dos comandos em [VALIDATION.md](VALIDATION.md).

## Pendências antes da 03B2B2

Revisão da 013, autorização separada de dry-run/aplicação e homologação em staging. Nenhum job remoto foi executado ou reativado. Resolver evidência real/reconciliação/adapter somente em fase autorizada. Não transformar drafts históricos em fila nem promover jobs validity_version=0. Este gate assegura validade no instante do begin; não consegue recolher uma autorização já emitida.

## Arquivos da entrega

Novos: supabase/migrations/202611160013_whatsapp_prompt_validity.sql; tests/whatsapp-outbound-validity.test.ts; tests/whatsapp-outbound-upgrade.test.ts; tests/whatsapp-outbound-validity-concurrency.mjs; PHASE03B2B1_REVIEW.md.

Alterados: src/domain/whatsapp-outbound.ts; src/components/whatsapp-outbound-panel.tsx; src/lib/whatsapp/outbound-queries.ts; src/lib/whatsapp/outbound-worker.ts (comentário); tests/whatsapp-outbound-database.test.ts; tests/whatsapp-outbound-ui.test.ts; package.json; vercel.json; README.md; AGENTS.md; VALIDATION.md.

Resultado final: 471 testes em 22 arquivos; lint, typecheck, build, format e format:check aprovados. Migrations 001–012 idênticas por SHA-256 à base.
