# Exportacao

Planilha do procedimento (`planilha.service.js`), Anexo I
(`anexo-i.service.js`), PDF consolidado (`pdf-consolidado.service.js`) e PDFs
por categoria (`pdf-por-categoria.service.js`).

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
- **Adiantamento nulo nao vira zero**: C3 recebe "Não informado" e o saldo
  (C4, formula no template) recebe "—". Com o zero, o formulario assinado
  mostrava o total inteiro como saldo devido. Ao trocar pelo oficial, confira
  onde ficam essas duas celulas.

## Planilhas

- So `confirmed` entra nas duas saidas Excel (issue 29). O resto vai contado
  no bloco "Fora da prestação", sem entrar em soma.
- A planilha segue o procedimento (issue 53): `Despesas`, `Resumo` e
  `Observações`, e as abas por tipo da issue 29 ao lado, na ordem do enum —
  ordenar por valor mudaria o layout de um mes para o outro.
- **`Despesas` e a fonte, e o `Resumo` e todo formula sobre ela**
  (`COUNTIF`/`SUMIF` nas colunas de letra fixa), nunca numero repetido. As
  cinco colunas do procedimento vem primeiro, na ordem dele, e as de apoio
  (Documento, Conferencia) depois.
- No `Resumo`, cidade se agrupa **sem caixa**: o `COUNTIF` do Excel nao
  distingue, e uma linha para "ITAPIPOCA/CE" e outra para "Itapipoca/CE"
  somariam a mesma despesa duas vezes — a conferencia acusaria DIVERGÊNCIA
  numa planilha certa.
- O bloco de conferencia compara as somas **no centavo** (`ROUND(...,2)`), e
  ha um teste por soma que desfaz so ela: o primeiro teste so desfazia o
  tipo, e tirar a comparacao da cidade passava.
- Linha que pede atencao: cor **e** a classe escrita na coluna Conferencia.
- `Observações` repete o texto da conferencia (`validateReport`) como a tela
  o mostra, sem acento e em centavos: as duas nunca contam historias
  diferentes.
- Colunas da aba de tipo: **Data, Local, Cidade, Valor**. Local e cidade saem
  do cadastro do emitente, ou do papel quando nao ha cadastro.
- A formatacao e a da planilha que quem confere ja conhece: cabecalho branco
  sobre `FF1F3864`, zebra `FFF2F2F2`, bordas, TOTAL mesclado e invertido,
  cabecalho congelado e autofiltro. Nenhuma cor carrega informacao sozinha. Ha
  teste de cada item — formatacao sem teste some na proxima refatoracao.
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
  passar um subtotal apontando para rotulo nenhum. O avaliador cobre so as
  funcoes que a planilha usa; funcao nova entra nele junto.

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

## PDFs por categoria

- A pagina e **copiada** (`copyPages`), nunca embutida: o procedimento manda
  "nunca rasterizar, nunca recortar", e embutir criaria uma pagina nova sem o
  `/Rotate`. O giro da revisao vai no `/Rotate` (`setRotation`), que e
  atributo da pagina. Ha teste de pixel contra a origem em cada rotacao.
- **Toda pagina em exatamente um arquivo**: duplicata vai junto, sem categoria
  vai em `sem-categoria`. Ha teste de cobertura com status e categorias
  misturados.
- Arquivos numerados em sequencia, na ordem das abas da planilha: um numero
  pulado parece arquivo faltando.
- As paginas de um mesmo arquivo de origem saem numa copia so, e dividem fonte
  e imagem em vez de repeti-las por pagina.
