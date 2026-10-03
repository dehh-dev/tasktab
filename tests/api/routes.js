'use strict';

/**
 * Todas as rotas de `/api` que exigem sessao — a lista que as duas matrizes
 * percorrem: a de autorizacao (`auth/scopes.test.js`) e a de contrato
 * (`contract.test.js`). **Rota nova entra aqui**, ou nenhuma das duas a
 * confere, e e justamente a rota esquecida que elas existem para pegar.
 *
 * - `roles`: quem passa do portao da rota. E o `requireScope`, ou, no cadastro
 *   de pessoas, o `requireAuth` mais a posse — o `:id` da matriz de
 *   autorizacao e sempre o cadastro de outra pessoa.
 * - `body`: um corpo valido, nas rotas de edicao. Tarefa, emitente e pessoa
 *   validam o corpo antes de procurar o registro; sem ele, o id inexistente
 *   responderia 422 em vez de 404.
 */
const EVERYONE = ['admin', 'user', 'auditor'];
const WRITERS = ['admin', 'user'];
const ADMIN = ['admin'];

const ROUTES = [
  { method: 'POST', path: '/api/auth/logout', roles: EVERYONE },
  { method: 'GET', path: '/api/auth/me', roles: EVERYONE },

  { method: 'GET', path: '/api/users', roles: ADMIN },
  { method: 'POST', path: '/api/users', roles: ADMIN },
  { method: 'GET', path: '/api/users/:id', roles: ADMIN },
  {
    method: 'PATCH',
    path: '/api/users/:id',
    roles: ADMIN,
    body: { name: 'Outro Nome' },
  },
  { method: 'DELETE', path: '/api/users/:id', roles: ADMIN },

  { method: 'GET', path: '/api/tasks', roles: EVERYONE },
  { method: 'POST', path: '/api/tasks', roles: WRITERS },
  { method: 'GET', path: '/api/tasks/:id', roles: EVERYONE },
  {
    method: 'PATCH',
    path: '/api/tasks/:id',
    roles: WRITERS,
    body: { title: 'Outro titulo' },
  },
  { method: 'DELETE', path: '/api/tasks/:id', roles: WRITERS },

  { method: 'GET', path: '/api/reports', roles: EVERYONE },
  { method: 'POST', path: '/api/reports', roles: WRITERS },
  { method: 'GET', path: '/api/reports/:id', roles: EVERYONE },
  {
    method: 'PATCH',
    path: '/api/reports/:id',
    roles: WRITERS,
    body: { title: 'Outro titulo' },
  },
  { method: 'DELETE', path: '/api/reports/:id', roles: WRITERS },
  { method: 'GET', path: '/api/reports/:id/receipts', roles: EVERYONE },
  { method: 'POST', path: '/api/reports/:id/receipts', roles: WRITERS },
  { method: 'GET', path: '/api/reports/:id/validation', roles: EVERYONE },
  { method: 'GET', path: '/api/reports/:id/export.xlsx', roles: EVERYONE },
  {
    method: 'GET',
    path: '/api/reports/:id/export/anexo-i.xlsx',
    roles: EVERYONE,
  },
  { method: 'GET', path: '/api/reports/:id/export.pdf', roles: EVERYONE },
  {
    method: 'GET',
    path: '/api/reports/:id/export/pdfs-por-categoria.zip',
    roles: EVERYONE,
  },

  { method: 'GET', path: '/api/receipts/:id', roles: EVERYONE },
  {
    method: 'PATCH',
    path: '/api/receipts/:id',
    roles: WRITERS,
    body: { amount_cents: 100 },
  },
  { method: 'DELETE', path: '/api/receipts/:id', roles: WRITERS },
  { method: 'POST', path: '/api/receipts/:id/reprocess', roles: WRITERS },
  { method: 'GET', path: '/api/receipts/:id/image', roles: EVERYONE },

  { method: 'GET', path: '/api/merchants', roles: EVERYONE },
  {
    method: 'GET',
    path: '/api/merchants/by-cnpj/26048802000165',
    roles: EVERYONE,
  },
  { method: 'POST', path: '/api/merchants', roles: WRITERS },
  { method: 'GET', path: '/api/merchants/:id', roles: EVERYONE },
  {
    method: 'PATCH',
    path: '/api/merchants/:id',
    roles: WRITERS,
    body: { default_category: 'outros' },
  },
];

/** Como a rota aparece nos mapas das matrizes: `GET /api/tasks/:id`. */
function label(route) {
  return `${route.method} ${route.path}`;
}

/** O caminho com o `:id` trocado por um valor. */
function pathWith(route, id) {
  return route.path.replace(':id', String(id));
}

/**
 * Um mapa `{ rota: valor }` para comparar de uma vez so: na falha, o diff do
 * Jest mostra exatamente quais rotas sairam do esperado.
 */
function byRoute(routes, valueFor) {
  return Object.fromEntries(
    routes.map((route) => [label(route), valueFor(route)]),
  );
}

module.exports = { ROUTES, EVERYONE, WRITERS, ADMIN, label, pathWith, byRoute };
