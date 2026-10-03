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

## Datas

A data "andava" um dia, e dois pontos resolvem:

1. `database.js` registra um type parser para o OID 1082 (`DATE`) que devolve
   a string crua `YYYY-MM-DD`. Sem ele o `pg` cria um `Date` na timezone local.
2. `web/src/constants.js` formata a data com `split('-')`, sem `Date`.

Em `due_date`, `issued_at` ou qualquer `DATE`, **nao introduza
`new Date(isoString)`**.
