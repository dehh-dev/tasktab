'use strict';

/**
 * Resposta da API nao fica guardada no navegador.
 *
 * O cache do navegador guarda pela URL e nao sabe de sessao: o que ficasse
 * nele sobreviveria ao logout, que apaga a sessao no banco mas nao toca no
 * disco de quem usou. E toda resposta daqui pertence a uma sessao — relatorio,
 * exportacao, comprovante com CNPJ e as vezes CPF de terceiros.
 *
 * Quem precisa de outra politica sobrescreve o header na propria rota: a
 * imagem do comprovante, guardada so para revalidar.
 */
const NO_STORE = 'no-store, no-cache, max-age=0, must-revalidate';

function noStore(req, res, next) {
  res.set('Cache-Control', NO_STORE);
  next();
}

module.exports = noStore;
