# API

**Toda rota de `/api` exige sessao**, com duas excecoes: `GET /api/health` (o
probe do container) e `POST /api/auth/login`. Sem sessao a resposta e `401`;
com sessao mas sem permissao, `403` — e `404` quando o recurso pertence a outra
pessoa (ver [seguranca.md](seguranca.md)).

## Rotas

Base: `/api/auth`

| Metodo | Rota      | Descricao                           | Sucesso |
| ------ | --------- | ----------------------------------- | ------- |
| `POST` | `/login`  | Abre a sessao e grava o cookie      | 200     |
| `POST` | `/logout` | Encerra a sessao (apaga do banco)   | 204     |
| `GET`  | `/me`     | Quem esta na sessao, com os escopos | 200     |

Base: `/api/users` (`users:read` / `users:write`; o proprio cadastro dispensa)

| Metodo   | Rota   | Descricao                         | Sucesso |
| -------- | ------ | --------------------------------- | ------- |
| `GET`    | `/`    | Lista (paginada)                  | 200     |
| `GET`    | `/:id` | Detalhe                           | 200     |
| `POST`   | `/`    | Cadastra                          | 201     |
| `PATCH`  | `/:id` | Altera nome, senha ou papel       | 200     |
| `DELETE` | `/:id` | Remove (os relatorios dele ficam) | 204     |

Base: `/api/tasks`

| Metodo   | Rota   | Descricao                   | Sucesso |
| -------- | ------ | --------------------------- | ------- |
| `GET`    | `/`    | Lista (paginada, filtravel) | 200     |
| `GET`    | `/:id` | Detalhe                     | 200     |
| `POST`   | `/`    | Cria                        | 201     |
| `PATCH`  | `/:id` | Atualiza (parcial)          | 200     |
| `DELETE` | `/:id` | Remove                      | 204     |

Query params do `GET /api/tasks`: `status` (enum), `limit` (1–100, padrao 50),
`offset` (padrao 0).

### Prestacao de contas

Como cada etapa funciona esta em
[prestacao-de-contas.md](prestacao-de-contas.md).

| Metodo   | Rota                                             | Descricao                       |
| -------- | ------------------------------------------------ | ------------------------------- |
| `GET`    | `/api/reports`                                   | Lista (filtro por `status`)     |
| `POST`   | `/api/reports`                                   | Cria                            |
| `GET`    | `/api/reports/:id`                               | Detalhe                         |
| `PATCH`  | `/api/reports/:id`                               | Atualiza                        |
| `DELETE` | `/api/reports/:id`                               | Remove (leva os comprovantes)   |
| `POST`   | `/api/reports/:id/receipts`                      | Envia 1..N PDFs                 |
| `GET`    | `/api/reports/:id/receipts`                      | Lista comprovantes com totais   |
| `GET`    | `/api/receipts/:id`                              | Detalhe                         |
| `PATCH`  | `/api/receipts/:id`                              | Corrige campos na revisao       |
| `DELETE` | `/api/receipts/:id`                              | Remove                          |
| `GET`    | `/api/receipts/:id/image`                        | Pagina do comprovante (WebP)    |
| `POST`   | `/api/receipts/:id/reprocess`                    | Reenvia para a fila             |
| `GET`    | `/api/reports/:id/validation`                    | Alertas de conferencia          |
| `GET`    | `/api/reports/:id/final-check`                   | Checagem final, antes de fechar |
| `GET`    | `/api/reports/:id/export.xlsx`                   | Planilha do procedimento        |
| `GET`    | `/api/reports/:id/export/anexo-i.xlsx`           | Anexo I (Excel)                 |
| `GET`    | `/api/reports/:id/export.pdf`                    | PDF consolidado                 |
| `GET`    | `/api/reports/:id/export/pdfs-por-categoria.zip` | Um PDF por categoria, num ZIP   |

Base: `/api/merchants` — o cadastro que da categoria ao comprovante.

| Metodo  | Rota                           | Descricao                       |
| ------- | ------------------------------ | ------------------------------- |
| `GET`   | `/api/merchants`               | Lista os emitentes cadastrados  |
| `POST`  | `/api/merchants`               | Cadastra um emitente            |
| `GET`   | `/api/merchants/:id`           | Detalhe                         |
| `PATCH` | `/api/merchants/:id`           | Atualiza (e a categoria padrao) |
| `GET`   | `/api/merchants/by-cnpj/:cnpj` | Busca pelo CNPJ lido da chave   |

