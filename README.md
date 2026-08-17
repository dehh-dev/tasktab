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
| Testes     | Jest (integracao, HTTP real)      |
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
└── middlewares/async-handler.js    # encaminha rejeicao de handler async
infra/
├── errors.js                       # BaseError + erros especificos
└── controller.js                   # handlers de erro plugados no Express
migrations/                         # node-pg-migrate
seeds/seed.js                       # 5 tarefas de exemplo
scripts/wait-for-postgres.js        # espera o banco aceitar conexoes
tests/                              # suite de integracao (orchestrator + specs)
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

| Script                      | O que faz                                             |
| --------------------------- | ----------------------------------------------------- |
| `dev`                       | Servicos + espera + migrations + API e interface      |
| `dev:api` / `dev:web`       | Sobe apenas um dos dois, sem preparar o banco         |
| `build`                     | Gera o build de producao da interface em `web/dist`   |
| `start`                     | So o servidor (assume banco pronto — uso em producao) |
| `seed`                      | Servicos + espera + migrations + 5 tarefas de exemplo |
| `services:up`               | Sobe os containers em background                      |
| `services:stop`             | Para os containers, preservando os dados              |
| `services:down`             | Remove os containers (`-v` tambem apaga o volume)     |
| `services:wait:database`    | Bloqueia ate o Postgres aceitar conexoes              |
| `migrations:up` / `:down`   | Aplica / reverte migrations                           |
| `migrations:create`         | Gera um novo arquivo de migration                     |
| `generate:anexo-i-template` | Regera o template SINTETICO em `assets/` (dev only)   |

O `services:wait:database` abre uma conexao real com o banco da aplicacao em
vez de so checar se o container subiu — assim valida tambem as credenciais e a
existencia do database, que e do que as migrations dependem. Ele respeita o
`NODE_ENV`, entao aponta para o banco de teste quando chamado pelo `pretest`.

## Variaveis de ambiente

`src/config/env.js` carrega `env.<NODE_ENV>` — `env.development` para dev e
`env.test` para os testes. O dotenv **nao sobrescreve** variaveis ja presentes
em `process.env`, entao em producao basta injetar as variaveis reais pelo
ambiente (nao existe `env.production` versionado).

| Variavel                                              | Descricao                           |
| ----------------------------------------------------- | ----------------------------------- |
| `PORT`                                                | Porta HTTP                          |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Conexao usada pela aplicacao        |
| `DATABASE_URL`                                        | Consumida pelo `node-pg-migrate`    |
| `RATE_LIMIT_WINDOW_MS`                                | Janela do limitador (padrao 15min)  |
| `RATE_LIMIT_MAX`                                      | Teto de leitura (padrao 600)        |
| `RATE_LIMIT_WRITE_MAX`                                | Teto de escrita (padrao 100)        |
| `RATE_LIMIT_BATCH_WRITE_MAX`                          | Teto das rotas em lote (padrao 600) |
| `UPLOAD_DIR`                                          | Onde os PDFs sao gravados           |
| `UPLOAD_MAX_BYTES`                                    | Tamanho maximo por arquivo          |
| `UPLOAD_MAX_FILES`                                    | Arquivos por requisicao             |
| `OCR_ENABLED`                                         | `false` desliga o degrau de OCR     |
| `OCR_LANGUAGE`                                        | Idioma do tesseract (padrao `por`)  |
| `OCR_CACHE_DIR`                                       | Cache dos dados de idioma           |
| `OCR_TIMEOUT_MS`                                      | Teto por pagina (padrao 20s)        |
| `LOG_LEVEL`                                           | Nivel do `pino` (padrao `info`)     |

O `.npmrc` liga `engine-strict`: sem ele o campo `engines` seria so um aviso e a
instalacao seguiria numa versao de Node incompativel.

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
`offset` (padrao 0).

### Prestacao de contas

Base: `/api/reports` e `/api/receipts`

