# RPA de lancamentos

O modulo substitui a planilha `CONTROLE DE DIARIA - <cidade>.xlsb`: a equipe
administrativa de um lancamento imobiliario, contratada como autonoma, recebe
por RPA (Recibo de Pagamento a Autonomo). O plano e as decisoes estao na issue
35; as regras de cada parte, no `CLAUDE.md` de `src/services/rpa/`.

Quem acessa: so o papel **admin** (escopos `rpa:read` e `rpa:write`). O
modulo guarda CPF, RG, conta bancaria e documentos de terceiros — ver
[seguranca.md](seguranca.md).

## O processo, na ordem da tela

1. **Empresa.** O codigo UAU, a razao social, o CNPJ, o tipo de servico e o
   centro de custo. A aba EMPRESA da planilha entra de uma vez por
   `npm run rpa:companies:import -- --file EMPRESA.xlsx` (ver o README).
2. **Lancamento.** Empresa, empreendimento, cidade, periodo, feriados, os
   campos do e-mail (obra, produto, insumo, destinatarios), o **horario
   padrao** por dia da semana e as **diarias por funcao**, com vigencia. Tipo
   de servico e centro de custo vazios valem os da empresa.
3. **Equipe.** Suba o `.xlsx` ou `.csv` baixado das respostas do Google Forms.
   Cada pessoa aparece com as pendencias escritas (CPF invalido, endereco sem
   numero, campo vazio). Corrija na propria pessoa, ou de a pendencia por
   resolvida. Importar de novo casa pelo CPF: ninguem duplica.
4. **Ponto.** A grade ja vem preenchida pelo horario padrao, do inicio a saida
   de cada pessoa. So se lanca a excecao: falta, meio periodo, horario
   diferente. Cada dia mostra o valor calculado.
5. **Pagamentos.** Periodo e data do pagamento, e os acrescimos, bonus e
   descontos, cada um com motivo. A **previa** nao grava nada; **emitir** faz
   a mesma conta e grava. O RPA emitido nao muda: errou, cancele com motivo e
   emita de novo.
6. **Emissao.** O RPA de cada pessoa em PDF, no layout do formulario de
   emissao, ou todos num `.zip`, e o texto do e-mail de solicitacao com botoes
   de copiar. O envio continua pelo Gmail de quem pede.
7. **Documentos.** Suba o `.zip` da pasta de respostas baixado do Drive. Cada
   arquivo vai para a pessoa e o tipo (CTPS, RG ou CNH, comprovante de
   endereco, dados bancarios); o que nao casar fica para escolher a pessoa. O
   `.zip` de saida tem uma pasta por pessoa, e a versao para e-mail reduz as
   fotos para caber nos 25 MB do Gmail.
8. **Recibos.** Suba o PDF escaneado que o financeiro devolve. Cada pagina vai
   para a pessoa pelo CPF; quem faltou, a pagina sem pessoa e o nome ou valor
   diferente do RPA sao apontados. Os pagamentos casados viram **pagos**.

O **Inicio** mostra o proximo pagamento (data, pessoas, liquido), quantas
pessoas ainda nao tiveram RPA e quantos RPAs passaram da data sem recibo.

## Regras de calculo

Hora normal = diaria / 8. Os valores andam em fracao de centavo e o
arredondamento (meio para cima, como o ARRED do Excel) e so no total do
pagamento.

| Dia               | Regra                                                             |
| ----------------- | ----------------------------------------------------------------- |
| Util e sabado     | diaria + as horas acima de 8h a 50%                               |
| Domingo e feriado | duas diarias + as horas acima de 8h a 100%, mesmo com menos de 8h |
| Abaixo de 8h      | nao desconta, em dia nenhum; o dia sai marcado como curto         |
| Meio periodo      | metade da diaria (dobrada no domingo e no feriado), base de 4h    |
| Falta             | zero                                                              |

- O **1o pagamento de cada pessoa** pode sair so com as diarias (opcao do
  lancamento); os extras entram no seguinte.
- Dia ja pago cujo ponto mudou entra no pagamento seguinte como **correcao**,
  a mais ou a menos. Nenhum dia e pago duas vezes.
- O **bonus** e um valor pontual, com motivo; nao cobre dia nenhum. Pagar dias
  adiantados e escolher um periodo que va ate eles.
- O **bruto** e o menor valor cujo liquido fecha no centavo, com o INSS a 11%
  ate o teto (truncado) e o IRRF da tabela vigente na data do pagamento, com a
  reducao da Lei 15.270/2025 em 2026. O teto do INSS e o IRRF somam os RPAs do
  mes do mesmo CPF no mesmo CNPJ.

## Instalacao

O PDF do RPA leva o logo e a identificacao do formulario de quem emite. O
repositorio e publico e traz os dois sinteticos: troque `assets/rpa-logo.png`
e `assets/rpa-form.json` (ver o README).

## Em aberto

- **Arredondamento do INSS e do IRRF**: o INSS truncado e o IRRF arredondado
  esperam a confirmacao do financeiro (constante `ROUNDING`).
- **Quem acessa**: so `admin` ate a decisao. Nenhum papel tem hoje leitura
  sem escrita; a tela ja fica so leitura sem `rpa:write`.
- **Retencao**: por quanto tempo guardar CPF, conta e documentos depois do
  ultimo recibo (ver [seguranca.md](seguranca.md)).
- **Codigo do RPA repetido**: o numero da pessoa recomeca em cada lancamento,
  e dois lancamentos da mesma empresa no mesmo mes dariam o mesmo
  `no-empresa-pessoa-mmaaaa`. Hoje a pessoa fica de fora da emissao com o
  motivo escrito.
- **Layouts reais nunca vistos**: o `.zip` baixado do Drive e o recibo do
  financeiro foram simulados a partir dos titulos das perguntas e da planilha.
  Confira o primeiro de cada um antes de confiar.
