# Prestacao de contas — regras do dominio

`reports` / `receipts` / `merchants`. Extracao, conferencia e exportacao tem
`CLAUDE.md` proprio em `src/services/`; backlog e decisoes ficam em
`docs/backlog-prestacao-de-contas.md`.

- **Dinheiro e `integer` em centavos.** Somar float produziu
  `219.98000000000002` no caso que originou o projeto; reais so na
  exportacao.
- O upload confere **magic bytes** (`%PDF`), nao extensao, e grava o arquivo
  com o proprio SHA-256 como nome. Reenviar o mesmo arquivo responde `200` com
  o que ja existe — e idempotente, nao erro de unique.
- PDF ilegivel vira uma linha `failed` com o motivo em `raw_text`: um arquivo
  ruim nao derruba o lote.
- Confirmar exige `issued_at`, `amount_cents` e `category`, conferidos sobre o
  registro ja gravado. Duplicata continua listada e fica fora do somatorio.
- **O total da tela soma o que esta em revisao; a categoria, so o
  confirmado** (`summarizeByReport`). Decisao de quem usa: a categoria do que
  esta em revisao e palpite. O alerta de adiantamento compara esse mesmo
  total; planilha e Anexo I so levam o confirmado.
  `GROUPING()` separa a linha de total do grupo sem categoria — os dois chegam
  com `category` nulo, e qual valia dependia da ordem das linhas.
- **Reprocessar o que uma pessoa ja conferiu** (confirmado, ou
  `extraction_source = 'manual'`) exige `{ "discard_review": true }`, senao
  `409` — a extracao regrava data, valor e categoria por cima. A tela pergunta
  antes.
- **Adiantamento nulo e "nao informado"; zero e "nao houve"** (issue 44): sem
  saber qual dos dois nao ha saldo, e a conferencia pede o nulo como pendente.
  Os relatorios anteriores a migration ficaram com o zero que tinham. O
  relatorio tem tambem `main_city`, base das regras da viagem (issue 51).
- **Relatorio `closed` e somente leitura**, ate para o dono: escrita responde
  `409`, e o unico PATCH aceito e `{ "status": "open" }`. A trava fica no
  `loadReport`/`loadReceipt`, **depois** da posse: o fechado alheio continua
  dando 404. Leitura e exportacao seguem liberadas.
- **A checagem final** (`final-check.service.js`, issue 57) e mostrada antes
  de fechar e **nao bloqueia**: o PATCH que fecha nao depende dela. Ela
  confere as entregas de verdade — somas pelos grupos da planilha
  (`conferenceTotals`) contra o total do banco, paginas pelos PDFs por
  categoria montados (`buildCategoryPdfs`). Nao troque por uma conta paralela:
  ela concordaria com o banco e esconderia o grupo que perdeu linha.
- As rotas usam o `batchWriteLimiter`, nao o teto geral de escrita.
- **O giro e do comprovante, nao do arquivo** (`receipts.rotation`, quarto de
  volta): vale para a imagem, o OCR do reprocessamento e o PDF consolidado.
  Girar **nao** marca a origem como manual — e o passo antes de reprocessar, e
  com a marca o reprocessamento pediria para descartar uma conferencia que
  ninguem fez.
- A imagem do cupom (`receipt-image.service.js`) sai a **4x em WebP q92**: os
  PDFs reais sao digitalizacoes a ~257 ppi (3,57x os pontos), e a 3x em PNG
  saia menor que o original e com quatro vezes mais bytes. Acima de 4x so
  haveria interpolacao. O ETag inclui o giro. A escala do QR (`qr.service.js`,
  3x) mira o zxing, nao o olho: nao amarre as duas.

## Retencao dos arquivos

- O arquivo morre com a linha que o referencia (`retention.service.js`). Sem
  TTL nem varredura por idade: expirar sozinho destruiria evidencia de um
  relatorio ainda questionavel.
- A exclusao e **contada por referencia** (`Receipt.countByHash`): um PDF
  atende todas as paginas dele e outros relatorios com o mesmo upload. **Nao
  troque por `unlink` direto.** Ha teste dos dois lados.
- `discardOrphans` roda **depois** de a linha sair do banco. No
  `report.destroy` os arquivos sao levantados **antes**, porque a cascata da
  FK leva os comprovantes.
- Falha ao apagar o arquivo nao derruba a resposta — a linha ja saiu. Fica um
  `warn`; `ENOENT` e silencioso.
- `raw_text` nao e anonimizado na confirmacao, de proposito: a regra que soma
  os itens le dele, e confirmar e reversivel. Ele nao e editavel: as colunas
  da revisao (`UPDATABLE_COLUMNS`) e as da extracao (`EXTRACTION_COLUMNS`)
  ficam separadas.
