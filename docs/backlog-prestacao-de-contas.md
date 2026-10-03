# Backlog — Aba de Prestação de Contas

Issues em ordem de execução para implementar a proposta no **tasktab**.

**Como usar:** cada bloco vira uma issue no GitHub. O título já está no formato
final, os critérios de aceite são checáveis e as dependências estão explícitas —
nenhuma issue começa antes que as suas dependências tenham fechado.

## Convenções do projeto

Valem para todas as issues. O `CLAUDE.md` na raiz é a fonte da verdade; o que
segue é o recorte que mais afeta este backlog.

**Código**

- Backend em CommonJS (`'use strict'` no topo), MVC em
  `src/models|controllers|routes|validators`. Frontend em `web/` é ESM com JSX.
- Imports relativos. Não existe alias nem import absoluto da raiz.
- Toda rota com `asyncHandler` — o Express 4 não captura rejeição de promise.
- SQL **sempre** parametrizado, e só dentro de `src/models/`.
- Nada de `console.*` em `src/` ou `infra/`: use `logger` (fora de requisição)
  ou `req.log` (dentro dela, que já carrega o `request_id`).
- Comentário só onde explica **porquê**, no tom já existente no código.

**Erros**

Toda resposta de erro nasce de uma classe de `infra/errors.js` que estende
`BaseError` e serializa via `toJSON()`:

```json
{ "name": "...", "message": "...", "action": "...", "status_code": 000 }
```

| Classe                 | Status | Quando                                         |
| ---------------------- | ------ | ---------------------------------------------- |
| `BadRequestError`      | 400    | id inválido, JSON malformado, corpo não-objeto |
| `NotFoundError`        | 404    | recurso ou rota inexistente                    |
| `ValidationError`      | 422    | falha de validação; carrega `details`          |
| `TooManyRequestsError` | 429    | teto de requisições estourado                  |
| `InternalServerError`  | 500    | qualquer erro inesperado                       |
| `ServiceError`         | 503    | dependência fora do ar                         |

- O `action` é **obrigatório** e diz ao usuário o que fazer a seguir — a
  interface o exibe abaixo da mensagem.
- `ValidationError` sempre popula `details` com `{ field, message }`.
- Erro inesperado: **deixe estourar**. O `onErrorHandler` converte em 500 sem
  vazar detalhe interno, e acrescenta `request_id` ao corpo.
- Nunca monte objeto de erro na mão dentro do controller.

**Testes**

Só integração, sem mock de banco e sem mock de `fetch`.

- `npm test` sobe a API em `:3001` em paralelo ao Jest; os testes falam **HTTP
  real**. Não existe Supertest e não se importa `src/app` em teste.
- Arranjo e utilitários vivem em `tests/orchestrator.js`.
- Arquivos espelham as rotas: `tests/api/reports/get.test.js`,
  `post.test.js`, e assim por diante.
- **Arquivo de teste novo não leva preâmbulo**: `tests/global-setup.js` já
  espera a API e aplica migrations uma vez por execução, e `tests/setup.js`
  trunca a tabela e fecha o pool por arquivo.
- Interface tem suíte própria em `e2e/` (Playwright), rodando no CI.

**Antes de fechar qualquer issue**

```bash
npm run lint && npm run format:check && npm test && npm run test:e2e
```

Os três primeiros são exigidos pelo hook de pre-commit; o CI roda os quatro.

**Commits:** Conventional Commits, validados pelo commitlint no `commit-msg`,
**incluindo o escopo**, restrito ao enum de `commitlint.config.js`. Use
`npm run commit`.

**Labels sugeridas:** `area:api` · `area:web` · `area:db` · `area:extracao` ·
`area:export` · `infra` · `bloqueada` — nenhuma existe ainda no repositório.

## Marcos

| Marco            | Issues      | Entrega                                        | PR  |
| ---------------- | ----------- | ---------------------------------------------- | --- |
| M0 — Terreno     | 0           | Ferramental destravado para o resto do backlog | #10 |
| M1 — Fundação    | 1 a 5, 22   | Upload, CRUD e revisão manual ponta a ponta    | #10 |
| M2 — Digital     | 6 a 8       | PDFs digitais preenchem sozinhos               | #11 |
| M3 — Cupom       | 25, 9 a 11  | QR Code + emitentes + categoria automática     | #12 |
| M4 — OCR         | 12 a 13     | Cupom térmico escaneado                        | #13 |
| M5 — Conferência | 14 a 15     | Deduplicação e validações                      | #13 |
| M6 — Saídas      | 26, 16 a 18 | Excel e PDF consolidado                        | #14 |
| M7 — Interface   | 19 a 21     | Aba completa com tela de revisão               | #15 |

Transversais (23, 24) entram a qualquer momento depois do M1 — entraram no
#16.