| Metodo   | Rota                                   | Descricao                     |
| -------- | -------------------------------------- | ----------------------------- |
| `GET`    | `/api/reports`                         | Lista (filtro por `status`)   |
| `POST`   | `/api/reports`                         | Cria                          |
| `GET`    | `/api/reports/:id`                     | Detalhe                       |
| `PATCH`  | `/api/reports/:id`                     | Atualiza                      |
| `DELETE` | `/api/reports/:id`                     | Remove (leva os comprovantes) |
| `POST`   | `/api/reports/:id/receipts`            | Envia 1..N PDFs               |
| `GET`    | `/api/reports/:id/receipts`            | Lista comprovantes com totais |
| `GET`    | `/api/receipts/:id`                    | Detalhe                       |
| `PATCH`  | `/api/receipts/:id`                    | Corrige campos na revisao     |
| `DELETE` | `/api/receipts/:id`                    | Remove                        |
| `GET`    | `/api/receipts/:id/image`              | Pagina do comprovante em PNG  |
| `POST`   | `/api/receipts/:id/reprocess`          | Reenvia para a fila           |
| `GET`    | `/api/reports/:id/validation`          | Alertas de conferencia        |
| `GET`    | `/api/reports/:id/export.xlsx`         | Resumo proprio (Excel)        |
| `GET`    | `/api/reports/:id/export/anexo-i.xlsx` | Anexo I oficial (Excel)       |
| `GET`    | `/api/reports/:id/export.pdf`          | PDF consolidado               |

Base: `/api/merchants` — o cadastro que da categoria ao comprovante.

| Metodo  | Rota                           | Descricao                       |
| ------- | ------------------------------ | ------------------------------- |
| `GET`   | `/api/merchants`               | Lista os emitentes cadastrados  |
| `POST`  | `/api/merchants`               | Cadastra um emitente            |
| `PATCH` | `/api/merchants/:id`           | Atualiza (e a categoria padrao) |
| `GET`   | `/api/merchants/by-cnpj/:cnpj` | Busca pelo CNPJ lido da chave   |

O upload aceita multipart no campo `files`, confere os **magic bytes** (`%PDF`)
em vez da extensao, e separa o arquivo em uma linha por pagina. O arquivo e
gravado com o proprio SHA-256 como nome, entao o mesmo PDF ocupa um lugar so no
disco; reenviar responde `200` com o que ja existe, e nao erro.

**Dinheiro e sempre inteiro em centavos.** Somar float produziu
`219.98000000000002` na conferencia manual que originou este projeto, e a
conversao para reais so acontece na exportacao.

### Extracao automatica

PDF com camada de texto tem data e valor preenchidos no proprio upload, e o
texto original fica em `raw_text` para auditoria. Pagina sem texto util desce
para o proximo degrau da cascata — QR Code, e depois OCR.

A busca do total e **ancorada em palavra-chave** (`VALOR TOTAL`, `Total a
pagar`, ...). Pegar "o maior numero da pagina" acharia a chave de acesso, o
CNPJ ou o telefone — todos maiores que qualquer refeicao.

Cupom com QR Code tem a **chave de acesso** lida do codigo — o dado mais
confiavel que a extracao produz, porque o QR tem correcao de erro e a chave
ainda passa pelo digito verificador mod-11. Sem QR legivel, a chave e buscada
no texto impresso; em qualquer caso, chave que nao fecha o DV e descartada.

A **categoria vem do CNPJ do emitente**, nunca do nome. Emitente conhecido
aplica a sua categoria padrao; desconhecido e cadastrado como
`nao_classificado` e o comprovante vai para revisao. Classificado o emitente
uma vez, todo cupom seguinte daquele CNPJ ja entra classificado — e a
ferramenta "aprendendo" por cadastro, sem nenhuma IA.

Pagina **sem camada de texto** (cupom escaneado) desce para o **OCR**, o
degrau mais caro e menos confiavel da cascata. Custo observado: cerca de
0,2 a 0,5 s por pagina depois do primeiro reconhecimento, mais uns 400 ms na
primeira execucao, que baixa 2,4 MB de dados de idioma para `OCR_CACHE_DIR`.

