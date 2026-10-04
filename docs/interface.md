# Interface web

React 19 com Vite, sem router e sem biblioteca de estado: a sessao vive no
`App`, e o que esta aberto, na casca. O CSS e proprio, sem framework externo, e
os icones sao do `lucide-react`. A organizacao em casca e modulos segue a do
[lifeboard](https://github.com/lucianodiisouza/lifeboard), usado como
referencia de desenho — o codigo daqui e proprio.

## Casca

A tela logada e uma casca (`web/src/shell/`) com os modulos dentro.

- **Barra lateral**, na tela larga: a marca, o **Inicio**, os **modulos** que
  a sessao alcanca, os **Ajustes** e quem esta logado, com o "Sair". O destino
  aberto leva `aria-current="page"`, pintado com fundo e peso, e nao so cor.
- **Barra superior**: onde se esta e o botao de tema, que alterna Sistema,
  Claro e Escuro.
- **Menu inferior**, abaixo de 768px: os mesmos destinos, ao alcance do
  polegar; o "Sair" passa para a barra superior. So um dos dois menus e
  montado por vez — os dois na pagina seriam dois menus "Principal" para o
  leitor de tela.
- Clicar no modulo aberto volta para o comeco dele, a lista. Cada destino abre
  do topo, e quando o botao clicado some junto com a pagina (o "Abrir" de um
  widget) o foco vai para o titulo da pagina nova.

### Modulos

`web/src/modules/registry.js` lista os modulos, na ordem da barra lateral.
Cada um declara nome, descricao, icone, o escopo de leitura que o torna
visivel, o de escrita que vira `canWrite`, a view, carregada sob demanda, e o
widget do Inicio. Quem nao tem o escopo de leitura nao ve o modulo: a tela nao
oferece o que a API so responderia com 403. Modulo novo e uma entrada no
registro, a view e o widget — a casca nao muda.

O modulo que sai e **desmontado**, nao so escondido: as telas reusam nomes de
classe parecidos, e manter duas no DOM vazava linha de uma para a contagem da
outra em teste E2E. Por isso tambem `ReportList` e `ReceiptList` usam
`.list-item*`, e nao `.task*`.

### Inicio

Um widget por modulo, com o resumo do proprio modulo e o "Abrir":

- **Tarefas**: quantas estao pendentes, em andamento e concluidas — o
  `meta.total` de cada filtro, e nao a contagem da primeira pagina — e as
  abertas, as em andamento primeiro.
- **Prestacao de Contas**: quantos relatorios estao abertos e fechados, e os
  abertos. O titulo abre direto o detalhe do relatorio.

### Ajustes

- **Tema**: Sistema, Claro ou Escuro, guardado no navegador (`localStorage`,
  chave `tasktab:tema`). O do sistema segue o aparelho pela media query do
  CSS; a escolha explicita vira `data-theme` no `<html>`, aplicada na carga por
  `web/public/tema.js`, antes do React, para nao piscar o outro tema.
- **Conta**: nome, e-mail, papel e a troca da propria senha.

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
- **Entregas** no rodape do cartao do relatorio: Excel e Anexo I, que so
  levam o confirmado e ficam desligados ate haver um, e o PDF consolidado e os
  PDFs por categoria, que levam toda pagina.
- **Conferencia** do relatorio inteiro no detalhe (`ValidationPanel`),
  agrupada pela classe do procedimento, com "Ver comprovante" em cada alerta
  que tem um.
- **Fechar o relatorio** passa pela checagem final (`FinalCheck`, num
  `ConfirmDialog`): cada item diz em texto se confere ou o que falta. Com algo
  em aberto, o botao vira "Fechar mesmo assim"; reabrir e direto.
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
    extracao regrava data, valor e categoria. O que espera revisao reprocessa
    direto: e o passo depois de girar a pagina de cabeca para baixo, e o giro
    gravado vale ao reabrir a revisao.
- **Descartar um comprovante**: pagina em branco no fim do PDF ou cupom de
  outra viagem nao se resolve na revisao, e um `needs_review` insoluvel trava a
  fila. Nenhum status e bloqueado. A exclusao e definitiva e leva o PDF junto
  quando nenhuma outra pagina o referencia, por isso passa sempre pelo
  `ConfirmDialog`, que mostra data e valor do alvo.

## Paleta

A base e neutra, em tons de zinco, com tema claro e escuro. Os tons de status
seguem o **GitHub Dark Colorblind** (Protanopia & Deuteranopia), cuja
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
