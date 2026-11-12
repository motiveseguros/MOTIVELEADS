# Regras persistentes — MOTIVE LEADS

## Escopo

Fases 01, 02A, 02B e 02C homologadas pelo usuário. Meta inbound homologada somente com número de teste. Fase 03A homologada em staging. Fase 03B1 homologada em staging em 12/11/2026: migration 011 remota, coleta determinística sem transporte, criando lead NEW sem responsável. Preservar distribuição manual, RLS e ingestão. Sem número oficial, envio real ou IA/LLM.

## Stack

Next.js App Router nativo, TypeScript strict, Tailwind CSS, shadcn/ui, Supabase PostgreSQL/Auth/RLS, ESLint e Git. Não substituir o framework por outro runtime.

## Arquitetura

- Separar domínio/validação, UI, ações de servidor e acesso a dados.
- Produtos vêm do banco. Seguro Auto e Consórcio aparecem apenas na migration de dados iniciais.
- Não usar any, casts para esconder erros, chaves sensíveis no browser ou permissões apenas visuais.
- Funções SQL são a fonte de verdade para transições/atribuições. Não duplicar essas regras em clientes.
- Toda ação importante de lead gera auditoria transacional; não permitir edição/exclusão de histórico.
- Toda alteração de schema deve ser uma migration versionada. Depois de aplicada a um ambiente compartilhado, nunca editar uma migration existente.
- Manter database.types.ts sincronizado com migrations.
- SECURITY DEFINER precisa de search_path vazio, objetos qualificados, grants mínimos e autorização explícita.
- Server Actions verificam usuário/role no servidor e validam entradas; consultas comuns preservam RLS.
- SUPABASE_SECRET_KEY apenas no módulo server-only administrativo, bootstrap e persistência autenticada de webhooks. A UI de conversas usa sessão do usuário e RLS. Nunca prefixar a secret key com NEXT_PUBLIC.
- Nunca criar bypass de autenticação, senha fixa, modo demo disfarçado ou dados de cliente em testes.

## Permissões

ADMIN gerencia equipe, catálogo, leads e atribuições.
AGENT acessa somente seus leads, altera sua disponibilidade, inicia e finaliza atendimento.
Inativos não têm acesso, mesmo com token válido. Não usar user_metadata para conceder ADMIN.

## Operação

- Atribuir/transferir somente por ADMIN, a funcionário ativo e especializado em produto ativo. AVAILABLE/BUSY/AWAY/OFFLINE não bloqueiam a RPC.
- Na interface, mostrar disponibilidade, priorizar AVAILABLE e exigir confirmação explícita para BUSY/AWAY/OFFLINE. Disponibilidade é informação operacional, não autorização.
- Transferência retorna a ASSIGNED; encerrados não reabrem nesta fase.
- Disponibilidade é manual.
- Não desativar funcionário com lead aberto ou remover especialidade desses leads.
- Não desativar o próprio administrador.
- Preservar controle de concorrência e histórico no mesmo commit de banco.
- Novos campos/ações devem preservar loading, empty, error, labels e responsividade.

## Qualidade

Antes de concluir mudanças relevantes: pnpm lint, pnpm typecheck, pnpm test, pnpm build.
Testar regras/permissões no banco, incluindo caminhos de negação. Evitar testes que apenas reproduzem detalhes de implementação.
Executar pnpm format:check. Manter arquivos pequenos e nomes claros.
Não declarar homologação Auth/PostgREST ou deploy sem executá-los. Documentar limites e pendências reais.
Atualizar README e VALIDATION quando setup, arquitetura ou verificação mudar.

## WhatsApp — Fase 02A

- Contact não é Lead. Preservar requisitos e distribuição de leads; conversas podem não ter lead.
- Não editar migrations 001–009. A correção de A01/A02 permanece na migration 008; F03 é corrigido exclusivamente pela 009. Criar novas migrations; nunca executar db push remoto automaticamente.
- Ingestão passa por RPC atômica, somente service_role. IDs internos são resolvidos no banco, não aceitos do payload.
- ADMIN lê todas as contas/contatos/conversas/mensagens; AGENT lê somente conversas e mensagens de leads atualmente atribuídos a ele.
- webhook_events não recebe acesso de usuários; histórico não é editável/excluível pela aplicação.
- Verificar autenticidade nos bytes brutos antes de decodificar JSON. POST permanece fechado com 503 sem autenticador; token de GET não autentica POST. Não adicionar bypass de desenvolvimento.
- Nesta fase parser suporta texto e callbacks de status. Rejeitar formatos desconhecidos sem gravar dados parciais; nunca simular envio real.
- Unicidade, idempotência, timestamps monotônicos e estados fora de ordem devem ser testados no SQL.
- Não guardar tokens/headers em tabelas/logs. Persistir somente payload normalizado por campos permitidos.

## A01/A02 — política obrigatória de ingestão

