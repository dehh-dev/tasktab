# tasktab

> Este arquivo tem precedencia sobre o `~/.claude/CLAUDE.md` global. O projeto ja
> segue o padrao dos anteriores em **erros**, **testes** e **commits**; o que ainda
> diverge (CommonJS, imports relativos, `env.*` sem ponto) esta na tabela
> "Conflitos com o global", no final. Na duvida, este arquivo vence.

API REST de tarefas em arquitetura MVC: Express 4 + PostgreSQL 18 no Docker,
migrations via `node-pg-migrate`, interface React 19 + Vite em `web/` (workspace
npm). **Todos os testes sao de integracao**, falando HTTP com a API de verdade
contra o banco de verdade.

Node **24.18.0** (`.nvmrc`) — rode `nvm use` antes de qualquer coisa.

## Comandos

| O que                                    | Comando                                   |
| ---------------------------------------- | ----------------------------------------- |
| Desenvolver (docker + migrations + tudo) | `npm run dev`                             |
| Rodar so a API / so a interface          | `npm run dev:api` / `npm run dev:web`     |
| Rodar testes                             | `npm test`                                |
| Iterar nos testes (servicos ja no ar)    | `npm run test:watch`                      |
| Lint / corrigir                          | `npm run lint` / `npm run lint:fix`       |
| Formatar / conferir                      | `npm run format` / `npm run format:check` |
| Criar migration                          | `npm run migrations:create -- nome`       |
| Aplicar / reverter migrations            | `npm run migrations:up` / `:down`         |
| Popular 5 tarefas de exemplo             | `npm run seed`                            |
| Subir / parar / remover servicos         | `services:up` / `services:stop` / `:down` |
| Build de producao da interface           | `npm run build` (gera `web/dist`)         |
| Commitar guiado pelo Conventional        | `npm run commit`                          |

`npm run dev` sobe o container, espera o Postgres aceitar conexoes, aplica as
migrations e so entao inicia API (`:3000`) e interface (`:5173`) em paralelo.
**No navegador use a 5173** — e o Vite, que serve a UI e faz proxy de `/api`
para o Express.

`npm test` e igualmente autossuficiente: o `pretest` sobe o Docker e espera o
banco, o proprio script sobe a API em `:3001` junto do Jest, o orchestrator
aplica as migrations, e o `posttest` para os containers. **Nunca rode `jest`
direto** — sem os servicos e sem a API no ar a suite falha por motivos que nao
tem nada a ver com o codigo. Como o `posttest` derruba tudo, use `test:watch`
enquanto estiver iterando.

## Convencoes

- **Backend e CommonJS** (`'use strict'` + `require` / `module.exports`).
  **Frontend em `web/` e ESM com JSX.** O `eslint.config.js` trata os dois como
  ambientes distintos — nao misture.
- **Imports relativos** (`../config/database`). Nao existe alias nem import
  absoluto a partir da raiz.
- Codigo, nomes de variaveis e descricoes de teste em ingles. **Mensagens de erro
  voltadas ao usuario final em portugues** (e o que os testes esperam). Os
  comentarios do repo sao em portugues sem acento — mantenha o padrao.
- Prettier decide formatacao. Nao discuta estilo — rode `npm run format`.
- Comentario so quando explica **por que**, nao o que o codigo ja diz. O repo
  usa isso para registrar decisao nao obvia (ver o type parser de `DATE` em
  `src/config/database.js`).

## Arquitetura

```
routes → asyncHandler → controller → validator → model → Postgres
                             ↓
                         BaseError → onError → { name, message, action, ... }
```

Cada camada tem uma responsabilidade e so uma:

- **`src/routes/`** — mapeamento REST, nada mais. Todo handler async passa pelo
  `asyncHandler`: o Express 4 nao captura rejeicao de promise sozinho.
- **`src/controllers/`** — orquestra validacao + model + status da resposta.
  Nao monta SQL. Nao monta objeto de erro.
- **`src/validators/`** — toda regra de entrada, incluindo `:id` e query string.
- **`src/models/`** — so SQL, **sempre parametrizado** (`$1, $2, ...`). Colunas
  que o cliente pode alterar ficam em `UPDATABLE_COLUMNS`; e o que impede
  escrita em `id` ou `created_at`.
- **`infra/`** — o que nao e regra de negocio: `errors.js` (hierarquia de erro)
  e `controller.js` (handlers plugados no Express). Fica na raiz, fora de
  `src/`, como nos outros projetos.

No backend a "View" e a representacao JSON produzida pelo controller. A
interface consome a mesma API publica — **nunca** um atalho para o banco.