**Recibo manuscrito fica de fora, por decisao consciente.** O Tesseract nao le
caneta sobre formulario, e insistir nisso e onde este tipo de projeto costuma
travar — esses vao direto para a fila manual.

O upload responde **202**: as linhas ja existem, o conteudo delas ainda esta
sendo lido por uma fila em processo. O `status` progride
`pending → processing → needs_review | failed`, e `GET /api/health` informa
quantas tarefas ainda faltam. Um comprovante preso pode ser reenviado para a
fila com `POST /api/receipts/:id/reprocess`.

A fila e **em processo** de proposito: sem servico novo, sem Redis. O gatilho
para trocar por BullMQ e **uso concorrente** — hoje um segundo processo nao ve
esta fila, e um reinicio perde o que estava na memoria. Como a unidade de
trabalho ja e "uma pagina, um registro", a migracao e local.

### Conferencia

`GET /api/reports/:id/validation` devolve alertas com severidade (`erro` ou
`aviso`). **Alerta nao bloqueia nada** — quem assina a prestacao de contas
decide; a ferramenta aponta, nao veta.

Regras: soma dos itens contra o total impresso, digito verificador da chave,
data dentro do periodo, valor fora da faixa historica do emitente,
comprovante incompleto, despesas acima do adiantamento e suspeita de
duplicata.

Fora de escopo hoje, registrado para nao parecer esquecimento: **coerencia
geografica e horaria** (jantar numa cidade e corrida em outra no mesmo
horario) depende de extrair cidade e hora, que nenhum parser faz ainda.

### Duplicatas

Duas notas com a **mesma chave de acesso** sao o mesmo documento e a segunda
colapsa sozinha, marcada com `duplicate_of_id`. Ela continua listada e vai no
PDF consolidado — so nao soma.

Mesma data com mesmo valor vira **alerta**, nunca exclusao. O risco e
assimetrico: deixar passar uma duplicata infla o total e a conferencia pega,
mas marcar como duplicata o que nao e some com uma despesa legitima. Foi assim
que R$ 48,60 sumiram da planilha que originou este projeto — dois almocos do
mesmo restaurante, mesmo valor, dias diferentes. Ha teste desse contraexemplo.

Nada e confirmado sozinho: a extracao troca digitar por conferir.

Confirmar um comprovante exige data, valor e categoria — a checagem considera o
que ja esta gravado, nao so o que veio no corpo. Comprovante marcado como
duplicata continua listado, mas fica **fora do somatorio**.

### Exportacao

Tres saidas, cada uma com um proposito diferente:

| Rota                                       | Para que                                            |
| ------------------------------------------ | --------------------------------------------------- |
| `GET /api/reports/:id/export.xlsx`         | Resumo proprio: todos os comprovantes, com formulas |
| `GET /api/reports/:id/export/anexo-i.xlsx` | O formulario oficial preenchido                     |
| `GET /api/reports/:id/export.pdf`          | Todos os cupons num PDF so, com indice e carimbo    |

O **resumo proprio** (`exceljs`, gerado do zero) traz todo comprovante, com o
`Status` a vista. Total geral e subtotal por categoria sao **formula**
(`SUMIFS`), nao valor fixo — o conferente edita uma linha e ve o total mudar
sozinho. Uma coluna auxiliar oculta marca duplicata (`1`/`0`) para a formula
excluir do somatorio sem depender de comparar texto de status.

O **Anexo I** e outra historia: **so entram comprovantes `confirmed`** — e o
unico status que significa "revisado por uma pessoa". O relatorio nao e
gerado do zero: o template `.xlsx` e **remendado**, nao reconstruido.
Bibliotecas que abrem-e-regravam um `.xlsx` perdem o que nao sabem
representar — foi assim que a validacao de dados (lista suspensa) de um
template oficial sumiu, na conferencia manual que originou este projeto. Aqui
`src/services/export/xlsx-cell-patch.js` troca so as celulas de dado por
manipulacao de string direto no XML da planilha; estilo, formula,
`dataValidations` e `mergeCells` nunca sao lidos para memoria, entao
sobrevivem byte a byte.

