# tasktab

API REST e interface web para duas coisas: um quadro de **tarefas** e a
**prestacao de contas** de viagem — os cupons entram em PDF, a extracao le
data, valor e emitente (texto, QR Code e OCR), uma pessoa revisa, a
conferencia aponta o que merece atencao, e a exportacao sai no formato que
quem assina ja usa.

## Stack

| Camada     | Ferramenta                        |
| ---------- | --------------------------------- |
| Runtime    | Node.js 24.18.0 LTS (`.nvmrc`)    |
| HTTP       | Express 4                         |
| Banco      | PostgreSQL 18 (imagem alpine)     |
| Driver     | `pg` (queries parametrizadas)     |
| Migrations | `node-pg-migrate`                 |
| Interface  | React 19 + Vite 7 (CSS proprio)   |
| Testes     | Jest (integracao, HTTP real)      |
| E2E        | Playwright                        |
| Qualidade  | ESLint 9 (flat config) + Prettier |

## Estrutura

```
src/
├── app.js · server.js     # montagem do Express e bootstrap HTTP
├── config/                # env.<NODE_ENV> e pool do Postgres
├── routes/                # mapeamento REST, com o escopo de cada rota
├── middlewares/           # sessao, escopo, upload, rate limit, no-store
├── controllers/           # orquestram validacao, model e resposta
├── validators/            # regras de entrada
├── models/                # SQL parametrizado
└── services/
    ├── auth/              # senha, sessao, escopos e posse
    ├── extraction/        # texto, QR Code e OCR dos comprovantes
    ├── validation/        # conferencia do relatorio
    └── export/            # planilha, Anexo I e PDFs
infra/                     # erros, handlers do Express e logger
migrations/                # node-pg-migrate
scripts/                   # users:create, espera do banco, template sintetico
assets/                    # template SINTETICO do Anexo I
tests/                     # integracao (orchestrator) e testes puros
e2e/                       # Playwright
web/src/                   # interface React (shell/, modules/, components/)
docs/                      # documentacao e backlog
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
aceitar conexoes, aplica as migrations pendentes e inicia a API (`:3000`) e a
interface (`:5173`) em paralelo. No navegador, use a porta **5173**: e o Vite,
que serve a interface e encaminha `/api` para o Express.

O `compose.yaml` cria dois bancos: `tasktab_development` e `tasktab_test`
(este via `docker/initdb/`, executado na primeira subida do volume).

### Primeiro usuario

A API nao tem auto-cadastro, e sem usuario nao ha como entrar. O primeiro sai
pela linha de comando:

```bash
npm run users:create -- --email voce@exemplo.com --name "Seu Nome" --role admin
```

Sem `--password` o script sorteia uma senha forte e a imprime **uma unica vez**
— e o caminho recomendado, porque senha em argumento fica no historico do
shell. Papeis aceitos: `admin`, `user`, `auditor`. Depois disso, novos
cadastros saem por `POST /api/users` (exige `users:write`).

Para redefinir a senha de quem perdeu o acesso, repita o comando com
`--replace`: a senha nova passa a valer, as sessoes abertas daquela pessoa sao
encerradas e o papel so muda se vier `--role`.

## Scripts

| Script                      | O que faz                                             |
| --------------------------- | ----------------------------------------------------- |
| `dev`                       | Servicos + espera + migrations + API e interface      |
| `dev:api` / `dev:web`       | Sobe apenas um dos dois, sem preparar o banco         |
| `build`                     | Gera o build de producao da interface em `web/dist`   |
| `start`                     | So o servidor (assume banco pronto — uso em producao) |
| `seed`                      | Servicos + espera + migrations + 5 tarefas de exemplo |
| `users:create`              | Cadastra um usuario (o primeiro acesso sai por aqui)  |
| `services:up`               | Sobe os containers em background                      |
| `services:stop`             | Para os containers, preservando os dados              |
| `services:down`             | Remove os containers (`-v` tambem apaga o volume)     |
| `services:wait:database`    | Bloqueia ate o Postgres aceitar conexoes              |
| `migrations:up` / `:down`   | Aplica / reverte migrations                           |
| `migrations:create`         | Gera um novo arquivo de migration                     |
| `generate:anexo-i-template` | Regera o template SINTETICO em `assets/` (dev only)   |

## Testes

Duas suites, ambas de integracao e contra o sistema de verdade: a da **API**
fala HTTP com o Express, e a **E2E** dirige um navegador contra a interface.

```bash
npm test              # API: sobe os servicos, roda a suite e para os containers
npm run test:watch    # API: sem subir/parar servicos, para iterar
npm run test:pure     # so as funcoes puras de extracao, sem servico nenhum
npm run test:e2e      # interface: Playwright contra API + Vite
npm run test:e2e:ui   # interface: modo interativo do Playwright
```

Nao e preciso preparar nada antes: os scripts sobem os servicos, a API de
teste (`:3001`, banco `tasktab_test`) e aplicam as migrations. Como o
`posttest` para os containers, use `test:watch` enquanto estiver iterando.

Na primeira execucao do E2E, instale o navegador com
`npx playwright install chromium`. Como a suite e organizada esta em
[tests/CLAUDE.md](tests/CLAUDE.md) e [e2e/CLAUDE.md](e2e/CLAUDE.md).

## Qualidade e commits

```bash
npm run lint          # ESLint (backend CommonJS + frontend JSX)
npm run lint:fix
npm run format        # Prettier
npm run format:check
npm run commit        # commit guiado pelo Conventional Commits
```

O historico segue **Conventional Commits**, validado pelo commitlint no hook
`commit-msg` do husky — inclusive o escopo, restrito ao enum de
`commitlint.config.js`. O hook `pre-commit` roda apenas `lint` e
`format:check`; `npm test` fica de fora de proposito, porque o `posttest`
derrubaria os containers em uso. Rode a suite antes de commitar. O CI repete
lint, formatacao, build e `npm test` a cada pull request.

## Documentacao

| Assunto                                                        | Onde                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Rotas, campos, formato de resposta e de erro                   | [docs/api.md](docs/api.md)                                                 |
| Prestacao de contas: upload, extracao, conferencia, exportacao | [docs/prestacao-de-contas.md](docs/prestacao-de-contas.md)                 |
| Sessao, papeis, protecoes HTTP, logs, retencao dos arquivos    | [docs/seguranca.md](docs/seguranca.md)                                     |
| Interface web e paleta                                         | [docs/interface.md](docs/interface.md)                                     |
| Variaveis de ambiente, producao, container, CI, `npm audit`    | [docs/operacao.md](docs/operacao.md)                                       |
| Backlog, decisoes e o que falta                                | [docs/backlog-prestacao-de-contas.md](docs/backlog-prestacao-de-contas.md) |
