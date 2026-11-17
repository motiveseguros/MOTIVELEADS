# Fase 03B2B2 — transporte Meta controlado em revisão

Entrega local de 17/11/2026. Base: phase-03b2b1-homologated, a9cd1784d4ac44168170e0156b7c202c5b9e0f68. Branch: phase-03b2b2-review, Preview desabilitado. Esta entrega não homologa envio real. Não houve acesso ao Supabase remoto, configuração Meta, token real, execução do CLI operacional, db push, deploy, merge na main ou tag.

## Contrato do transporte

Provider padrão DISABLED. META exige simultaneamente WHATSAPP_OUTBOUND_PROVIDER=META, WHATSAPP_OUTBOUND_EXECUTION_ENABLED=true, WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_API_VERSION e WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID válidos. O banco exige conta ativa, LIVE, geração atual, prompt vigente, ordem por draft_sequence, claim/token/lease e janela de atendimento. FAKE continua exclusivo de NODE_ENV=test.

O módulo server-only usa uma única chamada POST para https://graph.facebook.com/{version}/{phone_number_id}/messages, sem redirects nem retry. O exemplo de configuração usa v27.0. Authorization Bearer existe somente no request server-side. O input vem de begin: conta/número, destinatário, texto e job confiáveis do banco; nenhum browser escolhe esses campos.

Payload: messaging_product=whatsapp, recipient_type=individual, to=wa_id, type=text, text={body: draft original, preview_url:false}. Timeout de 15 segundos cobre conexão e leitura; resposta limitada a 65.536 bytes. Uma resposta 2xx só vale com JSON contendo exatamente um messages[].id compatível com wamid; envelope contraditório de erro é recusado. Não se fabrica identificador ou timestamp.

A [referência oficial Message API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api) documenta endpoint, payload e ID da resposta. A aceitação síncrona não é evidência de entrega. O transporte persiste PENDING; somente callbacks autenticados promovem SENT/FAILED/DELIVERED/READ. A [visão geral oficial de webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview) descreve mensagens recebidas e notificações de status. A versão v27.0 foi conferida na [referência Graph API](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account). Nenhum endpoint operacional da Meta foi chamado nesta implementação.

## Janela de atendimento

A [documentação oficial de envio](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages) limita mensagens livres à janela de atendimento de 24 horas. Fora dela, seriam necessários templates, fora deste escopo.

A implementação é conservadora: considera somente inbound com timestamp do provider não futuro, no mesmo contato/conta, usando o menor entre provider_timestamp e created_at. Entrega atrasada não renova uma janela antiga e relógio futuro não a estende. Chamadas não abrem janela neste sistema. Claim e begin revalidam no SQL. Job atual sem dispatch fora da janela é CANCELLED/CUSTOMER_SERVICE_WINDOW_EXPIRED, com evento SERVICE_WINDOW_EXPIRED. Begin retorna NULL e o worker não chama HTTP. A janela pode expirar durante o request em trânsito; uma rejeição explícita da Meta será FAILED, sem retry ou conversão automática em template.

## Migration 014 e integridade

Única migration nova: 202611160014_whatsapp_meta_transport.sql. Hashes das migrations 001–013 permanecem iguais à base homologada. Não há backfill, ativação, promoção de validity_version ou alteração dos jobs legados por upgrade.

- Jobs aceitam provider_kind FAKE/META; outbound_message_id tem FK e UNIQUE; provider_message_id mantém UNIQUE. META ACCEPTED exige ambos os vínculos. FAKE preserva seu contrato e não cria message.
- Evidência de erro restrita a HTTP status e códigos/subcódigos inteiros. Nenhum texto bruto, header ou token é armazenado.
- accept_meta_whatsapp_outbound bloqueia conta SHARE → conversation UPDATE → job UPDATE. Exige token, PROCESSING versão 1, begin registrado e lease válido. Insere uma OUTBOUND/text/PENDING, com sent_by_profile_id e provider_timestamp NULL; atualiza job/vínculo, evento ACCEPTED_META e last_message_at na mesma transação.
- Repetir mesmo job/token/wamid retorna o mesmo UUID sem novo evento/mensagem, inclusive depois do lease. Wamid divergente, token divergente ou wamid ocupado falham. Lease vencido antes da primeira persistência exige reconciliação, sem novo envio.
- Aceitação após dispatch não tenta apagar evidência só porque a conversa avançou/fechou ou o transporte foi desativado. Begin é a última autorização anterior ao request; não se pode desfazer um request já iniciado.
- fail_meta_whatsapp_outbound_job exige tentativa iniciada e claim vigente. Recusa conhecida termina FAILED; resultado incerto termina RECONCILIATION_REQUIRED. Preserva dispatch_started_at e registra evento técnico com actor_id NULL.
- claim/begin preservam invalidação, ordenação, fencing e predecessor em reconciliação da 013. A janela é uma guarda adicional; legados versão 0 continuam inelegíveis.

## Classificação de erros

