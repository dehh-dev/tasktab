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
| Cadastrar usuario (primeiro acesso)      | `npm run users:create -- --email ... `    |
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
routes → authenticate → requireScope → asyncHandler → controller → validator
                                                          ↓  ↓
                                                  ownership  model → Postgres
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
| `UnauthorizedError`    | 401    | sem sessao valida                              |
| `ForbiddenError`       | 403    | ha sessao, mas ela nao alcanca a operacao      |
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

## Autenticacao e autorizacao

A API era aberta ate a issue 32: qualquer um que alcancasse a porta listava os
relatorios e baixava a imagem de qualquer cupom — que traz CNPJ e, as vezes,
CPF de terceiros. Agora **toda** rota de `/api` exige sessao, menos duas:
`/api/health` (o probe do container) e `POST /api/auth/login`.

### Os dois eixos

Autorizacao aqui tem **escopo** e **posse**, e separa-los e o que evita a
mistura que costuma virar bug de permissao:

| Eixo       | Pergunta                | Onde                            |
| ---------- | ----------------------- | ------------------------------- |
| **Escopo** | que acao, em que classe | `requireScope` na **rota**      |
| **Posse**  | quais linhas            | `ownership.*` no **controller** |

O escopo fica na rota porque e o unico lugar onde da para ler, de cima a
baixo, o que cada endpoint exige — um controller novo que esqueca a checagem
passaria despercebido, uma rota sem `requireScope` salta aos olhos ao lado das
vizinhas. `requireScope` confere o nome contra `SCOPES` **na carga do modulo**:
um erro de digitacao derruba o processo no boot em vez de liberar a rota em
silencio.

Os escopos `:any` (`reports:read:any`, `reports:write:any`) sao a ponte entre
os dois eixos: quem os tem dispensa a checagem de posse. Sem eles, "admin"
viraria um `if` espalhado por cada controller.

### Papeis

| Papel     | O que e               | Alcance                          |
| --------- | --------------------- | -------------------------------- |
| `admin`   | administra pessoas    | tudo, inclusive relatorio alheio |
| `user`    | quem presta contas    | **os seus** relatorios           |
| `auditor` | quem confere e assina | le tudo, escreve nada            |

O `auditor` e o unico papel com `:any` de leitura sem o par de escrita, e e a
razao de os dois serem separados. **Nao junte os dois num escopo so.**

- A posse e do **relatorio**. Comprovante, imagem e exportacao herdam a dele:
  um cupom nao tem dono proprio, tem o dono da prestacao de contas em que foi
  lancado.
- `merchants` e cadastro **compartilhado** — a categoria de um CNPJ e a mesma
  para todo mundo, e duplicar por pessoa faria a mesma padaria ser classificada
  de dois jeitos.
- `tasks` tambem e compartilhada: o quadro e um so. Se um dia cada pessoa
  precisar do seu, o caminho e `tasks.owner_id` mais `tasks:read:any`,
  espelhando o que ja existe para relatorios.
- `reports.owner_id` e **anulavel**. Relatorio sem dono e legado (existia antes
  dos usuarios) e so quem tem `reports:read:any` o enxerga — cai fora do filtro
  naturalmente, porque `owner_id = $1` nunca casa com NULL.
- O dono sai da **sessao**, nunca do corpo, e `owner_id` nao esta em
  `UPDATABLE_COLUMNS`: transferir posse por um PATCH que passou por acaso seria
  a forma mais silenciosa de burlar tudo isto.

### 404 e nao 403 quando o recurso e de outra pessoa

Responder 403 confirmaria que o relatorio 7 existe para quem so queria
descobrir isso — dava para varrer os ids e mapear o sistema. O 403 fica para
quando **a acao** e negada e nao o registro (o auditor que le e tenta editar):
ali esconder nada adianta, porque ele acabou de ler o recurso. Ha teste dos
dois lados.

### Senha e sessao

- Senha com **`scrypt` do proprio Node** (`src/services/auth/password.js`).
  Nao entra `bcrypt` nem `argon2`: os dois trazem binario nativo para o que a
  biblioteca padrao ja faz. Os parametros vao **dentro** do hash
  (`scrypt$N$r$p$salt$hash`), entao endurecer o custo depois nao invalida as
  senhas ja cadastradas.