A segunda rodada nasceu do procedimento consolidado de prestação de contas e
da prestação finalizada de Itapipoca — ver
[Segunda rodada](#segunda-rodada--o-processo-completo):

| Marco                 | Issues  | Entrega                                          | PR  |
| --------------------- | ------- | ------------------------------------------------ | --- |
| M8 — Correções        | 33 a 39 | O que já existia e estava errado                 | —   |
| M9 — Revisão completa | 40 a 44 | Tudo o que o comprovante traz, digitável na tela | —   |
| M10 — Extração        | 45 e 46 | Conta do combustível e recortes de leitura       | —   |
| M11 — Conferência     | 47 a 52 | As regras de "o que sinalizar" do procedimento   | —   |
| M12 — Saídas          | 53 a 56 | Planilha, PDFs por categoria e Anexo I oficial   | —   |
| M13 — Fechamento      | 57      | Checagem final antes de fechar                   | —   |

Os critérios das issues 0 a 22, 25 e 26 ficaram sem marcação: foram escritos
antes da execução, e alguns mudaram depois dela — a regra de categoria da #11,
por exemplo, foi invertida pela #30. Da #23 em diante, cada issue foi marcada
ao fechar.

---

# M0 — Terreno

## Issue 0 — Preparar o ferramental

`infra` · **bloqueia todo o resto**

Quatro obstáculos que travariam o backlog logo no primeiro commit. Todos
baratos agora e caros de descobrir tarde.

**Escopo**

1. **Escopos do commitlint.** O enum aceita hoje `api, web, db, http, config,
infra, scripts, validation, lint, deps`. Acrescentar os que este backlog
   usa: `reports`, `receipts`, `merchants`, `extracao`, `export`, `upload`.
   Sem isso o hook rejeita o primeiro commit da Issue 1.
2. **`COPY assets ./assets` no Dockerfile.** O runtime copia apenas `src`,
   `infra` e `web/dist`. O template do Anexo I (#17) vive em `assets/` e
   funcionaria em desenvolvimento, quebrando só em produção.
3. **Diretório de upload.** Entrada no `.gitignore` e no `.dockerignore`,
   volume no container, e permissão de escrita para o usuário `node` — a
   imagem roda como não-root.
4. **Teto de requisições para o fluxo de lote.** O limitador de escrita está em
   100 por 15 min. Um lote de 30 cupons revisados passa disso só em `PATCH`,
   sem contar o upload. Definir teto próprio para as rotas de prestação de
   contas.

**Decisão a registrar (não implementar aqui)**

**CSP e a imagem do cupom.** A política é `img-src 'self' data:`, sem `blob:`.
A tela de revisão (#21) precisa exibir a página do PDF. Duas saídas: servir a
imagem por endpoint próprio (cabe em `'self'`, não mexe na política) ou liberar
`blob:`. A recomendação é a primeira — a CSP não deve ser afrouxada por
conveniência de implementação.

**Critérios de aceite**

- [ ] `npm run commit` aceita um commit com escopo `extracao`
- [ ] Imagem construída contém `assets/`
- [ ] Diretório de upload não aparece em `git status` nem dentro da imagem
- [ ] Container consegue escrever no diretório de upload rodando como `node`
- [ ] Decisão sobre a CSP registrada no `CLAUDE.md`

---

# M1 — Fundação

## Issue 1 — Migration: tabelas de prestação de contas

`area:db` · depende de #0

Criar o schema base. Sem isso nada mais anda.

**Escopo**

Uma migration em `migrations/`, seguindo o padrão da `create-tasks-table`
(enum via `createType`, índices explícitos, constraint de sanidade, `down` que
desfaz tudo).

Enums:

```
expense_category : alimentacao | combustivel | estacionamento | lavanderia |
                   transporte | hospedagem | outros | nao_classificado
receipt_status   : pending | processing | needs_review | confirmed | duplicate | failed
extraction_source: qr | text | ocr | manual
```

Tabelas:

| Tabela      | Campos                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merchants` | `id`, `cnpj` (varchar 14, unique), `name`, `default_category`, `city`, `created_at`, `updated_at`                                                                                                                                                                                                                                             |
| `reports`   | `id`, `title`, `period_start` (date), `period_end` (date), `advance_cents` (int), `status`, `created_at`, `updated_at`                                                                                                                                                                                                                        |
| `receipts`  | `id`, `report_id` (FK cascade), `merchant_id` (FK null), `file_path`, `file_hash` (varchar 64), `page_number` (int), `issued_at` (date), `amount_cents` (int), `category`, `access_key` (varchar 44), `status`, `extraction_source`, `confidence` (numeric), `raw_text` (text), `duplicate_of_id` (FK self, null), `created_at`, `updated_at` |

**Critérios de aceite**

- [ ] `amount_cents` é `integer` — nunca `numeric`/`float`. Motivo registrado em
      comentário: a conferência manual desta prestação de contas produziu
      `219.98000000000002` somando float
- [ ] `issued_at` é `date` (o parser do OID 1082 em `src/config/database.js` já
      garante que chega como string)
- [ ] As três tabelas reaproveitam o trigger existente `set_updated_at` — a
      função já existe desde a migration `add-updated-at-trigger`. **Não**
      duplicar a lógica, e **não** setar `updated_at` no model
- [ ] Unique em `(report_id, file_hash, page_number)` — barra reprocessar a
      mesma página do mesmo arquivo
- [ ] Índice composto casando com a ordenação da #5:
      `(report_id, issued_at, page_number)`. Índice de coluna única não serve
      para `ORDER BY` de duas colunas — no tasktab isso já valeu 2,96 ms → 0,06 ms
      na listagem de tarefas
- [ ] Índices em `receipts.status` e `merchants.cnpj`
- [ ] Constraint `amount_cents >= 0`
- [ ] Constraint de sanidade em `reports`: `period_end >= period_start`
- [ ] `npm run migrations:up` e `migrations:down` rodam limpos, nessa ordem,
      sem resíduo — conferir também que o `down` remove os enums

---

## Issue 2 — Model e validator de `reports`

`area:api` · depende de #1

**Escopo**

`src/models/report.model.js` e `src/validators/report.validator.js`, espelhando
`task.model.js` e `task.validator.js`.

Model: `findAll`, `findById`, `create`, `update`, `remove` — SQL parametrizado,
`COLUMNS` como constante, `UPDATABLE_COLUMNS` para update parcial.

Validator: `title` obrigatório (≤255, não vazio após `trim`), datas ISO
`YYYY-MM-DD` validadas de verdade (rejeitar `2026-02-31`, como já faz
`isValidIsoDate`), `advance_cents` inteiro ≥ 0.

**Critérios de aceite**

- [ ] `period_end >= period_start` validado na aplicação, com erro por campo
- [ ] Valor monetário entra em **centavos**; se a API aceitar reais em algum
      ponto, a conversão é explícita e testada
- [ ] Erros de validação usam `new ValidationError({ details })` com `details`
      no formato `{ field, message }`, e **com `action`** — igual ao validator
      de tasks
- [ ] O model **não** toca em `updated_at` (é do trigger)
- [ ] Testes cobrindo criação válida, título vazio, data inválida e período
      invertido

---

## Issue 3 — CRUD `/api/reports`

`area:api` · depende de #2

**Escopo**

`src/controllers/report.controller.js`, `src/routes/report.routes.js`, montado
em `src/routes/index.js` com `router.use('/reports', reportRoutes)`.

| Método   | Rota               | Sucesso                 |
| -------- | ------------------ | ----------------------- |
| `GET`    | `/api/reports`     | 200                     |
| `GET`    | `/api/reports/:id` | 200                     |
| `POST`   | `/api/reports`     | 201 + header `Location` |
| `PATCH`  | `/api/reports/:id` | 200                     |
| `DELETE` | `/api/reports/:id` | 204                     |

**Critérios de aceite**

- [ ] Todas as rotas com `asyncHandler`
- [ ] Sucesso no envelope já usado: `{ data }` e `{ data, meta }` na listagem.
      Erro **não** tem envelope — sai plano, no formato do `toJSON()`
- [ ] 404 via `new NotFoundError({ message, action })` quando o id não existe
- [ ] Testes em `tests/api/reports/`, um arquivo por método, sem preâmbulo
- [ ] Teste de integração por método, incluindo 404 e 422
- [ ] `npm run lint`, `npm run format:check` e `npm test` limpos

---

## Issue 4 — Upload de PDF e separação por página

`area:api` · `area:extracao` · depende de #3

Primeira entrega de valor real: joga o PDF inteiro e ele vira uma linha por
página.

**Escopo**

- `multer` com storage em disco (`express.json({limit:'100kb'})` atual não trata
  multipart)
- `POST /api/reports/:id/receipts` — aceita 1..N PDFs
- SHA-256 do arquivo com `crypto` nativo, antes de qualquer processamento
- `pdf-lib` separa em páginas; cada página vira um `receipt` com
  `status = 'pending'`
- Diretório de upload configurável por env, **fora do versionamento** (a
  entrada no `.gitignore` e no `.dockerignore` vem da #0)

**Critérios de aceite**

- [ ] Rejeita arquivo que não seja PDF (checar magic bytes `%PDF`, não só a
      extensão) → 422
- [ ] Limite de tamanho configurável; excedido → 422 com mensagem clara e
      `action` dizendo o limite
- [ ] Reenvio do mesmo arquivo no mesmo report não duplica registros (unique da
      #1 respeitado); responder 200 com o que já existe, **não** 500
- [ ] Report inexistente → 404
- [ ] A rota tem teto de requisições próprio (#0) — o upload de um lote não pode
      esbarrar no limitador de escrita
- [ ] Teste com PDF de 3 páginas cria exatamente 3 receipts, com `page_number`
      1, 2, 3

**Atenção:** PDF protegido por senha ou corrompido não pode derrubar o
processo — capturar e marcar `status = 'failed'` com motivo em `raw_text`.

---

## Issue 5 — CRUD e revisão de `receipts`

`area:api` · depende de #4

Fecha o M1: dá para usar a ferramenta digitando tudo à mão, já com tudo
organizado e somado.

**Escopo**

| Método   | Rota                        | Descrição                                  |
| -------- | --------------------------- | ------------------------------------------ |
| `GET`    | `/api/reports/:id/receipts` | lista com filtro por `status` e `category` |
| `GET`    | `/api/receipts/:id`         | detalhe                                    |
| `PATCH`  | `/api/receipts/:id`         | corrige campos na revisão                  |
| `DELETE` | `/api/receipts/:id`         | remove                                     |

Regra de transição de status: qualquer `PATCH` que preencha `issued_at`,
`amount_cents` e `category` pode levar a `confirmed`. Correção manual grava
`extraction_source = 'manual'` nos campos tocados.

**Critérios de aceite**

- [ ] Listagem ordenada por `issued_at`, com `page_number` como desempate —
      nulos por último, para o que ainda não foi extraído não sumir do fim da
      lista. A ordenação precisa bater com o índice da #1
- [ ] `meta` traz `total` e o somatório por categoria em centavos
- [ ] Não é possível confirmar um receipt sem data, valor ou categoria → 422
- [ ] Testes cobrindo filtro, correção manual, confirmação e a recusa de
      confirmar incompleto

---

## Issue 22 — Fixtures sintéticas de teste

`infra` · depende de #4

Sobe para o M1: a #6 já exige fixtures no critério de aceite, então isto é
dependência dura, não transversal.

**Critérios de aceite**

- [ ] Gerador de PDFs de teste: cupom com QR legível, PDF digital, manuscrito,
      par duplicado
- [ ] **Nenhum documento real versionado** — os cupons trazem CPF, CNPJ e
      endereço de terceiros
- [ ] Fixtures pequenas, para não pesar o repositório
- [ ] Vivem em `tests/fixtures/`, reaproveitáveis pela suíte E2E

---

# M2 — Extração de PDFs digitais

## Issue 6 — Serviço de extração de texto

`area:extracao` · depende de #22

Dos 31 documentos do caso-base, 9 eram PDFs digitais — esses não precisam de
OCR nenhum.

**Escopo**

`src/services/extraction/text.service.js` usando `unpdf` (ou `pdfjs-dist`).

Triagem: página com camada de texto útil → rota digital; sem texto → marcada
para a rota imagem (M4).

**Critérios de aceite**

- [ ] Função pura, testável, sem tocar em banco nem em HTTP
- [ ] Heurística de "texto útil" documentada (ex.: mínimo de caracteres
      alfanuméricos), não apenas `texto !== ''`
- [ ] `raw_text` gravado no receipt para auditoria posterior
- [ ] Usa as fixtures da #22

---

## Issue 7 — Normalizadores de valor e data

`area:extracao` · depende de #6

Isolado de propósito: é a fonte mais provável de bug silencioso do projeto
inteiro.

**Escopo**

`src/services/extraction/normalize.js`:

- `parseAmountToCents(str)` — entende `1.234,56`, `1234,56`, `R$ 59,60`,
  `59.60`. Devolve inteiro em centavos
- `parseDate(str)` — `DD/MM/YYYY`, `DD/MM/YY`, `YYYY-MM-DD` → string ISO
- `extractTotal(text)` — ancorado em palavra-chave: `VALOR TOTAL`,
  `Total a pagar`, `Valor a Pagar`, `TOTAL R$`

**Critérios de aceite**

- [ ] `extractTotal` **nunca** usa "maior número da página" — chave de acesso,
      CNPJ e telefone são números maiores. Regra registrada em comentário
- [ ] Ambiguidade `1.234` (mil ou 1,234?) resolvida por regra explícita e testada
- [ ] Teste de tabela com pelo menos 20 casos, incluindo os formatos reais já
      vistos: Hotinet, Colibri, Anota AI, GCOMweb, iFood
- [ ] Entrada não reconhecida devolve `null` — nunca `NaN`, nunca `0`
- [ ] `parseDate` não passa por `new Date(string)`: a timezone desloca a data em
      um dia. É a mesma razão do type parser do OID 1082 e do `formatDate` da
      interface

---

## Issue 8 — Parsers por emitente

`area:extracao` · depende de #7

**Escopo**

Registro de adaptadores em `src/services/extraction/parsers/`, com resolução
por CNPJ ou assinatura de layout, mais um parser genérico de fallback.

Primeiros adaptadores (todos com amostra real disponível): NFC-e Hotinet,
NFS-e (prefeitura), Uber, recibo padrão Buriti.

**Critérios de aceite**

- [ ] Acrescentar um emitente novo = acrescentar um arquivo, sem tocar no núcleo
- [ ] Fallback genérico sempre existe; parser específico só sobrescreve o que
      sabe fazer melhor
- [ ] Cada parser devolve `{ value, source, confidence }` por campo
- [ ] Teste por adaptador

---

# M3 — Cupom fiscal via QR Code

## Issue 25 — Spike: dependências nativas na imagem

`infra` · depende de #0 · **timeboxed**

Antes de escrever a #9. `sharp`, `@napi-rs/canvas`, `zxing-wasm` e
`tesseract.js` sobre `node:24.18.0-alpine` (musl) são risco real de build,
agravado pelo `--ignore-scripts` no estágio de dependências de produção, que
quebra pacote com `postinstall`.

**Critérios de aceite**

- [ ] Imagem construída com as quatro dependências, e um script que carrega
      cada uma e imprime a versão
- [ ] Se falhar em Alpine: trocar a base para `node:24.18.0-slim` e registrar o
      porquê no `Dockerfile`
- [ ] Conferir que o `engine-strict` continua satisfeito (Node ≥ 24.18.0)
- [ ] Tamanho da imagem antes e depois registrado na issue — decidir
      conscientemente se o custo compensa

---

## Issue 9 — Leitura de QR Code e chave de acesso

`area:extracao` · depende de #6 e #25

**A issue mais importante do projeto.** A chave de 44 dígitos é autodescritiva
e tem dígito verificador — resolve data e emitente sem OCR e valida a própria
leitura.

**Escopo**

- Renderizar página → imagem (`pdfjs-dist` + `@napi-rs/canvas`)
- Pré-processar com `sharp` (cinza, upscale 2–3×)
- Ler QR com `zxing-wasm`
- `src/services/extraction/access-key.js` com `parse()` e `isValid()`

Layout da chave:

| Posição | Campo        |
| ------- | ------------ |
| 1–2     | cUF          |
| 3–6     | AAMM         |
| 7–20    | CNPJ         |
| 21–22   | mod          |
| 23–25   | série        |
| 26–34   | nNF          |
| 35      | tpEmis       |
| 36–43   | cNF          |
| 44      | cDV (mod-11) |

**Critérios de aceite**

- [ ] DV mod-11 implementado e testado; chave inválida marca o receipt para
      revisão em vez de aceitar o dado
- [ ] Aceita chave vinda do QR **ou** do texto impresso (o número aparece nos
      dois lugares)
- [ ] Fallback: sem QR legível, tentar a chave pela camada de texto antes de
      desistir
- [ ] Teste com as 4 chaves reais abaixo. **Conferidas**: rodado o mod-11, e
      CNPJ, número da nota e DV batem nas quatro

```
52260626048802000165650010001631601303284889  → CNPJ 26048802000165, nNF 163160, DV 9
52260626048802000165650010001631191940931307  → CNPJ 26048802000165, nNF 163119, DV 7
52260620305961000111650010000078341000081451  → CNPJ 20305961000111, nNF   7834, DV 1
52260658080015000197650030001641801002927450  → CNPJ 58080015000197, nNF 164180, DV 0
```

**Nota:** a chave **não** carrega o valor total. Esse continua vindo de
texto/OCR.

---

## Issue 10 — Cadastro de emitentes

`area:api` · depende de #1

**Escopo**

Model, validator, controller e rotas de `merchants`, no mesmo padrão de reports.

`GET /api/merchants` · `POST /api/merchants` · `PATCH /api/merchants/:id` ·
`GET /api/merchants/by-cnpj/:cnpj`

**Critérios de aceite**

- [ ] CNPJ normalizado para 14 dígitos na entrada (aceitar com ou sem máscara)
- [ ] Validação de dígito verificador do CNPJ
- [ ] CNPJ duplicado → 422 com mensagem clara e `action`, **não** 500 por
      violação de unique
- [ ] Testes de criação, duplicata e busca por CNPJ

---

## Issue 11 — Categorização automática por emitente

`area:extracao` · depende de #9 e #10

É assim que a classificação vira automática **sem nenhuma IA**: a ferramenta
aprende por cadastro.

**Escopo**

Extraído o CNPJ, procurar em `merchants`. Achou → aplica `default_category` e
vincula `merchant_id`. Não achou → cria o merchant com
`default_category = 'nao_classificado'` e manda o receipt para `needs_review`.

**Critérios de aceite**

- [ ] Categoria **nunca** é adivinhada por nome ou palavra-chave — sem CNPJ
      conhecido, vai para revisão
- [ ] Confirmar a categoria de um receipt oferece atualizar o
      `default_category` do emitente (o valor real: 7 dos 28 lançamentos do
      caso-base eram do mesmo CNPJ)
- [ ] Teste: segundo cupom do mesmo CNPJ já entra classificado

---

# M4 — OCR

## Issue 12 — Pipeline de OCR

`area:extracao` · depende de #9

**Escopo**

`tesseract.js` com idioma `por`, sobre a imagem já pré-processada da #9 (cinza,
upscale, binarização). É no pré-processamento que o OCR ganha ou perde.

**Critérios de aceite**

- [ ] Roda só quando #6 classificou a página como sem texto útil
- [ ] `confidence` por campo gravado no receipt e usado depois para destacar na
      revisão
- [ ] Valor extraído por OCR **nunca** entra como `confirmed`
      automaticamente — sempre `needs_review`
- [ ] Timeout por página, para uma imagem ruim não travar o lote
- [ ] Documentar no README o custo real observado (~1–3 s/página)

**Fora de escopo — decisão consciente:** manuscrito. Os recibos da Pousada São
Sebastião são caneta sobre formulário; Tesseract não lê. Vão direto para a fila
manual com a imagem ampliada ao lado do formulário. Tentar OCR de manuscrito é
onde este tipo de projeto costuma travar.

---

## Issue 13 — Processamento assíncrono e status

`area:api` · `infra` · depende de #12

OCR de 30 páginas não cabe num ciclo de request.

**Escopo**

Processamento assíncrono **em processo** (sem serviço novo), com `status` no
banco e polling pelo frontend. Mais `POST /api/receipts/:id/reprocess`.

**Critérios de aceite**

- [ ] Upload responde 202 imediatamente, com os receipts em `pending`
- [ ] `status` progride `pending → processing → needs_review | confirmed | failed`
- [ ] Falha grava o motivo e **não** derruba o processamento das outras páginas
- [ ] Receipt travado em `processing` após reinício pode ser reprocessado. Isto
      não é hipotético: o `src/server.js` encerra graciosamente em SIGTERM e o
      trabalho em memória se perde — o container e o `npm run dev` fazem isso
      rotineiramente
- [ ] Cada etapa loga por `req.log` (ou `logger` fora da requisição), para que o
      `request_id` amarre o lote inteiro
- [ ] README registra a decisão e o gatilho para migrar a fila de verdade
      (BullMQ + Redis): uso concorrente. A unidade de trabalho já é "uma página,
      um registro", então a migração é local

---

# M5 — Conferência

## Issue 14 — Deduplicação

`area:extracao` · depende de #11

**Escopo**

| Caso real                                          | Regra                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Cupom + comprovante de cartão (Araújo, R$ 5,98)    | O comprovante imprime `VINCULADO AO COO ... NFC-e: 000164180` → casa pelo número da nota |
| Comanda + cupom fiscal (Mesa 13/CVL, R$ 91,19)     | Mesma data + mesmo valor + tipos de documento diferentes                                 |
| Recibo padrão + iFood (Padaria Imperial, R$ 24,36) | Mesma data + mesmo valor + nomes de emitente semelhantes                                 |

**Critérios de aceite**

- [ ] Duplicata **exata** (mesma chave de acesso) colapsa sozinha, marcando
      `duplicate_of_id`
- [ ] Duplicata **provável** vira alerta na revisão — nunca exclusão silenciosa
- [ ] Receipt marcado como duplicata continua no PDF consolidado, mas **não**
      soma no total
- [ ] Teste do contraexemplo, obrigatório: **17/06 e 23/06, ambos Franguinho,
      ambos R$ 48,60, notas 163119 e 163284 — NÃO são duplicata.** Foi
      exatamente essa confusão que sumiu com R$ 48,60 da planilha oficial. Regra
      agressiva demais recria o erro que a ferramenta existe para evitar

---

## Issue 15 — Validações automáticas

`area:api` · depende de #14

**Escopo**

`src/services/validation/` devolvendo lista de alertas por report:

| Regra                                     | O que pega                                      |
| ----------------------------------------- | ----------------------------------------------- |
| Soma dos itens = total declarado          | O `3,60` que deveria ser `37,60`                |
| DV da chave de acesso                     | Erro de OCR na chave                            |
| Total do report = soma das linhas         | Lançamento faltando ou duplicado                |
| Data dentro do período                    | Recibo de outro mês                             |
| Coerência geográfica/horária              | Jantar em Abadiânia 18h + Uber em Goiânia 18h48 |
| Valor fora da faixa histórica do emitente | Dígito a mais ou a menos                        |

**Critérios de aceite**

- [ ] `GET /api/reports/:id/validation` devolve os alertas com severidade
      (`erro` / `aviso`)
- [ ] Alerta **não** bloqueia exportação — o humano decide
- [ ] A regra "soma dos itens = total" tem teste dedicado: é a que pegaria o
      erro real de R$ 34,00
- [ ] A regra de faixa histórica só dispara com amostra mínima do emitente
      (senão vira ruído)

---

# M6 — Saídas

## Issue 26 — Spike: remendo do Anexo I

`area:export` · depende de #1 · **timeboxed**

Antes da #16. A #17 é, por admissão do próprio backlog, a issue mais arriscada,
e a #16 seria construída em cima dela. Se o remendo de XML não sobreviver ao
template real, a forma do M6 inteiro muda — melhor descobrir agora.

**Critérios de aceite**

- [ ] Abrir o template real como ZIP, alterar **uma** célula de valor, regravar
- [ ] Excel e LibreOffice abrem o resultado sem aviso de reparo
- [ ] Validação de dados (listas suspensas) preservada
- [ ] Diff do ZIP mostra apenas a entrada de planilha alterada
- [ ] Se falhar: registrar a alternativa escolhida antes de abrir a #16

---

## Issue 16 — Exportação Excel (resumo próprio)

`area:export` · depende de #5 e #26

**Escopo**

`GET /api/reports/:id/export.xlsx` com `exceljs`: colunas Data, Local, Tipo,
Valor, ordenadas por data; total geral e subtotais por categoria como
**fórmula** (não valor fixo, para o conferente poder editar e ver recalcular).

**Critérios de aceite**

- [ ] Formato de moeda em pt-BR: usar `[$R$-416] #,##0.00`, não
      `"R$" #,##0.00` — o segundo renderiza `R$ 1,320.28` em locale en-US
- [ ] Data como data de verdade, com `DD/MM/YYYY`, não string
- [ ] Centavos convertidos para reais só na saída
- [ ] Duplicatas aparecem marcadas e fora do somatório
- [ ] Teste que abre o arquivo gerado e confere o total

---

## Issue 17 — Preenchimento do Anexo I oficial

`area:export` · depende de #16

**Escopo**

O template tem fórmulas, estilos, células mescladas e **listas suspensas
(validação de dados)**. Bibliotecas que abrem e regravam o `.xlsx` reconstroem
o XML e perdem o que não sabem representar — na conferência manual desta
prestação de contas a validação de dados se perdeu exatamente assim.

Solução: **não reconstruir, remendar.**

1. Abrir como ZIP (`jszip`)
2. Alterar **apenas** as células de valor em `xl/worksheets/sheetN.xml`
   (`fast-xml-parser`)
3. Não tocar em `styles.xml`, `calcChain.xml` nem nas extensões de validação
4. Regravar o ZIP com o resto **byte a byte idêntico**

Mapa do template (já levantado): dados a partir da linha 32; colunas B (data),
C (cidade), G (descrição), S/W/X (categorias), Y (total da linha, fórmula
própria); linha 101 com os totais, cobrindo o intervalo inteiro — preencher
linha a linha não exige mexer em fórmula nenhuma.

**Critérios de aceite**

- [ ] Diff célula a célula entre original e gerado: **só** as células de dados
      mudam
- [ ] Validação de dados (listas suspensas) preservada — verificação explícita
      no teste
- [ ] Remover o `<v>` (valor em cache) das células com fórmula, ou marcar
      `<calcPr fullCalcOnLoad="1"/>`. Sem isso o Excel abre exibindo o total
      antigo até alguém editar uma célula
- [ ] Template versionado em `assets/`, sem dado pessoal preenchido, e presente
      dentro da imagem Docker (o `COPY` vem da #0)
- [ ] Teste que abre o gerado e confere total e saldo

---

## Issue 18 — PDF consolidado

`area:export` · depende de #14

**Escopo**

`GET /api/reports/:id/export.pdf` com `pdf-lib`, em ordem cronológica (data e,
quando houver, hora do comprovante).

Dois ganhos sobre o processo manual:

- **Carimbo por página**: `Item 07 · 19/06/2026 · Franguinho na Panela ·
R$ 37,60` na margem — o conferente para de precisar cruzar com a planilha
- **Sumário navegável**: página de índice no início e bookmarks por categoria e
  data

**Critérios de aceite**

- [ ] Ordem cronológica com hora como desempate quando disponível
- [ ] Carimbo não cobre conteúdo do cupom (posicionar na margem, medindo a
      página)
- [ ] Duplicatas incluídas e marcadas como tal no carimbo
- [ ] Contagem de páginas do resultado = soma das páginas de origem + índice
- [ ] Fonte com suporte a acentuação (WinAnsi ou fonte embutida) — testar com
      "Alimentação" e "Abadiânia"

---

# M7 — Interface

## Issue 19 — Navegação entre abas

`area:web` · depende de #3

**Escopo**

`App.jsx` hoje é uma tela só. Trocar view por estado (`useState` com
`'tasks' | 'expenses'`), sem dependência nova — coerente com o "CSS próprio,
sem framework" do projeto.

**Critérios de aceite**

- [ ] A aba de tarefas continua funcionando exatamente como hoje — as 13 specs
      de `e2e/` seguem passando sem alteração
- [ ] Aba acessível por teclado, com `aria-selected`
- [ ] Paleta e tokens de `styles.css` reaproveitados; cor nunca é o único canal
      de informação, como já vale para os status de tarefa
- [ ] Spec E2E cobrindo a troca de abas
- [ ] `react-router` **fora de escopo** — entra quando houver URL própria por
      relatório

---

## Issue 20 — Tela de listagem e upload

`area:web` · depende de #19, #4 e #13

**Escopo**

Lista de reports, criação, upload com arrastar-e-soltar, progresso por página e
polling enquanto houver receipt em `processing`.

**Critérios de aceite**

- [ ] Estados de carregando, vazio e erro tratados (o `App.jsx` atual já faz
      isso — seguir o padrão)
- [ ] Polling para quando não há mais `processing`; não fica batendo à toa
- [ ] Erro de upload usa `ApiError.fieldErrors()` do `web/src/api.js` — que já
      lê `body.details` do formato plano — exibindo no campo certo
- [ ] O `action` do erro é exibido, como o `App.jsx` já faz no alerta
- [ ] Total e subtotais visíveis, atualizados conforme os receipts são
      confirmados
- [ ] Specs E2E para criar report, subir arquivo e ver a lista preencher

---

## Issue 21 — Tela de revisão

`area:web` · depende de #20 e #15

**A tela que justifica o projeto.** O trabalho humano deixa de ser digitar e
passa a ser confirmar.

**Escopo**

Imagem do cupom à esquerda, campos extraídos à direita, navegação por teclado
entre pendentes.

**Critérios de aceite**

- [ ] A imagem é servida por endpoint próprio (mesma origem), respeitando a
      decisão de CSP da #0 — `blob:` não passa na política atual
- [ ] Campo de baixa confiança destacado visualmente, com a origem indicada
      (`qr` / `text` / `ocr` / `manual`)
- [ ] Alertas de duplicata e de validação no topo, com ação de aceitar ou
      rejeitar
- [ ] Confirmar avança para o próximo pendente sem recarregar a página
- [ ] Zoom na imagem — indispensável para cupom térmico e recibo manuscrito
- [ ] Atalhos de teclado para confirmar e navegar; um lote de 30 cupons tem que
      ser revisável sem tirar a mão do teclado
- [ ] Diálogo de confirmação, se houver, reaproveita o `ConfirmDialog` — que já
      usa `<dialog>` nativo com foco preso
- [ ] Specs E2E do fluxo de revisão, incluindo navegação por teclado

---

# Transversais

Podem entrar a qualquer momento depois do M1.

## Issue 23 — Documentação no README

`infra`

- [x] Seção da aba, no tom das existentes (explica o **porquê** das decisões,
      não só o que faz)
- [x] Novas variáveis de ambiente na tabela existente — as quatro de `OCR_*` e
      `LOG_LEVEL` faltavam
- [x] Endpoints na tabela de endpoints — `/api/merchants` faltava inteiro
- [x] Registrar as três decisões que mais custam a redescobrir: cascata de
      extração, dinheiro em centavos, remendo do XML no Anexo I
- [x] `CLAUDE.md` atualizado com o que for regra para quem escrever código novo

## Issue 24 — Retenção e privacidade

`infra`

- [x] Política de retenção dos arquivos enviados — o arquivo vive enquanto o
      comprovante existir; sem TTL, para não destruir evidência ainda
      questionável. Exclusão **contada por referência**
      (`src/services/retention.service.js`), porque o nome do arquivo é o
      SHA-256 e um PDF atende várias páginas e vários relatórios
- [x] Diretório de upload fora do versionamento (coberto pela #0, confirmar) —
      confirmado no `.gitignore` **e** no `.dockerignore`
- [x] Decisão sobre anonimizar `raw_text` após confirmação — **não anonimizar**.
      A regra de conferência que soma itens lê dele e confirmar é reversível:
      anonimizar ali calaria a checagem nos comprovantes que vão assinados. A
      proteção é o cerco: fora de `UPDATABLE_COLUMNS` e fora do log
- [x] Conferir que `raw_text` não vai parar no log — os serializers do
      `pino-http` são enxutos, mas log manual pode vazar CPF/CNPJ de terceiros.
      Nenhuma chamada atual loga o campo; a regra ficou no `CLAUDE.md`
- [x] Registrar a decisão antes de qualquer deploy em produção — seção
      "Retencao e privacidade" no `README.md`

---

## Issue 27 — Remover um comprovante pela interface

`area:web` · depende de #20 e #21

Hoje a única saída para um comprovante que não deveria estar no relatório é
apagar o relatório inteiro. Página em branco no fim do PDF, cupom de outra
viagem, arquivo escaneado torto que nem o OCR leu — todos ficam na lista, e
`needs_review` que ninguém consegue resolver trava a fila de revisão: o
contador "3 de 12 pendentes" nunca chega ao fim.

**O backend já resolve isso.** `DELETE /api/receipts/:id` existe desde a #5,
responde `204`, devolve `404` para id inexistente e apaga o PDF do disco pela
contagem de referência da #24 (`src/services/retention.service.js`). Está
coberto por `tests/api/receipts/delete.test.js` e documentado no README. Esta
issue **não toca no backend** — é só a afordância que falta.

**Escopo**

Botão "Deletar" na linha da lista (`ReceiptList`) e na barra da tela de revisão
(`ReceiptReview`), os dois passando pelo `ConfirmDialog` já existente. A
exclusão é definitiva e leva o PDF junto quando nenhuma outra página o
referencia — o diálogo tem que deixar isso claro.

**Critérios de aceite**

- [x] `web/src/api.js` ganha `deleteReceipt(id)`, espelhando `deleteTask`
- [x] Cada linha de `ReceiptList` tem "Deletar" (`btn btn--sm btn--danger`), sem
      empurrar o `link-button` que abre a revisão
- [x] A barra da `ReceiptReview` também tem a ação: a decisão de descartar
      costuma ser tomada olhando a imagem, não a lista
- [x] Reaproveita o `ConfirmDialog` (`<dialog>` nativo, foco preso, foco inicial
      no Cancelar) — nada de `window.confirm`, nada de div nova
- [x] O `target` do diálogo identifica o comprovante: nome do emitente ou
      `Comprovante #id`, com valor e data quando houver
- [x] O estado do diálogo mora na `ReportDetail`, uma instância só, e ela é
      renderizada tanto no ramo da lista quanto no ramo da revisão
- [x] Deletar o comprovante em revisão fecha a revisão e volta à lista; se ainda
      houver pendentes, segue para o próximo (mesmo `handleAction`)
- [x] Após a exclusão, `load()` atualiza lista, total e subtotais do
      `ReceiptSummary` — nada de remover só do estado local
- [x] Erro exibe `message` e `action`, no mesmo alerta que a tela já usa
- [x] Nenhum status é bloqueado: `confirmed`, `duplicate` e `failed` também
      podem ser removidos. Relatório `closed` também — a regra de fechamento não
      existe no backend e inventá-la só na UI seria promessa vazia
- [x] Specs E2E: excluir pela lista (some da lista e do total), cancelar (nada
      muda), e excluir pelo ramo de revisão

**Fora de escopo**

Desfazer / lixeira, exclusão em lote e bloqueio por relatório fechado. Cada um é
uma issue própria; a lixeira, em particular, brigaria com a política de retenção
da #24 (o arquivo morre junto com a linha).

---

## Issue 28 — Arrastar a imagem do comprovante para navegar

`area:web` · depende de #21

Com zoom, a única forma de andar pelo cupom é a barra de rolagem. Numa tela em
que a pessoa alterna imagem e formulário dezenas de vezes por lote, mirar uma
barra de 8px é atrito puro — o gesto natural é agarrar o documento e puxar,
como em qualquer visualizador de PDF.

**A investigação achou um defeito mais grave que a ergonomia.** `.review__image`
usa `transform-origin: top center` dentro de um flex com `justify-content:
center`. A imagem escalada cresce para os dois lados, mas a região de overflow
rolável só se estende para direita/baixo — o que transborda à esquerda fica
fora do alcance de qualquer barra. Medido no navegador, cupom a 300% num painel
de 396px:

|                                 | `top center` (atual) | `top left` |
| ------------------------------- | -------------------- | ---------- |
| Largura renderizada             | 1188px               | 1188px     |
| `scrollWidth`                   | 792px                | 1188px     |
| Faixa de `scrollLeft`           | 0–396                | 0–792      |
| Recorte inalcançável à esquerda | **396px (33%)**      | 0px        |

Ou seja: hoje **o terço esquerdo do cupom não pode ser visto a 300%**, e é onde
ficam a descrição dos itens e o CNPJ. Trocar a origem para `top left` resolve, e
é pré-requisito do arrasto — sem isso o gesto esbarraria num limite de rolagem
que não corresponde à imagem.

**Escopo**

Arrasto com o botão esquerdo dentro da imagem move a visualização, via
`scrollLeft`/`scrollTop` do `.review__image-scroll`. Nada de reimplementar
rolagem com `transform`: o container já rola, e mexer no `scrollLeft` mantém as
barras, a roda do mouse e o teclado coerentes de graça.

**Critérios de aceite**

- [x] `transform-origin: top left`, com a evidência acima registrada em
      comentário — é a razão de não voltar para `center`
- [x] Arrastar com o botão esquerdo dentro da imagem move a visualização na
      direção do gesto (pegar e puxar o papel, não mover uma câmera)
- [x] Ponteiro indica o estado: `grab` quando há o que arrastar, `grabbing`
      durante o gesto, padrão quando a imagem cabe inteira
- [x] Usa Pointer Events com `setPointerCapture`: soltar o botão fora do painel
      — ou fora da janela — não pode deixar o arrasto grudado
- [x] O arrasto nativo de imagem do browser (`dragstart`) é suprimido; sem isso
      o gesto vira um "arrastar arquivo" com imagem fantasma
- [x] Clique sem movimento não é tratado como arrasto e não seleciona texto
- [x] Zoom, roda do mouse e o botão "Redefinir" continuam como estão
- [x] O container é focável e rolável por teclado — quem não usa mouse também
      precisa alcançar o cupom ampliado
- [x] Specs E2E: o recorte à esquerda deixa de existir a 300%, e um arrasto
      altera `scrollLeft` na direção certa

**Fora de escopo**

Zoom ancorado no cursor (hoje a roda amplia a partir da origem, não do ponto
sob o mouse), arrasto com botão do meio e gestos de pinça em touch. São
melhorias independentes, e nenhuma é bloqueada por esta.

---

## Issue 29 — Exportação Excel organizada por tipo

`area:export` · `area:web` · depende de #16 e #21

O resumo próprio da #16 saía como lista cronológica plana, com os subtotais por
categoria empilhados no rodapé — e não tinha botão nenhum na interface: só
quem soubesse a URL conseguia exportar.

**A investigação achou um defeito de verdade, não só de ergonomia.** Um
comprovante sem categoria aparecia na coluna Tipo como `Sem categoria`
(`labels.js`), enquanto o subtotal do rodapé procurava por `Não classificado`
(a chave do enum). Nenhuma linha casava: o valor entrava no TOTAL e em
**nenhum** subtotal, e a soma dos tipos não fechava com o total geral. O
relatório 22 do banco de desenvolvimento, com um único cupom de R$ 37,60 sem
categoria, reproduzia o caso inteiro.

**Escopo**

`GET /api/reports/:id/export.xlsx` passa a gerar uma aba `Resumo` e **uma aba
por tipo com lançamento**. Só entra `confirmed` — o mesmo critério do Anexo I,
e confirmar já exige categoria, então toda linha da planilha tem tipo.

O valor de cada tipo no `Resumo` é fórmula cruzando abas
(`SUM('Alimentação'!D2:D9)`), não número repetido: corrigir um lançamento na
aba do tipo muda o resumo e o total sozinho. Repetir o valor criaria duas
verdades no mesmo arquivo.

**Critérios de aceite**

- [x] `nao_classificado` e `NULL` colapsam num rótulo só (`categoryKey`) — é
      ausência de decisão, não um tipo de despesa
- [x] Uma aba por tipo **com lançamento**, na ordem do enum: dois relatórios da
      mesma pessoa saem com o mesmo layout e podem ser comparados
- [x] Nome de aba normalizado (`: \ / ? * [ ]` e o teto de 31 caracteres) e
      referência entre abas com aspas simples — sem isso um acento no rótulo
      derruba a fórmula
- [x] Relatório sem nenhum confirmado gera arquivo válido com total `0`
      literal, não `SUM` de intervalo vazio (que abre em `#REF!`)
- [x] O que não entrou é listado em "Fora da prestação", contado e **fora de
      qualquer soma** — uma planilha que só mostra o confirmado esconde o
      trabalho que falta de quem vai assinar
- [x] Teste que **resolve** a fórmula contra as células, em
      `tests/helpers/xlsx-formula.js`, e não só compara a string: é o que pega
      o intervalo apontando para o lugar errado
- [x] Botão "Exportar Excel" na tela do relatório, como `<a href download>` —
      baixar por `fetch` exigiria `blob:`, que a CSP não libera
- [x] Sem confirmado, o botão fica desabilitado com a razão à vista, em vez de
      entregar planilha vazia
- [x] Spec E2E: botão desligado antes, download com o nome certo depois de
      confirmar

**Fora de escopo**

Filtro por status na URL da exportação, exportar vários relatórios de uma vez
e agrupar por emitente. Nenhum é bloqueado por esta.

---

## Issue 30 — Campos que já estavam no texto, e a planilha com cara de planilha

`area:extracao` · `area:export` · `area:web` · depende de #29

Conferência dos arquivos gerados contra as planilhas reais
(`Prestação Contas Itapipoca Henrique.xlsx`) apontou três coisas ao mesmo
tempo: erro de leitura, planilha crua demais, e campos que a pessoa preferia
receber preenchidos mesmo sem certeza a ter de digitar.

**O diagnóstico achou quatro defeitos, não uma limitação de OCR.** Tudo o que
faltava já estava no `raw_text` e era descartado:

1. **Data pegava a primeira do texto.** No cupom 106 o OCR leu
   `NiC-e ... 02/06/2026` (6 no lugar do 8) e, três linhas abaixo, estava
   `Data de Autorização 02/08/2026`. A errada venceu. Os comprovantes 101 e 106
   foram **confirmados com a data errada** — a prova de que campo preenchido
   sem destaque passa despercebido.
2. **Âncora do total atravessava a quebra de linha.** `\s+` engole o `\n`: o
   cabeçalho terminava em "Valor total", a linha seguinte começava com `001`, e
   o total do cupom virava R$ 1,00.
3. **Nome do emitente era "a primeira linha não vazia"** — num PDF escaneado,
   a margem do papel. 5 dos 19 emitentes estavam cadastrados como
   `: 40) 47 DL? "o`, e 11 dos 24 comprovantes não tinham emitente nenhum.
4. **Cidade, hora e documento nunca foram extraídos**, embora estejam no texto
   (`... SERRINHA FORTALEZA-CE 60714-242`, `13:59:27`,
   `NiC-e nº 000003210 Séria 012`). `merchants.city` existia e nunca era
   populada.

**Escopo**

Extração ancorada para data e hora, nome pela razão social colada ao CNPJ,
cidade reconstruída do endereço, documento fiscal, e palpite de categoria por
palavra-chave. Colunas `issued_time`, `document_ref` e `category_guessed` em
`receipts`. Planilha com as seis colunas e a formatação da referência.

**A decisão que inverteu uma regra**

Categoria passou a ser adivinhada por nome, o que o projeto proibia. A troca
foi consciente e a condição é a marca: `category_guessed` faz o campo chegar
com borda tracejada e a frase "Sugerida pelo nome do emitente — confira antes
de confirmar". O risco que a regra antiga evitava não era adivinhar; era
adivinhar **sem dizer que adivinhou**. Editar a categoria ou confirmar zera a
marca, e cadastro de emitente nunca é sobrescrito por palpite.

**Critérios de aceite**

- [x] `extractDate` prefere a data da autorização à primeira da página
- [x] Âncora não atravessa `\n` — no total e no nome do emitente
- [x] `extractLooseTotal` como segundo passe, com confiança 0.3, separado do
      estrito para um palpite não passar por leitura
- [x] Hora só quando há data: um `09:07` solto no ruído do OCR veio de telefone
- [x] Cidade separa bairro de município (`SERRINHA FORTALEZA-CE` →
      `Fortaleza/CE`) sem lista de municípios, e lê endereço em caixa mista
- [x] Nome do emitente pela razão social; teste do caso em que o CNPJ termina
      a linha e o endereço vinha no lugar
- [x] Palpite de categoria marcado, some ao editar ou confirmar, nunca
      sobrescreve cadastro; `null` quando o nome não diz nada
- [x] Colunas Cidade, Hora e Documento na planilha, vazias quando o cupom não
      as traz
- [x] Formatação da referência, com teste de cabeçalho, zebra, congelamento e
      mesclagem do TOTAL
- [x] Campos de hora e documento na tela de revisão, e spec E2E do palpite

**Medido nos 24 comprovantes reais do banco de desenvolvimento**

Cidade saiu de 3 para 20 preenchidas; hora e documento, de 0 para 7 e 4; nome
do emitente passou a acertar a razão social nos 7 cupons com camada de texto.
Os 17 restantes são recibos manuscritos — continuam fora por decisão, o
Tesseract não lê caneta sobre formulário.

**Fora de escopo**

Ler manuscrito, corrigir OCR por dicionário e casar cidade contra a tabela do
IBGE. Nenhum é bloqueado por esta.

---

## Issue 31 — Ajustes do primeiro uso real

`area:extracao` · `area:export` · `area:web` · depende de #30

Seis ajustes vindos de quem usa a ferramenta, depois de fechar uma prestação
de contas de verdade com ela. Três são remoções — e é a parte mais importante
desta issue.

**O que saiu**

- **Hora e Documento.** Foram acrescentados na #30 e nunca chegaram a ser
  consultados na revisão. Campo que ninguém lê não é neutro: alonga o
  formulário e divide a atenção de quem confere. Saíram do banco, da extração,
  da tela e da planilha. Voltam por pedido, não por completude.
- **Categoria `hospedagem`.** Não se aplica ao uso real. O Postgres não remove
  valor de enum, então o tipo foi recriado — migration com `up` e `down`
  testados nos dois sentidos, sem perda das 23 linhas existentes.
- **Chave de acesso no topo da revisão.** São 44 dígitos que ninguém confere a
  olho, ocupando a primeira linha acima da data. A _origem_ da extração (QR,
  texto, OCR) continua à vista: é ela que diz o quanto confiar no que está
  preenchido, e o número não acrescenta nada a isso.

**Categoria com piso `alimentacao`**

No relatório real, 21 de 23 lançamentos eram alimentação. Abrir o seletor em
cada linha custava mais que corrigir as duas erradas. O piso é aplicado no
`classify`, **fora** do `guessCategory` — que continua devolvendo `null` sem
indício no nome. Manter os dois separados é o que deixa visível qual dos dois
respondeu, e permite mudar o piso sem tocar nas regras que leem o nome.

Não existe mais comprovante sem categoria, e todo palpite continua marcado.

**A imagem do cupom: dois defeitos, não um**

O relato foi "esticado e mal formatado, e a resolução está ruim". Eram duas
causas independentes.

1. **Deformação.** `.review__image-scroll` é um container flex, e o
   `align-items: stretch` padrão esticava a imagem até os 70vh do painel. A
   proporção do documento ia junto. `flex-start` mais `height: auto` resolvem.
   De quebra, isso explicava por que o spec "sem zoom o painel não se anuncia
   como arrastável" passava: a imagem esticada sempre "cabia" na vertical, e o
   teste passava pelo motivo errado. Agora usa uma página larga e baixa.
2. **Resolução.** Renderizávamos a 3×. Os PDFs reais são digitalizações a
   257 ppi: a página de 1000pt traz uma imagem embutida de **3568px**, ou seja
   3,57× os pontos. A 3× o resultado saía com 3000px — **abaixo do original**,
   descartando detalhe que estava no arquivo. Passou a 4×, que cobre 288 ppi.
   Acima disso só haveria interpolação.

Medido na mesma página escaneada:

| formato           | dimensões     | tamanho    |
| ----------------- | ------------- | ---------- |
| PNG a 3× (antes)  | 3000×1431     | 1861 KB    |
| PNG a 4×          | 4000×1908     | 2913 KB    |
| **WebP q92 a 4×** | **4000×1908** | **451 KB** |

Mais resolução e quatro vezes menos bytes que antes. `sharp` já era dependência
de produção, então nada novo entrou. O custo é a renderização passar de ~1,1s
para ~2s, paga uma vez por comprovante graças ao ETag e ao `max-age` de um dia.

A escala do QR (`qr.service.js`) continua 3× e ficou desamarrada desta: lá o
alvo é o zxing, aqui é o olho humano.

**Critérios de aceite**

- [x] `issued_time` e `document_ref` fora do banco, da extração, da tela e da
      planilha; migration reversível
- [x] `hospedagem` fora do enum, com `up`/`down` testados e sem perda de dado
- [x] Chave de acesso não aparece mais na revisão; spec E2E trava a ausência
- [x] Piso `alimentacao` aplicado no `classify`, com `guessCategory` intacto
- [x] Imagem não deforma mais; spec de pan corrigido para não passar pelo
      motivo errado
- [x] Imagem servida em WebP a 4×, com teto de 4200px no lado maior

**Fora de escopo**

Cache da imagem em disco (hoje ela é re-renderizada a cada requisição sem
ETag), e escala derivada do ppi real de cada PDF em vez de fixa em 4×. Os dois
só valem se a espera de ~2s incomodar no uso.

---

## Issue 32 — Autenticação e autorização

`area:api` · `area:db` · `area:web` · `infra` · depende de #31

Até aqui a API era **aberta**. Qualquer um que alcançasse a porta listava os
relatórios, baixava o Anexo I assinado e puxava a imagem de qualquer cupom —
justamente onde estão o CNPJ do emitente e, às vezes, o CPF de terceiros. O
`CLAUDE.md` já proibia logar `raw_text` e `access_key`, mas a mesma informação
saía inteira pela rota. Enquanto rodou em `localhost` não houve dano; no
instante em que isso subisse para qualquer lugar acessível, seria vazamento.

Esta issue fecha isso, e a decisão que estrutura tudo é **separar os dois eixos
da autorização**.

**Escopo e posse são coisas diferentes**

| Eixo       | Pergunta                   | Onde vive                       |
| ---------- | -------------------------- | ------------------------------- |
| **Escopo** | que ação, sobre que classe | `requireScope` na **rota**      |
| **Posse**  | quais linhas               | `ownership.*` no **controller** |

O escopo fica na rota porque é o único lugar onde se lê, de cima a baixo, o que
cada endpoint exige. Um controller novo que esqueça a checagem passa
despercebido; uma rota sem `requireScope` salta aos olhos ao lado das vizinhas.
`requireScope` confere o nome contra a lista **na carga do módulo**: um erro de
digitação (`report:read`) derruba o processo no boot, em vez de liberar a rota
em silêncio — que é o pior desfecho possível para uma checagem de permissão.

A posse não cabe na rota: só dá para decidir com o registro em mãos. Os escopos
`:any` são a ponte entre os dois — quem os tem dispensa a checagem de posse.
Sem eles, "admin" viraria um `if` espalhado por cada controller, que é
exatamente onde uma permissão passa batida.

**Três papéis, e o auditor é o que justifica o desenho**

| Papel     | Alcance                                             |
| --------- | --------------------------------------------------- |
| `admin`   | tudo, inclusive relatório de outra pessoa           |
| `user`    | cria e revisa **os seus** relatórios                |
| `auditor` | lê tudo (inclusive o alheio) e **não escreve nada** |

O `auditor` é o único papel com `reports:read:any` **sem** o par de escrita — é
quem confere e assina. Se leitura e escrita cruzada fossem um escopo só, esse
papel não existiria.

A posse é do **relatório**. Comprovante, imagem e exportação herdam a dele: um
cupom não tem dono próprio, tem o dono da prestação de contas em que foi
lançado. `merchants` fica compartilhado de propósito (a categoria de um CNPJ é
a mesma para todo mundo) e `tasks` também — o quadro é um só.

**404, e não 403, quando o recurso é de outra pessoa**

Responder 403 confirmaria que o relatório 7 existe para quem só queria
descobrir isso, e daria para varrer os ids mapeando o sistema inteiro. Quem não
alcança o registro recebe a mesma resposta que receberia se ele não existisse.
O 403 continua valendo quando **a ação** é negada e não o registro — o auditor
que lê o relatório e tenta editá-lo. Ali esconder não adianta: ele acabou de
ler o recurso.

**Senha e sessão, sem dependência nova**

O projeto tem 16 dependências de produção e a regra de não acrescentar pacote
para o que cabe em vinte linhas. Nenhuma entrou aqui:

- Senha com **`scrypt` da biblioteca padrão**. `bcrypt` e `argon2` trazem
  binário nativo para fazer o que o Node já faz. Os parâmetros de custo vão
  **dentro** do hash (`scrypt$N$r$p$salt$hash`), então endurecê-los depois vale
  para as senhas novas sem invalidar as antigas.
- Sessão **no banco**, não JWT. O que se ganha é revogação: sair apaga a linha
  e o token morre na hora; trocar a senha derruba as outras sessões. Revogar um
  JWT exigiria uma lista de bloqueio consultada a cada requisição — o custo que
  o JWT prometia evitar. Com o Postgres já no caminho, a troca não paga.
- Cookie lido do header cru em dez linhas, sem `cookie-parser`. Não há
  assinatura a conferir: o valor já é um segredo de 256 bits guardado como
  hash, e assinar só acrescentaria uma chave para vazar.
- `sameSite=lax` é o que **dispensa token de CSRF**: sob Lax o cookie só
  acompanha navegação de topo por GET, e toda escrita da API é POST, PATCH ou
  DELETE.

O login gasta o mesmo tempo com e-mail inexistente e com senha errada
(`dummyVerify` contra um hash descartável), e devolve a mesma mensagem nos dois
casos. Sem isso, o login vira um verificador de quem tem conta aqui.

**Não existe auto-cadastro**

Criar pessoa exige `users:write`. O primeiro usuário sai por
`npm run users:create`, fora do processo do servidor — só quem já tem acesso à
máquina e ao banco. Sem `--password`, o script sorteia uma senha forte e a
imprime uma vez: argumento fica no histórico do shell.

Quem não é administrador ainda lê e edita **o próprio** cadastro — trocar a
própria senha não pode depender de terceiros. O que não muda em si mesmo é o
`role`: é a escalada de privilégio mais comum que existe. Trocar a própria
senha exige a atual e derruba as **outras** sessões, poupando a corrente para
não expulsar justamente quem acabou de fazer a coisa certa.

Duas travas fecham a porta por dentro: ninguém apaga a si mesmo, e o **único**
administrador não pode ser rebaixado nem removido. Sem elas o conserto seria um
UPDATE direto no banco.

**Os relatórios de quem sai ficam**

`reports.owner_id` é `ON DELETE SET NULL`, não cascade. Prestação de contas
assinada é evidência — mesma razão pela qual não há expiração automática dos
arquivos enviados (#24). A coluna também é **anulável**: não havia usuários
quando os relatórios existentes foram criados, e inventar um dono para eles
seria gravar uma mentira. Relatório sem dono é legado e só quem tem
`reports:read:any` o enxerga, o que cai fora do filtro naturalmente —
`owner_id = $1` nunca casa com NULL.

**Na interface**

`App.jsx` pergunta `GET /api/auth/me` ao abrir; sem sessão, mostra o login. As
abas e os botões de escrita seguem os escopos da resposta — um auditor não vê
"Novo relatório". É **conveniência de tela, não autorização**: o servidor
confere de novo a cada requisição, e há teste de API provando cada recusa.

**O que a suíte passou a exigir**

Toda rota exige sessão, então cada arquivo de teste precisa de uma. Duas
escolhas fizeram isso custar quase nada: o hash da senha é calculado **uma vez
por processo** (`scrypt` custa ~30 ms de propósito) e o token é sorteado uma
vez — o TRUNCATE apaga só a linha da sessão, recriada com o mesmo token. Nenhum
arquivo de teste precisou de preâmbulo novo.

`tests/api/auth/scopes.test.js` é a **matriz de autorização**, endpoint a
endpoint, e vale mais que a soma dos testes de cada rota: uma rota nova sem
`requireScope` passa em todos os testes dela mesma, e só ali, ao chegar com um
papel que não deveria alcançá-la, é que a falta aparece.

No E2E, o login roda num **projeto de setup** e o cookie é reaproveitado pelas
specs. O `globalSetup` não serviria: ele acontece antes de o `webServer` subir.
As specs de logout usam sessão própria — a sessão do `storageState` é uma linha
no banco, e um logout de verdade a revogaria para todas as specs seguintes.
Aconteceu na primeira execução.

**Critérios de aceite**

- [x] Migration reversível com `users`, `sessions` e `reports.owner_id`, mais
      as constraints de e-mail minúsculo e nome não vazio
- [x] `POST /api/auth/login|logout` e `GET /api/auth/me`; CRUD de `/api/users`
- [x] Toda rota de `/api` exige sessão, exceto `health` e `login`
- [x] `requireScope` em cada rota, com o nome validado na carga do módulo
- [x] Posse conferida em relatório, comprovante, imagem e as três exportações
- [x] 404 (e não 403) para recurso de outra pessoa, com teste dos dois lados
- [x] `scrypt` sem dependência nova; hash nunca sai na resposta
- [x] Sessão revogável; troca de senha derruba as outras
- [x] `npm run users:create` para o primeiro acesso
- [x] Tela de login e gate de sessão na interface, com abas por escopo
- [x] Matriz de autorização em `tests/api/auth/scopes.test.js`

**Fora de escopo**

Recuperação de senha por e-mail (exigiria um serviço de envio, que o projeto
não tem), segundo fator, `tasks.owner_id`, tela de administração de usuários na
interface (hoje o CRUD é só de API) e transferência de posse de um relatório.
Nenhum é bloqueado por esta.

**Revisão antes do merge**

Lida a issue inteira antes de abrir o PR, seis pontos foram corrigidos, todos
com teste que os trava:

- Cookie de sessão com `%` quebrado derrubava a API inteira com 500, inclusive
  o login — quem tivesse o cookie não conseguia nem entrar para trocá-lo. Agora
  vale como sessão ausente.
- Quando a sessão caía no meio do uso, cada painel mostrava o próprio alerta e
  a pessoa só saía dele recarregando a página. Agora a tela volta ao login,
  com o motivo.
- O auditor via "Deletar", "Confirmar" e campos editáveis na revisão, e cada
  um respondia 403. Agora a revisão é somente leitura para quem não escreve.
- A matriz de autorização cobria 8 das 33 rotas que exigem sessão. Agora cobre
  todas, e uma mutação nas rotas confirmou que ela acusa a falta.
- `users:create --replace` não encerrava as sessões abertas, rebaixava a
  `user` quando vinha sem `--role` e aceitava senha curta.
- `loadReport` tinha duas cópias e o 404 de relatório, três. A igualdade entre
  "não existe" e "não é seu" dependia de elas nunca divergirem; agora há um
  lugar só, e um teste comparando as duas respostas.

---

# Segunda rodada — o processo completo

Duas fontes, lidas lado a lado com o código em outubro de 2026:

1. **O procedimento consolidado** (`prestacao-de-contas-processo.md`), escrito
   a partir de quatro prestações reais (Itapipoca/CE, Formosa/GO, Viamão/RS e
   Palmas/TO): leitura dos PDFs, validação, deduplicação, separação por
   categoria, planilha de acompanhamento, Anexo I e o que sinalizar.
2. **A prestação finalizada de Itapipoca**: os seis PDFs por categoria (42
   páginas) e a planilha final conferida por uma pessoa. Fica **fora do
   repositório** — traz CNPJ e CPF de terceiros — e serve de corpus de
   medição.

**A fonte da verdade é o comprovante.** Quando o procedimento, a planilha e o
papel discordam, vale o papel. Foi o que resolveu a única contradição do
procedimento: o texto diz que a caixa de chocolate do Mateus (R$ 205,59) foi
para Outros, a planilha final a lançou em Alimentação, e a tabela de
distribuição do próprio procedimento concorda com a planilha.

## Decisões desta rodada

| Pergunta                           | Decisão                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| Categorias                         | as cinco do procedimento (#40)                            |
| Piso `alimentacao` do palpite      | continua                                                  |
| Hora e número do documento         | não voltam; só a data                                     |
| Anexo I oficial                    | ainda não chegou; o mapa da versão 19 vem do procedimento |
| Recibo padrão Buriti               | não agora: só é emitido quando não há comprovante         |
| Comprovante sem CNPJ legível       | nome e cidade lidos do próprio comprovante (#42)          |
| Reprocessar o que já foi conferido | permitido, com confirmação explícita (#35)                |
| Procedimento × planilha × papel    | vale o comprovante                                        |
| Valor em revisão na tela           | soma no total, sem categoria e sem bloco à parte (#39)    |

## O que a prestação de Itapipoca mostrou

Medido com a cascata atual (texto → QR → OCR → parsers) sobre as 42
páginas, sem banco, comparando cada página com a planilha final:

| Páginas                       | Qtd | QR lido | Data e valor certos  | Sem valor |
| ----------------------------- | --- | ------- | -------------------- | --------- |
| Fotos de comprovante (OCR)    | 22  | 3       | 5                    | 16        |
| Recibos padrão Buriti (texto) | 20  | 0       | 0 (data certa em 20) | 20        |

- **O QR leu 3 das 7 NFC-e** — o mesmo número que o procedimento registra
  com várias escalas e binarização. Ler o QR de outro jeito não prometia
  ganho, e ficou de fora.
- **O OCR leu o combustível como R$ 2.225,49**, e o papel diz R$ 225,49. A
  conta litros × preço unitário pegaria isso sozinha (#45).
- **As 15 páginas de recibo manuscrito não renderam nada**, como esperado: o
  Tesseract não lê caneta. O que acelera esses é o recorte na revisão (#46).
- **Uma página chegou com `/Rotate 180`** (`03_combustivel_comprovantes.pdf`,
  página 2) — o caso real da página de cabeça para baixo, e o que o PDF
  consolidado descartava (#36).
- **A planilha final soma 7 pares de mesmo dia e mesmo valor**, em linhas
  vizinhas, totalizando R$ 269,62 — o valor que o procedimento descreve como
  redocumentação. Não são duplicatas: foi um caso isolado em que o
  colaborador não tinha os comprovantes de almoço e janta do mesmo dia, e os
  recibos foram validados como exceção. É o exemplo de livro de por que a
  regra `possivel_duplicata` aponta e não decide — ela marca os sete, e
  colapsar sozinha teria apagado R$ 269,62 legítimos.
- OCR leva **5,9 s por página** (mediana; 11,9 s no pior caso). Um lote como
  este fica uns dois minutos em processamento com a tela consultando.

## Fora desta rodada, de propósito

- **Recibo padrão Buriti** — decisão acima. Registro para quando voltar: eram
  20 das 42 páginas, todas com camada de texto, e a extração não leu o valor
  de nenhuma.
- **Hora e número do documento** — e com eles a ordem por hora no mesmo dia,
  a numeração de recibo fora de sequência e a incoerência de horário.
- **QR com várias escalas** — medido acima: o método do procedimento acertou
  o mesmo que o projeto já acerta.
- **Julgamento de conteúdo** — item que não pertence à categoria, emissor
  incompatível com a despesa, finalidade indeterminada. A ferramenta aponta
  Outros (#51); decidir é de quem assina.
- **`trust proxy`** — só importa se a produção ficar atrás de proxy reverso.

---

# M8 — Correções

## Issue 33 — Cada família de rota com um teto de escrita só

`area:api` · `infra` · sem dependência

O teto geral de escrita (`writeLimiter`, 100 por janela) era aplicado no
`app.js` a toda escrita em `/api`, inclusive em `/reports`, `/receipts` e
`/merchants` — que passavam também pelo teto de lote (`batchWriteLimiter`,
600). O de lote era um segundo filtro por cima, e não um substituto: com os
limitadores reais e `WRITE_MAX=3`, `BATCH_WRITE_MAX=10`, a sequência de
PATCH num relatório saía `204 204 204 429 429 429`. Revisar um relatório de
41 comprovantes cortava na centésima escrita, não na seiscentésima.

**Escopo**

Os dois tetos de escrita passam a ser montados em `src/routes/index.js`, um
por família, antes do `authenticate` — recusar barato, sem consultar sessão.
O limitador pode ser ligado em teste por `RATE_LIMIT_ENABLED=true`, que é como
uma instância própria da API o exercita sem mudar nada para a suíte.

**Critérios de aceite**

- [x] Escrita em `/reports`, `/receipts` e `/merchants` só conta no teto de
      lote
- [x] Escrita em `/auth`, `/users` e `/tasks` continua no teto geral
- [x] Os dois tetos rodam antes do `authenticate`
- [x] Teste de integração numa instância própria da API, com o limitador
      ligado e tetos baixos, que cai com o código anterior
- [x] A suíte principal continua com o limitador desligado

**Como ficou**

`tests/api/rate-limit.test.js` sobe uma instância por teste
(`startApiInstance`): o contador vive na memória do processo e só zera no fim
da janela. Com a montagem antiga, dois dos quatro casos caem com 429 na
quarta escrita. A instância espera até 60 s para subir: com o disco disputado
por outro programa, uma partida levou 38 s, contra 0,4 s de costume.

**Fora de escopo**

Teto de leitura próprio para lote e `trust proxy`.

---

## Issue 34 — A tela acompanha o processamento sem travar e sem gastar o teto

`area:web` · sem dependência

Enquanto houvesse página em processamento, a tela do relatório buscava três
coisas a cada 1,5 s — relatório, comprovantes e conferência. O teto de
leitura é de 600 por janela: cinco minutos de processamento contínuo o
esgotavam, e o lote de Itapipoca, com OCR de 5,9 s por página, passa de dois.
A conferência ainda custa duas consultas por comprovante (#52).

Pior: quando um ciclo falhava, o `.catch(() => {})` engolia o erro e nenhum
ciclo novo era agendado. A tela ficava em "processando" sem aviso nenhum.

**Escopo**

Durante o processamento, cada ciclo busca só a lista de comprovantes;
relatório e conferência são recarregados uma vez, quando nada mais está em
processamento. Um ciclo que falha mostra o motivo e tenta de novo com espera
crescente; o 401 continua levando ao login.

**Critérios de aceite**

- [x] Durante o processamento, cada ciclo faz uma requisição só
- [x] Terminado o processamento, relatório e conferência recarregam uma vez
- [x] Ciclo que falha mostra aviso com a ação, e o acompanhamento continua
- [x] O aviso some quando a consulta volta a responder
- [x] Spec E2E contando as requisições durante o processamento
- [x] Spec E2E da falha transitória no meio do acompanhamento

**Como ficou**

A falha da spec é real, não interceptada: `context.setOffline(true)` derruba a
rede do navegador sem inventar resposta — a regra de não mockar continua com
uma exceção só. Com a tela antiga, a conferência era buscada 6 vezes durante
um lote de 60 páginas (agora, uma), e a queda de rede não gerava aviso
nenhum. A espera cresce de 1,5 s até 15 s, e uma recarga completa bem-sucedida
apaga o aviso.

**Fora de escopo**

Trocar o polling por SSE ou WebSocket.

---

## Issue 35 — Reprocessar o que já foi conferido pede confirmação explícita

`area:api` · `area:web` · sem dependência

`POST /api/receipts/:id/reprocess` não olhava o status: devolvia a página a
`pending`, e a extração regravava data, valor e categoria por cima do que uma
pessoa tinha conferido. A tela só oferecia o botão para `failed`, `pending` e
`processing`, mas a API aceitava qualquer um.

**Decisão:** reprocessar o que já foi conferido continua possível, com
confirmação explícita.

**Escopo**

Comprovante `confirmed`, ou corrigido à mão (`extraction_source = 'manual'`),
só é reprocessado com `{ "discard_review": true }` no corpo; sem isso, `409`
com a ação que explica o que se perde. A tela oferece "Reprocessar" também
para o confirmado, atrás de um diálogo que diz o que vai ser descartado.

**Critérios de aceite**

- [x] Sem a confirmação, `409 ConflictError` com `action`, e nada muda no
      banco
- [x] Com `discard_review: true`, `202`, e a página volta à revisão com o que
      a extração ler
- [x] O que veio da extração e ninguém tocou segue sem confirmação
- [x] `discard_review` que não seja booleano: `422` com `details`
- [x] Relatório fechado continua respondendo `409` antes de tudo
- [x] Tela: "Reprocessar" no confirmado, com diálogo; spec E2E

**Como ficou**

Um teste antigo do OCR simulava a página presa zerando o valor por `PATCH` —
o que agora conta como correção à mão. O arranjo passou a escrever o estado
direto no banco (`updateColumnDirectly`), que é o caminho para o que a API não
produz: a página presa em `processing` depois de um reinício.

**Fora de escopo**

Guardar a conferência descartada para desfazer.

---

## Issue 36 — O PDF consolidado respeita a rotação da página original

`area:export` · sem dependência

O consolidado embute a página original numa página nova, maior, para abrir a
faixa do carimbo — e o `embedPdf`/`drawPage` do `pdf-lib` não leva o
`/Rotate` junto. Página com `/Rotate 90`, exibida 600×200, saía 200×626; com
`/Rotate 180`, saía de cabeça para baixo. A imagem da revisão respeita a
rotação, então quem conferia via a página de um jeito e o arquivo exportado
saía de outro. Na prestação de Itapipoca isso aconteceria com uma página.

**Escopo**

A página é desenhada já girada, de modo que a página nova sai sem `/Rotate` e
mostra exatamente o que a original mostra. A faixa do carimbo continua no
rodapé e legível.

**Critérios de aceite**

- [x] `/Rotate` 90, 180 e 270 saem no consolidado como a origem é exibida
- [x] Teste compara pixel a pixel a página exportada, sem a faixa, com a
      origem renderizada
- [x] Carimbo continua no rodapé, na horizontal

**Como ficou**

Diferença máxima de pixel **zero** nas três rotações. Forçando a rotação 0 —
o comportamento antigo —, as três caem. A renderização do teste roda em
subprocesso (`tests/helpers/pdf-render.js`), pelo mesmo motivo do
`pdf-text.js`.

**Fora de escopo**

Girar a página pela revisão (#43).

---

## Issue 37 — A planilha de resumo abre com os totais em qualquer leitor

`area:export` · sem dependência

O exceljs grava a fórmula sem valor guardado, e o `workbook.xml` saía sem
`fullCalcOnLoad`. O Excel recalcula ao abrir; a pré-visualização do WhatsApp,
do Gmail e do Drive, e qualquer leitor que use o valor guardado, mostram os
totais em branco — o problema que o procedimento descreve para o openpyxl.

**Escopo**

Toda fórmula leva o resultado guardado, calculado em centavos inteiros, e o
arquivo marca `fullCalcOnLoad` para quem recalcula.

**Critérios de aceite**

- [x] Toda célula com fórmula tem valor guardado
- [x] O valor guardado bate com a fórmula resolvida contra as células
      (`tests/helpers/xlsx-formula.js`)
- [x] `fullCalcOnLoad` no `workbook.xml`

**Fora de escopo**

Valor guardado nas fórmulas do Anexo I: elas são do template, e o oficial
ainda não chegou (#55).

---

## Issue 38 — Anexo I: cada categoria na coluna do formulário

`area:export` · sem dependência

O mapa de colunas era placeholder e mandava `transporte` e `estacionamento`
para W — que, no formulário versão 19, é Combustível. Uma corrida de táxi saía
lançada como abastecimento, o mesmo tipo de erro que o procedimento lista
entre os já encontrados nesse formulário. O template sintético tinha só S, W e
X, e o total da linha era `S+W+X`: corrigir só o mapa faria o táxi sumir do
total.

**Escopo**

Mapa da versão 19 — O Passagens, Q Táxi/Conduções, S Alimentação,
U Hospedagem, W Combustível, X Outras — no serviço e no template sintético,
com o total da linha cobrindo as seis colunas. Estacionamento e lavanderia
não têm coluna própria e vão para X, como o procedimento manda.

**Critérios de aceite**

- [x] `transporte` em Q, `estacionamento` e `lavanderia` em X, combustível
      em W
- [x] Template sintético com as seis colunas e `Y = O+Q+S+U+W+X`
- [x] Teste por categoria afirmando a coluna e o total da linha

**Fora de escopo**

O formulário oficial (#55).

---

## Issue 39 — Os totais da tela: categoria só com o confirmado

`area:api` · `area:web` · sem dependência

O mesmo relatório tinha três totais: a planilha e o Anexo I somam só os
confirmados, e a tela e o alerta de adiantamento somavam tudo menos duplicata,
inclusive valor de OCR que ninguém conferiu — distribuído pela categoria que a
extração adivinhou.

**Decisão:** o valor em revisão vai para o total, sem categoria e sem bloco à
parte. Uma primeira versão desta issue tirou o valor em revisão do total e o
mostrou num bloco "Fora da prestação"; quem usa preferiu o total único, com o
provisório dentro. A planilha e o Anexo I continuam só com o confirmado, e os
totais batem quando o relatório está conferido.

**Escopo**

`meta` da listagem: `total_cents` com tudo o que tem valor menos duplicata, e
`by_category` só com o confirmado — a categoria de quem ainda está em revisão
é palpite, e distribuir valor por palpite faria o subtotal de um tipo mudar a
cada correção. O alerta de adiantamento compara o mesmo total da tela.

**Critérios de aceite**

- [x] `total_cents` soma o que está em revisão e deixa a duplicata de fora
- [x] `by_category` só com o confirmado
- [x] Alerta de adiantamento com o mesmo total, com teste dos dois lados
- [x] Com o relatório conferido, o total da tela é o da planilha

**Como ficou**

A consulta de totais tinha um defeito latente: o grupo dos comprovantes sem
categoria e a linha de total do `ROLLUP` chegavam os dois com categoria nula,
e qual valia dependia da ordem das linhas — todo upload cria comprovantes sem
categoria. `GROUPING()` separa os dois. O alerta de adiantamento não tinha
teste nenhum; ganhou os dois lados (em revisão conta, duplicata não).

---

# M9 — Revisão completa

## Issue 40 — As cinco categorias do procedimento

`area:db` · `area:extracao` · `area:export` · `area:web` · depende de #38

O enum tem seis categorias de despesa; o procedimento usa cinco: Alimentação,
Táxi/Locomoção, Combustível, Lavanderia e Outros. `estacionamento` sobra — e
no Anexo I já cai em Outras.

**Escopo**

Migration que recria o enum sem `estacionamento`, convertendo o que existir
para `outros` em `receipts` e `merchants`, com `up` e `down` testados como na
remoção de `hospedagem`. O valor `transporte` fica, com o rótulo
"Táxi/Locomoção" nas saídas e na tela. O palpite por nome que achava
estacionamento passa a sugerir `outros`, marcado como qualquer palpite.

**Critérios de aceite**

- [x] Migration reversível; o `down` documenta que o que virou `outros` não
      volta a ser estacionamento
- [x] Rótulo "Táxi/Locomoção" nas três saídas e na tela; nome de aba sem a
      barra
- [x] `web/src/constants.js` espelhando o enum novo
- [x] Palpite de estacionamento sugere `outros`, com a marca

**Como ficou**

`tests/db/expense-category.test.js` roda o `down` e o `up` de verdade
(`runMigration` no orchestrator): volta o banco para antes da migration,
grava um comprovante e um emitente como estacionamento e confere que o `up`
os levou para `outros`. O arranjo só funciona se o `down` devolver o valor ao
enum; trocando a conversão por `alimentacao`, o teste cai. A planilha final de
Itapipoca chama a categoria só de "Táxi"; ficou o rótulo do procedimento,
"Táxi/Locomoção" — trocar é uma linha em `labels.js` e outra em
`web/src/constants.js`.

**Fora de escopo**

Renomear o valor `transporte` no banco.

---

## Issue 41 — Chave de acesso digitada na revisão, conferida pelo DV

`area:api` · `area:web` · sem dependência

O `PATCH` do comprovante aceita só data, valor, categoria e status. Quando o
QR e o texto falham, a chave some e ninguém consegue informá-la — e é a chave
que o procedimento chama de fonte da verdade para emitente e data. O caso que
o procedimento conta (AAMM borrado lido como 2606, quando era 2608) só se
resolve digitando e deixando o DV julgar. A regra `chave_acesso` da
conferência hoje só dispara com dado gravado direto no banco.

**Escopo**

`PATCH` aceita `access_key`, recusada com `422` se não fechar o DV. Do CNPJ da
chave sai o emitente, pelo mesmo caminho da extração; chave repetida no
relatório marca a duplicata como a extração marca. Na revisão, o campo
aparece quando o comprovante não tem chave.

**Critérios de aceite**

- [x] Chave que não fecha o DV: `422` no campo `access_key`
- [x] Chave válida vincula o emitente pelo CNPJ das posições 7 a 20
- [x] Mesma chave de outro comprovante do relatório: vira duplicata
- [x] Campo na revisão só quando falta a chave; spec E2E

**Como ficou**

A chave digitada aceita os separadores da impressão e vale o mesmo que a lida
do QR (`typed-issuer.service.js`): o emitente sai do CNPJ dela pelo
`classify` da extração, e a categoria do cadastro só substitui um palpite —
nunca a escolha de uma pessoa, nem a que veio no mesmo `PATCH`. Chave repetida
no relatório vira duplicata mesmo num "confirmar", porque é o mesmo documento
fiscal; em outro relatório, não. Digitar a chave marca a origem como manual,
então reprocessar depois pede a confirmação da #35. A regra `chave_acesso` da
conferência fica como rede para o que entra por fora da API. Sem o serviço,
caem os três testes de emitente, categoria e duplicata.

---

## Issue 42 — Emitente, CNPJ e cidade lidos do próprio comprovante

`area:db` · `area:api` · `area:extracao` · `area:web` · `area:export` ·
depende de #41

Comprovante sem CNPJ legível — o recibo manuscrito, onde o procedimento diz
que se concentra a Alimentação — sai na planilha sem nome e sem cidade, duas
das cinco colunas obrigatórias. Não há como informá-los: o `PATCH` não aceita
emitente, e o cadastro de emitente exige CNPJ.

**Decisão:** procurar no próprio comprovante. A cidade é a do documento,
nunca a do destino da viagem.

**Escopo**

`PATCH` aceita `cnpj` (vincula ou cria o emitente). Sem CNPJ, o comprovante
guarda nome e cidade como estão no papel, preenchidos pela extração quando o
texto os traz e editáveis na revisão. As saídas usam o emitente quando há, e o
que o comprovante traz quando não há.

**Critérios de aceite**

- [x] `cnpj` válido no `PATCH` vincula o emitente; inválido, `422`
- [x] Nome e cidade próprios do comprovante, quando não há emitente
- [x] Extração preenche os dois mesmo sem CNPJ, quando o texto os traz
- [x] Planilha e Anexo I usam o emitente, ou o que o comprovante traz
- [x] Spec E2E de um manuscrito revisado à mão

**Como ficou**

Duas colunas no comprovante, `issuer_name` e `issuer_city`: a extração grava o
que o texto traz sempre, com ou sem CNPJ, e a revisão mostra os dois campos
quando não há emitente cadastrado. Lista, planilha, Anexo I e o carimbo do PDF
leem do mesmo lugar (`COALESCE` do cadastro com o papel, em
`receipt.model.js`). Sem chave, o `cnpj` digitado vincula o emitente pelo
`classify` — o serviço da #41 virou `typed-issuer.service.js`, para a chave e
o CNPJ —, e `cnpj: null` desvincula, porque o CNPJ do texto pode ser o da
credenciadora. Com chave no comprovante, o CNPJ vem dela e um digitado é
recusado. A validação do CNPJ, que era cópia no validador de emitente, mora
agora em `validators/rules.js`. O E2E usa um cupom com texto e sem CNPJ: um
manuscrito de verdade passaria pelo OCR, a parte mais cara da suíte, para
provar o mesmo caminho.

---

## Issue 43 — Girar a página na revisão

`area:db` · `area:api` · `area:web` · `area:export` · depende de #36

"Página de cabeça para baixo. Acontece." O escaneamento do WhatsApp chega com
orientação variada, e hoje não há como girar uma página: o QR e o OCR leem a
imagem como veio.

**Escopo**

Rotação por comprovante (0, 90, 180, 270), escolhida na revisão. Vale para a
imagem da revisão, para o reprocessamento e para o PDF consolidado, somada ao
`/Rotate` da origem.

**Critérios de aceite**

- [ ] Coluna com check de múltiplo de 90; migration reversível
- [ ] Girar na revisão atualiza a imagem e não perde zoom nem posição
- [ ] Reprocessar lê a página girada
- [ ] Consolidado sai girado, sem mexer no arquivo original

---

## Issue 44 — Editar o relatório pela tela, com cidade principal

`area:db` · `area:api` · `area:web` · sem dependência

A tela só cria relatório e muda o status. Título, período e adiantamento não
se corrigem depois — e o procedimento manda sinalizar "adiantamento não
informado", porque sem ele não há saldo. Hoje adiantamento esquecido é
`0`, indistinguível de "não houve adiantamento".

**Escopo**

Formulário de edição usando o `PATCH` que já existe. `advance_cents` passa a
aceitar nulo (não informado), e o relatório ganha a cidade principal da
viagem, base das regras de #51.

**Critérios de aceite**

- [ ] Editar título, período, adiantamento e cidade principal pela tela
- [ ] Adiantamento nulo é "não informado"; zero é "não houve"
- [ ] Migration reversível para as duas colunas
- [ ] Relatório fechado continua aceitando só a reabertura

---

# M10 — Extração

## Issue 45 — Combustível: litros × preço unitário

`area:extracao` · sem dependência

"É a checagem que pega erro de um dígito." O OCR leu o abastecimento de
Itapipoca como R$ 2.225,49; o cupom diz 39,56 L × R$ 5,70 = R$ 225,49.

**Escopo**

Ler litros e preço unitário do cupom de combustível e conferir contra o
total, arredondando ao centavo. Regra nova na conferência, sem bloquear nada.

**Critérios de aceite**

- [ ] Os dois exemplos do procedimento fecham (39,56 × 5,70 e 18,461 × 4,97)
- [ ] Divergência vira alerta no comprovante
- [ ] Sem litros ou sem preço legível, a regra não dispara
- [ ] Casos puros em `tests/services/`

---

## Issue 46 — Atalhos de recorte na revisão

`area:web` · sem dependência

A página inteira não é legível campo a campo. O procedimento recorta por
tipo, e a proporção da página já diz o tipo: paisagem é recibo manuscrito,
retrato muito alto é cupom térmico.

**Escopo**

Atalhos de zoom sobre a mesma imagem, sem renderizar nada novo: no
manuscrito, a faixa do valor (55–100% da largura, 0–42% da altura) e a da data
(70–100% da altura); no cupom, três fatias com 3% de sobreposição; em
qualquer página, o cabeçalho do emitente (0–75% × 0–40%).

**Critérios de aceite**

- [ ] Atalhos escolhidos pela proporção da imagem
- [ ] Teclado e mouse, sem perder o arrastar da #28
- [ ] Spec E2E medindo o recorte de um atalho

---

# M11 — Conferência

## Issue 47 — O que a chave de acesso já diz

`area:extracao` · sem dependência

A chave tem a UF (posições 1–2), o mês da emissão (3–6) e o tipo de emissão
(35). Nenhum dos três é conferido.

**Critérios de aceite**

- [ ] Mês da chave diferente da data do comprovante: erro — o caso 2606/2608
- [ ] Tipo de emissão diferente de normal: "emitido em contingência"
- [ ] UF da chave diferente da UF da cidade do emitente: aviso

---

## Issue 48 — A classificação do procedimento nos alertas

`area:api` · `area:web` · sem dependência

Hoje há `erro` e `aviso`. O procedimento classifica em PENDENTE, DECISÃO,
ATENÇÃO, VERIFICADO e INFORMATIVO — e é a mesma classificação da aba de
Observações da planilha (#53).

**Critérios de aceite**

- [ ] Cada regra com a sua classe, documentada
- [ ] A tela agrupa pela classe
- [ ] Mudança de contrato da `/validation` registrada no README

---

## Issue 49 — Valores repetidos que não são duplicata

`area:api` · sem dependência

"Avisar quando houver valores repetidos que não são duplicata, para ninguém
apagar na conferência." Duas notas com chave diferente são documentos
diferentes, e hoje nem entram em alerta nenhum.

**Critérios de aceite**

- [ ] Mesmo valor em documentos provadamente diferentes: INFORMATIVO, "não
      apague"
- [ ] O contraexemplo dos dois almoços continua não sendo duplicata

---

## Issue 50 — Documentos não fiscais somados à parte

`area:api` · `area:export` · sem dependência

Recibo manuscrito, comanda e cupom de conferência podem ser glosados. O
procedimento manda somar e informar. Sem chave de acesso válida, o documento
não é NFC-e — dá para derivar, sem coluna nova.

**Critérios de aceite**

- [ ] Total e quantidade dos comprovantes sem chave, na conferência
- [ ] O mesmo número na planilha (#53)

---

## Issue 51 — Regras da viagem

`area:api` · depende de #44

O que o procedimento manda sinalizar e depende do relatório inteiro:

**Critérios de aceite**

- [ ] Categoria Outros: DECISÃO — finalidade a confirmar
- [ ] Despesa fora da cidade principal: INFORMATIVO
- [ ] Duas cidades no mesmo dia: INFORMATIVO, lembrando que conexão de voo
      explica a maioria
- [ ] Valor muito acima do padrão da categoria na viagem, com amostra mínima
- [ ] Adiantamento não informado: PENDENTE

---

## Issue 52 — Conferência sem uma consulta por comprovante

`area:api` · sem dependência

`checkMerchantRange` e `checkDuplicates` fazem uma consulta por comprovante:
80 consultas num relatório de 40, a cada abertura da tela.

**Critérios de aceite**

- [ ] Número de consultas constante no tamanho do relatório
- [ ] Os testes de conferência passam sem alteração

---

# M12 — Saídas

## Issue 53 — Planilha de acompanhamento no formato do procedimento

`area:export` · depende de #39 e #48

A planilha final de Itapipoca tem duas abas: `Despesas` (Data, Local, Cidade,
Tipo, Valor — 41 linhas e o TOTAL GERAL) e `Resumo` (`COUNTIF`/`SUMIF` sobre
`Despesas`). O procedimento acrescenta o resumo por cidade, o bloco de
conferência, o saldo e a aba de Observações.

**Em aberto:** as abas por tipo da #29 ficam ao lado ou saem.

**Critérios de aceite**

- [ ] `Despesas` com as cinco colunas na ordem, e as de apoio depois
- [ ] Resumo por categoria e por cidade por fórmula
- [ ] Bloco de conferência: as quatro somas e a célula OK/DIVERGÊNCIA
- [ ] Adiantamento e saldo
- [ ] Aba de Observações com a classificação da #48
- [ ] Cor nas linhas que pedem atenção, sem cor como único canal
- [ ] Paisagem, `fitToWidth = 1`, cabeçalho congelado e autofiltro

---

## Issue 54 — PDFs por categoria, com a página original intacta

`area:export` · depende de #36

O procedimento entrega um PDF por categoria com despesa, em ordem
cronológica, com as páginas originais — "nunca rasterizar, nunca recortar".
A duplicata vai junto, como comprovação.

**Critérios de aceite**

- [ ] Um arquivo por categoria com despesa, num ZIP (`jszip` já é dependência)
- [ ] Página copiada, não embutida: sem faixa e com o `/Rotate` da origem
- [ ] Teste de cobertura: toda página em exatamente um arquivo, total igual
- [ ] Teste de pixel: página gerada idêntica à de origem
- [ ] Rota nova em `tests/api/routes.js`

---

## Issue 55 — Anexo I oficial (versão 19)

`area:export` · `bloqueada`

O template continua sintético. O mapa da versão 19 já está no serviço desde a
#38; falta o arquivo.

**Critérios de aceite**

- [ ] Template oficial em branco em `assets/`, sem dado de ninguém
- [ ] Valor numa coluna só por linha, limpando as demais
- [ ] Diff célula a célula: nada fora do bloco de dados muda

---

## Issue 56 — Anexo já preenchido: comparar antes de sobrescrever

`area:api` · `area:web` · depende de #55

"O arquivo pode já vir preenchido por outra pessoa." Os erros já achados
nesse formulário: duas linhas duplicadas desalinhando as seguintes, valor na
coluna errada, dígitos trocados, lançamento faltando.

**Critérios de aceite**

- [ ] Envio do Anexo preenchido devolve a diferença linha a linha
- [ ] Os quatro erros do procedimento aparecem cada um com o seu nome
- [ ] Nada é sobrescrito sem a pessoa ver a diferença
- [ ] Rota nova em `tests/api/routes.js`

---

# M13 — Fechamento

## Issue 57 — Checagem final ao fechar

`area:api` · `area:web` · depende de #53 e #54

A checagem final do procedimento, mostrada ao fechar o relatório. Informa,
não bloqueia.

**Critérios de aceite**

- [ ] Soma das linhas = total = subtotais por categoria = subtotais por
      cidade
- [ ] Toda página em exatamente um PDF de categoria; páginas geradas =
      recebidas
- [ ] Toda chave com DV validado; todo valor confirmado por uma pessoa
- [ ] Diálogo antes de fechar, com o que falta