### Formato das respostas

Sucesso vem envelopado em `{ "data": ... }`; listagem inclui `meta` com
`{ total, limit, offset }`. Erro vem **plano**, no formato do `toJSON()` da
secao seguinte — sem envelope.

## Tratamento de erros

Toda resposta de erro nasce de uma classe em `infra/errors.js` que estende
`BaseError` e serializa via `toJSON()` no formato:

```json
{ "name": "...", "message": "...", "action": "...", "status_code": 000 }
```

| Classe                 | Status | Quando                                         |
| ---------------------- | ------ | ---------------------------------------------- |
| `BadRequestError`      | 400    | id invalido, JSON malformado, corpo nao-objeto |
| `NotFoundError`        | 404    | recurso ou rota inexistente                    |
| `ValidationError`      | 422    | falha de validacao; carrega `details`          |
| `TooManyRequestsError` | 429    | teto de requisicoes estourado                  |
| `ServiceError`         | 503    | dependencia fora do ar (banco)                 |
| `InternalServerError`  | 500    | qualquer erro inesperado                       |

- **Erro esperado** → crie ou reutilize uma classe especifica com seu proprio
  `statusCode`, `message` e `action`. O `action` diz ao usuario **o que fazer a
  seguir** — a interface o exibe abaixo da mensagem, entao nunca deixe vazio.
- **Erro inesperado** → deixe estourar. O `onErrorHandler` converte em
  `InternalServerError` (500) para nao vazar detalhe interno.
- Erro **nosso** com status 5xx (`ServiceError`) e repassado como esta e
  logado; a mensagem publica dele ja nasce segura.
- **Nunca** monte um objeto de erro na mao dentro do controller.
- Sempre repasse a causa original: `new InternalServerError({ cause: error })`.
  E o que preserva o rastro no log quando a mensagem publica e generica.
- `ValidationError` **sempre** popula `details` com `{ field, message }` — e o
  que permite ao `TaskForm` exibir cada erro no campo certo, preservando o que
  foi digitado. Sem isso a UX de formulario regride para um alerta generico.

Os handlers ficam em `infra/controller.js` e sao plugados no Express via
`controller.errorHandlers` (`onNoMatch` e `onError`). O `onError` precisa dos 4
argumentos (`error, req, res, next`) — e a assinatura que marca o middleware
como handler de erro. Nao remova o `next`.

## Testes

So integracao, em `tests/`. Sem mock de banco, sem mock de `fetch`, sem teste
unitario de camada de dados. Se algo parece dificil de testar sem mock, o
problema e o desenho do codigo, nao o teste.

`npm test` sobe a API de verdade em paralelo ao Jest (via `concurrently`) e os
testes falam **HTTP real** contra `http://localhost:3001`. Nao ha supertest e
nao se importa `src/app` dentro de teste.

Os arquivos espelham as rotas: `tests/api/tasks/get.test.js`,
`post.test.js`, `put.test.js`, `delete.test.js`, mais `tests/api/health.test.js`
e `tests/api/not-found.test.js`.

Tudo que e infraestrutura de teste vive em **`tests/orchestrator.js`**:

| Funcao                    | Para que                                     |
| ------------------------- | -------------------------------------------- |
| `waitForAllServices()`    | espera o `/api/health` responder 200         |
| `runPendingMigrations()`  | aplica as migrations no banco de teste       |
| `clearDatabase()`         | trunca `tasks` reiniciando a identidade      |
| `insertTask(overrides)`   | arranjo direto no banco, sem passar pela API |
| `updateTaskTitleDirectly` | escrita crua, para provar garantia do banco  |
| `request(m, path, body)`  | requisicao HTTP; `body` string vai cru       |

**Um arquivo de teste novo nao precisa de preambulo nenhum** — so `require` do
orchestrator e os `describe`. O ciclo esta dividido em dois lugares:

| Onde                    | Quando roda          | O que faz                       |
| ----------------------- | -------------------- | ------------------------------- |
| `tests/global-setup.js` | uma vez por execucao | espera a API, aplica migrations |
| `tests/setup.js`        | por arquivo de teste | trunca a tabela, fecha o pool   |

O que e caro fica no `global-setup`: `runPendingMigrations()` custa um processo
`npx`, e chama-lo por arquivo multiplicaria o custo a cada arquivo novo.
Deduplicar com marca em `process.env` **nao** funciona — o Jest entrega a cada
arquivo a sua propria copia de `process.env`.