> **O template em `assets/anexo-i-template.xlsx` e SINTETICO, nao o
> formulario oficial.** Nao existe, neste projeto, o arquivo real do Anexo I
> — decisao tomada com o usuario ao iniciar o marco de exportacao. O
> sintetico (gerado por `npm run generate:anexo-i-template`) reproduz a mesma
> estrutura que o processo manual descreve — formulas, celula mesclada, lista
> suspensa, linha de totais cobrindo o intervalo — para provar a tecnica.
> **Antes de qualquer uso real, troque o arquivo pelo formulario oficial** e
> confira se `CATEGORY_COLUMN` em `anexo-i.service.js` ainda bate: o mapa de
> oito categorias para tres colunas (S/W/X) e um placeholder.

O **PDF consolidado** (`pdf-lib`) junta a pagina original de cada comprovante
— nunca gera imagem nova do cupom — em ordem cronologica, com um carimbo no
rodape (`Item 07 | 19/06/2026 | Franguinho na Panela | R$ 37,60`) e uma pagina
de indice no inicio, com bookmarks por categoria e por data. O carimbo fica
numa faixa **nova**, adicionada abaixo do conteudo original ao embutir a
pagina — fisicamente nao ha como cobrir o cupom, porque a faixa nao existia
antes. Duplicata entra no PDF e no indice, marcada com `[DUPLICATA]`.

A ordem cronologica usa `id` como desempate, nao hora do comprovante: nenhum
parser de extracao le hora ainda. Registrado como limitacao conhecida.

`GET /api/health` consulta o banco de verdade: devolve `200` com
`{ "data": { "status": "ok", "uptime": ... } }` quando o Postgres responde e
`503` (`ServiceError`) quando nao responde — nunca `200` com o banco fora.

### Campos

| Campo         | Tipo   | Regras                                                  |
| ------------- | ------ | ------------------------------------------------------- |
| `title`       | string | **obrigatorio**, nao-vazio, max. 255 caracteres         |
| `description` | text   | opcional, aceita `null`                                 |
| `status`      | enum   | `pending` \| `in_progress` \| `done` (padrao `pending`) |
| `due_date`    | date   | opcional, `YYYY-MM-DD`, data valida no calendario       |

`created_at` e `updated_at` sao do banco. O `updated_at` e mantido por um
trigger, entao vale tambem para escrita que nao passa pela API.

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
plano, sempre no mesmo formato:

```json
{
  "name": "ValidationError",
  "message": "Falha de validacao.",
  "action": "Ajuste os campos indicados em details e tente de novo.",
  "status_code": 422,
  "details": [{ "field": "title", "message": "title e obrigatorio" }]
}
```

O `action` diz o que fazer a seguir, e o `details` (so em `422`) aponta o campo
culpado — e o que permite a interface exibir o erro no campo certo.

Codigos: `400` (id/JSON invalido), `404` (inexistente), `422` (falha de
validacao), `429` (limite de requisicoes), `500` (erro interno), `503`
(dependencia fora do ar).

### Logs

`pino` estruturado, uma linha por requisicao. Cada uma ganha um `request_id`
(UUID) devolvido no header `x-request-id`; se a requisicao ja chegar com esse
header, o valor e preservado, para que o rastro atravesse proxies.

Nas respostas **5xx** o mesmo id sai no corpo, em `request_id` — e o que liga a
reclamacao do usuario a linha de log, ja que a mensagem publica de um 500 e
deliberadamente generica. Nos 4xx o corpo ja diz o que corrigir, entao o id
nao entra.

`LOG_LEVEL` controla o nivel (padrao `info`, e `silent` em teste). Em
desenvolvimento a saida passa pelo `pino-pretty`; em producao sai em JSON.

### Protecoes HTTP

O `helmet` aplica os headers de seguranca com a politica padrao — front e back
ficam sempre na mesma origem, entao a CSP `'self'` atende o build do Vite sem
excecoes.

O limitador tem dois tetos sobrepostos: um geral, generoso porque a interface
recarrega a lista a cada mutacao, e um mais apertado so para escrita. Ambos
respondem `429` no mesmo formato dos demais erros.

