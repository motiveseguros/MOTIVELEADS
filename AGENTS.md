# Regras persistentes — MOTIVE LEADS

## Escopo

Fase 01: central interna de leads. Não implementar WhatsApp, Meta Cloud API, chatbot, automações, distribuição automática ou funcionalidades adicionais sem solicitação explícita.

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
- Service role apenas no módulo server-only de provisionamento e no bootstrap.
- Nunca criar bypass de autenticação, senha fixa, modo demo disfarçado ou dados de cliente em testes.

## Permissões

ADMIN gerencia equipe, catálogo, leads e atribuições.
AGENT acessa somente seus leads, altera sua disponibilidade, inicia e finaliza atendimento.
Inativos não têm acesso, mesmo com token válido. Não usar user_metadata para conceder ADMIN.

## Operação

- Atribuir somente a funcionário ativo, AVAILABLE e especializado em produto ativo.
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