- Rodam com `--runInBand`: compartilham a mesma tabela e nao podem paralelizar.
- Use `insertTask()` para preparar estado — arranjo fora da rota evita que um
  teste de leitura quebre por causa de um bug na escrita.
- Asserte o **contrato**: status HTTP e o shape do JSON. Em erro, asserte `name`
  e `status_code`; em 422, tambem o `field` dentro de `details`.

### E2E da interface

`npm run test:e2e` (Playwright, em `e2e/`) sobe API e Vite pelo `webServer` do
`playwright.config.js` e dirige o navegador. Regras:

- O arranjo passa pela **API publica** (`e2e/helpers.js`), nunca pelo banco: um
  pool do `pg` no worker do Playwright prende o processo no fim da suite.
- Locators acessiveis (`getByRole`, `getByLabel`) — de quebra, cobrem a11y.
  Escope ao formulario (`page.locator('form.form')`): "Status" tambem casa com
  o `aria-label` do grupo de filtros, e "Cancelar" existe no form e no dialogo.
- O E2E aponta para a API de teste via `API_URL`. **Nunca** deixe a suite tocar
  o banco de desenvolvimento.
- Vale a mesma regra de nao mockar. A unica excecao esta anotada em
  `form-validation.spec.js` e explicada la.
- O `ConfirmDialog` usa a tag `<dialog>` nativa com `showModal()`. **Nao volte
  para uma `div` com `aria-modal`**: era uma promessa de isolamento que o
  browser nao cumpria. O `close()` roda em `useLayoutEffect`, porque uma
  limpeza tardia acontece com o no ja fora do DOM e o foco nao volta.

## Logs

`pino` via `infra/logger.js`. **Nao use `console.*` em `src/` nem em `infra/`** —
use `logger` (fora de requisicao) ou `req.log` (dentro dela, que ja vem com o
`request_id` anexado).

- Todo erro 5xx devolve `request_id` no corpo; os 4xx nao (mudaria o contrato
  sem ganho, e ha teste afirmando o corpo exato do 404).
- Em teste o logger e `silent`, para nao poluir a saida da suite.
- Os serializers sao enxutos de proposito: o padrao do `pino-http` despeja
  todos os headers em cada linha.

## Container

`Dockerfile` multi-stage; o runtime nao tem devDependencies, roda como `node` e
nao carrega arquivo de env. O `HEALTHCHECK` usa `/api/health` e respeita `PORT`.

Migrations **nao** rodam a partir dessa imagem: `node-pg-migrate` e
devDependency. Aplicar migration e passo separado do pipeline.

## Protecoes HTTP

`helmet()` com a politica padrao e dois limitadores em `/api`
(`src/middlewares/rate-limit.js`): um geral e um so para escrita.

- **Nao afrouxe a CSP.** Front e back estao sempre na mesma origem; se algo
  quebrou sob `'self'`, o problema e o recurso externo, nao a politica.
  Decisao ja tomada para a aba de prestacao de contas: a imagem do cupom e
  servida por endpoint proprio, que cabe em `'self'` — **nao** liberar `blob:`
  so para exibir preview gerado no cliente.
- O limitador e desligado em teste de proposito — a suite trombaria em
  qualquer teto realista. Mudou algo nele? Confira manualmente com
  `RATE_LIMIT_WRITE_MAX=5 npm start`.
- As rotas de prestacao de contas usam o `batchWriteLimiter`, com teto proprio:
  revisar um lote de 30 cupons sao dezenas de escritas seguidas de uma pessoa
  so, e o teto geral cortaria no meio do trabalho.

## Ambientes

`src/config/env.js` carrega `env.<NODE_ENV>` — **sem ponto no inicio**:
`env.development` e `env.test`, ambos versionados de proposito (valores locais).
O dotenv **nao sobrescreve** variaveis ja presentes em `process.env`, entao em
producao basta injetar as reais pelo ambiente. Nao existe `env.production`.

Dev usa `tasktab_development`; testes usam `tasktab_test`, criado pelo
`docker/initdb/` apenas na **primeira** subida do volume — se o banco de teste
sumir, e `npm run services:down -- -v` e subir de novo.

## Prestacao de contas

Segunda area do backend, em `reports` / `receipts` / `merchants`. O backlog
completo esta em `docs/backlog-prestacao-de-contas.md`.

- **Dinheiro e `integer` em centavos, sempre.** Nao introduza `numeric` nem
  float: somar float produziu `219.98000000000002` no caso que originou o
  projeto. Converter para reais e coisa da exportacao.
