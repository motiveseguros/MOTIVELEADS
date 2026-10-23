# Verificação da Fase 01

Data: 23/10/2026.

| Verificação                          | Resultado                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| ESLint (incluindo --max-warnings 0)  | Aprovado, zero erros e zero avisos                                                 |
| TypeScript strict / tsc --noEmit     | Aprovado                                                                           |
| Vitest                               | 39 testes aprovados em 2 arquivos                                                  |
| Banco PGlite                         | Todas as 4 migrations aplicadas com sucesso; 32 testes SQL                         |
| Validação de entradas                | 7 testes aprovados                                                                 |
| next build                           | Aprovado; 12 rotas geradas, incluindo /_not-found, e proxy                         |
| Compatibilidade de peer dependencies | Sem conflitos                                                                      |
| Formatação Prettier                  | Aprovada                                                                           |
| Smoke HTTP                           | /login = 200; /employees sem configuração/sessão = 307 para /login                 |
| Inspeção visual                      | Tela inicial de configuração conferida no navegador local                          |
| Segredo no bundle de cliente         | 16 arquivos JavaScript inspecionados; zero referências a SUPABASE_SERVICE_ROLE_KEY |

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