O limitador **fica desligado em `NODE_ENV=test`**: a suite dispara dezenas de
requisicoes em segundos e trombaria em qualquer teto realista. Para conferir
manualmente, suba com um teto baixo e repita uma escrita:

```bash
RATE_LIMIT_WRITE_MAX=5 npm start
```

### Retencao e privacidade

Um cupom fiscal nao e um arquivo qualquer: traz CNPJ do emitente, e as vezes
CPF na nota, de gente que nao e usuaria deste sistema. As decisoes abaixo
valem para qualquer deploy.

**O arquivo vive enquanto o comprovante existir, e nao mais que isso.** Apagar
um comprovante ou um relatorio apaga tambem o PDF do disco. Nao ha varredura
por idade nem TTL: o dono da prestacao de contas decide quando ela deixa de ser
necessaria — expirar sozinho destruiria a evidencia de um relatorio que ainda
pode ser questionado meses depois.

A exclusao e **contada por referencia**, nunca direta. O PDF e gravado com o
proprio SHA-256 como nome, entao um arquivo atende todas as paginas dele e
ainda e reaproveitado por outro relatorio que receba o mesmo upload; apagar
junto com a primeira linha removida levaria embora o cupom das outras.
`src/services/retention.service.js` so chama o `unlink` quando nenhuma linha
aponta mais para aquele hash. Ha teste dos dois lados: o arquivo some quando a
ultima referencia sai, e sobrevive enquanto houver outra.

Falha ao apagar o arquivo **nao derruba a resposta**: a linha ja saiu do banco
e o erro nao a traz de volta. Fica um `warn` no log, que e o que permite varrer
o diretorio depois. O caso comum — arquivo que ja nao estava la (`ENOENT`) — e
silencioso de proposito.

O diretorio de upload esta fora do versionamento (`.gitignore`) **e fora da
imagem** (`.dockerignore`): em container ele e um volume, e a imagem nunca
carrega arquivo de usuario.

**`raw_text` nao e anonimizado apos a confirmacao** — decisao consciente, nao
esquecimento. O campo nao e so trilha de auditoria: a regra de conferencia que
soma os itens contra o total impresso le dele, e confirmar um comprovante e
reversivel. Anonimizar na confirmacao silenciaria a checagem exatamente nos
comprovantes ja revisados, que sao os que vao assinados. O texto nasce e morre
junto com a linha do comprovante.

O que protege o `raw_text`, entao, e o cerco em volta dele:

- Nao e editavel por `PATCH`. As colunas que a revisao pode corrigir
  (`UPDATABLE_COLUMNS`) sao deliberadamente separadas das que a extracao
  escreve (`EXTRACTION_COLUMNS`) — juntar as duas deixaria a trilha de
  auditoria apagavel pelo cliente.
- **Nunca vai para o log.** Os serializers do `pino-http` sao enxutos e nao
  despejam corpo de requisicao, mas log manual escreve o que mandarem: nao
  passe `raw_text`, `access_key` nem o comprovante inteiro para o `req.log`.
  Para investigar uma extracao, logue o `id` do comprovante e consulte o banco.

## Interface web

React 19 com Vite, sem router e sem biblioteca de estado — a tela e unica e o
estado vive no `App`. O CSS e proprio, sem framework externo.

Duas abas dividem a interface: **Tarefas** e **Prestacao de Contas**
(`TabNav.jsx`), no padrao WAI-ARIA de `tablist` com tabindex circulante — seta
esquerda/direita move o foco **e** ja seleciona a aba (ativacao automatica),
com retorno ao inicio/fim nas pontas. A aba inativa e **desmontada**, nao so
escondida com `hidden`: as duas telas reusavam nomes de classe parecidos
(`.task`), e manter as duas sempre no DOM vazava linha de uma aba para o
contador de elementos da outra em teste E2E. Por isso tambem `ReportList` e
`ReceiptList` usam `.list-item*`, e nao `.task*` — namespace proprio para nao
repetir o problema.

