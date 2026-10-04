# Conferencia e duplicatas

`GET /api/reports/:id/validation` (`index.js`) aponta; quem decide e a pessoa
que assina. **Alerta nao bloqueia nada.**

- Cada alerta leva a **classe do procedimento** em `level` (issue 48):
  pendente, decisao, atencao, verificado, informativo — a mesma da aba de
  Observacoes da planilha. A classe de cada regra fica em `RULE_LEVEL`, num
  lugar so, e ha teste que barra regra sem classe. A tela agrupa por ela
  (`ValidationPanel`), e `web/src/constants.js` espelha os `LEVELS`.
- Regra so dispara com evidencia suficiente: a de itens exige ao menos dois
  itens legiveis, a de faixa um historico minimo (`MIN_HISTORY`). Alarme falso
  destroi a confianca mais rapido que um erro nao detectado.
- **Nenhuma regra vai ao banco** (issue 52). O que precisa dele vem numa
  consulta do relatorio inteiro, no `Promise.all` do `validateReport`, e a
  regra recebe o resultado. Uma consulta por comprovante eram 80 num
  relatorio de 40, a cada abertura da tela. O
  `tests/api/reports/validation-queries.test.js` conta as consultas de verdade
  e falha se o numero crescer com o relatorio.

## Duplicatas (`src/services/dedup.service.js`)

- So **mesma chave de acesso** colapsa sozinha (`duplicate_of_id`), e o alerta
  sai como `verificado`, para quem assina saber por que o comprovante esta
  fora da soma. Mesma data com mesmo valor e **suspeita**, e pede decisao.
- A duplicata exata e decidida **antes** de a pagina sair de `processing`:
  status e `duplicate_of_id` numa escrita so. Gravar `needs_review` primeiro
  deixava a pagina parecendo pronta, e uma confirmacao naquele instante
  somaria a duplicata. O teste le o banco sem intervalo para pegar essa
  janela.
- Ha teste do contraexemplo: dois almocos iguais em dias diferentes **nao** sao
  duplicata. **Nao afrouxe esse teste** — foi assim que R$ 48,60 sumiram da
  planilha que originou o projeto.
- **Mesmo valor em chaves diferentes** e `informativo` (`valor_repetido`,
  issue 49), em cada comprovante: "nao apague nem marque como duplicata".
  **Data diferente nao prova** que sao dois documentos — ela e lida pelo OCR.
  A marcada a mao como duplicata segue avisada quando nenhum comprovante
  somado carrega a chave dela: marcar tira da soma.

## Regras

- **Documentos sem chave** (issue 50, `nao_fiscal`): um alerta so, do
  relatorio, com `count` e `total_cents` em campo proprio — um por comprovante
  seria ruido (35 das 42 paginas de Itapipoca). A base e a do `total_cents` de
  `summarizeByReport`: em revisao entra, duplicata e comprovante sem valor
  nao. Se uma mudar, mude a outra: o numero e uma parte do total da tela, e ha
  teste comparando os dois.
- **Faixa do emitente** (`faixa_emitente`, atencao): o historico vem **so
  dos relatorios do mesmo dono** (`merchantHistoryByReport`), e o sem dono
  fica com os sem dono. A mensagem traz o minimo e o maximo, e ela sai na
  conferencia e na planilha: com os relatorios de todos, mostrava valores de
  quem a pessoa nem pode consultar. O emitente e compartilhado pela
  categoria, nao pelo valor gasto nele. Ha teste com duas pessoas.
- **Padrao da categoria** (issue 51, `acima_do_padrao`, decisao): 3x a mediana
  dos **outros** da categoria, com ao menos 3 deles. So o confirmado, dos dois
  lados — a categoria em revisao e palpite, com piso em alimentacao, e um
  combustivel nao revisado pareceria o almoco mais caro. Outros fica de fora:
  nao tem padrao, e cada comprovante dela ja pede decisao. O fator foi medido
  em Itapipoca: marca 3 de 35, e nada ficou entre 2,3x e 4,1x.
- **Cidades** (issue 51): compare por `cityOf`/`sameCity` — sem acento, sem
  caixa, e a UF so quando as duas a trazem. O cupom imprime "CONCEICAO" ou
  "Conceição", e a cidade principal e digitada a mao. `duas_cidades` e um
  alerta por dia, nao por comprovante, e fora da cidade e informativo: viagem
  tem trecho, e conexao de voo explica a maioria.
- **O que a chave ja diz** (issue 47, `checkAccessKeyFields`): mes da chave
  diferente da data lida e atencao (o OCR trocou agosto por junho num cupom
  real), tipo de emissao diferente de 1 e contingencia, e UF da chave
  diferente da UF do emitente e atencao. A chave fechou o DV: quando discorda,
  o resto foi lido errado. O mapa IBGE → UF fica em `access-key.js`.
- **Combustivel** (issue 45): litros x preco unitario contra o total, so com a
  linha que **fecha a propria conta** (um centavo de folga, porque a bomba
  arredonda) e so em comprovante de combustivel — a garrafa de 1,5 L do
  mercado tem o mesmo desenho. Foi a regra que pegou R$ 2.225,49 lido onde a
  linha dizia 39,56 L x R$ 5,70 = R$ 225,49. No leitor, o separador unico dos
  litros e decimal: `18.461` sao litros.
