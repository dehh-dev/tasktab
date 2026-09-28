'use strict';

/**
 * Escopos e papeis.
 *
 * A autorizacao deste projeto tem **dois eixos**, e separa-los e o que evita a
 * mistura que costuma virar bug de permissao:
 *
 * 1. **Escopo** — que _acao_ sobre que _recurso_ (`reports:write`). Checado no
 *    mapeamento da rota, antes de qualquer consulta ao banco.
 * 2. **Posse** — _quais linhas_. Vive em `ownership.js` e roda no controller,
 *    depois de carregar o registro.
 *
 * Os escopos terminados em `:any` sao a ponte entre os dois: quem os tem
 * dispensa a checagem de posse. Sem eles, "admin" viraria um `if` espalhado
 * por cada controller — que e exatamente onde uma permissao passa despercebida.
 *
 * A posse e propriedade do **relatorio**. Comprovantes, imagens e exportacoes
 * herdam a do relatorio a que pertencem: um cupom nao tem dono proprio, tem o
 * dono da prestacao de contas em que foi lancado.
 *
 * Emitentes (`merchants`) sao cadastro **compartilhado** de propositio: a
 * categoria de um CNPJ e a mesma para todo mundo, e duplicar o cadastro por
 * pessoa faria a mesma padaria ser classificada de dois jeitos.
 *
 * Tarefas tambem sao compartilhadas — o quadro e um so. Se um dia cada pessoa
 * precisar do seu, o caminho e `tasks.owner_id` mais um `tasks:read:any`,
 * espelhando o que ja existe para relatorios.
 */

const SCOPES = [
  'tasks:read',
  'tasks:write',
  'reports:read',
  'reports:write',
  // Alcanca relatorio de qualquer dono, inclusive os sem dono (legado).
  'reports:read:any',
  'reports:write:any',
  'receipts:read',
  'receipts:write',
  'merchants:read',
  'merchants:write',
  'users:read',
  'users:write',
];

const ROLES = ['admin', 'user', 'auditor'];

/**
 * Papel -> escopos.
 *
 * - `admin` administra pessoas e alcanca a prestacao de contas de todas elas.
 * - `user` e quem presta contas: cria e revisa **os seus** relatorios.
 * - `auditor` e quem confere e assina: le tudo, escreve nada. E o unico papel
 *   com `:any` sem o par de escrita, e a razao de os dois serem separados.
 */
const ROLE_SCOPES = {
  admin: SCOPES,

  user: [
    'tasks:read',
    'tasks:write',
    'reports:read',
    'reports:write',
    'receipts:read',
    'receipts:write',
    'merchants:read',
    'merchants:write',
  ],

  auditor: [
    'tasks:read',
    'reports:read',
    'reports:read:any',
    'receipts:read',
    'merchants:read',
  ],
};

function scopesForRole(role) {
  return ROLE_SCOPES[role] || [];
}

function hasScope(user, scope) {
  return Boolean(user) && user.scopes.includes(scope);
}

module.exports = { SCOPES, ROLES, ROLE_SCOPES, scopesForRole, hasScope };
