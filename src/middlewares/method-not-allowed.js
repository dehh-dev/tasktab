'use strict';

const { MethodNotAllowedError } = require('../../infra/errors');

const ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Responde 405 para metodo errado em caminho que existe.
 *
 * Chamado no fim de cada router, le os metodos ja registrados por caminho e
 * acrescenta um `.all()` que so e alcancado quando nenhum deles casou. Escrito
 * a mao em cada arquivo, a lista do `Allow` ficaria desatualizada na primeira
 * rota nova; lida do proprio router, nao tem como divergir.
 *
 * Nao passa por `requireScope` de proposito: o metodo errado e o mesmo para
 * qualquer pessoa, e o caminho nao e segredo — a rota inexistente ja responde
 * 404 sem sessao.
 */
function rejectOtherMethods(router) {
  const byPath = new Map();

  for (const layer of router.stack) {
    if (!layer.route) continue;

    const methods = byPath.get(layer.route.path) || new Set();

    for (const method of Object.keys(layer.route.methods)) {
      methods.add(method.toUpperCase());
    }

    byPath.set(layer.route.path, methods);
  }

  for (const [path, methods] of byPath) {
    // O Express responde HEAD com o handler do GET.
    if (methods.has('GET')) methods.add('HEAD');

    const allow = ORDER.filter((method) => methods.has(method));

    router.all(path, (req, res, next) => {
      // OPTIONS segue para a resposta automatica do Express, que ja lista o
      // `Allow` do caminho.
      if (req.method === 'OPTIONS') return next();

      res.set('Allow', allow.join(', '));
      next(new MethodNotAllowedError({ method: req.method, allow }));
    });
  }

  return router;
}

module.exports = rejectOtherMethods;