- A comparacao e `timingSafeEqual`, e o login roda `dummyVerify` quando o
  e-mail nao existe: sem isso a resposta instantanea entregaria quais e-mails
  estao cadastrados. Pelo mesmo motivo, e-mail inexistente e senha errada
  devolvem **a mesma** mensagem. Ha teste comparando as duas respostas.
- Sessao no **banco**, cookie `httpOnly` + `sameSite=lax`. O que se ganha e
  revogacao: sair apaga a linha e o token morre na hora, e trocar a senha
  derruba as outras sessoes. Um JWT so expira — revoga-lo antes exigiria uma
  lista de bloqueio consultada a cada requisicao, que e o custo que o JWT
  prometia evitar.
- **`sameSite=lax` e o que dispensa token de CSRF.** Sob Lax o cookie so
  acompanha navegacao de topo por GET, e toda escrita daqui e POST, PATCH ou
  DELETE. Trocar para `none` reintroduz o CSRF e passaria a exigir token.
- O que vai para o banco e o **SHA-256** do token, nunca o token. SHA-256 basta
  aqui e nao bastaria para senha: nao ha dicionario de tokens de 32 bytes
  aleatorios para uma GPU percorrer.
- O cookie e lido do header cru em dez linhas (`session.service.js`), sem
  `cookie-parser`. Nao ha assinatura a conferir — o valor ja e um segredo de
  256 bits guardado como hash, e assinar so acrescentaria uma chave para vazar.
- `POST /api/auth/login` tem teto proprio (`authLimiter`), bem mais apertado
  que o de escrita: e a unica rota onde repetir com outro valor tem serventia
  para quem nao deveria estar aqui.

### Cadastro de pessoas

**Nao existe auto-cadastro.** Criar usuario exige `users:write`; o primeiro de
todos sai por `npm run users:create`, que roda fora do processo do servidor —
so quem ja tem acesso a maquina e ao banco. Sem `--password`, o script sorteia
uma senha forte e a imprime uma vez (argumento fica no historico do shell).

- Qualquer pessoa le e edita **o proprio** cadastro sem `users:*` — trocar a
  propria senha nao pode depender de um administrador. O que ela **nao** pode
  mudar em si mesma e o `role`: e a escalada de privilegio mais comum que
  existe, e ha teste dela.
- Trocar a **propria** senha exige `current_password`; um administrador
  redefinindo a de outra pessoa nao tem como saber a atual.
- `email` nao muda por `PATCH`: trocar o e-mail troca a identidade de login.
- Nao da para apagar a si mesmo nem rebaixar/apagar o **unico** administrador —
  sem isso o sistema fica sem quem cadastre pessoas, e o conserto seria um
  UPDATE direto no banco.
- Apagar um usuario **nao** apaga os relatorios dele: `owner_id` e
  `ON DELETE SET NULL`. Prestacao de contas assinada e evidencia, pela mesma
  razao que nao ha expiracao automatica dos arquivos.
- `password_hash` nao existe em `User.COLUMNS`. Os dois unicos caminhos que o
  trazem sao `findByEmailWithSecret` (login) e `findByIdWithSecret` (troca da
  propria senha). **Nao acrescente um terceiro.**

### Na interface

`App.jsx` pergunta `GET /api/auth/me` ao abrir: sem sessao, mostra o
`LoginScreen`. As abas e os botoes de escrita seguem os escopos da resposta —
um auditor nao ve "Novo relatorio". Isso e **conveniencia de tela, nao
autorizacao**: o servidor confere de novo a cada requisicao, e ha teste de API
provando cada recusa.

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

| Funcao                              | Para que                                                |
| ----------------------------------- | ------------------------------------------------------- |
| `waitForAllServices()`              | espera o `/api/health` responder 200                    |
| `runPendingMigrations()`            | aplica as migrations no banco de teste                  |
| `clearDatabase()`                   | trunca `tasks` reiniciando a identidade                 |
| `insertTask(overrides)`             | arranjo direto no banco, sem passar pela API            |
| `insertUser` / `insertSession`      | usuario e sessao direto no banco                        |
| `createUserWithSession`             | usuario de outro papel, devolve `{ user, token }`       |
| `seedDefaultUser()`                 | recria o admin padrao e a sessao dele                   |
| `updateTaskTitleDirectly`           | escrita crua, para provar garantia do banco             |
| `request(m, path, body, { token })` | HTTP; `body` string vai cru, `token: null` = sem sessao |

