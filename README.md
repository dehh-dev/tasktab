# tasktab

Gerenciador de Tarefas — API REST em arquitetura MVC com Express e PostgreSQL.

## Stack

| Camada     | Ferramenta                        |
| ---------- | --------------------------------- |
| Runtime    | Node.js 24.18.0 LTS (`.nvmrc`)    |
| HTTP       | Express 4                         |
| Banco      | PostgreSQL 18 (imagem alpine)     |
| Driver     | `pg` (queries parametrizadas)     |
| Migrations | `node-pg-migrate`                 |
| Interface  | React 19 + Vite 7 (CSS proprio)   |
| Testes     | Jest + Supertest                  |
| Qualidade  | ESLint 9 (flat config) + Prettier |

## Estrutura

```
src/
├── app.js                          # montagem do Express (middlewares + rotas)
├── server.js                       # bootstrap HTTP e shutdown gracioso
├── config/
│   ├── env.js                      # carrega env.<NODE_ENV> e valida obrigatorias
│   └── database.js                 # pool do Postgres
├── models/task.model.js            # M — acesso a dados (SQL)
├── controllers/task.controller.js  # C — orquestra validacao + model + resposta
├── routes/                         # mapeamento REST
├── validators/                     # regras de validacao de entrada
├── middlewares/                    # asyncHandler + tratamento de erros
└── errors/api-error.js             # erro com status HTTP
migrations/                         # node-pg-migrate
seeds/seed.js                       # 5 tarefas de exemplo
scripts/wait-for-postgres.js        # espera o banco aceitar conexoes
tests/                              # suite de integracao da API
web/                                # interface React (workspace npm)
├── vite.config.js                  # proxy /api -> :3000 em desenvolvimento
└── src/
    ├── App.jsx                     # estado da pagina e orquestracao
    ├── api.js                      # cliente HTTP da API
    ├── constants.js                # enum de status e formatacao de data
    ├── styles.css                  # paleta e layout, sem framework CSS
    └── components/                 # StatusFilter, TaskForm, TaskList, ConfirmDialog
```

No backend, a "View" e a representacao JSON produzida pelos controllers. A
interface consome essa mesma API publica, sem atalhos para o banco.

## Setup

```bash
nvm install                    # instala o Node declarado no .nvmrc
npm install                    # instala a raiz + o workspace web/
npm run dev                    # interface em http://localhost:5173
```

O `npm run dev` faz todo o resto sozinho: sobe o container, espera o banco
aceitar conexoes, aplica as migrations pendentes e entao inicia a API (`:3000`)
e a interface (`:5173`) em paralelo. O `npm run seed` segue a mesma cadeia antes
de popular as 5 tarefas de exemplo.

No navegador, use a porta **5173**: e o Vite, que serve a interface e encaminha
`/api` para o Express.

O `compose.yaml` cria dois bancos: `tasktab_development` e `tasktab_test`
(este ultimo via `docker/initdb/`, executado na primeira subida do volume).

### Scripts

| Script                    | O que faz                                             |
| ------------------------- | ----------------------------------------------------- |
| `dev`                     | Servicos + espera + migrations + API e interface      |
| `dev:api` / `dev:web`     | Sobe apenas um dos dois, sem preparar o banco         |
| `build`                   | Gera o build de producao da interface em `web/dist`   |
| `start`                   | So o servidor (assume banco pronto — uso em producao) |
| `seed`                    | Servicos + espera + migrations + 5 tarefas de exemplo |
| `services:up`             | Sobe os containers em background                      |
| `services:stop`           | Para os containers, preservando os dados              |
| `services:down`           | Remove os containers (`-v` tambem apaga o volume)     |
| `services:wait:database`  | Bloqueia ate o Postgres aceitar conexoes              |
| `migrations:up` / `:down` | Aplica / reverte migrations                           |
| `migrations:create`       | Gera um novo arquivo de migration                     |

O `services:wait:database` abre uma conexao real com o banco da aplicacao em
vez de so checar se o container subiu — assim valida tambem as credenciais e a
existencia do database, que e do que as migrations dependem. Ele respeita o
`NODE_ENV`, entao aponta para o banco de teste quando chamado pelo `pretest`.

## Variaveis de ambiente

`src/config/env.js` carrega `env.<NODE_ENV>` — `env.development` para dev e
`env.test` para os testes. O dotenv **nao sobrescreve** variaveis ja presentes
em `process.env`, entao em producao basta injetar as variaveis reais pelo
ambiente (nao existe `env.production` versionado).

| Variavel                                              | Descricao                        |
| ----------------------------------------------------- | -------------------------------- |
| `PORT`                                                | Porta HTTP                       |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Conexao usada pela aplicacao     |
| `DATABASE_URL`                                        | Consumida pelo `node-pg-migrate` |

## Endpoints

Base: `/api/tasks`

