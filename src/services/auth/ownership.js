'use strict';

const { NotFoundError, ForbiddenError } = require('../../../infra/errors');
const { hasScope } = require('./scopes');

/**
 * Posse: o segundo eixo da autorizacao (o primeiro e o escopo, checado na
 * rota). Aqui se decide **quais linhas** a sessao alcanca, ja com o registro
 * carregado.
 *
 * A posse e do relatorio. Comprovante, imagem e exportacao herdam a do
 * relatorio a que pertencem.
 */

/**
 * 404 e nao 403 quando o relatorio e de outra pessoa.
 *
 * Responder 403 confirmaria que o relatorio 7 existe para quem so queria
 * descobrir isso — dava para varrer os ids e mapear quantas prestacoes de
 * contas ha no sistema. Quem nao alcanca o registro recebe a mesma resposta
 * que receberia se ele nao existisse.
 *
 * O 403 continua valendo para o caso em que **a acao** e negada e nao o
 * registro: um auditor le o relatorio e tenta edita-lo. Ali esconder nada
 * adianta, porque ele acabou de ler o recurso.
 */
function reportNotFound(id) {
  return new NotFoundError({
    message: `Report ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os relatorios disponiveis.',
  });
}

function canReadReport(user, report) {
  if (hasScope(user, 'reports:read:any')) {
    return true;
  }

  return Boolean(report.owner_id) && report.owner_id === user.id;
}

function canWriteReport(user, report) {
  if (hasScope(user, 'reports:write:any')) {
    return true;
  }

  return Boolean(report.owner_id) && report.owner_id === user.id;
}

function assertCanReadReport(user, report) {
  if (!canReadReport(user, report)) {
    throw reportNotFound(report.id);
  }
}

/**
 * Escrita exige as duas coisas: alcancar a linha e ter o escopo de escrita.
 *
 * Um auditor tem `reports:read:any` e nenhum `reports:write`, entao le o
 * relatorio dos outros e recebe 403 ao tentar mudar qualquer coisa — que e
 * exatamente o papel de quem confere e assina.
 */
function assertCanWriteReport(user, report) {
  if (!canReadReport(user, report)) {
    throw reportNotFound(report.id);
  }

  if (!canWriteReport(user, report)) {
    throw new ForbiddenError({
      message: 'Este relatorio pertence a outra pessoa.',
      action: 'Peca a quem o criou, ou a um administrador, para altera-lo.',
    });
  }
}

/**
 * Quando a listagem deve se limitar ao dono. `undefined` significa "sem
 * filtro" — e o que o model espera de quem tem `reports:read:any`.
 *
 * Relatorio com `owner_id` nulo e legado (existia antes de haver usuarios) e
 * cai naturalmente fora do filtro: `owner_id = $1` nunca casa com NULL. So
 * quem tem `:any` os enxerga, que e o comportamento desejado.
 */
function reportOwnerFilter(user) {
  return hasScope(user, 'reports:read:any') ? undefined : user.id;
}

/**
 * Acesso ao cadastro de uma pessoa.
 *
 * Todo mundo le e edita o proprio cadastro sem precisar de `users:*` — trocar a
 * propria senha nao pode depender de um administrador. O que a pessoa pode
 * mudar em si mesma e menor que o que um administrador pode, e essa parte fica
 * no validator, que e onde as regras de campo moram.
 */
function assertCanReadUser(actor, targetId) {
  if (actor.id === targetId || hasScope(actor, 'users:read')) {
    return;
  }

  throw new ForbiddenError({
    message: 'Voce so pode consultar o seu proprio cadastro.',
    action: 'Peca a um administrador os dados de outra pessoa.',
  });
}

function assertCanWriteUser(actor, targetId) {
  if (actor.id === targetId || hasScope(actor, 'users:write')) {
    return;
  }

  throw new ForbiddenError({
    message: 'Voce so pode alterar o seu proprio cadastro.',
    action: 'Peca a um administrador para alterar outra pessoa.',
  });
}

module.exports = {
  reportNotFound,
  canReadReport,
  canWriteReport,
  assertCanReadReport,
  assertCanWriteReport,
  reportOwnerFilter,
  assertCanReadUser,
  assertCanWriteUser,
};
