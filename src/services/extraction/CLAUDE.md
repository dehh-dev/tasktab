# Extracao

Cascata **texto → QR → OCR** (`pipeline.service.js`). Pagina sem camada de
texto util desce para o OCR; o que nem o OCR le fica em `needs_review` sem
origem. **Nada e confirmado sozinho**: a extracao troca digitar por conferir,
nao por deixar de olhar.

## Leitura

- `normalize.js` devolve **`null`** quando nao reconhece a entrada. Nunca
  `NaN`, nunca `0` — zero e plausivel e passaria despercebido ate a
  conferencia.
- `extractTotal` e **ancorado em palavra-chave**. Nunca "o maior numero da
  pagina": chave de acesso, CNPJ e telefone sao maiores que qualquer refeicao.
- `extractDate` tambem e ancorado, e **prefere a linha de autorizacao**: num
  cupom real o OCR errou a data do equipamento, a primeira data da pagina
  venceu, e agosto virou junho numa prestacao assinada. A autorizacao e
  carimbo do SEFAZ.
- **Ancora nao atravessa quebra de linha.** `\s*` e `\s+` engolem o `\n`: o
  cabecalho "Valor unit. Valor total" colou no codigo do primeiro item e o
  total virou R$ 1,00 no lugar de R$ 165,00. Use busca por linha ou
  `[^\S\n]*`.
- `extractLooseTotal` e um segundo passe, para a linha em que o OCR sujou o
  espaco entre a ancora e o numero. Entra com confianca 0.3, que faz o
  comprovante chegar destacado na revisao. **Nao junte os dois passes** — um
  palpite passaria por leitura.
- O nome do emitente vem da **razao social colada no CNPJ**, nao da primeira
  linha — num PDF escaneado ela e a margem do papel. A linha do CNPJ e lida
  tambem quebrada pelo OCR (`21 .417.280/0001-08`, `GNPJ`, `CNP)`), so com
  digitos. Adaptador de emitente unico declara `issuer` (a Uber), que vale
  **depois** da razao social: "Pedido via Uber Eats" nao faz da Uber quem
  vendeu. A linha de cima do CNPJ so vale quando a dele traz **so data e
  hora, ou nada** (maquininha), e se nao for endereco (`R.`, `Tv.`, `End.:`),
  cidade ou titulo do DANFE — o nome vai para o cadastro do emitente. Com
  `IE: ...` ou sujeira ao lado do CNPJ, fica o topo.
- **Maquininha nao imprime "total"**: `DEBITO R$ 146,50` e `VALOR: 96,53` sao
  `CARD_ANCHORS`, um **terceiro passe** (`extractCardTotal`) que so roda
  quando o estrito e o tolerante nao acharam ancora de total. Dentro de
  `TOTAL_ANCHORS` eles venciam o total sujo da NFC-e e saiam com a confianca
  dela: paga em dinheiro, "VALOR: 300,00" e o entregue, com troco.
  Debito/credito so com `R$`: "Cartao de Debito 77,60" e a linha de
  pagamento da NFC-e.
- `extractDate(text, { period })`: com a chave validada, a data lida que
  discorda do mes dela da lugar a **gemea** — outra data do papel, no mes da
  chave e no mesmo dia (`19/10/2006` → `19/10/2026`). Sem o mesmo dia, uma
  garantia ou vencimento do mes trocaria a emissao e calaria a `chave_mes`.
  **Ela desempata, nao inventa**: sem gemea, a resposta e a de sempre e a
  `chave_mes` aponta.
- Item em duas linhas (`001 765 CITRUS LATA` / `1 UN X 8,00 8,00`) e lido
  pela segunda (`ITEM_DETAIL_LINE`), com o `1` lido como `l`, `I` ou `|`.
  Entre o preco unitario e o total, espaco ou `=` obrigatorio: sem ele, a
  linha sem total (`1 UN X 18,00`) era partida dentro do preco.
  `extractItemCount` da a contagem impressa e o maior numero de ordem lido
  (`003 752 BUFFET`, com letra na descricao — `085 3333-4444` e telefone),
  que a regra da soma usa para nao acusar com item faltando.
