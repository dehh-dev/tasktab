# RPA: equipe, documentos, calculo, pagamentos e emissao

O modulo substitui a planilha `CONTROLE DE DIARIA - <cidade>.xlsb` (plano em
issue 35). Aqui ficam a importacao das respostas do Google Forms (issue 37),
a grade do ponto com o calculo das diarias (issue 38), os pagamentos com o
bruto e os impostos (issue 39), a emissao: PDF, .zip e e-mail (issue 40), os
documentos do formulario (issue 41), os recibos assinados (issue 42) e a
retencao dos dados pessoais.

## Importacao (`import.service.js`)

- O arquivo e conferido **pelo conteudo**: zip com `xl/workbook.xml` e .xlsx,
  zip com `xl/workbook.bin` e .xlsb (recusado, com o que fazer), texto sem
  byte nulo e .csv. Extensao e content-type do envio nao contam.
- A planilha vem pelo `spreadsheetUpload` (memoria, campo `file`), e lida e
  descartada. **Nao grave a planilha em disco nem no banco**: traz CPF, RG e
  conta de toda a equipe.
- **Coluna pelo titulo da pergunta, nunca pela posicao** (`form-columns.js`):
  sem acento, sem caixa e so ate a quebra de linha ou o "(Exemplo" — o titulo
  real e `"Cidade-UF\r\n(Exemplo: Goiania-GO)"`. As regras sao em ordem
  ("Nome completo MAE" cai em `mother_name` antes de `name`). Anexos ficam de
  fora (sao da issue 41); pergunta desconhecida vira aviso.
- **O .csv nao passa pelo `csv.read` do exceljs**: o mapeamento padrao dele
  faz `Number()` em cada valor e apaga o zero a esquerda do CPF. `csv.js` le
  tudo como texto, UTF-8 ou Windows-1252, virgula ou ponto e virgula.
- No .xlsx do Sheets o CPF, o CEP e a agencia chegam como **numero**, sem o
  zero a esquerda. CPF e PIS so voltam completados se o verificador fechar
  (`recover`), e isso vira nota (`cpf_padded`); CEP e agencia sao completados
  pelo tamanho.
- Reimportar **casa pelo CPF** dentro do lancamento. So a resposta de carimbo
  mais novo (ou igual) atualiza, e so os campos que a planilha traz — uma
  planilha sem a pergunta de dependentes nao zera ninguem. Quem nao veio no
  arquivo continua no lancamento. Pessoa nova ganha `MAX(number) + 1`, com o
  lancamento travado (`FOR UPDATE`) para duas importacoes nao darem o mesmo
  numero.
- Linha sem nome ou sem CPF de 11 digitos fica de fora, listada pelo numero.
  CPF de 11 digitos com DV errado **entra**, com pendencia: e a mesma pessoa
  que vai corrigir.
- Aviso e linha recusada levam o numero da linha, **nunca o CPF**. O log leva
  so contagens e o id do lancamento.

## Limpeza e pendencias (`form-cleaning.js`, `worker-issues.js`)

Funcoes puras, com tabela de casos em `tests/services/rpa/`. Nenhuma
pendencia barra a importacao.

- Duas origens, no campo `source`: `form` e nota da limpeza (CPF completado,
  data ilegivel, banco ambiguo, cidade sem UF); `check` e verificacao do valor
  gravado (`checkWorker`: DV, endereco sem numero, inicio antes do lancamento
  ou igual ao nascimento, conta sem digito, campo obrigatorio vazio).
- `reconcileIssues` e a regra unica do PATCH e da reimportacao: nota fica
  enquanto o campo dela nao muda; verificacao roda de novo sobre o cadastro
  inteiro; pendencia dada por resolvida (`resolve_issues`) nao volta enquanto
  o campo nao mudar.
- Cidade `Cidade-UF`: quando a cidade e a do lancamento, vale a grafia dele
  (`avare sp` vira `Avaré-SP`); fora isso, so a caixa e arrumada. Nao ha lista
  de municipios.
- Banco pelo codigo digitado, por apelido (`BANK_ALIASES`) ou pelo nome da
  lista do Banco Central. **"Banco ItauBank S.A" e ambiguo** (479 e outro
  banco; quase sempre e o Itau Unibanco, 341): fica sem codigo e com nota.