### RPA de lancamentos

Escopos `rpa:read` / `rpa:write`, por enquanto so do papel `admin`: o modulo
guarda CPF, RG e conta bancaria de terceiros. O plano e as etapas estao na
issue 35.

| Metodo  | Rota                     | Descricao                                        |
| ------- | ------------------------ | ------------------------------------------------ |
| `GET`   | `/api/rpa/companies`     | Lista as empresas pelo codigo UAU (paginada)     |
| `POST`  | `/api/rpa/companies`     | Cadastra uma empresa                             |
| `GET`   | `/api/rpa/companies/:id` | Detalhe                                          |
| `PATCH` | `/api/rpa/companies/:id` | Atualiza (o codigo UAU nao muda: e a identidade) |

| Metodo   | Rota                            | Descricao                                     |
| -------- | ------------------------------- | --------------------------------------------- |
| `GET`    | `/api/rpa/launches`             | Lista os lancamentos (filtro por `status`)    |
| `POST`   | `/api/rpa/launches`             | Cria, com horario padrao e diarias            |
| `GET`    | `/api/rpa/launches/:id`         | Detalhe                                       |
| `PATCH`  | `/api/rpa/launches/:id`         | Atualiza; encerrado so aceita reabrir         |
| `DELETE` | `/api/rpa/launches/:id`         | Apaga (recusa com `409` se ha RPA)            |
| `POST`   | `/api/rpa/launches/:id/import`  | Importa a equipe das respostas do formulario  |
| `GET`    | `/api/rpa/launches/:id/workers` | A equipe, pelo numero fixo, com pendencias    |
| `GET`    | `/api/rpa/launches/:id/days`    | A grade do ponto, com o valor de cada dia     |
| `PUT`    | `/api/rpa/launches/:id/days`    | Grava em lote so os dias que mudam            |
| `GET`    | `/api/rpa/workers/:id`          | Detalhe da pessoa                             |
| `PATCH`  | `/api/rpa/workers/:id`          | Corrige a pessoa e da pendencia por resolvida |

O lancamento leva `company_id`, `city`, `state`, `development`, `starts_on` e
`ends_on` (obrigatorios), `holidays` (datas), `service_type` e `cost_center`
(sem eles, valem os da empresa), `site`, `product` e `supply` (os campos do
e-mail de solicitacao), `email_to` e `email_cc`, `first_payment_daily_only`,
`schedule` — o horario padrao, `[{ weekday, quantity, start_time, lunch_out,
lunch_in, end_time }]`, com `weekday` de 1 (segunda) a 7 (domingo); dia que
nao vem e folga — e `rates` — as diarias por funcao, `[{ role, starts_on,
ends_on, daily_cents, promoted_bonus_cents }]`, sem vigencias sobrepostas da
mesma funcao. No `PATCH`, `schedule` e `rates` substituem a lista inteira.

`POST /api/rpa/launches/:id/import` recebe o `.xlsx` ou `.csv` baixado das
respostas do Google Forms, em multipart no campo `file`. O arquivo e lido e
descartado. A resposta traz `created`, `updated`, `unchanged`, `rejected`
(`[{ line, reason }]`, as linhas sem nome ou CPF), `warnings` (pergunta
desconhecida ou pessoa repetida, pela linha), `changes` (`[{ worker_id,
number, fields }]`, o que cada resposta mais nova mudou) e `workers` (a equipe,
com as pendencias). Reimportar casa pelo CPF e nao duplica ninguem. Sem a
pergunta de nome ou de CPF, ou com um arquivo que nao e planilha, `422` no
campo `file`.

Cada pessoa tem `issues`: `[{ code, field, message, source, resolved }]`. O
`PATCH` corrige campos (CPF com verificador valido e unico no lancamento,
inicio real, saida, `promoted_since`, `dependents`, dados do formulario) e da
pendencias por resolvidas com `resolve_issues: [{ code, field }]`. O `number`
nao muda.