- A proposta inteira vai tambem para `extracted` (jsonb), na mesma escrita
  das colunas: os mesmos nomes, mais `parser` e `cnpj`. Pagina sem leitura
  grava `{ parser: null, extraction_source: null }` — nulo e comprovante
  anterior a coluna. A revisao nao a toca: e a base da avaliacao
  (`scripts/evaluate-extraction.js`).
- **Mudou a extracao, meca antes e depois**:
  `npm run extraction:evaluate -- --report <id> --reextract` le os PDFs de
  novo com `proposeFile`, que nao grava nada nem cadastra emitente
  (`classify` com `register: false`). `proposePage` e o mesmo caminho do
  upload, sem a escrita: nao duplique a cascata num caminho so da avaliacao.
  Relatorio 93 e corpus de Itapipoca sao a base.
- A pagina e **renderizada uma vez** (`pipeline.service.js`) e o PNG serve ao
  QR e ao OCR, na mesma `RENDER_SCALE`. Eram duas renderizacoes a 3x por
  pagina escaneada. A falha nao fica guardada: o OCR renderiza de novo.
- Nome e cidade do papel ficam no comprovante (`issuer_name`, `issuer_city`,
  issue 42), com ou sem CNPJ; a cidade vai tambem para `merchants.city`. Lista
  e saidas usam o cadastro quando ha e o papel quando nao ha, num lugar so
  (`ISSUER_NAME` / `ISSUER_CITY` em `receipt.model.js`).
- `readPage` aceita `normalise: false`, que so o recibo assinado do RPA usa:
  normalizada, a pagina com linha de assinatura se perde no Tesseract. O
  cupom segue normalizado; trocar para ele pede medir antes e depois.
- Hora e numero do documento chegaram a ser extraidos e foram **removidos** no
  uso real: ninguem os consultava. Voltam por pedido, nao por completude.
- **Manuscrito fica de fora**, por decisao consciente: o Tesseract nao le
  caneta sobre formulario.
- `extractFuelLines` le litros, preco e total da linha de combustivel, e
  `extractDiscounts`, as linhas que comecam por desconto; a regra que os usa
  esta em `src/services/validation/CLAUDE.md`.

## Chave de acesso e CNPJ

- O CNPJ confiavel e o das posicoes 7 a 20 da **chave**, nao o do texto: o
  cupom traz tambem o da credenciadora do cartao.
- A chave impressa e procurada **depois do OCR** (`keyFromText`), no texto da
  pagina, digital ou lido da imagem: na foto com o QR borrado ela e a unica,
  e e ela que escolhe a data. Antes era procurada so antes do OCR, numa
  pagina escaneada ainda sem texto.
- Chave que nao fecha o DV mod-11 e **descartada** — nao ha meio termo num
  identificador com verificador.
- **CNPJ alfanumerico** (julho de 2026): os 12 primeiros caracteres do CNPJ, e
  as posicoes 7 a 18 da chave, aceitam `A-Z`; nos DVs cada caractere vale
  `ASCII - 48`. **Nao volte a limpar com `\D`**: a letra sumia e a chave era
  descartada sem aviso. Achado no texto, candidato com letra so vale se fechar
  o DV (`plausible`) — "SUPERMERCADO12" tem o formato de um CNPJ.
- A chave que a extracao nao achou se digita na revisao (issue 41): o `PATCH`
  aceita os separadores da impressao e recusa com `422` a que nao fecha o DV.
  Digitada, vale o mesmo que a lida do QR (`typed-issuer.service.js`): vincula
  o emitente pelo `classify`, a categoria do cadastro substitui um palpite
  (nunca uma escolha de pessoa), e a mesma chave em outro comprovante do
  relatorio faz deste a duplicata, por cima de um "confirmar". A tela manda a
  categoria inteira ao confirmar: **o palpite devolvido igual continua
  palpite**, senao o cupom de posto saia confirmado como Alimentacao.