- Operacao so como numero (a da Caixa); "Conta Corrente", "." e o codigo do
  proprio banco viram vazio — e o que o formulario de Avare recebeu.
- No PATCH o CPF corrigido **tem** de fechar o DV e nao pode repetir outro do
  lancamento. O `number` nao muda: vai no codigo de todo RPA da pessoa.

## Grade do ponto e calculo (`timesheet.js`, `day-value.js`)

- **So a excecao e gravada** (`rpa_days`). A grade nasce do horario padrao do
  lancamento, do inicio a saida (inclusive) de cada pessoa; dia da semana sem
  horario e folga (`source: 'off'`). Excecao igual ao padrao, sem observacao,
  e apagada em vez de gravada. Era a LANCA com o Botao 1, que gerava de novo
  quem ja tinha saido.
- **O valor nunca e gravado**: e calculado na leitura, entao mudar a diaria
  ou o feriado ja muda a grade. O pagamento (issue 39) congela o que levou em
  `rpa_payment_days` e compara com a grade para achar a correcao.
- **1/1920 de centavo** (`SUBCENTS_PER_CENT`), inteiro do comeco ao fim: por
  centavo de diaria, o minuto vale 4 (hora normal = diaria / 8), 6 a 50% e 8 a
  100%. Nada de float, nada de arredondar por dia.
- **Regras**, conferidas com a planilha (replica de 70 de 70 linhas) e
  ajustadas pelas decisoes de 2026-10-31:
  - dia util e sabado: diaria + o que passa de 8h a 50%;
  - domingo e feriado: duas diarias + o que passa de 8h a 100%, **mesmo com
    menos de 8h** (a planilha tirava a dobra do domingo e descontava o
    feriado);
  - **abaixo da base nada desconta**, em dia nenhum (a planilha descontava o
    sabado a 50%): sai a marca `short_day`, e meia diaria ou desconto e
    decisao de quem lanca;
  - meia diaria: metade da diaria (dobrada no domingo e no feriado), base de
    4h e extra com a mesma hora normal de diaria / 8. Na planilha a hora da
    meia diaria era diaria / 16 e a base seguia 8h por um `0.05` no lugar de
    `0.5`; nenhum dia real de Avare tinha meio periodo. Confirmado por quem
    paga em 2026-10-31;
  - feriado e do lancamento, vale para todos e prevalece sobre o domingo (as
    regras sao a mesma, e nao somam).
- Feriado em dia de semana vem **preenchido pelo horario padrao**, ja dobrado:
  a grade e o ponto previsto, e o RPA sai antes do fim do periodo. Quem nao
  trabalhou no feriado ganha falta. Confirmado em 2026-10-31, como as duas
  abaixo: a saida (`left_on`) e o ultimo dia trabalhado, e entra na grade; dia
  sem horario de almoco e dia sem almoco — o "1h quando nao indicado" da
  issue 38 descreve so os exemplos dos criterios.
- Diaria da `rpa_rates` vigente na data, com a funcao sem acento nem caixa, e
  o adicional de promovido a partir de `promoted_since`. Sem vigencia: na
  grade o dia vem com valor `null` e `no_rate`; no PUT de um dia trabalhado e
  `422` com `date` e `role` no `details` — o `#N/D` da planilha.
- Horarios: entrada e saida obrigatorias, almoco com os dois ou nenhum, em
  ordem, com no maximo uma virada da meia-noite (turno da noite, marca
  `overnight`) e menos de 24h. A regra e a mesma do horario padrao
  (`validators/rpa-times.js`), para o padrao nunca gerar dia que a grade
  recusa.
- **Consultas constantes**: o PUT grava e apaga com `unnest` (uma consulta
  cada), qualquer que seja o lote, com teste pelo `query-counter`. O lote e
  tudo ou nada; tirar a excecao vale ate fora do periodo da pessoa, para
  limpar o dia de quem teve a saida antecipada.

## Pagamentos (`payment-plan.js`, `taxes.js`, `payment.service.js`)