**Um arquivo de teste novo nao precisa de preambulo nenhum** — so `require` do
orchestrator e os `describe`. O ciclo esta dividido em dois lugares:

| Onde                    | Quando roda          | O que faz                                                |
| ----------------------- | -------------------- | -------------------------------------------------------- |
| `tests/global-setup.js` | uma vez por execucao | espera a API, aplica migrations                          |
| `tests/setup.js`        | por arquivo de teste | trunca as tabelas, recria o usuario padrao, fecha o pool |

O que e caro fica no `global-setup`: `runPendingMigrations()` custa um processo
`npx`, e chama-lo por arquivo multiplicaria o custo a cada arquivo novo.
Deduplicar com marca em `process.env` **nao** funciona — o Jest entrega a cada
arquivo a sua propria copia de `process.env`.

- **Toda rota exige sessao, e `request()` ja chega autenticada** como o admin
  padrao — nenhum arquivo de teste precisa de preambulo. O hash da senha e
  calculado uma vez por processo (o `scrypt` custa ~30 ms de proposito) e o
  token e sorteado uma vez; o que o TRUNCATE apaga e so a linha da sessao,
  recriada com o mesmo token. Para testar 401, `{ token: null }`; para testar
  outro papel, `createUserWithSession({ role })`.
- O usuario padrao e **admin** para que o arranjo antigo continue valendo:
  `insertReport()` cria relatorio sem dono, e so `reports:read:any` o enxerga.
- `tests/api/auth/scopes.test.js` e a **matriz de autorizacao**, endpoint a
  endpoint. Vale mais que a soma dos testes de cada rota: uma rota nova sem
  `requireScope` passa em todos os testes dela mesma, e so ali, ao chegar com
  um papel que nao deveria alcanca-la, e que a falta aparece. **Toda rota nova
  entra nessa lista.**
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
- Atalho de teclado que precisa funcionar independente de onde o foco esta
  (`ReceiptReview`: `Escape`, `Alt+seta`) vai em `document.addEventListener`
  dentro de `useEffect`, nunca em `onKeyDown` de uma `div` nao-focavel — o
  evento so borbulha ate a div se o foco estiver dentro da subarvore dela, e
  apos uma remontagem (troca de `key`) o foco pode ficar fora sem aviso
  nenhum, calando o atalho em silencio.
- Componente que mostra "um item de cada vez" dentro de uma lista/fila
  (`ReceiptReview` por `receipt.id`, `TaskForm` por `editing.id`) leva
  `key={item.id}` no elemento pai. Sem isso o React reaproveita a mesma
  instancia ao trocar de item, vazando estado local (zoom, valor digitado,
  flag de imagem carregada) de um item para o proximo.

## Logs

`pino` via `infra/logger.js`. **Nao use `console.*` em `src/` nem em `infra/`** —
use `logger` (fora de requisicao) ou `req.log` (dentro dela, que ja vem com o
`request_id` anexado).

- Todo erro 5xx devolve `request_id` no corpo; os 4xx nao (mudaria o contrato
  sem ganho, e ha teste afirmando o corpo exato do 404).
- Em teste o logger e `silent`, para nao poluir a saida da suite.
- Os serializers sao enxutos de proposito: o padrao do `pino-http` despeja
  todos os headers em cada linha.
- **Nunca logue senha, token de sessao nem cookie.** O `redact` do pino ja
  cobre `req.headers.cookie` e `authorization`, mas log manual escreve o que
  mandarem. Para investigar acesso, logue o `user_id` — o `authenticate` ja o
  anexa a cada linha da requisicao.
- **Nunca logue `raw_text`, `access_key` ou o comprovante inteiro.** Os
  serializers nao despejam corpo de requisicao, mas log manual escreve o que
  mandarem — e um cupom traz CNPJ e as vezes CPF de terceiros. Para investigar
  uma extracao, logue o `id` do comprovante e consulte o banco.

## Container

