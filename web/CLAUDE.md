# Interface (React 19 + Vite)

Tela unica, sem router e sem biblioteca de estado: o estado vive no `App`. CSS
proprio em `src/styles.css`, sem framework. ESM com JSX — o backend e que e
CommonJS.

- Em dev o Vite faz proxy de `/api`; em producao o Express serve `web/dist` com
  fallback de SPA, so com o build no disco e fora do teste. Mesma origem
  sempre: **nao adicione CORS**.
- Paleta **GitHub Dark Colorblind**: acao destrutiva e laranja, e os status
  evitam o eixo verde/vermelho. **Cor nunca e o unico canal** — todo badge leva
  o texto do status.
- `src/constants.js` espelha os enums do banco (`task_status`,
  `expense_category`, `receipt_status`, `report_status`) e os `LEVELS` da
  conferencia. Mudou la, mude aqui.
- Data `YYYY-MM-DD` se formata com `split('-')`, nunca com `Date`.

## Sessao

- `App.jsx` pergunta `GET /api/auth/me` ao abrir; sem sessao, `LoginScreen`.
  Abas e botoes de escrita seguem os escopos (o auditor nao ve "Novo
  relatorio"), mas isso e conveniencia: quem autoriza e o servidor.
- Um 401 no meio do uso volta ao login com o motivo: o `request` de `api.js`
  avisa por `onSessionLost`, menos nas rotas de `/api/auth`, que tratam o
  proprio 401 (no login ele e senha errada). O App so escuta enquanto ha
  alguem logado: quem clica em "Sair" nao recebe aviso.
- Sem escrita, a revisao e somente leitura: campos num `fieldset`
  desabilitado, sem "Confirmar", "Deletar" nem "Marcar como duplicata"
  (`e2e/expenses-readonly.spec.js`).

## Componentes

- `ConfirmDialog` usa `<dialog>` com `showModal()`. **Nao volte para uma `div`
  com `aria-modal`**: era uma promessa de isolamento que o browser nao
  cumpria. O `close()` roda em `useLayoutEffect` — mais tarde, o no ja saiu do
  DOM e o foco nao volta. Conteudo alem da mensagem vai em `children`, como a
  checagem final ao fechar o relatorio.
- Atalho que vale com o foco em qualquer lugar (`ReceiptReview`: `Escape`,
  `Alt+seta`) vai em `document.addEventListener` dentro de `useEffect`, nunca
  em `onKeyDown` de `div`: depois de uma remontagem o foco fica fora da
  subarvore e o atalho cala sem aviso.
- Componente de "um item de cada vez" (`ReceiptReview` por `receipt.id`,
  `TaskForm` por `editing.id`) leva `key={item.id}` no pai, senao zoom, valor
  digitado e imagem carregada vazam de um item para o proximo.
- Enquanto ha pagina em processamento, a `ReportDetail` consulta **so a
  lista**; relatorio e conferencia recarregam uma vez, quando nada mais
  processa. Buscar os tres a cada 1,5 s esgotava o teto de leitura em cinco
  minutos de OCR. Ciclo que falha mostra o motivo e tenta de novo com espera
  crescente.

## Imagem do comprovante

- `.review__image-scroll` e flex com `align-items: flex-start`: com `stretch` a
  imagem era esticada e o cupom deformava. `height: auto` no `.review__image` e
  o par obrigatorio do `max-width`.
- O zoom e `transform: scale()` com `transform-origin: top left`, **nunca
  `center`**: o overflow so rola para a direita e para baixo, e um terco do
  cupom ficava inalcancavel a 300%. Ha spec medindo o recorte.
- **Atalhos de recorte** (`cropShortcuts` em `ReceiptReview.jsx`, issue 46):
  retangulos em fracao da pagina, aplicados como zoom e rolagem sobre a mesma
  imagem. A proporcao da imagem ja girada escolhe os atalhos — paisagem e
  recibo manuscrito (Valor, Data), retrato a partir de 1,6:1 e cupom (tres
  fatias com 3% de sobreposicao), e o Cabecalho vale para qualquer pagina.
  Zoom igual ao atual rola na hora; senao, depois que o zoom novo pinta.
- Girar (issue 43) muda a URL da imagem com `?rotacao=`, para o navegador nao
  reaproveitar a copia de antes.