- **Uma regra so** (`planWorker`), no lugar das cinco linhas do RELATORIO: do
  periodo, a diaria e o extra de cada dia ainda nao pagos; de dia anterior, o
  extra pendente de diaria ja paga; de todo dia pago, a correcao entre o que
  a grade vale hoje e o que saiu. Bonus, acrescimo e desconto com motivo. O
  **bonus e pontual e nao cobre dia nenhum** (decisao de 2026-10-31): pagar
  dias adiantados e so escolher um periodo que va ate eles — a grade e o
  ponto previsto, e a mudanca depois vira correcao.
- **"1o pagamento so com diarias" e por pessoa**: quem entrou depois tambem
  tem o primeiro dela sem extra. O extra fica em `deferred_extra_subcents` e
  entra no seguinte.
- `rpa_payment_days` leva **todo dia do periodo, inclusive o de valor zero**
  (falta, folga): e o que faz uma falta que vira dia trabalhado aparecer como
  correcao, e nao sumir.
- O total da pessoa e arredondado **uma vez**, meio para longe do zero (o
  ARRED do Excel), em `value_cents`; o resto e subcentavo.
- **Bruto pelo liquido** (`grossForNet`): o menor bruto cujo liquido fecha no
  centavo. INSS e IRRF so crescem com o bruto, entao o liquido anda -1, 0 ou
  +1 por centavo: busca binaria e uma janela de 10 centavos abaixo. Ha teste
  varrendo liquidos de R$ 1 a R$ 15 mil.
- **Imposto corta em duas casas, sem arredondar** (`ROUNDING` em
  `taxes.js`), INSS e IRRF, decisao de 2026-11-01. E o que o sistema do RH
  (Senior) faz: o RPCI de Avare devolveu R$ 650,01 para o RPA de R$ 650,00 da
  planilha, com o INSS de 80,3374 cobrado como 80,33. O total da pessoa nao
  muda: continua arredondado como no item acima.
- **O mes acumula por CPF e CNPJ**, em qualquer lancamento: a base do INSS
  deste RPA e o que falta para o teto; o IRRF e o do mes inteiro menos o ja
  retido; a base gravada e a parte deste RPA na base do mes.
- Previa e emissao fazem a mesma conta (`buildPayments`). A emissao trava o
  lancamento e o rele dentro da transacao; sao tres INSERTs com `unnest`.
- O numero do RPA e o menor livre entre os nao cancelados: cancelar o 1o e
  emitir de novo da o 1 outra vez, com o mesmo codigo. O banco trava o
  emitido (ver `src/models/CLAUDE.md`); pago nao se cancela pela API.

## Emissao (`rpa-pdf.service.js`, `rpa-format.js`, `document.service.js`)

- **O layout e o da aba FORM.DRH.03**: a area A1:L56, com as larguras das
  colunas e as alturas das linhas reais, reduzida para 507 x 630 pt a 71 pt da
  esquerda e 80 pt do topo da pagina Carta. Cada campo ocupa a celula
  mesclada que ocupava la. Da planilha vieram so rotulos e posicoes.
- **Logo e cabecalho sao da instalacao** (`assets/rpa-logo.png`,
  `assets/rpa-form.json`): o repositorio e publico e traz os dois sinteticos
  (`npm run generate:rpa-assets`). O codigo do RPA vai em negrito italico sob
  o logo.
- As tabelas impressas sao as que o RPA **guardou na emissao**
  (`inss_table_id`, `irrf_table_id`), e nao as vigentes hoje. O formulario
  trazia as faixas do empregado, todas a 11%; o contribuinte individual tem
  uma so, com o teto logo abaixo.
- **Gerar de novo da o mesmo arquivo, byte a byte**: datas do PDF e hora do
  nome sao as da emissao (em Brasilia), e as do .zip tambem. Atencao no
  teste: o `PDFDocument.load` do pdf-lib regrava a data de modificacao sem
  `updateMetadata: false`.
- A fonte padrao (WinAnsi) escreve acento, ç, ª e º; o que ela nao tem perde
  o acento ou vira `?` (`encodable`), para um nome de terceiro nunca derrubar
  a emissao. Texto que nao cabe encolhe ate 4,5 pt e, no limite, corta com
  reticencias.
