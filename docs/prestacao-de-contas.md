# Prestacao de contas

Da viagem ao relatorio assinado: os cupons entram em PDF, a extracao le data,
valor e emitente, uma pessoa revisa, a conferencia aponta o que merece
atencao, e a exportacao sai no formato que quem assina ja usa. As rotas estao
em [api.md](api.md); o backlog e as decisoes, em
[backlog-prestacao-de-contas.md](backlog-prestacao-de-contas.md).

## Relatorio e upload

O upload aceita multipart no campo `files`, confere os **magic bytes** (`%PDF`)
em vez da extensao, e separa o arquivo em uma linha por pagina. O arquivo e
gravado com o proprio SHA-256 como nome, entao o mesmo PDF ocupa um lugar so no
disco; reenviar responde `200` com o que ja existe, e nao erro.

**Dinheiro e sempre inteiro em centavos.** Somar float produziu
`219.98000000000002` na conferencia manual que originou este projeto, e a
conversao para reais so acontece na exportacao.

No relatorio, `advance_cents` nulo e **adiantamento nao informado**, e zero e
**nao houve adiantamento** — sem saber qual dos dois, nao ha saldo a calcular.
`main_city` guarda a cidade principal da viagem.

A listagem de comprovantes devolve em `meta` o `total_cents` com tudo o que ja
tem valor, **menos duplicata** — inclusive o que ainda esta em revisao, para
quem revisa ver para onde a prestacao vai — e o `by_category` so com o
confirmado: a categoria de quem ainda nao foi conferido e palpite. A planilha
e o Anexo I so levam o confirmado, entao os totais batem quando o relatorio
esta conferido.

Relatorio **fechado** e somente leitura, ate para o dono: toda escrita
responde `409`, e o unico `PATCH` aceito e `{ "status": "open" }`. Leitura e
exportacao seguem liberadas — fechado e justamente o que se exporta.

## Extracao

Cascata em tres degraus: **texto do PDF → QR Code → OCR**. PDF com camada de
texto tem data e valor preenchidos no proprio upload, e o texto original fica
em `raw_text` para auditoria. Pagina sem texto util desce para o proximo
degrau.

A busca do total e **ancorada em palavra-chave** (`VALOR TOTAL`, `Total a
pagar`, ...). Pegar "o maior numero da pagina" acharia a chave de acesso, o
CNPJ ou o telefone — todos maiores que qualquer refeicao.

Cupom com QR Code tem a **chave de acesso** lida do codigo — o dado mais
confiavel que a extracao produz, porque o QR tem correcao de erro e a chave
ainda passa pelo digito verificador mod-11. Sem QR legivel, a chave e buscada
no texto impresso; em qualquer caso, chave que nao fecha o DV e descartada.
Quando nem o QR nem o texto a dao, ela pode ser **digitada na revisao**
(`access_key` no `PATCH /api/receipts/:id`, com ou sem espacos): o DV confere
a digitacao, o CNPJ dela vincula o emitente, e a mesma chave em outro
comprovante do relatorio faz deste a duplicata.

Comprovante sem CNPJ legivel — o recibo manuscrito — guarda **nome e cidade
como estao no papel** (`issuer_name` e `issuer_city`), lidos do texto quando ha
e corrigidos na revisao. E com eles que a lista, a planilha e o Anexo I saem
quando nao ha emitente cadastrado; sem chave, o `cnpj` digitado na revisao
vincula o emitente.

As categorias sao as cinco do procedimento: **Alimentacao, Taxi/Locomocao,
Combustivel, Lavanderia e Outros**. A de cada comprovante segue tres degraus:

1. o **cadastro do emitente**, que vale sempre — classificado um CNPJ uma vez,
   todo cupom seguinte dele ja entra classificado, sem IA nenhuma;
2. sem cadastro, um **palpite pelo nome** do emitente (posto, lavanderia,
   taxi...);
3. sem indicio no nome, o piso **Alimentacao**, que era 21 de 23 lancamentos
   no relatorio real que motivou a regra.

Palpite e piso chegam marcados na revisao como sugeridos, e nunca sobrescrevem
o cadastro.

Pagina **sem camada de texto** (cupom escaneado) desce para o **OCR**, o
degrau mais caro e menos confiavel da cascata: cerca de 0,2 a 0,5 s por pagina
depois do primeiro reconhecimento, mais uns 400 ms na primeira execucao, que
baixa 2,4 MB de dados de idioma para `OCR_CACHE_DIR`. Pagina de cabeca para
baixo se endireita na revisao: `rotation` no `PATCH`, em quarto de volta, vale
para a imagem, para o OCR do reprocessamento e para o PDF consolidado — o
arquivo original nunca e regravado.

**Recibo manuscrito fica de fora, por decisao consciente.** O Tesseract nao le
caneta sobre formulario, e insistir nisso e onde este tipo de projeto costuma
travar — esses vao direto para a revisao manual.

