# Configuracao, bancos e datas

- `env.js` carrega `env.<NODE_ENV>` — **sem ponto no inicio**:
  `env.development` e `env.test`, versionados de proposito (valores locais).
  O dotenv nao sobrescreve o que ja esta em `process.env`, entao producao
  injeta pelo ambiente; nao existe `env.production`.
- Sessao: `SESSION_TTL_HOURS` (padrao 168), `SESSION_COOKIE_NAME` e
  `SESSION_COOKIE_SECURE`. O `Secure` so liga sozinho em producao — em dev e no
  E2E o acesso e por `http://localhost`, e o cliente descartaria o cookie.
- Dev usa `tasktab_development`; testes, `tasktab_test`, criado pelo
  `docker/initdb/` so na **primeira** subida do volume. Se o de teste sumir:
  `npm run services:down -- -v` e subir de novo.
- O `env.test` traz `PGOPTIONS=-c synchronous_commit=off`, que o `pg` le
  sozinho: o commit do teste nao espera o fsync (~7 ms cada no volume do
  Docker). Nao leve para o `env.development` — la ha dado que importa.
- `db.rolledBack(work)` e a previa de uma escrita: BEGIN, a conta e ROLLBACK
  sempre, mesmo quando ela termina. A previa do `PATCH` do lancamento do RPA
  usa para ver o banco como ficaria, com as constraints de verdade.
- **Dentro de `db.transaction`, uma consulta por vez**: o `client` e uma
  conexao so, e `Promise.all` nele o pg 8 enfileira com um DeprecationWarning
  (o 9 deixa de aceitar). Fora da transacao, pelo pool, o paralelo vale. A
  emissao de RPA fazia isso; o teste dela sobe uma API com
  `--throw-deprecation`, que cai com o aviso.
- Arquivo enviado: dev em `uploads/`, testes em `uploads-test/`
  (`UPLOAD_DIR` do `env.test`). A retencao conta referencias no banco do
  proprio ambiente; com um diretorio so, um podia apagar o arquivo do outro.

## Datas

A data "andava" um dia, e dois pontos resolvem:

1. `database.js` registra um type parser para o OID 1082 (`DATE`) que devolve
   a string crua `YYYY-MM-DD`. Sem ele o `pg` cria um `Date` na timezone local.
   O `date[]` (OID 1182, os feriados do lancamento do RPA) tem parser proprio
   pelo mesmo motivo: o padrao do array chamava o de data em cada item.
2. `web/src/constants.js` formata a data com `split('-')`, sem `Date`.

Em `due_date`, `issued_at` ou qualquer `DATE`, **nao introduza
`new Date(isoString)`**.
