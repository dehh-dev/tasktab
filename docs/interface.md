# Interface web

React 19 com Vite, sem router e sem biblioteca de estado — a tela e unica e o
estado vive no `App`. O CSS e proprio, sem framework externo.

Duas abas dividem a interface: **Tarefas** e **Prestacao de Contas**
(`TabNav.jsx`), no padrao WAI-ARIA de `tablist` com tabindex circulante — seta
esquerda/direita move o foco **e** ja seleciona a aba, com retorno ao
inicio/fim nas pontas. A aba inativa e **desmontada**, nao so escondida: as
duas telas reusavam nomes de classe parecidos, e manter as duas no DOM vazava
linha de uma aba para a contagem da outra em teste E2E. Por isso tambem
`ReportList` e `ReceiptList` usam `.list-item*`, e nao `.task*`.

## Tarefas

- **Listagem** com filtro por status (Todas / Pendente / Em andamento /
  Concluida) e contagem total vinda do `meta` da API.
- **Formulario unico** para criar e editar, com contador de caracteres do
  titulo. Erros `422` aparecem no campo correspondente, preservando o que foi
  digitado.
- **Exclusao** passa por um dialogo de confirmacao, na tag `<dialog>` nativa:
  o foco fica preso dentro dele, comeca no botao seguro (para que um `Enter`
  acidental nao delete nada) e volta ao botao que o abriu. `Escape` e clique
  fora cancelam.

## Prestacao de contas

- **Lista de relatorios**, com criacao e edicao (`ReportForm`): periodo,
  cidade principal e adiantamento, que em branco fica "nao informado". Valor
  em reais com separador de milhar (`1.500,00`) passa por `parseMoneyToCents`,
  que remove o ponto antes de trocar a virgula — o parse ingenuo virava `NaN`
  e o adiantamento entrava como `0` sem erro nenhum.
- **Upload de PDF** por clique ou arrastar-e-soltar (`ReceiptUpload`), sem
  filtrar extensao no cliente: o servidor ja confere os magic bytes, e filtrar
  de novo esconderia a mensagem de erro especifica que a API devolve. Enquanto
  a extracao roda, a tela acompanha sozinha e avisa se perder a conexao.
- **Conferencia** do relatorio inteiro no detalhe (`ValidationPanel`),
  agrupada pela classe do procedimento, com "Ver comprovante" em cada alerta
  que tem um.
- **Fila de revisao** (`ReceiptReview`): imagem do comprovante pelo endpoint
  proprio, com zoom por botao ou roda do mouse, arrasto para andar pelo cupom
  ampliado, e o formulario de data, valor e categoria ao lado.
  - O arrasto mexe no `scrollLeft`/`scrollTop` do container, que ja rola, e
    usa `setPointerCapture` — sem ele, soltar o botao fora do painel deixava o
    arrasto grudado no cursor.
  - `transform-origin` da imagem e `top left`, **nunca `center`**: o overflow
    rolavel so se estende para direita e baixo, e escalar do centro punha um
    terco do cupom fora do alcance de qualquer barra.
  - Atalhos de recorte enquadram o cabecalho, o valor e a data do recibo
    manuscrito, ou as fatias de um cupom longo; os botoes de giro endireitam a
    pagina. Quando a extracao nao achou a chave de acesso ou o emitente, os
    campos para digita-los aparecem na propria revisao.
  - O badge de origem e confianca e **um so por comprovante**: o pipeline grava
    a confianca do campo mais fraco, nao uma por campo.
  - Alertas aparecem no topo, com "Marcar como duplicata" (so na suspeita de
    duplicata) e "Dispensar" — dispensar e local, so tira o alerta da vista
    naquela sessao.
  - Confirmar avanca para o proximo pendente sem sair da tela; quando a fila
    acaba, a revisao fecha sozinha.
  - Atalhos: `Escape` volta a lista, `Alt+seta` navega entre pendentes. Com o
    `ConfirmDialog` aberto os dois ficam mudos: o `Escape` e do dialogo, e um
    toque so nao pode cancelar a exclusao **e** fechar a revisao.
  - Reprocessar o que ja foi conferido pede confirmacao antes, porque a
    extracao regrava data, valor e categoria.
- **Descartar um comprovante**: pagina em branco no fim do PDF ou cupom de
  outra viagem nao se resolve na revisao, e um `needs_review` insoluvel trava a
  fila. Nenhum status e bloqueado. A exclusao e definitiva e leva o PDF junto
  quando nenhuma outra pagina o referencia, por isso passa sempre pelo
  `ConfirmDialog`, que mostra data e valor do alvo.

## Paleta

Baseada no tema **GitHub Dark Colorblind** (Protanopia & Deuteranopia), cuja
troca central em relacao ao dark padrao e substituir verde por azul e vermelho
por laranja — justamente o par que esses tipos de daltonismo confundem. Por
isso as acoes destrutivas sao laranja (`#ec8e2c`), nao vermelhas.

| Status       | Cor               |
| ------------ | ----------------- |
| Pendente     | Amarelo `#d29922` |
| Em andamento | Azul `#4184e4`    |
| Concluida    | Roxo `#a371f7`    |

Cor nunca e o unico canal de informacao: cada badge tambem carrega o texto do
status, entao a leitura sobrevive em tons de cinza.
