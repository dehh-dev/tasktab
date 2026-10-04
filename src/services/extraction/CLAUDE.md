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
  linha — num PDF escaneado ela e a margem do papel.
- Nome e cidade do papel ficam no comprovante (`issuer_name`, `issuer_city`,
  issue 42), com ou sem CNPJ; a cidade vai tambem para `merchants.city`. Lista
  e saidas usam o cadastro quando ha e o papel quando nao ha, num lugar so
  (`ISSUER_NAME` / `ISSUER_CITY` em `receipt.model.js`).
- Hora e numero do documento chegaram a ser extraidos e foram **removidos** no
  uso real: ninguem os consultava. Voltam por pedido, nao por completude.
- **Manuscrito fica de fora**, por decisao consciente: o Tesseract nao le
  caneta sobre formulario.
- `extractFuelLines` le litros, preco e total da linha de combustivel; a regra
  que os usa esta em `src/services/validation/CLAUDE.md`.

## Chave de acesso e CNPJ

- O CNPJ confiavel e o das posicoes 7 a 20 da **chave**, nao o do texto: o
  cupom traz tambem o da credenciadora do cartao.
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
  relatorio faz deste a duplicata, por cima de um "confirmar".
- Sem chave, o `PATCH` aceita `cnpj` e vincula pelo mesmo `classify`;
  `cnpj: null` desvincula, porque o CNPJ do texto pode ser o da credenciadora.
  Com chave, o CNPJ vem dela, e um digitado e `422`.

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
- O worker do OCR sobe com `errorHandler` (`ocr.service.js`). **Nao tire**:
  sem ele o tesseract.js relanca o erro do worker fora de qualquer promise, e
  a API inteira cai. A falha na subida (idioma que nao carrega) e rejeitada a
  mao, porque o `createWorker` a engole e ficaria pendente com a fila parada
  atras dele. Ela fica guardada ate o processo reiniciar, com um `error` no
  log, e as paginas sem texto seguem para a revisao. O teste sobe uma
  instancia com idioma inexistente e paginas em branco, sem pagar o
  Tesseract.