- **Listagem de tarefas** com filtro por status (Todas / Pendente / Em
  andamento / Concluida) e contagem total vinda do `meta` da API.
- **Formulario unico** para criar e editar, com contador de caracteres do
  titulo. Erros `422` do backend sao exibidos no campo correspondente,
  preservando o que foi digitado.
- **Exclusao** passa por um dialogo de confirmacao, na tag `<dialog>` nativa:
  o foco fica preso dentro dele, comeca no botao seguro (para que um `Enter`
  acidental nao delete nada) e volta ao botao que o abriu ao fechar. `Escape`
  e clique fora cancelam.

### Prestacao de contas

- **Lista de relatorios** com criacao (`ReportForm`) e abertura de detalhe.
  Valor em reais digitado com separador de milhar (`1.500,00`) passa por
  `parseMoneyToCents`, que remove o ponto antes de trocar a virgula — o parse
  ingenuo (`replace(',', '.')` puro) virava `NaN` nesse caso e o adiantamento
  entrava como `0` **sem erro nenhum**, silenciosamente.
- **Upload de PDF** por clique ou arrastar-e-soltar (`ReceiptUpload`), sem
  filtrar extensao no cliente: o servidor ja confere os magic bytes, filtrar
  de novo so duplicaria a regra e esconderia a mensagem de erro especifica
  que a API devolve.
- **Fila de revisao** (`ReceiptReview`): imagem do comprovante pelo endpoint
  proprio (`GET /api/receipts/:id/image`, mesma origem), com zoom por botao
  ou roda do mouse, arrasto com o botao esquerdo para andar pelo cupom
  ampliado, e formulario de data/valor/categoria ao lado.
  - O arrasto mexe no `scrollLeft`/`scrollTop` do container, que ja rola —
    nao ha um segundo sistema de coordenadas em `transform` para manter em
    sincronia com as barras, a roda e o teclado. Usa `setPointerCapture`,
    porque sem ele soltar o botao fora do painel nunca entrega o `pointerup`
    e o arrasto fica grudado no cursor.
  - `transform-origin` da imagem e `top left`, **nunca `center`**: a regiao de
    overflow rolavel de um container so se estende para direita e baixo, entao
    escalar a partir do centro punha um terco do cupom fora do alcance de
    qualquer barra de rolagem. Medido a 300% num painel de 396px — 1188px de
    imagem para 792px de `scrollWidth`. O badge de
    origem/confianca e **um so por comprovante** — o pipeline grava a confianca
    do campo mais fraco, nao uma por campo, entao nao ha dado para destacar um
    campo especifico sem mudar o schema.
  - Alertas de validacao e de duplicata aparecem no topo, com "Marcar como
    duplicata" (so na regra `possivel_duplicata`) e "Dispensar" — dispensar e
    **local**, nao persiste no servidor, so tira o alerta da vista naquela
    sessao.
  - Confirmar recarrega a fila e avanca para o proximo pendente **sem sair da
    tela nem recarregar a pagina**; some a fila, a revisao fecha sozinha.
  - Atalhos: `Escape` volta a lista, `Alt+seta` navega entre pendentes. Os
    dois ficam num `addEventListener` no `document` (mesmo padrao do
    `ConfirmDialog`), nao num `onKeyDown` de `div`: apos navegar para outro
    comprovante o componente remonta (via `key={receipt.id}`, necessario para
    nao vazar zoom e valores digitados de um comprovante para o proximo) e o
    foco pode ficar fora da subarvore da div, calando o atalho em silencio.
    Com o `ConfirmDialog` aberto os dois atalhos ficam mudos de proposito: o
    `Escape` e do dialogo, e sem essa guarda um unico toque cancelaria a
    exclusao **e** fecharia a revisao junto.
- **Descartar um comprovante** (`ReceiptList` e a barra da `ReceiptReview`,
  estado e dialogo na `ReportDetail`): pagina em branco no fim do PDF ou cupom
  de outra viagem nao tem como ser resolvido na revisao, e um `needs_review`
  insoluvel trava a fila. Nenhum status e bloqueado — inclusive `confirmed` e
  `duplicate`. A exclusao e definitiva e leva o PDF junto quando nenhuma outra
  pagina o referencia (ver "Retencao e privacidade"), por isso passa sempre
  pelo `ConfirmDialog`, cujo alvo traz data e valor: sem emitente extraido, e
  o unico jeito de conferir que o cupom certo esta sendo apagado.

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