- Identidade inbound imutável: kind, waba_id, phone_number_id/conta resolvida, external_message_id, wa_id, type, text_body e provider_timestamp. Diferenças reais nesses campos continuam recusadas.
- display_name é metadado opcional do contato; não participa da identidade da mensagem. Nome diferente, ausente ou null não invalida duplicata.
- Só preencher contacts.display_name se o valor atual for NULL e o recebido não for vazio após normalização explícita de whitespace da migration 009. Nunca substituir/apagar nome existente por ingestão. Primeiro nome válido processado prevalece, sem escolher o evento mais recente.
- Duplicata válida pode preencher um nome ainda NULL, mas não recria mensagem/conversa nem reescreve o histórico técnico; conversa fechada permanece fechada. Todo preenchimento participa da transação do lote.
- Atualização posterior de perfil/nome será operação explícita distinta em etapa futura; não implementá-la nesta correção.
- Preservar regressões permanentes para metadados ausentes/diferentes, divergência imutável, lote misto, eventos atrasados e upgrade 007→008.

## F03 — normalização de whitespace

- Normalizar apenas as bordas da entrada usando Unicode White_Space explícito no SQL: U+0009–000D, 0020, 0085, 00A0, 1680, 2000–200A, 2028, 2029, 202F, 205F, 3000. Resultado vazio é NULL; preservar caracteres internos e nomes existentes com conteúdo.
- A migration 009 converte somente nomes antigos vazios/whitespace-only para NULL. Não reescrever mensagens, conversas ou eventos; não alterar A01/A02, autorização ou RLS.
- Manter testes de tabulação, LF/CR, NBSP, misturas, preenchimento posterior, duplicata fechada, atomicidade e upgrade 008→009.

## Scripts de homologação remota controlada

- pnpm homologate e pnpm homologate:whatsapp:cleanup exigem confirmação interativa vinculada ao project-ref antes de abrir conexão. Nunca executar automaticamente como teste/build.
- .env.local fornece a secret para a RPC HTTP e WHATSAPP_HOMOLOGATION_DATABASE_URL administrativa do mesmo projeto para conta fictícia, leitura e cleanup. TLS verificado, sem log de credenciais. Essa separação respeita os grants existentes.
- Homologação e cleanup exigem SUPABASE_DATABASE_CA_PATH apontando para o CA oficial do PostgreSQL baixado do painel Supabase. Resolver caminhos relativos na raiz do projeto, validar leitura/PEM e usar ssl.ca com rejectUnauthorized true. A URL não depende de sslmode=require; nunca permitir parâmetros sobrescreverem o TLS, expor paths/credenciais em erros ou desabilitar verificação TLS.
- Somente a conta de homologação pode ser inserida diretamente. Contact/conversation/message são criados exclusivamente pela RPC. IDs, timestamp e payload são fixos; não aceitar overrides.
- Cleanup só por IDs e valores exatos após validar toda a fixture em transação; abortar em colisões, lead vinculado, registros extras ou conteúdo divergente. Não conceder novos grants, criar migrations nem alterar schema para esses scripts.
- Preservar testes locais de confirmação, isolamento, idempotência e rollback; não confundir testes PGlite/HTTP simulado com homologação remota.

- Exceção operacional explicitamente autorizada: vincular a conversa fictícia validada a lead aberto de Consórcio atribuído à Bruna, usando IDs inspecionados, locks, revisão esperada e recibo local antes do commit. Sem alterar lead, atribuição ou RLS. Reversão específica somente pelo recibo do mesmo projeto/lead/revisão; cleanup geral continua recusando lead vinculado. Recibo em .homologation/ ignorado pelo Git, sem credenciais.

## Fase 02C1 — assinatura do POST

- WHATSAPP_APP_SECRET é exclusivamente server-side, em .env.local ignorado pelo Git ou Vercel Secret; nunca NEXT_PUBLIC, código, testes ou logs. Fixtures de teste usam apenas segredos fictícios.
- Validar X-Hub-Signature-256 no formato sha256= mais 64 dígitos hex, calcular HMAC-SHA256 dos bytes crus com crypto nativo e comparar buffers de tamanho igual com timingSafeEqual. Não normalizar/reescrever corpo ou chave.
- Assinatura inválida/ausente: 403 antes de JSON.parse/parser/cliente Supabase/RPC. Segredo ausente: fail closed, 503 em requisições JSON dentro do limite. Guardas anteriores preservam 415/413/400.
- GET usa apenas WHATSAPP_WEBHOOK_VERIFY_TOKEN; não autentica POST. Ausência do App Secret não pode ter bypass de desenvolvimento/produção.
- Não registrar body, assinatura, digest, segredos, dados pessoais ou erros brutos. Preservar testes HMAC, bytes diferentes para JSON equivalente, limites, GET e negação de acesso ao parser/banco.
- Preparar Vercel Secret e documentação não autoriza conectar Meta, alterar o staging, fazer deploy ou aplicar migrations automaticamente.

## Provisionamento do número de TESTE