- Sem chave, o `PATCH` aceita `cnpj` e vincula pelo mesmo `classify`;
  `cnpj: null` desvincula, porque o CNPJ do texto pode ser o da credenciadora.
  Com chave, o CNPJ vem dela, e um digitado e `422` — a chave de depois do
  PATCH: o que remove a chave (`access_key: null`) pode trazer o CNPJ.

## Categoria

- As cinco do procedimento (issue 40): Alimentacao, Taxi/Locomocao
  (`transporte` no banco), Combustivel, Lavanderia e Outros, mais
  `nao_classificado`. `hospedagem` e `estacionamento` sairam do enum a pedido
  de quem usa.
- Tres degraus, nesta ordem: **cadastro do emitente** (decisao humana, vale
  sempre), **palpite por palavra-chave** no nome (`category-guess.js`) e o
  **piso `alimentacao`** (`DEFAULT_CATEGORY`) — eram 21 de 23 lancamentos no
  relatorio real que motivou o ajuste.
- Fora do cadastro, a categoria grava `category_guessed = true`, e a revisao a
  destaca ("Sugerida pelo nome do emitente"); editar a categoria ou confirmar
  zera a marca. **Palpite nunca sobrescreve cadastro** — ha teste dos dois
  lados.
- Adivinhar pelo nome ja foi proibido, e voltou a pedido de quem usa: num lote
  de 30 cupons, corrigir os poucos errados custa menos que classificar tudo. O
  risco era adivinhar **sem dizer que adivinhou** — se a marca sair da tela, a
  regra antiga volta a ser a certa.
- `guessCategory` devolve `null` sem indicio no nome; o piso e aplicado
  **fora**, no `classify`, para mudar um sem mexer no outro.
- `nao_classificado` vira `NULL` no comprovante: e ausencia de decisao, e o
  enum gravado faria a linha parecer classificada nos subtotais.

## Fila e testes

- O processamento e **assincrono**, numa fila em processo (`queue.js`); o
  upload responde `202`. Teste que afirme conteudo extraido passa por
  `waitForProcessing`, e o `tests/setup.js` drena a fila antes de truncar —
  senao o trabalho de um teste escreve no banco ja limpo do seguinte.
- A duplicata exata e decidida antes de a pagina sair de `processing` (ver
  `src/services/validation/CLAUDE.md`).
- Os casos de parsing sao testes puros em `tests/services/`
  (`npm run test:pure`). A leitura de PDF e por integracao: o `unpdf` usa
  import dinamico, que a VM do Jest recusa sem flag.
- A cascata inteira e conferida num upload so, com um cupom digital e um
  escaneado. O Tesseract e a parte mais cara da suite: **nao suba outro
  escaneado** para provar um pedaco que esse teste ja prova.
- **Nada de CDN em tempo de execucao.** O `.wasm` do zxing vem do pacote
  (`zxing.js`, que leitura e fixture usam) e o idioma do Tesseract, de
  `@tesseract.js-data/por` (`OCR_LANG_PATH`), com `cacheMethod: 'none'`. Os
  dois buscavam no jsDelivr na primeira pagina de cada processo: sem rede o QR
  sumia, o OCR derrubava a API e a suite nao rodava. Nao chame
  `require('zxing-wasm')` direto.
- O worker do OCR sobe com `errorHandler` (`ocr.service.js`). **Nao tire**:
  sem ele o tesseract.js relanca o erro do worker fora de qualquer promise, e
  a API inteira cai. A falha na subida (idioma que nao carrega) e rejeitada a
  mao, porque o `createWorker` a engole e ficaria pendente com a fila parada
  atras dele. Ela fica guardada ate o processo reiniciar, com um `error` no
  log, e as paginas sem texto seguem para a revisao. O teste sobe uma
  instancia com idioma inexistente e paginas em branco, sem pagar o
  Tesseract.
