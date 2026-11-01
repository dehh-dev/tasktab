# Seguranca e privacidade

## Autenticacao e autorizacao

Sessao por cookie `httpOnly`, gravada no banco. Entrar cria a linha, sair a
apaga — o token morre na hora, e nao quando venceria. A senha e derivada com
`scrypt` (biblioteca padrao do Node), com os parametros de custo dentro do
proprio hash, para que endurece-los depois nao invalide as senhas existentes.

`sameSite=lax` no cookie e o que **dispensa token de CSRF**: sob Lax o cookie
so acompanha navegacao de topo por GET, e toda escrita da API e POST, PATCH ou
DELETE.

A autorizacao tem dois eixos, e os dois valem sempre:

- **Escopo** — que acao, sobre que classe de recurso. Declarado na rota
  (`requireScope('reports:write')`).
- **Posse** — quais linhas. Conferida no controller, com o registro em maos.

| Papel     | Alcance                                             |
| --------- | --------------------------------------------------- |
| `admin`   | tudo, inclusive relatorio de outra pessoa           |
| `user`    | cria e revisa **os seus** relatorios                |
| `auditor` | le tudo (inclusive o alheio) e **nao escreve nada** |

A posse pertence ao **relatorio**; comprovante, imagem e exportacao herdam a
dele. Quando o recurso e de outra pessoa a resposta e `404`, e nao `403`:
responder 403 confirmaria que aquele id existe, e permitiria varrer os ids para
mapear o sistema. O `403` fica para quando a **acao** e negada e nao o
registro — o auditor que le o relatorio e tenta edita-lo.

O `merchants` e cadastro compartilhado (a categoria de um CNPJ vale para todo
mundo) e o quadro de `tasks` tambem, por decisao de produto.

Na interface, as abas e os botoes seguem os escopos da sessao: o auditor ve a
revisao de comprovantes em modo somente leitura. Quando a sessao cai no meio
do uso — venceu, ou foi revogada por uma troca de senha em outro navegador —,
a tela volta para o login dizendo por que.

## Protecoes HTTP

O `helmet` aplica os headers de seguranca com a politica padrao — front e back
ficam sempre na mesma origem, entao a CSP `'self'` atende o build do Vite sem
excecoes.

Nenhuma resposta de `/api` fica no cache do navegador (`Cache-Control:
no-store`): o cache guarda pela URL e nao sabe de sessao, entao o que ficasse
nele sobreviveria ao logout. A imagem do comprovante e a unica excecao,
`private, no-cache`: o navegador guarda, mas pergunta antes de cada uso, e a
pergunta passa pela sessao e pela posse. Com o ETag certo a resposta e um `304`,
sem renderizar a imagem de novo.

O limitador tem um teto para toda requisicao, generoso porque a interface
recarrega a lista a cada mutacao, e **um teto de escrita por familia de
rota**: o geral para `/auth`, `/users` e `/tasks`, e um proprio para
`/reports`, `/receipts` e `/merchants`, que trabalham em lote. Os dois nao se
somam — cada escrita passa por um so. O mais apertado de todos fica no
`POST /api/auth/login`, a unica rota onde repetir a requisicao com outro valor
serve a quem nao deveria estar aqui. Todos respondem `429` no mesmo formato
dos demais erros.

O limitador **fica desligado em `NODE_ENV=test`**: a suite dispara dezenas de
requisicoes em segundos e trombaria em qualquer teto realista.
`tests/api/rate-limit.test.js` sobe uma instancia propria da API com
`RATE_LIMIT_ENABLED=true` e tetos baixos, e confere cada familia. Para conferir
manualmente, suba com um teto baixo e repita uma escrita:

```bash
RATE_LIMIT_WRITE_MAX=5 npm start
```

## Logs

`pino` estruturado, uma linha por requisicao. Cada uma ganha um `request_id`
(UUID) devolvido no header `x-request-id`; se a requisicao ja chegar com esse
header, o valor e preservado, para que o rastro atravesse proxies.

Nas respostas **5xx** o mesmo id sai no corpo, em `request_id` — e o que liga a
reclamacao do usuario a linha de log, ja que a mensagem publica de um 500 e
deliberadamente generica. Nos 4xx o corpo ja diz o que corrigir, entao o id
nao entra.

`LOG_LEVEL` controla o nivel (padrao `info`, e `silent` em teste). Em
desenvolvimento a saida passa pelo `pino-pretty`; em producao sai em JSON.

## Retencao e privacidade

Um cupom fiscal nao e um arquivo qualquer: traz CNPJ do emitente, e as vezes
CPF na nota, de gente que nao e usuaria deste sistema. As decisoes abaixo
valem para qualquer deploy.

**O arquivo vive enquanto o comprovante existir, e nao mais que isso.** Apagar
um comprovante ou um relatorio apaga tambem o PDF do disco. Nao ha varredura
por idade nem TTL: o dono da prestacao de contas decide quando ela deixa de ser
necessaria — expirar sozinho destruiria a evidencia de um relatorio que ainda
pode ser questionado meses depois.