`Dockerfile` multi-stage; o runtime nao tem devDependencies, roda como `node` e
nao carrega arquivo de env. O `HEALTHCHECK` usa `/api/health` e respeita `PORT`.

Migrations **nao** rodam a partir dessa imagem: `node-pg-migrate` e
devDependency. Aplicar migration e passo separado do pipeline.

As dependencias nativas da extracao (`sharp`, `@napi-rs/canvas`,
`zxing-wasm`, e o `tesseract.js` do M4) foram verificadas nesta base Alpine e
funcionam com `--ignore-scripts` — todas trazem binario musl pre-compilado.
**Nao troque a base para Debian sem medir**: a troca foi avaliada e dispensada.

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
- `POST /api/auth/login` usa o `authLimiter`, o teto mais apertado dos quatro.
  E a unica rota onde repetir a requisicao com outro valor serve a quem nao
  deveria estar aqui.

## Ambientes

`src/config/env.js` carrega `env.<NODE_ENV>` — **sem ponto no inicio**:
`env.development` e `env.test`, ambos versionados de proposito (valores locais).
O dotenv **nao sobrescreve** variaveis ja presentes em `process.env`, entao em
producao basta injetar as reais pelo ambiente. Nao existe `env.production`.

Variaveis da sessao (`src/config/env.js`): `SESSION_TTL_HOURS` (padrao 168),
`SESSION_COOKIE_NAME` e `SESSION_COOKIE_SECURE`. O `Secure` do cookie so liga
sozinho em producao — em desenvolvimento e no E2E o acesso e por
`http://localhost`, e um cookie `Secure` ali seria descartado pelo cliente.

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

### Retencao dos arquivos

- **Arquivo enviado morre junto com a linha que o referencia.** Apagar
  comprovante ou relatorio apaga o PDF do disco, via
  `src/services/retention.service.js`. Nao existe TTL nem varredura por idade:
  expirar sozinho destruiria evidencia de um relatorio ainda questionavel.
- A exclusao e **contada por referencia** (`Receipt.countByHash`), nunca
  direta. O nome do arquivo e o SHA-256 do conteudo, entao um PDF atende todas
  as paginas dele e ainda e reaproveitado por outro relatorio com o mesmo
  upload. **Nao troque por um `unlink` direto** — levaria embora o cupom das
  outras linhas. Ha teste dos dois lados.
- Chame `discardOrphans` **depois** de a linha sair do banco: e o que faz a
  contagem refletir so referencias vivas. No `report.destroy` os arquivos
  precisam ser levantados **antes**, porque a cascata da FK apaga os
  comprovantes e leva a informacao junto.
- Falha ao apagar o arquivo nao derruba a resposta: a linha ja saiu, e o erro
  nao a traz de volta. Fica um `warn`; `ENOENT` e silencioso.
- **`raw_text` nao e anonimizado na confirmacao** — decisao consciente. A regra
  de conferencia que soma itens le dele, e confirmar e reversivel: anonimizar
  ali calaria a checagem justamente nos comprovantes que vao assinados.

### Extracao

`src/services/extraction/` — cascata: texto (M2) → QR (M3) → OCR (M4).

- `normalize.js` devolve **`null`** quando nao reconhece a entrada. Nunca
  `NaN`, nunca `0`: zero e um valor plausivel e passaria despercebido ate a
  conferencia.
- `extractTotal` e **ancorado em palavra-chave**. Nao volte a usar "o maior
  numero da pagina": chave de acesso (44 digitos), CNPJ (14) e telefone (11)
  sao todos maiores que qualquer refeicao.
- **`extractDate` tambem e ancorado**, e prefere a linha de autorizacao. Num
  cupom real o texto trazia `NiC-e ... 02/06/2026` e, tres linhas abaixo,
  `Data de Autorização 02/08/2026`: o OCR errou a primeira, "a primeira data da
  pagina" venceu, e agosto virou junho numa prestacao ja assinada. A
  autorizacao e carimbo do SEFAZ e vale mais que o que o equipamento imprimiu.