O upload responde **202**: as linhas ja existem, o conteudo delas ainda esta
sendo lido por uma fila em processo. O `status` progride
`pending → processing → needs_review | failed`, e `GET /api/health` informa
quantas tarefas ainda faltam. Um comprovante preso pode ser reenviado para a
fila com `POST /api/receipts/:id/reprocess`. O que uma pessoa ja conferiu —
confirmado, ou corrigido a mao — so volta para a fila com
`{ "discard_review": true }` no corpo, porque a extracao regrava data, valor e
categoria por cima; sem isso, a resposta e `409`.

A fila e **em processo** de proposito: sem servico novo, sem Redis. O gatilho
para trocar por BullMQ e **uso concorrente** — hoje um segundo processo nao ve
esta fila, e um reinicio perde o que estava na memoria. Como a unidade de
trabalho ja e "uma pagina, um registro", a migracao e local.

**Nada e confirmado sozinho**: a extracao troca digitar por conferir. Confirmar
um comprovante exige data, valor e categoria — a checagem considera o que ja
esta gravado, nao so o que veio no corpo.

## Conferencia

`GET /api/reports/:id/validation` devolve alertas com a **classe do
procedimento** em `level`, e o `meta` conta cada uma:

| `level`       | Quando                                                |
| ------------- | ----------------------------------------------------- |
| `pendente`    | falta algo para a prestacao ficar completa            |
| `decisao`     | o dado pode estar certo, e uma pessoa precisa decidir |
| `atencao`     | o dado provavelmente foi lido ou lancado errado       |
| `verificado`  | a ferramenta conferiu e resolveu sozinha              |
| `informativo` | nada a corrigir, so contexto para quem assina         |

Ate a issue 48 o campo era `severity`, com `erro` e `aviso`; o `meta` trazia
`erros` e `avisos`. **Alerta nao bloqueia nada** — quem assina a prestacao de
contas decide; a ferramenta aponta, nao veta.

Regras: soma dos itens contra o total impresso, litros vezes preco unitario no
combustivel, digito verificador da chave, mes, UF e tipo de emissao da chave
(contingencia), data dentro do periodo, valor fora da faixa historica do
emitente, comprovante incompleto, despesas acima do adiantamento, suspeita de
duplicata, valor repetido em documentos diferentes e documentos sem chave de
acesso somados a parte.

Recibo manuscrito, comanda e cupom de conferencia podem ser glosados, e o
procedimento manda somar e informar. Por isso os comprovantes **sem chave de
acesso valida** saem num alerta `informativo` do relatorio inteiro (regra
`nao_fiscal`), com a quantidade em `count` e a soma em `total_cents`. A base e
a do total da tela: o que esta em revisao entra, e a duplicata e o comprovante
sem valor ficam de fora. A NFC-e cuja chave nao foi lida tambem entra, ate
alguem digitar a chave na revisao.

As **regras da viagem** olham o relatorio inteiro:

| Regra                        | Classe      | Quando                                                                         |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `categoria_outros`           | decisao     | despesa em Outros: a finalidade precisa ser confirmada                         |
| `acima_do_padrao`            | decisao     | confirmado com 3x ou mais a mediana dos outros da categoria (ao menos 3 deles) |
| `fora_da_cidade`             | informativo | cidade do emitente diferente da cidade principal do relatorio                  |
| `duas_cidades`               | informativo | despesas em duas cidades no mesmo dia, um alerta por dia                       |
| `adiantamento_nao_informado` | pendente    | adiantamento nulo; zero e "nao houve" e nao pede nada                          |

O padrao da categoria so usa o que esta confirmado, porque a categoria do que
esta em revisao e palpite; Outros nao tem padrao. As cidades sao comparadas sem
acento nem caixa, e a UF so pesa quando as duas a trazem. Na prestacao de
Itapipoca, o padrao marcaria 3 dos 35 comprovantes de alimentacao, e as
cidades, 9 das 41 despesas e 3 dos 14 dias, todos de ida e volta.

Fora de escopo hoje, registrado para nao parecer esquecimento: a **coerencia
horaria** (jantar numa cidade e corrida em outra no mesmo horario) depende de
ler a hora do comprovante, que nenhum parser faz. A cidade e conferida so no
dia.

## Duplicatas

Duas notas com a **mesma chave de acesso** sao o mesmo documento e a segunda
colapsa sozinha, marcada com `duplicate_of_id`. Ela continua listada e vai no
PDF consolidado — so nao soma.

Mesma data com mesmo valor vira **alerta**, nunca exclusao. O risco e
assimetrico: deixar passar uma duplicata infla o total e a conferencia pega,
mas marcar como duplicata o que nao e some com uma despesa legitima. Foi assim
que R$ 48,60 sumiram da planilha que originou este projeto — dois almocos do
mesmo restaurante, mesmo valor, dias diferentes. Ha teste desse contraexemplo.

