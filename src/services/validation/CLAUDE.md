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