- Exceção administrativa explicitamente autorizada: pnpm provision:whatsapp pode criar/reativar/atualizar somente META TEST NUMBER para o par WABA/Phone Number ID de teste autorizado, após confirmação interativa do projeto e número. Nunca executar automaticamente.
- .env.local fornece WHATSAPP_TEST_WABA_ID, WHATSAPP_TEST_PHONE_NUMBER_ID, WHATSAPP_TEST_DISPLAY_PHONE_NUMBER, WHATSAPP_HOMOLOGATION_DATABASE_URL e SUPABASE_DATABASE_CA_PATH. Reutilizar CA com rejectUnauthorized=true; não requer secrets HTTP nem acesso à Meta.
- Recusar destinos fora da lista autorizada e colisões de identidade. Preservar MOTIVE HOMOLOGACAO, outras contas e todas as tabelas de mensagens/leads. Sem DELETE, migrations, RLS, número oficial, chatbot ou envio.
- Repetição deve preservar o estado; validar rollback, proteção da fixture e confirmação antes de conectar. Saída restrita aos cinco campos da própria conta e mensagens fixas sanitizadas.

## Webhook Meta — exceção autorizada de teste (05/11/2026)

- Usuário autorizou configurar somente o app MOTIVE LEADS 1139169371917116 e número de teste +1 (555) 156-4835, Phone Number ID 1519898697862586, WABA 1169885138706340. O ID 1281001924190390 identifica o portfólio empresarial; não usá-lo como WABA.
- Callback de staging verificado e somente messages assinado (v27.0). Preservar GET verify token distinto de App Secret do POST. Não publicar app, registrar número oficial, enviar mensagens ou ampliar assinaturas automaticamente.
- A correção administrativa autorizada do WABA foi específica para META TEST NUMBER, mantendo active=true; não tornar o provisionador permissivo para identidades divergentes.
- Configuração de callback/assinatura do campo não comprova entrega inbound, persistência ou associação via subscribed_apps. Homologar isso separadamente, sem afirmar sucesso end-to-end antes de observar.

## Fase 03A — Conversa → Lead

- Migration 010 adiciona convert_conversation_to_lead. Não aplicar remotamente ou publicar a Fase 03A sem instrução; o marco phase-02c-homologated permanece anterior a essa implementação.
- ADMIN ativo obrigatório na Server Action e na RPC, inclusive no caminho de retry. Cliente da sessão autenticada, nunca secret administrativa. AGENT não converte mesmo que tenha acesso à conversa.
- Bloquear conversa FOR UPDATE antes de decidir/criar. Conversa OPEN sem lead cria via create_lead existente, vincula UUID retornado e registra evento de conversão na mesma transação. Preservar CREATED e FK; sem lead_id/responsável/ator arbitrário na entrada.
- Primeiro sucesso prevalece. Repetição retorna lead existente sem alterar dados/histórico; não criar outro lead ou reabrir conversa. Nenhuma deduplicação global por telefone foi introduzida.
- Dados editados no formulário ficam no lead. Não sobrescrever contato nem mensagens. Atribuição continua separada pelo fluxo da Fase 01, com acesso AGENT derivado da RLS existente.
- Testar rollback nas três etapas, retry, autorização negativa, produto inválido, histórico e RLS após distribuição. Concorrência de conexões reais e UI/PostgREST permanecem pendências explícitas até homologação.

## Fase 03B1 — coleta sem transporte

- Não editar migrations 001–011: a 011 foi aplicada remotamente com autorização e homologada em 12/11/2026. Código 1538857 publicado na main; marco phase-03b1-homologated. O bloqueio de Preview continua exclusivo de phase-03b1-review. Novas migrations/deploys e implementação da 03B2 exigem autorização própria.
- Estado/validação/idempotência/conclusão residem no banco. Somente novos inbounds chegam ao intake, na mesma transação de ingestão. Duplicata não reaplica turno, inclusive de mensagens anteriores à migration.
- Primeira mensagem abre NAME e gera pergunta; respostas seguintes avançam NAME → PRODUCT → LOCATION → EMAIL → SUPPLEMENTAL → COMPLETE. Produtos ativos resolvidos por nomes/aliases auditáveis, nunca UUID fixo.
- Telefone vem do contato/wa_id; nunca perguntar, inventar ou distribuir automaticamente. COMPLETE cria NEW sem responsável; telefone ausente exige revisão sem conclusão.
- Rascunhos DRAFT em tabela própria não são mensagens enviadas. Não ligar worker, Graph API ou transporte real, nem reprocessar backlog automaticamente. A futura 03B2 exige marco explícito de ativação; drafts históricos da 03B1 nunca devem ser enviados retroativamente.
- Conclusão técnica privada não recebe ator externo e não relaxa conversão ADMIN-only. Auditoria explícita WHATSAPP_INTAKE com actor_id NULL somente nos dois eventos de criação automática; ações humanas mantêm auth.uid().
- RLS nova: ADMIN lê sessão/drafts, AGENT recebe dados comerciais pelo lead/conversa atribuídos; nenhuma escrita direta da API.
- Preservar A01/A02/F03 e a ordem de preenchimento de display_name. Ordenar por timestamp/posição somente o processamento de intake dos UUIDs realmente novos, depois da ingestão original.
- Concorrência nativa é opt-in, exclusivamente em PostgreSQL local vazio e isolado; nunca usar conexão administrativa remota para esses testes.