`GET /api/rpa/launches/:id/days?from=&to=` devolve a grade pessoa x dia,
preenchida com o horario padrao do inicio a saida de cada pessoa, ate 93 dias
por vez (sem `from` e `to`, o lancamento inteiro). Cada dia traz `kind`
(`weekday`, `saturday`, `sunday`, `holiday`), `source` (`schedule`, `exception`
ou `off`, a folga), `quantity`, os horarios, `worked_minutes`,
`extra_minutes`, `daily_cents` (a diaria vigente), `daily_subcents`,
`extra_subcents`, `value_subcents` e `flags` (`short_day`, `no_rate`,
`overnight`). Os valores vao em **1/1920 de centavo**
(`subcents_per_cent: 1920`): o extra por minuto nao fecha em centavo, e o
arredondamento e so no total do pagamento. Dia trabalhado sem diaria vigente
vem com valor `null` e a marca `no_rate`. Cada pessoa tem `totals`.

`PUT /api/rpa/launches/:id/days` recebe `{ "days": [...] }`, ate 1000 dias:
`{ worker_id, date, quantity, start_time, lunch_out, lunch_in, end_time, note }`
para gravar a excecao (`quantity` 0 e falta, sem horario; 0.5 e meio periodo)
ou `{ worker_id, date, reset: true }` para voltar ao padrao. O dia igual ao
padrao tambem volta ao padrao. O lote e gravado inteiro ou nada: pessoa de
outro lancamento, data fora do periodo da pessoa e dia trabalhado sem diaria
vigente respondem `422` apontando a linha (`days[i].campo`); o ultimo traz
tambem `date` e `role`. A resposta e a grade do trecho gravado.

Calculo, com hora normal = diaria / 8: dia util e sabado pagam a diaria e as
horas acima de 8h a 50%; domingo e feriado, duas diarias e as horas acima de
8h a 100%, mesmo com menos de 8h. Abaixo de 8h nada e descontado: o dia sai
com `short_day`. Meia diaria tem base de 4h.

Campos da empresa: `code` (codigo UAU, inteiro, unico), `name` e `cnpj`
(obrigatorios; o CNPJ entra com ou sem mascara e e conferido pelo
verificador), `city`, `state` (UF), `service_type` e `cost_center`. Os dois
ultimos sao o padrao que o lancamento herda para o formulario do RPA. Para
cadastrar a aba EMPRESA inteira, use `npm run rpa:companies:import` (ver o
README).

`GET /api/health` consulta o banco de verdade: devolve `200` com
`{ "data": { "status": "ok", "uptime": ... } }` quando o Postgres responde e
`503` (`ServiceError`) quando nao responde — nunca `200` com o banco fora.

## Campos de uma tarefa

| Campo         | Tipo   | Regras                                                  |
| ------------- | ------ | ------------------------------------------------------- |
| `title`       | string | **obrigatorio**, nao-vazio, max. 255 caracteres         |
| `description` | text   | opcional, aceita `null`                                 |
| `status`      | enum   | `pending` \| `in_progress` \| `done` (padrao `pending`) |
| `due_date`    | date   | opcional, `YYYY-MM-DD`, data valida no calendario       |

`created_at` e `updated_at` sao do banco. O `updated_at` e mantido por um
trigger, entao vale tambem para escrita que nao passa pela API.

## Exemplos

Toda chamada leva o cookie de sessao que o login devolve (`-c` guarda, `-b`
envia):

```bash
curl -c sessao.txt -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"voce@exemplo.com","password":"..."}'

curl -b sessao.txt -X POST localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Revisar PR","status":"in_progress","due_date":"2026-08-15"}'

curl -b sessao.txt "localhost:3000/api/tasks?status=done&limit=10"
curl -b sessao.txt -X PATCH localhost:3000/api/tasks/1 -H 'Content-Type: application/json' -d '{"status":"done"}'
curl -b sessao.txt -X DELETE localhost:3000/api/tasks/1
```

## Respostas

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

Codigos: `400` (id/JSON invalido), `401` (sem sessao), `403` (sem permissao),
`404` (inexistente), `405` (metodo errado num caminho que existe, com
`Allow`), `409` (o estado nao permite, como escrever em relatorio fechado),
`413` (corpo JSON acima de 100 KB), `422` (falha de validacao), `429` (limite de requisicoes), `500` (erro
interno), `503` (dependencia fora do ar).