| Metodo        | Rota   | Descricao                   | Sucesso |
| ------------- | ------ | --------------------------- | ------- |
| `GET`         | `/`    | Lista (paginada, filtravel) | 200     |
| `GET`         | `/:id` | Detalhe                     | 200     |
| `POST`        | `/`    | Cria                        | 201     |
| `PUT`/`PATCH` | `/:id` | Atualiza (parcial)          | 200     |
| `DELETE`      | `/:id` | Remove                      | 204     |

Query params do `GET /api/tasks`: `status` (enum), `limit` (1–100, padrao 50),
`offset` (padrao 0). Ha tambem `GET /api/health`.

### Campos

| Campo         | Tipo   | Regras                                                  |
| ------------- | ------ | ------------------------------------------------------- |
| `title`       | string | **obrigatorio**, nao-vazio, max. 255 caracteres         |
| `description` | text   | opcional, aceita `null`                                 |
| `status`      | enum   | `pending` \| `in_progress` \| `done` (padrao `pending`) |
| `due_date`    | date   | opcional, `YYYY-MM-DD`, data valida no calendario       |

### Exemplos

```bash
curl -X POST localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Revisar PR","status":"in_progress","due_date":"2026-08-15"}'

curl "localhost:3000/api/tasks?status=done&limit=10"
curl -X PATCH localhost:3000/api/tasks/1 -H 'Content-Type: application/json' -d '{"status":"done"}'
curl -X DELETE localhost:3000/api/tasks/1
```

Sucesso vem envelopado em `{ "data": ... }` (listagem inclui `meta`). Erro vem
em `{ "error": { "message", "details?" } }`.

Codigos: `400` (id/JSON invalido), `404` (inexistente), `422` (falha de
validacao, com `details` por campo), `500` (erro interno).

## Interface web

React 19 com Vite, sem router e sem biblioteca de estado — a tela e unica e o
estado vive no `App`. O CSS e proprio, sem framework externo.

- **Listagem** com filtro por status (Todas / Pendente / Em andamento /
  Concluida) e contagem total vinda do `meta` da API.
- **Formulario unico** para criar e editar, com contador de caracteres do
  titulo. Erros `422` do backend sao exibidos no campo correspondente,
  preservando o que foi digitado.
- **Exclusao** passa por um dialogo de confirmacao: `Escape` e clique fora
  cancelam, e o foco inicial fica no botao seguro para que um `Enter`
  acidental nao delete nada.

### Paleta

Baseada no tema **GitHub Dark Colorblind** (Protanopia & Deuteranopia), cuja
troca central em relacao ao dark padrao e substituir verde por azul e vermelho
por laranja — justamente o par que esses tipos de daltonismo confundem. Por
isso as acoes destrutivas sao laranja (`#ec8e2c`), nao vermelhas.

Os status seguem a mesma logica e evitam o eixo verde/vermelho por completo:

| Status       | Cor               |
| ------------ | ----------------- |
| Pendente     | Amarelo `#d29922` |
| Em andamento | Azul `#4184e4`    |
| Concluida    | Roxo `#a371f7`    |

Cor nunca e o unico canal de informacao: cada badge tambem carrega o texto do
status, entao a leitura sobrevive em tons de cinza.

### Producao

Em desenvolvimento o Vite serve a interface e encaminha `/api` para o Express.
Em producao nao ha Vite: rode `npm run build` e o Express passa a servir
`web/dist` na mesma origem, com fallback de SPA para rotas que nao comecem com
`/api`. Nos dois casos front e back ficam na mesma origem, o que dispensa CORS.

## Testes

```bash
npm test          # sobe os servicos, roda a suite e para os containers
npm run test:watch  # sem subir/parar servicos, para iterar
```

Roda contra `tasktab_test` com `NODE_ENV=test`. Nao e preciso preparar nada
antes: o `pretest` sobe os servicos e espera o banco, o `globalSetup` do Jest
aplica as migrations e cada teste roda sobre uma tabela truncada. Ao final o
`posttest` para os containers.

Como o `posttest` derruba os servicos, use `test:watch` (com os containers ja
no ar) enquanto estiver iterando.

## Qualidade de codigo

```bash
npm run lint          # ESLint (backend CommonJS + frontend JSX)
npm run lint:fix
npm run format        # Prettier
npm run format:check
```

### Sobre o `npm audit`

Os `overrides` do `package.json` sao escopados por versao de `minimatch`,
porque cada major consome uma API diferente do `brace-expansion`: a 3.x espera
o export CommonJS da linha 1.x, enquanto a 10.x usa a 5.x. Forcar uma unica
versao para as duas quebra o ESLint com `expand is not a function`.

Resta um aviso conhecido, sem correcao possivel hoje: o ESLint fixa
`minimatch ^3.1.2` internamente e essa linha nao tem versao considerada
corrigida pelo advisory. O impacto e nulo aqui — trata-se de negacao de
servico ao expandir um glob malicioso, e os unicos globs em uso vem dos
proprios arquivos de configuracao do projeto, nao de entrada externa.
