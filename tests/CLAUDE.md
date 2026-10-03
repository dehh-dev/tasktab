# Testes

So integracao, com uma excecao estreita (ver "Puros"). Os testes falam **HTTP
real** com a API em `http://localhost:3001` — nada de supertest, nada de
importar `src/app`.

## Organizacao

- Os arquivos espelham as rotas (`tests/api/tasks/get.test.js`,
  `post.test.js`, ...). Os scripts de linha de comando tem os seus em
  `tests/scripts/`, rodados de verdade por `runScript`, e o que e do banco
  (triggers, migrations) fica em `tests/db/`.
- O que vale para **toda** rota mora em duas matrizes que percorrem a mesma
  lista, `tests/api/routes.js`, e comparam um mapa `{ rota: resultado }` — a
  falha mostra de uma vez todas as rotas fora do esperado:

| Matriz                          | O que confere em toda rota                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `tests/api/auth/scopes.test.js` | 401 sem sessao; 403 exatamente para os papeis sem o escopo                                            |
| `tests/api/contract.test.js`    | 400 com id invalido, 404 com id inexistente, 422 com corpo so de colunas de identidade, nada em cache |

**Rota nova entra em `routes.js`**, ou nenhuma das duas a confere — e uma rota
sem `requireScope` passa em todos os testes dela mesma. Nao volte a escrever
"404 para id inexistente" em cada arquivo.

## Ciclo

| Onde              | Quando                  | O que faz                                                 |
| ----------------- | ----------------------- | --------------------------------------------------------- |
| `global-setup.js` | uma vez por execucao    | espera a API, aplica migrations                           |
| `setup.js`        | antes de **cada** teste | espera a fila, trunca as tabelas, recria o usuario padrao |

- Arquivo novo nao precisa de preambulo: `require` do orchestrator e os
  `describe`.
- O caro fica no `global-setup` (`runPendingMigrations` custa um processo
  `npx`). Marca em `process.env` nao deduplica: cada arquivo do Jest tem a
  propria copia.
- Rodam em serie (`--runInBand`), porque compartilham as tabelas.

## `orchestrator.js`

| Funcao                                                             | Para que                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `request(m, path, body, { token, baseUrl })`                       | HTTP; `body` string vai cru, `token: null` = sem sessao    |
| `requestUpload` / `requestBinary`                                  | multipart; resposta binaria (planilha, PDF, imagem)        |
| `insertTask` / `insertReport` / `insertReceipt` / `insertMerchant` | arranjo direto no banco, sem passar pela API               |
| `insertUser` / `insertSession` / `createUserWithSession`           | usuario e sessao; o ultimo devolve `{ user, token }`       |
| `updateColumnDirectly(t, id, c, v)`                                | escrita crua; diz se o `updated_at` andou, medido no banco |
| `waitForProcessing(reportId)` / `waitForQueue()`                   | espera a extracao terminar                                 |
| `findReceipts` / `findSessions` / `findPasswordHash`               | leitura direta do banco                                    |
| `uploadedFileExists` / `leftoverUploads()`                         | arquivo no disco; temporarios do multer que sobraram       |
| `runScript(file, args)`                                            | roda um script de `scripts/` contra o banco de teste       |
| `runMigration(direcao, n)` / `migrationsFrom(nome)`                | anda migrations; quantas o `down` desfaz ate antes de uma  |
| `enumLabels(tipo)`                                                 | valores de um enum do banco, na ordem declarada            |
| `startApiInstance(env)`                                            | outra API, em porta propria (`request` com `baseUrl`)      |

- `request()` ja chega autenticada como o **admin padrao**. `{ token: null }`
  testa 401; `createUserWithSession({ role })`, outro papel. O hash da senha e
  calculado uma vez por processo (o `scrypt` custa ~30 ms de proposito) e o
  token, sorteado uma vez; o TRUNCATE apaga so a linha da sessao, recriada com
  o mesmo token.
- O padrao e admin para o arranjo antigo valer: `insertReport()` cria
  relatorio sem dono, que so `reports:read:any` enxerga.
- Os `insert*` nao citam as colunas mais novas (giro, emitente, cidade
  principal): `tests/db/expense-category.test.js` volta o banco para antes
  delas e arranja com os mesmos `insert*`. Coluna nova entra por
  `updateColumnDirectly`.

## Regras

- **Teste tem de conseguir falhar.** Quando a regra importa, quebre o codigo de
  proposito e veja o teste cair antes de confiar nele — tres testes de
  `updated_at` passavam sem trigger nenhum.
- Prepare estado com `insert*()`, fora da rota: um teste de leitura nao quebra
  por bug na escrita.
- Asserte o contrato: status e shape do JSON. Em erro, `name` e `status_code`;
  em 422, tambem o `field` de `details`.
- Compare instantes **no Postgres**: o `Date` so vai ate milissegundo, e
  `not.toEqual` entre a string ISO e o `Date` do `pg` passa sempre.
- Conteudo extraido, so depois de `waitForProcessing`.
- Nunca use comprovante real como fixture: traz CNPJ e CPF de terceiros.
  `tests/fixtures/pdf.js` gera cupom com texto, com QR e escaneado.

## Puros

O Jest tem dois projetos (`jest.config.js`): `integracao`, com o ciclo acima,
e `puros`, as funcoes puras de `tests/services/` (`npm run test:pure`, menos de
um segundo, sem Docker). E a excecao a regra de so integracao, e vale so para
funcao pura: uma tabela de 48 casos de parsing nao cabe em 48 PDFs. Pasta nova
de teste cai na integracao, o lado seguro.

## Helpers

- `tests/helpers/pdf-text.js` e `pdf-render.js` rodam a leitura de PDF num
  subprocesso `node`: o `unpdf` usa import dinamico, que a VM do Jest recusa.
- `tests/helpers/xlsx-formula.js` resolve formula contra as celulas: SUM,
  COUNTIF, SUMIF, ROUND, IF, AND e referencia a outra aba. Funcao nova na
  planilha entra no avaliador junto.
- `tests/helpers/query-counter.js` e um repasse TCP entre uma API de teste
  (`startApiInstance` com o `DB_HOST`/`DB_PORT` dele) e o Postgres, que conta
  as consultas sem alterar nada no caminho. E como se prova "numero de
  consultas constante" sem mock.