O caminho inverso tambem e avisado: mesmo valor em notas de **chave diferente**
sai na conferencia como `informativo`, em cada uma, com "nao apague nem marque
como duplicata". So a chave prova que sao documentos diferentes — data
diferente nao basta, porque a data pode ter sido lida errado.

## Exportacao

Tres saidas, cada uma com um proposito diferente:

| Rota                                       | Para que                                         |
| ------------------------------------------ | ------------------------------------------------ |
| `GET /api/reports/:id/export.xlsx`         | A planilha do procedimento, com as abas por tipo |
| `GET /api/reports/:id/export/anexo-i.xlsx` | O formulario do Anexo I preenchido               |
| `GET /api/reports/:id/export.pdf`          | Todos os cupons num PDF so, com indice e carimbo |

A **planilha** (`exceljs`, gerada do zero) segue o procedimento de prestacao
de contas e abre com tres abas:

- **`Despesas`**: um comprovante confirmado por linha, em ordem cronologica,
  com as cinco colunas do procedimento — Data, Local, Cidade, Tipo e Valor — e
  duas de apoio: Documento ("Com chave" ou "Sem chave") e Conferencia (a
  classe do alerta mais grave do comprovante). A linha que pede atencao ganha
  cor, e a classe vai escrita ao lado: a cor nunca e o unico canal. Sai
  deitada, na largura da folha, com cabecalho congelado, autofiltro e TOTAL
  GERAL.
- **`Resumo`**: todo por formula sobre `Despesas` (`COUNTIF`/`SUMIF`), nunca
  numero repetido — corrigir uma linha corrige o resto. Traz o total por tipo
  e por cidade; a **conferencia** (soma das linhas, total geral, soma por tipo
  e soma por cidade, com a celula `OK` ou `DIVERGÊNCIA`); o adiantamento e o
  saldo ("a devolver" ou "a receber", e nada de saldo quando o adiantamento
  nao foi informado); os documentos com e sem chave de acesso, o mesmo numero
  da conferencia da tela; e o que ficou "Fora da prestação".
- **`Observações`**: a conferencia do relatorio com o mesmo texto da tela,
  agrupada pela classe do procedimento, com data, local e valor do comprovante
  de cada alerta.

Depois vem uma aba por tipo de despesa **com lancamento**, na ordem do enum,
para dois relatorios da mesma pessoa sairem com o mesmo layout, cada uma com
**Data, Local, Cidade e Valor** e o total da aba. So entram comprovantes
`confirmed`, o mesmo criterio do Anexo I. O que ficou de fora (aguardando
revisao, duplicata, falha) aparece contado em "Fora da prestação", sem entrar
em soma nenhuma — planilha que so mostra o confirmado esconde de quem vai
assinar o trabalho que falta.

O **Anexo I** tambem so leva comprovantes `confirmed` — o unico status que
significa "revisado por uma pessoa". O relatorio nao e gerado do zero: o
template `.xlsx` e **remendado**, nao reconstruido. Bibliotecas que
abrem-e-regravam um `.xlsx` perdem o que nao sabem representar — foi assim que
a lista suspensa de um template oficial sumiu, na conferencia manual que
originou este projeto. Aqui `src/services/export/xlsx-cell-patch.js` troca so
as celulas de dado direto no XML da planilha; estilo, formula,
`dataValidations` e `mergeCells` sobrevivem byte a byte.

> **O template em `assets/anexo-i-template.xlsx` e SINTETICO, nao o formulario
> oficial**, que nao existe neste projeto. O sintetico (gerado por
> `npm run generate:anexo-i-template`) reproduz a estrutura que o processo
> manual descreve — formulas, celula mesclada, lista suspensa, linha de totais
> — para provar a tecnica. **Antes de qualquer uso real, troque pelo formulario
> oficial** e confira `CATEGORY_COLUMN` em `anexo-i.service.js`: o mapa segue a
> versao 19 descrita pelo procedimento (O Passagens, Q Taxi/Conducoes,
> S Alimentacao, U Hospedagem, W Combustivel, X Outras), conferido so contra a
> descricao.

O **PDF consolidado** (`pdf-lib`) junta a pagina original de cada comprovante
— nunca gera imagem nova do cupom — em ordem cronologica, com um carimbo no
rodape (`Item 07 | 19/06/2026 | Franguinho na Panela | R$ 37,60`) e uma pagina
de indice no inicio, com bookmarks por categoria e por data. O carimbo fica
numa faixa **nova**, adicionada abaixo do conteudo original ao embutir a
pagina — fisicamente nao ha como cobrir o cupom. Duplicata entra no PDF e no
indice, marcada com `[DUPLICATA]`. A ordem usa `id` como desempate, porque
nenhum parser le a hora do comprovante.
