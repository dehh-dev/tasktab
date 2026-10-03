# Erros e logs

## Erros

Toda resposta de erro nasce de uma classe de `errors.js` que estende
`BaseError` e serializa via `toJSON()`:

```json
{ "name": "...", "message": "...", "action": "...", "status_code": 000 }
```

| Classe                  | Status | Quando                                           |
| ----------------------- | ------ | ------------------------------------------------ |
| `BadRequestError`       | 400    | id invalido, JSON malformado, corpo nao-objeto   |
| `NotFoundError`         | 404    | recurso ou rota inexistente                      |
| `UnauthorizedError`     | 401    | sem sessao valida                                |
| `ForbiddenError`        | 403    | ha sessao, mas ela nao alcanca a operacao        |
| `MethodNotAllowedError` | 405    | metodo errado em caminho que existe (`Allow`)    |
| `ConflictError`         | 409    | estado nao permite: escrita em relatorio fechado |
| `ValidationError`       | 422    | falha de validacao; carrega `details`            |
| `TooManyRequestsError`  | 429    | teto de requisicoes estourado                    |
| `ServiceError`          | 503    | dependencia fora do ar (banco)                   |
| `InternalServerError`   | 500    | qualquer erro inesperado                         |

- Erro esperado: classe especifica, com `statusCode`, `message` e `action`. O
  `action` diz o que fazer a seguir — a interface o exibe abaixo da mensagem,
  entao nunca fica vazio.
- Erro inesperado: deixe estourar. O `onErrorHandler` o converte em
  `InternalServerError` (500), sem vazar detalhe.
- `catch` so pega o caso que sabe nomear (`ENOENT` na leitura do PDF,
  `InvalidPDFException` ao gerar a imagem) e relanca o resto. Um `catch` largo
  ja transformou permissao de disco e template ausente em "reenvie o arquivo",
  sem nada no log. Ha teste de cada caso.
- Erro nosso com 5xx (`ServiceError`) passa como esta e e logado; a mensagem
  publica dele ja nasce segura.
- Sempre repasse a causa: `new InternalServerError({ cause: error })`.
- `ValidationError` sempre popula `details` com `{ field, message }`: e o que
  leva cada erro ao campo certo do formulario, sem perder o que foi digitado.
- `controller.js` pluga `onNoMatchHandler` e `onErrorHandler` via
  `controller.errorHandlers`. O de erro precisa dos 4 argumentos
  (`error, req, res, next`) — e a assinatura que o marca como handler de erro.
  **Nao remova o `next`.**

## Logs

`pino` via `logger.js`: `logger` fora de requisicao, `req.log` dentro dela (ja
com o `request_id` e, depois do `authenticate`, o `user_id`).

- Todo 5xx devolve `request_id` no corpo; os 4xx nao — ha teste com o corpo
  exato do 404.
- Em teste o logger e `silent`.
- Os serializers sao enxutos de proposito: o padrao do `pino-http` despeja
  todos os headers em cada linha.
- O `redact` cobre `req.headers.cookie` e `authorization`, mas log manual
  escreve o que mandarem. Para investigar acesso, logue o `user_id`; uma
  extracao, o `id` do comprovante.
