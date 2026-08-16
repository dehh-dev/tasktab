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

| Marco            | Issues      | Entrega                                        |
| ---------------- | ----------- | ---------------------------------------------- |
| M0 — Terreno     | 0           | Ferramental destravado para o resto do backlog |
| M1 — Fundação    | 1 a 5, 22   | Upload, CRUD e revisão manual ponta a ponta    |
| M2 — Digital     | 6 a 8       | PDFs digitais preenchem sozinhos               |
| M3 — Cupom       | 25, 9 a 11  | QR Code + emitentes + categoria automática     |
| M4 — OCR         | 12 a 13     | Cupom térmico escaneado                        |
| M5 — Conferência | 14 a 15     | Deduplicação e validações                      |
| M6 — Saídas      | 26, 16 a 18 | Excel e PDF consolidado                        |
| M7 — Interface   | 19 a 21     | Aba completa com tela de revisão               |

Transversais (23, 24) entram a qualquer momento depois do M1.

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

- [ ] Seção da aba, no tom das existentes (explica o **porquê** das decisões,
      não só o que faz)
- [ ] Novas variáveis de ambiente na tabela existente
- [ ] Endpoints na tabela de endpoints
- [ ] Registrar as três decisões que mais custam a redescobrir: cascata de
      extração, dinheiro em centavos, remendo do XML no Anexo I
- [ ] `CLAUDE.md` atualizado com o que for regra para quem escrever código novo

## Issue 24 — Retenção e privacidade

`infra`

- [ ] Política de retenção dos arquivos enviados
- [ ] Diretório de upload fora do versionamento (coberto pela #0, confirmar)
- [ ] Decisão sobre anonimizar `raw_text` após confirmação
- [ ] Conferir que `raw_text` não vai parar no log — os serializers do
      `pino-http` são enxutos, mas log manual pode vazar CPF/CNPJ de terceiros
- [ ] Registrar a decisão antes de qualquer deploy em produção
