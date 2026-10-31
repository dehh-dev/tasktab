# RPA: importacao da equipe, pendencias e calculo

O modulo substitui a planilha `CONTROLE DE DIARIA - <cidade>.xlsb` (plano em
issue 35). Aqui ficam a importacao das respostas do Google Forms (issue 37) e
a grade do ponto com o calculo das diarias (issue 38).

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