- O upload confere **magic bytes** (`%PDF`), nao extensao, e grava o arquivo
  com o proprio SHA-256 como nome. Reenviar o mesmo arquivo responde `200` com
  o que ja existe — e operacao idempotente, nao erro de unique.
- PDF ilegivel vira uma linha em `failed` com o motivo em `raw_text`. **Nao**
  deixe um arquivo ruim derrubar o lote.
- Confirmar exige `issued_at`, `amount_cents` e `category`, conferidos sobre o
  registro ja gravado. Duplicata continua listada e **fora do somatorio**.
- As rotas usam o `batchWriteLimiter`, nao o teto geral de escrita.

## Garantias no banco

O que precisa valer para **toda** escrita mora no banco, nao no model:

- `updated_at` e mantido pelo trigger `tasks_set_updated_at`. Nao volte a
  setar a coluna no `task.model.js` — o ponto e cobrir tambem seed, psql e
  migration.
- `tasks_title_not_blank` complementa a validacao da aplicacao.

## Datas

Dois pontos ja resolvidos, pela mesma razao (a data "andar" um dia):

1. `src/config/database.js` registra um type parser para o OID 1082 (`DATE`), que
   devolve a string crua `YYYY-MM-DD`. Sem isso o `pg` converte para `Date` na
   timezone local.
2. `web/src/constants.js` formata a data com `split('-')`, sem passar por `Date`.

Ao mexer em qualquer coisa com `due_date`, **nao introduza `new Date(isoString)`**.

## Interface web

React 19 + Vite, sem router e sem biblioteca de estado — tela unica, estado no
`App`. CSS proprio em `web/src/styles.css`, sem framework.

- Em dev o Vite faz proxy de `/api`. Em producao nao ha Vite: o Express serve
  `web/dist` com fallback de SPA (`src/app.js`), so quando o build existe no
  disco e fora do ambiente de teste. Nos dois casos front e back ficam na mesma
  origem — **e o que dispensa CORS, nao adicione middleware de CORS**.
- A paleta segue o **GitHub Dark Colorblind**: acoes destrutivas sao laranja, nao
  vermelhas, e os status evitam o eixo verde/vermelho. **Cor nunca e o unico
  canal de informacao** — todo badge carrega tambem o texto do status.
- `web/src/constants.js` espelha o enum `task_status` do banco. Mudou o enum na
  migration? Atualize os dois.

## Nunca

- Nao rode `jest` direto — use `npm test` ou `npm run test:watch`.
- Nao aponte `migrations:up` para nada alem de `env.development`.
- Nao concatene valor em SQL. Placeholder sempre.
- Nao faca commit sem `npm test` e `npm run lint` passando.
- Nao adicione dependencia so para resolver algo que 20 linhas resolvem — o
  projeto e deliberadamente enxuto (3 dependencias de producao).
- Nao escreva mensagem de commit fora do padrao **Conventional Commits** — o
  commitlint rejeita no hook do husky, inclusive escopo fora do enum de
  `commitlint.config.js`. Prefira `npm run commit`.
- Nao coloque `npm test` no `pre-commit`: o `posttest` derruba o Docker e
  mataria os containers em uso. O hook roda so `lint` + `format:check`.

## Conflitos com o `~/.claude/CLAUDE.md` global

**Ja alinhado** — o global vale como escrito:

| Item                                          | Onde                          |
| --------------------------------------------- | ----------------------------- |
| `BaseError` + `toJSON()` com `action`         | `infra/errors.js`             |
| `onErrorHandler` / `controller.errorHandlers` | `infra/controller.js`         |
| So testes de integracao, sem mock             | `tests/`                      |
| `tests/orchestrator.js`                       | mesmas funcoes dos anteriores |
| `npm run commit` + commitlint no husky        | `.husky/`                     |

**Ainda diverge** — aqui vence o que esta nesta coluna:

| Global diz                | Neste projeto                                  |
| ------------------------- | ---------------------------------------------- |
| Next.js Pages Router      | Express 4 (`src/app.js`)                       |
| ESM, nada de CommonJS     | CommonJS no backend; ESM so em `web/`          |
| Imports absolutos da raiz | Imports relativos (Node puro nao resolve bare) |
| next-connect              | middleware do Express                          |
| `.env.development`        | `env.development`, sem ponto                   |
| skill `/teste-integracao` | nao existe                                     |
| Node >= 20.9              | Node 24.18.0 (`engines` exige)                 |

As tres primeiras divergencias sao deliberadas: converter para ESM + imports
absolutos foi avaliado e adiado, nao esquecido.