- Sem tipo de servico e centro de custo o RPA nao sai (`422`): a planilha
  imprimia `0`. Cancelado nao se imprime (`409`).
- O nome do arquivo leva acento e `ª`; o `Content-Disposition` manda as duas
  formas (`filename` ASCII e `filename*` UTF-8). No .zip o JSZip marca o nome
  como UTF-8 (bit 11) sozinho; duas pessoas com o mesmo primeiro e ultimo
  nome ganham o numero da pessoa no fim.
- O e-mail nao e enviado: a API devolve assunto, destinatarios e corpo em
  texto e HTML (campos em negrito vermelho, escapados). Do 2o pagamento em
  diante o texto e o da resposta, com o mesmo assunto, para o Gmail juntar a
  conversa.

## Documentos do formulario (`zip-reader.js`, `documents.js`, `documents.service.js`)

- **O .zip vai para o disco e e lido por partes** (`zip-reader.js`, sobre
  `FileHandle`): o do Drive pode ter centenas de MB (limite proprio,
  `RPA_DOCUMENTS_MAX_BYTES`). Leitor proprio, e nao o JSZip, porque a defesa
  de bomba precisa dos tamanhos **antes** de descompactar, e o JSZip so os
  expoe por propriedade interna.
- **Defesa de zip em duas camadas.** Pelo diretorio central, antes de abrir
  qualquer entrada: ate 2.000 arquivos, 50 MB por arquivo e 400 MB no total
  descompactados. Ao descompactar, `maxOutputLength` igual ao tamanho
  declarado: a entrada que mente para no primeiro byte a mais. CRC e tamanho
  conferidos. Zip64, senha e compressao que nao seja deflate sao recusados.
  Uma entrada ruim recusa o .zip inteiro; arquivo de formato desconhecido so
  volta em `rejected`.
- **O nome da entrada nunca vira caminho**: o arquivo e gravado pelo SHA-256,
  no mesmo diretorio dos comprovantes (a retencao conta as duas tabelas). O
  nome so diz a pasta (tipo e lado) e a conta (a pessoa).
- **Tipo pela pasta da pergunta**, nunca pelo nome do arquivo, com regras em
  ordem (`KIND_RULES`): a CTPS ("Carteira de Trabalho") antes do RG, porque o
  RG diz "Lado dos Dados". O formato e pelo conteudo (`detectType`).
- **Pessoa pelo primeiro e ultimo nome da conta**, sem acento e sem caixa;
  duas pessoas com a mesma chave, ou nenhuma, deixam o documento sem pessoa,
  com `source_name` para escolher na mao (`PATCH /api/rpa/files/:id`).
  Reenviar so preenche a pessoa que faltava: a escolha feita na mao fica.
- Frente e verso com o mesmo hash viram **um arquivo sem lado** (`CTPS.jpg`);
  o mesmo arquivo nao se repete no lancamento (`rpa_files_unique_hash_per_launch`).
- **Versao para e-mail**: foto acima de 1 MB sai a 2.400 px no lado maior,
  JPEG q85, virada pela orientacao da camera; PDF vai como veio. O .zip e
  montado em memoria so nesse caso, para avisar (`X-Email-Warning`) se passar
  dos 25 MB do Gmail. A versao completa sai do disco em fluxo.
- **Nada de nome de arquivo, de conta ou de documento no log**: so contagens
  e o id do lancamento, com teste lendo a saida de uma API de verdade
  (`tests/api/rpa/log.test.js`). Os nomes so voltam na resposta.

## Recibos assinados (`receipt-reading.js`, `receipts.service.js`)

- **O RH manda um RPCI por pessoa** (Senior, A4, com camada de texto; visto
  num recibo real de Avare em 2026-11-01), e cada um volta assinado no proprio
  PDF. O envio aceita varios PDFs no campo `file` (ate `UPLOAD_MAX_FILES`) ou
  o escaneado com todos. A leitura percorre um PDF so, os enviados juntos na
  ordem; cada original fica em `sources`, com a faixa de paginas dele.
