# Auditoria final — Fase 03A do MOTIVE LEADS

Conclusão: **Fase 03A apta para dry-run da migration 010.** Auditoria iniciada em 06/11/2026 e concluída em 09/11/2026 (America/Sao_Paulo). Nenhum defeito P0 crítico, P1 alto, P2 médio ou P3 baixo identificado no escopo testado. Nenhuma correção automática foi realizada.

## Escopo e evidências

Revisados migration 010, create_lead e auditoria da Fase 01, guardas ADMIN, Server Action, validação, tela de conversão, histórico e RLS das conversas. Código e migrations foram comparados por SHA-256 com o início desta auditoria. Migrations 001–010 e arquivos de implementação permaneceram sem mudanças. O arquivo gerado next-env.d.ts foi restaurado ao conteúdo inicial após o build. Apenas este parecer e a referência em VALIDATION.md foram acrescentados pela auditoria.

Evidências executáveis fora do repositório: ../../work/audit03a/concurrency-audit.mjs e concurrency-results.json. Script separado de auditoria: cria um banco exclusivo em PostgreSQL local, aplica as migrations reais e aceita somente 127.0.0.1 com o usuário audit_owner. Não lê .env.local nem usa credenciais remotas. Fixtures são fictícias e isoladas. Não é parte do build ou do teste padrão.

