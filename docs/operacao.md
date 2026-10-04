# Operacao

## Variaveis de ambiente

`src/config/env.js` carrega `env.<NODE_ENV>` — `env.development` para dev e
`env.test` para os testes. O dotenv **nao sobrescreve** variaveis ja presentes
em `process.env`, entao em producao basta injetar as variaveis reais pelo
ambiente (nao existe `env.production` versionado).

| Variavel                                              | Descricao                                 |
| ----------------------------------------------------- | ----------------------------------------- |
| `PORT`                                                | Porta HTTP                                |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Conexao usada pela aplicacao              |
| `DATABASE_URL`                                        | Consumida pelo `node-pg-migrate`          |
| `RATE_LIMIT_WINDOW_MS`                                | Janela do limitador (padrao 15min)        |
| `RATE_LIMIT_MAX`                                      | Teto de leitura (padrao 600)              |
| `RATE_LIMIT_WRITE_MAX`                                | Teto de escrita (padrao 100)              |
| `RATE_LIMIT_BATCH_WRITE_MAX`                          | Teto das rotas em lote (padrao 600)       |
| `RATE_LIMIT_AUTH_MAX`                                 | Teto do login (padrao 20)                 |
| `RATE_LIMIT_ENABLED`                                  | `true` liga em teste, `false` desliga     |
| `UPLOAD_DIR`                                          | Onde os PDFs sao gravados                 |
| `UPLOAD_MAX_BYTES`                                    | Tamanho maximo por arquivo                |
| `UPLOAD_MAX_FILES`                                    | Arquivos por requisicao                   |
| `OCR_ENABLED`                                         | `false` desliga o degrau de OCR           |
| `OCR_LANGUAGE`                                        | Idioma do tesseract (padrao `por`)        |
| `OCR_LANG_PATH`                                       | Dados do idioma (padrao: o pacote `por`)  |
| `OCR_TIMEOUT_MS`                                      | Teto por pagina (padrao 20s)              |
| `SESSION_COOKIE_NAME`                                 | Nome do cookie (padrao `tasktab_session`) |
| `SESSION_TTL_HOURS`                                   | Validade da sessao (padrao 168h)          |
| `SESSION_COOKIE_SECURE`                               | Forca (ou desliga) o `Secure` do cookie   |
| `PASSWORD_PEPPER`                                     | Pepper das senhas (obrigatorio)           |
| `PASSWORD_SCRYPT_P`                                   | Paralelismo do scrypt (padrao 5)          |
| `LOG_LEVEL`                                           | Nivel do `pino` (padrao `info`)           |

O `.npmrc` liga `engine-strict`: sem ele o campo `engines` seria so um aviso e a
instalacao seguiria numa versao de Node incompativel.

A extracao nao usa rede: o `.wasm` do leitor de QR e os dados de idioma do OCR
vem dos pacotes instalados. Se o OCR nao subir — outro `OCR_LANGUAGE` sem os
dados dele em `OCR_LANG_PATH`, por exemplo —, a API segue no ar, o log registra
`o OCR nao subiu` e as paginas sem texto vao para a revisao sem leitura ate o
processo reiniciar.

O `services:wait:database` abre uma conexao real com o banco da aplicacao em
vez de so checar se o container subiu — assim valida tambem as credenciais e a
existencia do database, que e do que as migrations dependem. Ele respeita o
`NODE_ENV`, entao aponta para o banco de teste quando chamado pelo `pretest`.

## Producao

Em desenvolvimento o Vite serve a interface e encaminha `/api` para o Express.
Em producao nao ha Vite: rode `npm run build` e o Express passa a servir
`web/dist` na mesma origem, com fallback de SPA para rotas que nao comecem com
`/api`. Nos dois casos front e back ficam na mesma origem, o que dispensa CORS.

## Container

```bash
docker build -t tasktab .
docker run -p 3000:3000 \
  -e DB_HOST=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=... \
  -e PASSWORD_PEPPER=... \
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

## Integracao continua

O workflow `.github/workflows/ci.yml` roda a cada pull request e a cada push na
`main`, em dois jobs paralelos: **qualidade** (lint, `format:check` e build da
interface) e **testes de integracao** (`npm test`).

O job de teste usa o mesmo `npm test` do desenvolvimento, com Docker de verdade.
Um `services: postgres` do proprio Actions nao serviria: ele nao executa o
`docker/initdb/`, entao o banco `tasktab_test` nunca existiria.

O `npm audit` fica de fora de proposito, pelo motivo da secao abaixo.

## Sobre o `npm audit`

Os `overrides` do `package.json` sao escopados por versao de `minimatch`,
porque cada major consome uma API diferente do `brace-expansion`: a 3.x espera
o export CommonJS da linha 1.x, enquanto a 10.x usa a 5.x. Forcar uma unica
versao para as duas quebra o ESLint com `expand is not a function`.

Resta um aviso conhecido, sem correcao possivel hoje: o ESLint fixa
`minimatch ^3.1.2` internamente e essa linha nao tem versao considerada
corrigida pelo advisory. O impacto e nulo aqui — trata-se de negacao de
servico ao expandir um glob malicioso, e os unicos globs em uso vem dos
proprios arquivos de configuracao do projeto, nao de entrada externa.