- **Ancora nao atravessa quebra de linha.** `\s*` e `\s+` engolem o `\n`, e foi
  assim que o cabecalho "Valor unit. Valor total" colou no codigo do primeiro
  item e o total do cupom virou `001` — R$ 1,00 no lugar de R$ 165,00. O mesmo
  bug apareceu no nome do emitente, onde o CNPJ colava na linha de endereco.
  Use busca por linha ou `[^\S\n]*`.
- Ha um segundo passe, `extractLooseTotal`, para a linha em que o OCR sujou o
  espaco entre a ancora e o numero (`.. VALOR TOTAL Ri 2... 2.225,49`). Ele
  entra com confianca 0.3, o que arrasta a confianca do comprovante para baixo
  e faz a linha chegar destacada na revisao. **Nao junte os dois** — misturar
  faria um palpite passar por leitura.
- Nome do emitente vem da **razao social colada no CNPJ**, nao da primeira
  linha da pagina. A primeira linha de um PDF escaneado e a margem do papel, e
  era com ela que 5 dos 19 emitentes do caso-base tinham sido cadastrados
  (`: 40) 47 DL? "o`).
- A **cidade do emitente** sai do mesmo texto que ja estava sendo extraido e
  jogado fora, e vai para `merchants.city`.
- Hora e numero do documento chegaram a ser extraidos e foram **removidos** no
  uso real: nenhuma das duas era consultada na revisao, e campo que ninguem le
  so alonga o formulario. Se voltarem, voltam por pedido, nao por completude.
- **Nada e confirmado automaticamente.** A extracao troca digitar por
  conferir, nao por deixar de olhar.
- Categoria tem tres degraus, nesta ordem: **cadastro do emitente** (decisao
  humana, vale sempre), **palpite por palavra-chave** no nome
  (`category-guess.js`), e o **piso `DEFAULT_CATEGORY`** (`alimentacao`). Nao
  existe mais comprovante sem categoria: o campo vem sempre preenchido, e
  sempre marcado quando nao veio do cadastro. O piso e `alimentacao` porque era
  21 de 23 lancamentos no relatorio real que motivou o ajuste — abrir o seletor
  em cada linha custava mais que corrigir as duas erradas.
  O palpite grava `category_guessed = true`, a
  revisao destaca o campo com borda tracejada e a frase "Sugerida pelo nome do
  emitente", e editar a categoria ou confirmar o comprovante zera a marca.
  **Palpite nunca sobrescreve cadastro** — ha teste dos dois lados.
- Isto **inverteu** a regra anterior ("categoria nunca e adivinhada por nome"),
  a pedido de quem usa: num lote de 30 cupons, classificar tudo a mao custa
  mais que corrigir os poucos que o palpite erra. O que segurou a regra antiga
  continua valendo em outra forma — o risco nao era adivinhar, era adivinhar
  **sem dizer que adivinhou**. Se algum dia a marca sair da tela, a regra
  antiga volta a ser a certa.
- `guessCategory` continua devolvendo `null` sem indicio no nome — o piso e
  aplicado **fora** dela, no `classify`. Manter os dois separados e o que
  permite mudar o piso sem mexer nas regras que leem o nome, e o que deixa
  visivel no codigo qual dos dois respondeu.
- **`hospedagem` saiu do enum** a pedido de quem usa. Remover valor de enum no
  Postgres exige recriar o tipo; ha migration com `up` e `down` testados.
- O CNPJ confiavel e o das posicoes 7 a 20 da **chave de acesso**, nao o do
  texto: o cupom traz tambem o da credenciadora do cartao.
- Chave que nao fecha o DV mod-11 e **descartada**. Nao ha meio termo entre
  confiar e nao confiar num identificador com verificador.
- `nao_classificado` vira `NULL` no comprovante: e ausencia de decisao, nao
  categoria. Gravar o enum faria a linha parecer classificada nos subtotais.
- Cascata: **texto → QR → OCR**. Pagina sem camada de texto util desce para o
  OCR; o que nem o OCR le fica em `needs_review` sem origem.
- **Manuscrito fica de fora**, por decisao consciente: o Tesseract nao le
  caneta sobre formulario.
- O processamento e **assincrono**, numa fila em processo. Upload responde
  `202`. Todo teste que afirme algo sobre conteudo extraido precisa passar por
  `orchestrator.waitForProcessing`, e o `tests/setup.js` drena a fila antes de
  truncar — sem isso, trabalho de um teste escreve no banco ja limpo do
  seguinte. Aconteceu.
