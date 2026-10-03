# E2E (Playwright)

`npm run test:e2e` sobe a API de teste e um Vite proprio na **5174**
(`WEB_PORT`), com proxy para a API de teste via `API_URL`
(`playwright.config.js`). Na 5173 o `reuseExistingServer` pegava o Vite de um
`npm run dev` aberto, ligado ao banco de dev: **nunca** deixe a suite tocar o
banco de desenvolvimento. Uma spec so: `npm run test:e2e -- arquivo.spec.js`.

- O arranjo passa pela **API publica** (`helpers.js`), nunca pelo banco: um
  pool do `pg` no worker do Playwright prende o processo no fim da suite.
- Comprovante de preparo vai por `addReceipts`, que so devolve com a extracao
  pronta. Subir pela tela fica para as specs cujo assunto e o upload: esperar
  o poll da `ReportDetail` custava quase 2 s por spec. `sendReceipts` volta
  com a extracao ainda rodando, so para `expenses-polling.spec.js`.
- Locators acessiveis (`getByRole`, `getByLabel`), escopados ao formulario
  (`page.locator('form.form')`): "Status" casa tambem com o grupo de filtros,
  e "Cancelar" existe no form e no dialogo.
- Sem mock: a unica excecao esta anotada em `form-validation.spec.js`. Queda de
  rede nao e excecao — `context.setOffline(true)` derruba a rede de verdade.
- Na primeira execucao: `npx playwright install chromium`.
