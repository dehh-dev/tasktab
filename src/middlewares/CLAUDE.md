# Protecoes HTTP

`helmet()` com a politica padrao, `no-store.js` e os limitadores de
`rate-limit.js`. `authenticate.js` identifica a sessao e **nao barra
ninguem**; quem barra e `requireScope` / `requireAuth` (`authorize.js`).

- **Nao afrouxe a CSP.** Front e back estao sempre na mesma origem; se algo
  quebrou sob `'self'`, o problema e o recurso externo. A imagem do cupom vem
  de endpoint proprio — **nao** libere `blob:` para preview no cliente.
- **Nenhuma resposta de `/api` fica no cache do navegador** (`no-store.js`, o
  primeiro da cadeia). O cache guarda pela URL e nao sabe de sessao: a imagem
  com `max-age` continuava aparecendo depois do logout, ate para outra conta.
  A unica excecao e a imagem: `private, no-cache`, revalidada pela sessao e
  pela posse a cada uso, com ETag e 304. **Nao volte a por `max-age`.** O 304
  leva os mesmos headers do 200, senao herda o `no-store`.
- Um teto para toda requisicao (`app.js`) e **um teto de escrita por familia
  de rota** (`routes/index.js`): o geral para `/auth`, `/users` e `/tasks`, e
  o `batchWriteLimiter` para `/reports`, `/receipts` e `/merchants`, **no
  lugar** do geral e nunca somado — revisar 30 cupons sao dezenas de escritas
  de uma pessoa so. Os dois rodam antes do `authenticate`, para recusar sem
  consultar a sessao.
- `POST /api/auth/login` usa o `authLimiter`, o mais apertado: e a unica rota
  onde repetir com outro valor serve a quem nao deveria estar aqui.
- Em teste o limitador fica desligado; `RATE_LIMIT_ENABLED=true` o religa, e
  `tests/api/rate-limit.test.js` sobe uma instancia propria
  (`startApiInstance`) com tetos baixos. Mexeu nos tetos? E la que se confere.
