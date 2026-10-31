# RPA: importacao da equipe e pendencias

O modulo substitui a planilha `CONTROLE DE DIARIA - <cidade>.xlsb` (plano em
issue 35). Aqui fica a importacao das respostas do Google Forms (issue 37); o
calculo das diarias (issue 38) entra nesta pasta e neste arquivo.

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
