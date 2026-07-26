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
```

A "View" e a representacao JSON produzida pelos controllers — nao ha camada de
template, por ser uma API.

## Setup

```bash
nvm install                    # instala o Node declarado no .nvmrc
npm install
npm run dev                    # http://localhost:3000
```

O `npm run dev` faz todo o resto sozinho: sobe o container, espera o banco
aceitar conexoes, aplica as migrations pendentes e so entao inicia o servidor.
O `npm run seed` segue a mesma cadeia antes de popular as 5 tarefas de exemplo.

O `compose.yaml` cria dois bancos: `tasktab_development` e `tasktab_test`
(este ultimo via `docker/initdb/`, executado na primeira subida do volume).

### Scripts

| Script                    | O que faz                                             |
| ------------------------- | ----------------------------------------------------- |
| `dev`                     | Servicos + espera + migrations + servidor em watch    |
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
npm run lint          # ESLint
npm run lint:fix
npm run format        # Prettier
npm run format:check
```