| Evidência                                                   | Categoria             | Estado persistido       |
| ----------------------------------------------------------- | --------------------- | ----------------------- |
| HTTP 429/código conhecido de limite, envelope Meta válido   | RATE_LIMITED          | FAILED                  |
| HTTP 5xx com erro Meta explícito                            | TEMPORARY_UNAVAILABLE | FAILED                  |
| HTTP 4xx determinístico                                     | PERMANENT_REJECTION   | FAILED                  |
| Timeout/reset/exceção de conexão                            | NETWORK_UNCERTAIN     | RECONCILIATION_REQUIRED |
| JSON/2xx inválido, resposta ambígua ou sem envelope de erro | PROVIDER_EXCEPTION    | RECONCILIATION_REQUIRED |

Somente números e categorias fechadas atravessam a fronteira. Nenhum message/fbtrace_id/body/headers do provider é retornado ou logado. Falha de acceptMeta após resposta aceita produz RECOVERY_REQUIRED; não chama send de novo, não registra falsa recusa e não libera sucessor. Resultado incerto não é recuperado automaticamente.

## Corrida accept × webhook: opção B durável

whatsapp_pending_statuses guarda callback antecipado, ligado ao webhook_event normalizado, conta, wa_id, wamid, status e timestamp do callback. Somente contato já conhecido nessa conta é aceito. Um ID já associado a mensagem de outra conta/contato/direção continua recusado. Desconhecido não cria message nem prova envio.

Conta UPDATE da ingestão conflita com SHARE da aceitação. Se accept vencer, callback encontra a linha; se callback vencer, accept encontra a pendência. A mesma transação da aceitação aplica a precedência PENDING < SENT < FAILED < DELIVERED < READ e marca evento/pendência resolvidos. Um callback READ antecipado pode fazer a transação final já expor READ, mas existe evidência real do webhook: o POST sozinho só cria PENDING. O provider_timestamp da message permanece NULL; timestamp de status não é timestamp de criação/envio.

Há limite de 1.000 pendências não resolvidas por conta. Ao atingir o limite, o lote inteiro falha atomicamente com SQLSTATE 54000 e o HTTP existente responde 503 sanitizado; nada é descartado silenciosamente. Duplicatas não consomem outra entrada. Pendências resolvidas permanecem como evidência. Não há purge/reaper automático; monitoramento e procedimento de reconciliação são pendências operacionais. A solução não depende de uma garantia não verificada de retry da Meta.

## RLS e grants

As RPCs acceptMeta, failMeta e whatsapp_meta_target concedem EXECUTE somente a service_role; PUBLIC/anon/authenticated não executam. Funções privadas de janela/expiração não recebem grants das roles de API. Todas usam SECURITY DEFINER e search_path vazio; referências de aplicação qualificadas. RPCs substituídas preservam os grants restritos anteriores.

whatsapp_pending_statuses tem RLS e nenhum grant para PUBLIC/anon/authenticated/service_role; só as funções privilegiadas a acessam. Não houve relaxamento das políticas comerciais. A nova view message_timeline é security_invoker, SELECT somente authenticated, respeitando RLS das messages. ADMIN lê diagnóstico pela própria sessão; AGENT só vê mensagens normais da conversa atribuída e não recebe config/jobs/events/intake/pendências.

## Histórico e interface

message_timeline fornece timeline_at=COALESCE(provider_timestamp,created_at). Detalhe paginado ordena timeline_at DESC, created_at DESC, id DESC; inbox usa a mesma ordenação para o último texto. Aceitação atualiza last_message_at pela hora local de persistência, sem mudar inbound. Callbacks atualizam a mesma linha e não mudam sua posição por inventar timestamp.

ADMIN distingue META/FAKE/nenhum e, em META PENDING, “Aceito pela Meta · aguardando status”; entrega/lida/falha vêm do status da message associada. AGENT autorizado vê a OUTBOUND comercial usual. Nenhum token, claim token ou resposta bruta é exibido.

## Executor manual: não executado nesta entrega

Comando preparado para homologação futura: pnpm outbound:once <UUID-da-conta-de-teste>. Usa tsx com condição react-server para preservar server-only. Carrega .env.local somente em processo interativo, exige stdin/stdout TTY, um único UUID e frase exata ENVIAR UMA <project-ref> <account-uuid>. Não há --yes nem confirmação por pipe.

Recusa qualquer Phone Number ID fora do teste autorizado 1519898697862586; confere a associação da conta via RPC mínima antes do claim. Mostra apenas projeto, UUID da conta e ID do número de teste. Processa no máximo um job e encerra. Não existe rota HTTP, cron, loop ou caller automático. Não adicionar token/ativar switches nem executar este comando sem autorização específica de homologação.

Dependência adicionada: tsx 4.23.15. Build script de esbuild permanece explicitamente desabilitado em pnpm-workspace.yaml; runtime usa o binário opcional instalado. Não houve upgrade geral de dependências.

## Testes e resultados