PostgreSQL **17.11 nativo para Windows**, obtido pelo [pacote de binários EDB](https://www.enterprisedb.com/download-postgresql-binaries) indicado na [página oficial PostgreSQL](https://www.postgresql.org/download/windows/), iniciado somente em loopback. Duas conexões independentes tiveram backend PIDs 21208 e 20112; uma terceira observou bloqueios e consultas. Isso não é PGlite. O ambiente reproduz roles e auth.uid() para teste, mas não o gateway Auth/PostgREST do Supabase.

## Resultado por requisito

| Verificação              | Resultado                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN ativo obrigatório  | Guarda SQL require_admin antes de ler/bloquear a conversa; requireAdmin na ação de servidor.                                                                                       |
| AGENT via chamada direta | Negado com SQLSTATE 42501, também em retry de conversa já convertida. Nenhum efeito.                                                                                               |
| Forja de perfil/autor    | Metadados com role ADMIN não concedem acesso. Argumento p_actor_id não existe e foi recusado. UPDATE de profiles e conversations por usuário recusado.                             |
| SECURITY DEFINER         | search_path vazio, referências de aplicação qualificadas com public/app_private/auth; sem SQL dinâmico. Built-ins resolvidos no pg_catalog implícito.                              |
| Autor da auditoria       | auth.uid(); não vem do formulário. Eventos registram lead_id, actor_id, created_at e ação; evento CONVERTED_FROM_CONVERSATION inclui conversation_id.                              |
| Atomicidade              | Criação, vínculo e eventos na mesma transação. Falhas forçadas em inserção do lead, CREATED, vínculo e evento de conversão reverteram todos os registros.                          |
| Locking                  | SELECT FOR UPDATE antes de validar lead_id e antes de create_lead. pg_blocking_pids confirmou que a segunda conexão esperou pela primeira.                                         |
| Integridade              | create_lead existente valida produto ativo, constraints e FK. Nenhum vínculo com UUID de lead fornecido pelo cliente. Sem alteração/movimentação de messages ou perfil do contact. |
| RLS                      | Sem responsável: apenas ADMIN. Atribuição libera responsável, não outro agente. Transferência revoga agente anterior; inatividade também revoga acesso.                            |
| Upgrade                  | 009→010 sobre dados inbound existentes preservou snapshots no PostgreSQL nativo. Suite PGlite também cobriu banco novo 001→010.                                                    |

### Grants efetivos observados no PostgreSQL nativo

| Papel                               | EXECUTE da RPC | Efeito                                                                               |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| PUBLIC                              | Não            | Sem grant público                                                                    |
| anon                                | Não            | Permission denied                                                                    |
| authenticated                       | Sim            | ADMIN e AGENT usam esse papel PostgreSQL; a função exige perfil ADMIN ativo no banco |
| service_role                        | Não            | Permission denied                                                                    |
| audit_owner (owner local da função) | Sim            | Privilégio do proprietário; em Supabase o owner depende do executor da migration     |

Não existe um papel SQL ADMIN separado nesta arquitetura. Dar EXECUTE a authenticated é necessário para o ADMIN autenticado; isso permite ao AGENT invocar a função, mas a guarda bloqueia a operação com 42501. Não confundir autorização de chamada do PostgreSQL com autorização de negócio. A migration não altera grants de tabelas ou políticas RLS. A ACL da 010 ainda não existe no remoto porque ela não foi aplicada lá.

### Concorrência real

| Cenário                                        | Resultado                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mesma conversa, transações sobrepostas         | Segunda sessão bloqueada pela primeira; após commit recebeu o mesmo UUID. **1 lead, 1 vínculo, 2 eventos, 0 órfãos**. Espera total observada ~30,65 ms. |
| SELECT durante conversão não confirmada        | Consulta ADMIN em outra sessão concluiu em ~4,02 ms e viu lead_id NULL; não viu lead parcial.                                                           |
| Duas conversas diferentes simultaneamente      | Ambas as RPCs concluíram antes de qualquer commit: **2 leads, 2 vínculos, 4 eventos**, sem bloqueio cruzado.                                            |
| Primeira operação faz rollback                 | Segunda aguardou e criou o único lead confirmado. Lead transitório da primeira não persistiu; **1 lead e 2 eventos**.                                   |
| Dez disputas adicionais com disparo simultâneo | Cada par retornou o mesmo lead: **1 lead e 2 eventos por conversa**. Nenhum deadlock ou timeout inesperado.                                             |
| Repetição após commit                          | Mesmo UUID; snapshot integral inalterado, sem novo lead/evento.                                                                                         |

Total final do banco exclusivo de teste: **14 leads, 15 conversas, 15 mensagens e 30 eventos**. Os eventos são 14 CREATED + 14 CONVERTED_FROM_CONVERSATION + 1 ASSIGNED + 1 TRANSFERRED. Uma conversa ficou sem lead por ser a fixture dos testes de falha. **Zero leads órfãos.**

Política de repetição: primeiro sucesso prevalece; retorna o lead existente sem revalidar/substituir os campos enviados nem gerar outro evento. Isso vale inclusive após fechamento posterior da conversa. Uma conversa fechada ainda sem lead é recusada. A guarda ADMIN ocorre antes desse retorno idempotente.

### Validação e regressão

| Comando        | Resultado                                                |
| -------------- | -------------------------------------------------------- |
| pnpm lint      | Código 0                                                 |
| pnpm typecheck | Código 0                                                 |
| pnpm test      | Código 0 — **311 testes em 14 arquivos**                 |
| pnpm build     | Código 0                                                 |
| pnpm format    | Código 0; sem reformatação dos arquivos de implementação |

Esses comandos foram reexecutados na etapa inicial desta auditoria; a comparação de hashes na retomada confirmou o mesmo código. O teste nativo separado foi executado em 09/11/2026 e passou. Ele acrescenta comprovação de concorrência/atomicidade/autorização ao resultado do Vitest, sem inflar o total de 311 testes. Bundle do browser: 17 arquivos JavaScript inspecionados; nenhum valor secreto de .env.local nem referência às variáveis administrativas SUPABASE_SECRET_KEY/WHATSAPP_APP_SECRET.

## Defeitos, riscos, pendências e limitações

**Defeitos:** nenhum P0/P1/P2/P3 reproduzido. Nenhuma correção aplicada.

**Riscos operacionais:** manter a migration antes do deploy da interface 03A; publicar o código primeiro faria a nova RPC ficar indisponível. Transações externas longas podem prolongar a espera pelo lock; os testes terminaram sem timeout, mas não constituem ensaio de carga.

**Pendências de homologação:** aplicar a migration somente após autorização, então validar o fluxo Auth/PostgREST/navegador ADMIN e AGENT no staging. O teste nativo comprova os bloqueios SQL, não substitui a infraestrutura de pooler, JWT, rede ou configuração do Supabase remoto. Nenhuma entrega 03A remota é declarada homologada por este parecer.

**Limitações conhecidas preservadas:** idempotência por conversation, não deduplicação global de contatos/leads por telefone. Campos revisados pertencem ao lead, sem atualização do contato. Validação SQL de e-mail é a existente da Fase 01 (tamanho e presença de @); a validação Zod da ação é mais estrita. O teste de roles injeta a identidade somente no ambiente isolado para representar o auth.uid() fornecido pelo gateway; não afirma que um usuário possa escolher identidade via API.

## Dry-run remoto condicionado ao parecer limpo

Em 09/11/2026 foi executado exatamente:

```sh
pnpm exec supabase db push --dry-run --linked
```

Projeto vinculado conferido: frhivqlldgakifqdfpyv. Código de saída **0**, dryRun=true, seeds=[], roles=[]. A única migration listada foi:

```text
202611060010_conversation_to_lead.sql
```

A CLI informou explicitamente que não aplicaria migrations. **Migration 010 não aplicada remotamente.** Não houve db push efetivo, deploy/publicação de código, alteração de Meta ou mudança nas migrations 001–009. Nenhuma conta/lead/mensagem real foi usada nos testes de concorrência.