## Container

```bash
docker build -t tasktab .
docker run -p 3000:3000 \
  -e DB_HOST=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=... \
  tasktab
```

Build multi-stage: um estagio instala so as dependencias de producao, outro
gera o build da interface, e o runtime recebe apenas o resultado dos dois. A
imagem roda como usuario `node`, sem devDependencies e sem nenhum arquivo de
env — em producao as variaveis vem do ambiente.

O `HEALTHCHECK` reaproveita o proprio `/api/health`, entao o container so se
declara saudavel quando o Postgres responde. Ele respeita `PORT`.

As **migrations ficam de fora da imagem**: o `node-pg-migrate` e uma
devDependency, entao aplicar migration e um passo separado do pipeline, com o
toolchain completo — nao algo que o container de runtime faca sozinho.

## Testes

Duas suites, ambas de integracao e ambas contra o sistema de verdade: a da
**API** fala HTTP com o Express, e a **E2E** dirige um navegador contra a
interface.

```bash
npm test              # API: sobe os servicos, roda a suite e para os containers
npm run test:watch    # API: sem subir/parar servicos, para iterar
npm run test:e2e      # interface: Playwright contra API + Vite
npm run test:e2e:ui   # interface: modo interativo do Playwright
```

Roda contra `tasktab_test` com `NODE_ENV=test`. Nao e preciso preparar nada
antes: o `pretest` sobe os servicos e espera o banco, o proprio `test` sobe a
API em `:3001` em paralelo ao Jest, e o `tests/orchestrator.js` espera o
`/api/health`, aplica as migrations e trunca a tabela a cada teste. Ao final o
`posttest` para os containers.

Os testes falam **HTTP de verdade** com a API, como qualquer outro cliente —
nao importam `src/app` nem usam supertest.

### E2E da interface

O `npm run test:e2e` sobe a API em `:3001` (banco de teste) e o Vite em `:5173`,
e roda o Playwright contra o navegador. O proxy do Vite aponta para a API de
teste via `API_URL`, entao o E2E **nunca toca no banco de desenvolvimento**.

O arranjo de cada teste passa pela API publica, nao pelo banco: manter um pool
do `pg` vivo dentro do worker do Playwright prenderia o processo no fim da
suite. Aqui quem esta sob teste e a interface.

Na primeira execucao, instale o navegador: `npx playwright install chromium`.

Como o `posttest` derruba os servicos, use `test:watch` (com os containers ja
no ar) enquanto estiver iterando.

## Qualidade de codigo

```bash
npm run lint          # ESLint (backend CommonJS + frontend JSX)
npm run lint:fix
npm run format        # Prettier
npm run format:check
npm run commit        # commit guiado pelo Conventional Commits
```

### Integracao continua

O workflow `.github/workflows/ci.yml` roda a cada pull request e a cada push na
`main`, em dois jobs paralelos: **qualidade** (lint, `format:check` e build da
interface) e **testes de integracao** (`npm test`).

O job de teste usa o mesmo `npm test` do desenvolvimento, com Docker de verdade.
Um `services: postgres` do proprio Actions nao serviria: ele nao executa o
`docker/initdb/`, entao o banco `tasktab_test` nunca existiria.

O `npm audit` fica de fora de proposito — veja a secao sobre ele acima.

### Commits

O historico segue **Conventional Commits**, validado pelo commitlint no hook
`commit-msg` do husky — inclusive o escopo, restrito ao enum de
`commitlint.config.js`. Use `npm run commit` para ser guiado pelo prompt.

O hook `pre-commit` roda apenas `lint` e `format:check`. `npm test` fica de fora
de proposito: o `posttest` derruba o Docker, o que mataria os containers em uso
durante o desenvolvimento — rode a suite no terminal antes de commitar.

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