- **PDF de uma pagina vai para a pessoa como veio**, sem `copyPages`: e o
  recibo inteiro, e uma copia perderia a assinatura digital (gov.br). Do PDF
  com varias paginas, a pagina e copiada (abaixo). Ha teste byte a byte dos
  dois.
- **A leitura roda na fila** (`extraction/queue.js`), como o reprocessamento
  do comprovante: o `POST` grava o PDF pelo hash, cria o envio
  (`rpa_receipt_batches`, `pending`) e responde `202`. A tela acompanha pelo
  `GET` do envio, que termina `done` com o resultado ou `failed` com mensagem
  publica.
- Texto pela camada da pagina; sem texto util, **OCR sem normalizar**
  (`readPage(..., { normalise: false })`). Normalizada, a pagina quase toda
  branca com uma linha de assinatura (`____` ou `....`) se perde inteira no
  Tesseract: o CPF saia "STI.AT1./33-13" e linhas sumiam. O fixture de teste
  tem a linha de assinatura de proposito.
- **Pessoa pelo CPF, com o verificador**: o CPF que o OCR trocou um digito nao
  fecha o DV e nao casa com ninguem. Sem CPF que case, pelo primeiro e ultimo
  nome do cadastro, quando so uma pessoa do pagamento os tem na pagina. **O CPF
  vale mais que o nome.** Cada pessoa pega a primeira pagina dela; a segunda
  vai para as sem pessoa, como repetida.
- Nome, liquido e data lidos pela palavra da linha (`nome`, `liquido`,
  `data`). No RPCI do RH a camada de texto vem fora da ordem da pagina: o nome
  fica numa linha so, **antes** do rotulo "NOME COMPLETO" (no OCR, depois), e
  o "LIQUIDO:" vem sem o valor. Por isso o rotulo sozinho busca o nome na
  linha vizinha que so tem nome (`LABEL_WORDS` barra os rotulos), "nome ou
  razao social" e sempre a empresa, e o liquido sem valor na linha sai de "a
  importancia de R$". O teste reproduz as duas ordens com dados sinteticos; o
  recibo real nao entra no repositorio. Diferenca e **apontada, nunca
  corrigida** — o recibo de R$ 650,01
  continua contra o RPA de R$ 650,00, e o pagamento vira pago assim mesmo.
- A pagina separada e **copiada** (`copyPages`), sem recomprimir: a imagem e a
  mesma, byte a byte (ha teste do stream). O PDF dela sai sem data
  (`updateMetadata: false`), entao reenviar o mesmo lote da o mesmo arquivo e
  nao duplica o recibo.
- O nome do arquivo e o do **cadastro** (`RECIBO NOME COMPLETO.pdf`), nunca o
  do recibo, que pode vir com erro de digitacao.
- O log leva so o id do envio e contagens; CPF, nome e valor ficam no
  resultado, no banco.

## Retencao (`retention.service.js`, decisao de 2026-11-01)

- **Um mes depois de encerrado**, o lancamento perde documentos, recibos e
  envios de recibo (banco e disco, pela contagem por referencia de
  `src/services/retention.service.js`) e os dados pessoais da equipe
  (`Worker.PERSONAL_COLUMNS` viram nulo, pendencias somem). Ficam nome, CPF,
  funcao, datas, dependentes e os RPAs inteiros.
- O prazo conta de `closed_at`, mantido pelo banco (ver `src/models/CLAUDE.md`).
  `purge_on` e `purged_on` saem do model ja em Brasilia.
- A varredura roda **dentro da API**: na subida e a cada seis horas
  (`startRetentionSweep` no `server.js`), sem cron. Cada lancamento e uma
  transacao que trava e confere de novo (`lockExpired`): quem reabriu no meio
  fica com os dados. O disco so e limpo depois do commit. Falha vira `warn` e
  a proxima rodada tenta de novo.
- Depois dela, **nao reabre** e o PDF do RPA (`rpa.pdf`, `rpas.zip`) e `409`
  (`launchPurged` em `access.service.js`): o RPA impresso traz conta e
  endereco, que ja nao existem.
- O log leva so o id do lancamento e contagens. O teste sobe uma API propria
  (`startApiInstance`) para exercitar a varredura de verdade, e confere o log.
