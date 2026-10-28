# Regras persistentes — MOTIVE LEADS

## Escopo

Fase 01 homologada pelo usuário no Supabase remoto. Fase 02A: preparar domínio/backend/RLS e leitura de conversas WhatsApp, sem conectar Meta, usar token real, registrar número, enviar mensagens reais, implementar chatbot, coleta automática, Flows ou distribuição automática.

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
- Não editar migrations 001–008. A correção de A01/A02 permanece na migration 008; F03 é corrigido exclusivamente pela 009. Criar novas migrations; nunca executar db push remoto automaticamente.
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