| Comando           | Resultado                                                           |
| ----------------- | ------------------------------------------------------------------- |
| pnpm lint         | Aprovado, exit 0                                                    |
| pnpm typecheck    | Aprovado, exit 0                                                    |
| pnpm test         | 558 testes aprovados, 24 arquivos, exit 0                           |
| pnpm build        | Aprovado na repetição, exit 0; aviso de segurança Next.js permanece |
| pnpm format       | Aprovado, exit 0                                                    |
| pnpm format:check | Aprovado, exit 0                                                    |

Cobertura nova inclui HTTP mockado, timeout em fetch/body, limites, ausência de config, alvo divergente, begin recusado, persistência falha sem reenvio; SQL de aceitação/idempotência/colisões, rollback em mensagem/evento/conversa/reconciliação, janela expirada/futura, supersede, predecessor, status fora de ordem, limite de pendências, RLS/grants e upgrade 013→014. Os testes anteriores continuam na suíte, inclusive Fase 01/A01/A02/F03/intake.

Reprodução dos novos cenários: pnpm test:outbound:meta:concurrency com OUTBOUND_TEST_DATABASE_URL apontando para um banco local vazio motive_outbound_test_<sufixo>, loopback e porta explícita. O harness recusa host remoto e nunca carrega .env.local. Use um banco vazio separado para cada suíte.

PostgreSQL 17.11 local, conexões TCP independentes, cluster descartável isolado: 10 cenários Meta + 13 outbox/crash + 10 validade/ordem + 7 intake = 40 aprovados. Os 10 novos cobrem mesmo job, conversas paralelas antes de commit, supersede × begin, accept duplicado, ambos os vencedores accept × callback, falha × callback com predecessor em reconciliação, rollback do accept, liberação do sucessor após ACCEPTED e status concorrente fora de ordem. Não foram usados PGlite como prova de concorrência nem conexões remotas. HTTP externo: zero.

A inspeção dos 17 bundles client não encontrou nomes/valores de secrets locais, token fictício, endpoint graph.facebook.com ou Bearer. Diff e hashes de migrations também foram verificados sem imprimir valores de credenciais. Testes usam apenas identificadores/segredos obviamente fictícios.

## Riscos e pendências antes do primeiro envio

- Homologação real Auth/PostgREST/Meta e aplicação da 014 ainda NÃO executadas. Só depois da revisão, autorização remota e habilitação explícita dos três controles.
- Não existe exactly-once entre HTTP e banco. Aceitação Meta seguida de falha/crash local exige reconciliação operacional; o wamid pode ter sido perdido antes da persistência. Callback pendente preserva evidência, mas não cria aceitação sozinho. Nunca repetir send para resolver isso.
- Pendências desconhecidas e resultados incertos precisam de monitoramento/manual de operação antes de escala. Limite de 1.000 pode bloquear um lote misto; isso é fail closed, não descarte.
- Ingestão serializa por conta. Avaliação de carga continua pendente. Mensagens inéditas entre transações seguem ordem de aquisição do lock, sem reordenação retroativa de respostas do intake.
- Suporte atual: texto, destinatário numérico wa_id, janela de inbound. Templates, chamadas e identidades BSUID sem wa_id não foram adicionados. Nenhum número oficial/token de system user foi configurado.
- Desativar impede novos begin, mas não cancela request já autorizado/em trânsito. Timeout de 15s limita a espera e trata ambiguidade conservadoramente.
- pnpm audit identificou dois avisos moderados: Next.js 16.4.3 ([GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h)) e minimatch ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). São dependências anteriores à fase; não foram atualizadas nesta entrega. O primeiro build foi interrompido pelo aviso de segurança do Next; o resultado da execução final consta acima. Não interpretar aprovação funcional como ausência de risco de dependências; tratar atualização e revalidação separadamente antes de produção.

## Arquivos desta entrega

- .env.example
- AGENTS.md
- PHASE03B2B2_REVIEW.md
- README.md
- VALIDATION.md
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml
- scripts/run-whatsapp-outbound-once.ts
- src/components/whatsapp-outbound-panel.tsx
- src/domain/whatsapp-outbound.ts
- src/lib/database.types.ts
- src/lib/whatsapp/meta-provider.ts
- src/lib/whatsapp/outbound-provider.ts
- src/lib/whatsapp/outbound-queries.ts
- src/lib/whatsapp/outbound-store.ts
- src/lib/whatsapp/outbound-worker.ts
- src/lib/whatsapp/queries.ts
- supabase/migrations/202611160014_whatsapp_meta_transport.sql
- tests/support/outbound-postgres.mjs
- tests/whatsapp-database.test.ts
- tests/whatsapp-meta-concurrency.mjs
- tests/whatsapp-meta-database.test.ts
- tests/whatsapp-meta-provider.test.ts
- tests/whatsapp-outbound-database.test.ts
- tests/whatsapp-outbound-ui.test.ts
- tests/whatsapp-outbound-upgrade.test.ts
- tests/whatsapp-outbound-validity.test.ts
- tests/whatsapp-outbound-worker.test.ts
- tests/whatsapp-ui.test.ts
- vercel.json