- Os testes puros de extracao vivem em `tests/services/`. E excecao estreita a
  regra de so integracao, e vale so para funcao pura: uma tabela de 48 casos de
  parsing nao cabe em 48 PDFs. Leitura de PDF continua coberta por integracao —
  o `unpdf` usa import dinamico, que a VM do Jest recusa sem flag.

## Conferencia e duplicatas

- **Alerta nao bloqueia.** `GET /api/reports/:id/validation` aponta; quem
  decide e a pessoa que assina.
- So **mesma chave de acesso** colapsa como duplicata automatica. Mesma data
  com mesmo valor e **suspeita**, e vira alerta.
- Regra agressiva demais recria o erro que a ferramenta existe para evitar: ha
  teste do contraexemplo (dois almocos iguais em dias diferentes **nao** sao
  duplicata). **Nao afrouxe esse teste.**
- Regra de conferencia so dispara com evidencia suficiente — a de itens exige
  ao menos dois itens legiveis, a de faixa exige historico minimo. Alarme falso
  destroi a confianca mais rapido que um erro nao detectado.

## Exportacao

`src/services/export/` — resumo por tipo, Anexo I oficial e PDF consolidado.

- **O template em `assets/anexo-i-template.xlsx` e SINTETICO.** Nao existe
  neste projeto o arquivo real do Anexo I. Antes de qualquer uso em producao,
  troque pelo formulario oficial e revise `CATEGORY_COLUMN` em
  `anexo-i.service.js` — o mapa de 8 categorias para 3 colunas (S/W/X) e
  placeholder, criado sem o layout real.
- **Nunca abra-e-regrave o `.xlsx` do Anexo I com exceljs (ou qualquer lib
  parse-and-rebuild).** Foi assim que a validacao de dados (lista suspensa) de
  um template oficial se perdeu, na conferencia manual que originou este
  projeto. `xlsx-cell-patch.js` troca celula por manipulacao de string direto
  no XML — estilo, formula, `dataValidations`, `mergeCells` nunca sao lidos
  para memoria como objeto, entao sobrevivem intocados.
- O regex de `setCell` usa quantificador **preguicoso** nos atributos da
  celula (`[^>]*?`, nao `[^>]*`). Guloso consome o `/` de uma celula
  autofechada (`<c .../>`) e a substituicao apaga a celula seguinte inteira.
  Ja aconteceu uma vez — **nao volte para guloso**.
- So `receipts.status === 'confirmed'` entra nas duas saidas Excel (issue 29):
  no Anexo I porque e o que vai assinado, e no resumo por tipo pelo mesmo
  motivo. O que ficou de fora vai contado no bloco "Fora da prestacao", sem
  entrar em soma — some do total, nao da vista.
- O resumo e **uma aba por tipo** com lancamento, mais a aba `Resumo`, na ordem
  do enum. Ordenar por valor faria dois relatorios da mesma pessoa sairem com
  layout diferente, e comparar um mes com o outro viraria procurar a linha.
- Colunas da aba de tipo: **Data, Local, Cidade, Valor**. Hora e Documento
  chegaram a existir e sairam no uso real — ver a secao de extracao. Cidade sai
  do emitente (`merchants.city`).
- A formatacao **nao e enfeite**: cabecalho branco sobre `FF1F3864`, zebra
  `FFF2F2F2`, bordas, linha de TOTAL mesclada e invertida, cabecalho congelado
  e autofiltro. E o layout que quem confere ja conhece da planilha antiga —
  chegar com outro obrigaria a reaprender onde olhar. A zebra existe para a
  vista nao escorregar de linha numa tabela de seis colunas; nenhuma cor
  carrega informacao sozinha.
- Ha teste afirmando o preenchimento do cabecalho, a zebra, o congelamento e a
  mesclagem do TOTAL. Formatacao que ninguem testa e formatacao que a proxima
  refatoracao apaga sem que a suite reclame.
- Valor de cada tipo no `Resumo` e **formula cruzando abas**
  (`SUM('Alimentação'!D2:D9)`), nao numero repetido: dois numeros para a mesma
  conta e uma contradicao esperando um deles ser editado.
