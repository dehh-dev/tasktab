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

| Metodo   | Rota                                             | Descricao                     |
| -------- | ------------------------------------------------ | ----------------------------- |
| `GET`    | `/api/reports`                                   | Lista (filtro por `status`)   |
| `POST`   | `/api/reports`                                   | Cria                          |
| `GET`    | `/api/reports/:id`                               | Detalhe                       |
| `PATCH`  | `/api/reports/:id`                               | Atualiza                      |
| `DELETE` | `/api/reports/:id`                               | Remove (leva os comprovantes) |
| `POST`   | `/api/reports/:id/receipts`                      | Envia 1..N PDFs               |
| `GET`    | `/api/reports/:id/receipts`                      | Lista comprovantes com totais |
| `GET`    | `/api/receipts/:id`                              | Detalhe                       |
| `PATCH`  | `/api/receipts/:id`                              | Corrige campos na revisao     |
| `DELETE` | `/api/receipts/:id`                              | Remove                        |
| `GET`    | `/api/receipts/:id/image`                        | Pagina do comprovante (WebP)  |
| `POST`   | `/api/receipts/:id/reprocess`                    | Reenvia para a fila           |
| `GET`    | `/api/reports/:id/validation`                    | Alertas de conferencia        |
| `GET`    | `/api/reports/:id/export.xlsx`                   | Planilha do procedimento      |
| `GET`    | `/api/reports/:id/export/anexo-i.xlsx`           | Anexo I (Excel)               |
| `GET`    | `/api/reports/:id/export.pdf`                    | PDF consolidado               |
| `GET`    | `/api/reports/:id/export/pdfs-por-categoria.zip` | Um PDF por categoria, num ZIP |

Base: `/api/merchants` — o cadastro que da categoria ao comprovante.

| Metodo  | Rota                           | Descricao                       |
| ------- | ------------------------------ | ------------------------------- |
| `GET`   | `/api/merchants`               | Lista os emitentes cadastrados  |
| `POST`  | `/api/merchants`               | Cadastra um emitente            |
| `GET`   | `/api/merchants/:id`           | Detalhe                         |
| `PATCH` | `/api/merchants/:id`           | Atualiza (e a categoria padrao) |
| `GET`   | `/api/merchants/by-cnpj/:cnpj` | Busca pelo CNPJ lido da chave   |

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
`422` (falha de validacao), `429` (limite de requisicoes), `500` (erro
interno), `503` (dependencia fora do ar).
