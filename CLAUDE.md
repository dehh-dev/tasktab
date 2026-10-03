# tasktab

API REST de tarefas e de prestacao de contas: Express 4 + PostgreSQL 18 no
Docker, migrations com `node-pg-migrate`, interface React 19 + Vite em `web/`
(workspace npm). Node **24.18.0** (`.nvmrc`) — rode `nvm use` antes de tudo.

## Comandos

| O que                                    | Comando                                   |
| ---------------------------------------- | ----------------------------------------- |
| Desenvolver (docker + migrations + tudo) | `npm run dev`                             |
| Rodar so a API / so a interface          | `npm run dev:api` / `npm run dev:web`     |
| Rodar testes                             | `npm test`                                |
| Iterar nos testes (servicos ja no ar)    | `npm run test:watch`                      |
| So os testes puros, sem servico nenhum   | `npm run test:pure`                       |
| E2E da interface                         | `npm run test:e2e`                        |
| Lint / corrigir                          | `npm run lint` / `npm run lint:fix`       |
| Formatar / conferir                      | `npm run format` / `npm run format:check` |
| Criar migration                          | `npm run migrations:create -- nome`       |
| Aplicar / reverter migrations            | `npm run migrations:up` / `:down`         |
| Popular 5 tarefas de exemplo             | `npm run seed`                            |
| Cadastrar usuario (primeiro acesso)      | `npm run users:create -- --email ...`     |
| Subir / parar / remover servicos         | `services:up` / `services:stop` / `:down` |
| Build de producao da interface           | `npm run build` (gera `web/dist`)         |
| Commitar guiado pelo Conventional        | `npm run commit`                          |

- `npm run dev` sobe o container, espera o Postgres, aplica as migrations e
  inicia a API (`:3000`) e a interface (`:5173`). No navegador use a **5173**:
  e o Vite, que faz proxy de `/api`.
- `npm test` e `npm run test:e2e` sao autossuficientes: sobem o Docker e a API
  de teste (`:3001`), e o `post` de cada um **para os containers**. Para
  iterar com os servicos no ar, `npm run test:watch`. **Nunca rode `jest`
  direto** — sem os servicos a suite falha por motivos alheios ao codigo.

## Convencoes

- Backend **CommonJS** (`'use strict'`, `require`); `web/` e **ESM com JSX**.
  O `eslint.config.js` trata os dois como ambientes distintos.
- Imports **relativos**, sem alias. Converter para ESM com imports absolutos
  foi avaliado e adiado, nao esquecido.
- Comentarios em portugues **sem acento**, so para o porque. Texto da API e da
  tela tambem sai sem acento (os testes esperam assim); planilha e PDF
  exportados levam acento.
- **Dinheiro e `integer` em centavos**, sempre — nada de `numeric` nem float.
- Projeto enxuto de proposito: nao adicione dependencia para o que 20 linhas
  resolvem.
- Unica excecao a regra global de so integracao: funcoes puras de parsing,
  testadas em `tests/services/` (ver `tests/CLAUDE.md`).

## Arquitetura

```
routes → authenticate → requireScope → asyncHandler → controller → validator
                                                          ↓  ↓
                                                  ownership  model → Postgres
                             ↓
                         BaseError → onError → { name, message, action, ... }
```

- `src/routes/`: so o mapeamento REST. Todo handler async passa pelo
  `asyncHandler` — o Express 4 nao captura rejeicao de promise.
- `src/controllers/`: orquestra validacao, model e status. Nao monta SQL nem
  objeto de erro.
- `src/validators/`: toda regra de entrada, inclusive `:id` e query string.
- `src/models/`: so SQL, sempre com placeholder. `UPDATABLE_COLUMNS` e o que o
  cliente pode alterar — e o que impede escrita em `id` ou `created_at`.
- `infra/`: erros, handlers do Express e logger.
- Sucesso vem em `{ "data": ... }`, e listagem traz `meta` com
  `{ total, limit, offset }`; erro vem plano, no formato do `toJSON()`. A
  interface consome a mesma API publica, nunca um atalho para o banco.

## Detalhes por assunto

Cada pasta abaixo tem um `CLAUDE.md` com as regras e o porque delas, e o
Claude Code o carrega quando le um arquivo dali. **Leia o do assunto antes de
mexer nele** quando a mudanca comecar em outra pasta — rota nova, por exemplo,
toca auth, middlewares e testes.

| Assunto                                               | Arquivo                               |
| ----------------------------------------------------- | ------------------------------------- |
| Relatorio, comprovante, upload, totais, retencao      | `src/CLAUDE.md`                       |
| Sessao, papeis, escopo e posse, senha, usuarios       | `src/services/auth/CLAUDE.md`         |
| Rate limit, CSP, cache das respostas                  | `src/middlewares/CLAUDE.md`           |
| Variaveis de ambiente, bancos, datas                  | `src/config/CLAUDE.md`                |
| Extracao (texto, QR, OCR), chave de acesso, categoria | `src/services/extraction/CLAUDE.md`   |
| Conferencia e duplicatas                              | `src/services/validation/CLAUDE.md`   |
| Exportacao (planilha, Anexo I, PDF)                   | `src/services/export/CLAUDE.md`       |
| Erros e logs                                          | `infra/CLAUDE.md`                     |
| Migrations e garantias do banco                       | `src/models/CLAUDE.md`                |
| Testes de integracao e puros                          | `tests/CLAUDE.md`                     |
| E2E (Playwright)                                      | `e2e/CLAUDE.md`                       |
| Interface React                                       | `web/CLAUDE.md`                       |
| Container                                             | `docker/CLAUDE.md`                    |
| Backlog, decisoes e o que falta                       | `docs/backlog-prestacao-de-contas.md` |

Regra nova vai para o `CLAUDE.md` do assunto, nao para este. A documentacao
para pessoas fica em `docs/` (o `README.md` aponta cada arquivo): mudou rota,
campo ou comportamento visivel, atualize la tambem.

## Nunca

- Rodar `jest` direto, ou apontar `migrations:up` para algo alem de
  `env.development`.
- Por em `migrations/` qualquer arquivo que nao seja migration: o
  `node-pg-migrate` tenta carregar todos.
- Criar rota em `/api` sem `requireScope` (ou `requireAuth`, para o que so
  precisa de sessao) — o `authenticate` nao barra ninguem, de proposito. Rota
  nova entra tambem em `tests/api/routes.js`.
- Carregar relatorio ou comprovante sem `loadReport` / `loadReceipt`
  (`src/services/auth/access.service.js`): e por fora deles que um vazamento
  entra.
- Aceitar `owner_id` do cliente, em corpo ou query: o dono sai da sessao.
- Trocar `sameSite=lax` por `none` sem introduzir token de CSRF junto.
- Acrescentar caminho novo que leia `password_hash`.
- Logar senha, token, cookie, `raw_text`, `access_key` ou o comprovante
  inteiro — cupom traz CNPJ e as vezes CPF de terceiros. Logue o `id`.
- Usar `console.*` em `src/` ou `infra/` — use `logger` ou `req.log`.
- Usar `new Date(isoString)` numa data `YYYY-MM-DD`: ela anda um dia.
- Abrir e regravar o `.xlsx` do Anexo I com exceljs ou outra lib que
  reconstroi o arquivo.
- Adicionar middleware de CORS: front e back estao sempre na mesma origem.
- Colocar `npm test` no `pre-commit`: o `posttest` derruba o Docker em uso. O
  hook roda so `lint` + `format:check`.

## Commits

O escopo e restrito ao enum de `commitlint.config.js`; o commitlint rejeita o
que ficar fora dele.
