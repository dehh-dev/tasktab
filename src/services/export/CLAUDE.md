# Exportacao

Resumo por tipo (`xlsx-por-tipo.service.js`), Anexo I (`anexo-i.service.js`) e
PDF consolidado (`pdf-consolidado.service.js`).

## Anexo I

- **O template `assets/anexo-i-template.xlsx` e SINTETICO**: o formulario
  oficial nao existe neste projeto. Antes de uso real, troque pelo oficial e
  confira `CATEGORY_COLUMN`. O mapa ja segue a versao 19 descrita pelo
  procedimento (O Passagens, Q Taxi/Conducoes, S Alimentacao, U Hospedagem,
  W Combustivel, X Outras; lavanderia e outros em X). O sintetico se regera
  com `npm run generate:anexo-i-template`.
- **Nunca abra-e-regrave o `.xlsx` com exceljs ou outra lib que reconstroi o
  arquivo**: foi assim que a lista suspensa de um template oficial se perdeu.
  `xlsx-cell-patch.js` troca a celula direto no XML; estilo, formula,
  `dataValidations` e `mergeCells` nunca viram objeto.
- O regex de `setCell` usa quantificador **preguicoso** nos atributos
  (`[^>]*?`). O guloso consome o `/` de uma celula autofechada e apaga a
  seguinte — ja aconteceu. **Nao volte para guloso.**

## Planilhas

- So `confirmed` entra nas duas saidas Excel (issue 29). O resto vai contado
  no bloco "Fora da prestação", sem entrar em soma.
- O resumo tem **uma aba por tipo** com lancamento, mais a aba `Resumo`, na
  ordem do enum — ordenar por valor mudaria o layout de um mes para o outro.
  As abas por tipo ficam tambem quando vier a planilha do procedimento
  (issue 53).
- Colunas da aba de tipo: **Data, Local, Cidade, Valor**. Local e cidade saem
  do cadastro do emitente, ou do papel quando nao ha cadastro.
- A formatacao e a da planilha que quem confere ja conhece: cabecalho branco
  sobre `FF1F3864`, zebra `FFF2F2F2`, bordas, TOTAL mesclado e invertido,
  cabecalho congelado e autofiltro. Nenhuma cor carrega informacao sozinha. Ha
  teste de cada item — formatacao sem teste some na proxima refatoracao.
- O valor de cada tipo no `Resumo` e **formula cruzando abas**
  (`SUM('Alimentação'!D2:D9)`), nunca numero repetido.
- **Toda formula leva o resultado guardado** (`formulaWithResult`), e o
  workbook marca `fullCalcOnLoad`: o exceljs grava formula sem valor, e a
  pre-visualizacao do WhatsApp e do Drive abria os totais em branco.
- Nome de aba em formula vai entre aspas simples, e o Excel recusa
  `: \ / ? * [ ]` e mais de 31 caracteres: use `sheetName` / `sheetRange`.
- **`nao_classificado` e `NULL` sao o mesmo grupo** (`categoryKey` em
  `labels.js`). Com rotulos diferentes, o valor entrava no total e em nenhum
  subtotal. **Nao volte a dar rotulo proprio ao `nao_classificado`.**
- Teste de planilha **resolve a formula contra as celulas**
  (`tests/helpers/xlsx-formula.js`): foi a comparacao de string que deixou
  passar um subtotal apontando para rotulo nenhum.

## PDF consolidado

- O carimbo fica numa faixa **nova**, criada ao embutir a pagina numa maior —
  nunca um retangulo desenhado por cima. Fisicamente nao cobre o cupom.
- A pagina e embutida **ja girada pelo `/Rotate` da origem**, somado ao giro do
  comprovante (`placement`): o `embedPdf` nao leva o `/Rotate`, e o cupom ja
  endireitado na origem voltava invertido. Ha teste de pixel das rotacoes.
- Ordem cronologica com `id` de desempate: nenhum parser le a hora.
- Bookmarks usam a API de baixo nivel do pdf-lib (`doc.context`).
- Teste de PDF gerado **nao chama `unpdf` dentro do Jest**:
  `tests/helpers/pdf-text.js` extrai num subprocesso `node`.