A exclusao e **contada por referencia**, nunca direta. O PDF e gravado com o
proprio SHA-256 como nome, entao um arquivo atende todas as paginas dele e
ainda e reaproveitado por outro relatorio que receba o mesmo upload; apagar
junto com a primeira linha removida levaria embora o cupom das outras.
`src/services/retention.service.js` so chama o `unlink` quando nenhuma linha
aponta mais para aquele hash.

Falha ao apagar o arquivo **nao derruba a resposta**: a linha ja saiu do banco
e o erro nao a traz de volta. Fica um `warn` no log, que e o que permite varrer
o diretorio depois. O caso comum — arquivo que ja nao estava la (`ENOENT`) — e
silencioso de proposito.

O diretorio de upload esta fora do versionamento (`.gitignore`) **e fora da
imagem** (`.dockerignore`): em container ele e um volume, e a imagem nunca
carrega arquivo de usuario.

**`raw_text` nao e anonimizado apos a confirmacao** — decisao consciente, nao
esquecimento. A regra de conferencia que soma os itens contra o total impresso
le dele, e confirmar um comprovante e reversivel: anonimizar na confirmacao
silenciaria a checagem exatamente nos comprovantes que vao assinados. O que
protege o `raw_text` e o cerco em volta dele:

- Nao e editavel por `PATCH`. As colunas que a revisao pode corrigir
  (`UPDATABLE_COLUMNS`) sao separadas das que a extracao escreve
  (`EXTRACTION_COLUMNS`) — juntar as duas deixaria a trilha de auditoria
  apagavel pelo cliente.
- **Nunca vai para o log**, nem a `access_key` ou o comprovante inteiro. Para
  investigar uma extracao, logue o `id` do comprovante e consulte o banco.
  Como rede de seguranca, o logger troca por `[Redacted]` os campos `cpf`,
  `pis`, `rg`, `agency`, `account`, `pix_key`, `raw_text`, `access_key` e
  `password` no topo do objeto logado e um nivel abaixo. Ele casa o nome do
  campo, nao o conteudo: um CPF dentro de uma mensagem de texto passa.

## RPA: dado pessoal de terceiros

O modulo RPA ([rpa.md](rpa.md)) guarda dados de quem presta servico, que nao
e usuario do sistema:

- **Cadastro da pessoa** (`rpa_workers`): nome, CPF, PIS, RG e emissao,
  nascimento e local, nome da mae e do pai, endereco, banco, agencia, conta e
  chave Pix, e-mail.
- **Documentos** (`rpa_files`, no diretorio de upload): fotos e PDFs de CTPS,
  RG ou CNH, comprovante de endereco e dados bancarios, e os recibos assinados.
- **Recibos enviados** (`rpa_receipt_batches`): os PDFs assinados, como
  vieram, e o resultado da leitura (nome, CPF e valor lidos).

O que o protege:

- So o `admin` escreve (`rpa:write`). O `auditor` le (`rpa:read`), para
  conferir antes de o RPA sair: ve CPF, conta e documentos da equipe, sem
  alterar nada.
- A **planilha de respostas do formulario nao e guardada**: e lida em memoria
  na importacao e descartada. O `.zip` dos documentos sai do disco depois de
  lido.
- **Nada disso vai para o log**: o `redact` cobre CPF, PIS, RG, agencia, conta
  e chave Pix, mais o `detail` do erro do Postgres, que repetiria a linha que
  violou uma constraint. Ha teste lendo a saida de uma API com o log ligado na
  importacao, nos documentos e nos recibos.
- O nome de arquivo do `.zip` do Drive nunca vira caminho no disco: o arquivo
  e gravado pelo SHA-256, como o comprovante.

**Por quanto tempo**: ate um mes depois de o lancamento ser encerrado
(decisao de 2026-11-01). Nesse dia a propria API apaga os documentos, os
recibos e os envios de recibo, do banco e do disco (pela mesma retencao por
referencia dos comprovantes), e deixa nulos RG, nascimento, PIS, endereco,
filiacao, e-mail, banco, conta e chave Pix da equipe. Ficam nome, CPF, funcao
e os valores dos RPAs: o historico do que foi pedido ao financeiro, que guarda
a via oficial. O RPA, mesmo cancelado, nao se apaga.

- O prazo conta de `closed_at`, que o banco marca ao encerrar e limpa ao
  reabrir; reabrir antes do prazo adia a retencao.
- Depois dela o lancamento **nao reabre** (o banco recusa) e o PDF do RPA
  nao sai mais, porque traz conta e endereco.
- A varredura roda na subida da API e a cada seis horas, e loga so o id do
  lancamento e contagens.
- Lancamento sem RPA emitido pode ser apagado antes disso, inteiro.