- **Nome de aba em formula precisa de aspas simples** e o Excel recusa
  `: \ / ? * [ ]` e nomes acima de 31 caracteres. `sheetName`/`sheetRange`
  cuidam disso — uma categoria nova com acento ou barra derrubaria a planilha
  inteira sem elas.
- **`nao_classificado` e `NULL` sao o mesmo grupo** (`categoryKey` em
  `labels.js`). Enquanto tinham rotulos diferentes, o subtotal procurava
  "Nao classificado" e as linhas diziam "Sem categoria": o valor entrava no
  total e em nenhum subtotal, e a soma dos tipos nao fechava. **Nao volte a
  dar rotulo proprio ao `nao_classificado`.**
- Teste de planilha **resolve a formula contra as celulas**
  (`tests/helpers/xlsx-formula.js`), nao so compara a string. Foi a
  comparacao de string que deixou passar o subtotal que apontava para um
  rotulo que nenhuma linha usava.
- O carimbo do PDF fica numa faixa **nova**, criada ao embutir a pagina
  original numa pagina maior — nunca um retangulo desenhado por cima.
  Fisicamente nao ha como cobrir o cupom.
- Ordem cronologica do PDF usa `id` como desempate, nao hora: nenhum parser de
  extracao le hora do comprovante ainda.
- Bookmarks (outlines) do PDF usam a API de baixo nivel do pdf-lib
  (`doc.context`) — nao ha metodo de alto nivel para isso na biblioteca.
- Teste de PDF gerado **nao pode chamar `unpdf` direto de dentro do Jest**: o
  mesmo problema do `text.service.js` (import dinamico, VM do Jest recusa sem
  `--experimental-vm-modules`). `tests/helpers/pdf-text.js` roda a extracao
  num subprocesso `node` puro, no mesmo espirito do `runPendingMigrations()`.

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
- A imagem do cupom (`receipt-image.service.js`) e renderizada a **4x** e
  servida em **WebP q92**, e nao a 3x em PNG. A escala nao e chute: os PDFs
  reais sao digitalizacoes a 257 ppi — uma pagina de 1000pt traz uma imagem
  embutida de 3568px, ou seja 3,57x os pontos. A 3x o resultado saia com
  3000px, **abaixo do original**, jogando fora detalhe que estava no arquivo.
  Medido na mesma pagina: PNG a 3x = 3000x1431 e 1861 KB; WebP a 4x =
  4000x1908 e 451 KB. Mais resolucao e quatro vezes menos bytes. Acima de 4x so
  haveria interpolacao, porque o dado nao existe no PDF.
- A escala do **QR** (`qr.service.js`) continua 3x e e outra coisa: la o alvo e
  o zxing, aqui e o olho humano. Nao amarre as duas.
- `.review__image-scroll` e um container flex, e `align-items` **precisa** ser
  `flex-start`. Com o `stretch` padrao a imagem, como item flex, era esticada
  ate os 70vh do painel e a proporcao do documento ia junto — o cupom aparecia
  deformado. `height: auto` no `.review__image` e o par obrigatorio do
  `max-width`.
- Conteudo ampliado por `transform: scale()` dentro de um container com
  `overflow: auto` leva `transform-origin: top left`. A regiao de overflow
  rolavel so se estende para direita e baixo: escalando a partir do centro, o
  que passa da borda esquerda fica **inalcancavel** por qualquer barra. Foi o
  que aconteceu com a imagem do cupom (`.review__image`), onde um terco do
  documento nao podia ser visto a 300%. **Nao volte para `center`** — ha spec
  E2E medindo o recorte.

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
- Nao crie rota em `/api` sem `requireScope` (ou `requireAuth`, para o que so
  precisa de sessao). `authenticate` **nao barra ninguem** de proposito.
- Nao carregue um relatorio ou comprovante sem passar por `loadReport` /
  `loadReceipt`: e por fora deles que um vazamento entra.
- Nao aceite `owner_id` do cliente, em corpo nem em query. O dono sai da sessao.
- Nao troque `sameSite=lax` por `none` sem introduzir token de CSRF junto.
- Nao acrescente caminho novo que leia `password_hash`.

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
