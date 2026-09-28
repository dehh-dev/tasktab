'use strict';

const User = require('../models/user.model');
const Session = require('../models/session.model');
const validator = require('../validators/user.validator');
const password = require('../services/auth/password');
const ownership = require('../services/auth/ownership');
const { hasScope } = require('../services/auth/scopes');
const { NotFoundError, ValidationError } = require('../../infra/errors');

function userNotFound(id) {
  return new NotFoundError({
    message: `Usuario ${id} nao encontrado.`,
    action: 'Verifique o id informado ou liste os usuarios disponiveis.',
  });
}

function emailAlreadyTaken() {
  return new ValidationError({
    message: 'Ja existe um usuario com este e-mail.',
    action: 'Use outro e-mail ou recupere o acesso do cadastro existente.',
    details: [{ field: 'email', message: 'email ja cadastrado' }],
  });
}

/** GET /api/users */
async function index(req, res) {
  const { limit, offset } = validator.validateListQuery(req.query);
  const [data, total] = await Promise.all([
    User.findAll({ limit, offset }),
    User.count(),
  ]);

  res.json({ data, meta: { total, limit, offset } });
}

/** GET /api/users/:id */
async function show(req, res) {
  const id = validator.validateId(req.params.id);

  // Quem nao tem `users:read` ainda alcanca o proprio cadastro. A checagem vem
  // antes da consulta: sem ela, a resposta diferente para id existente e
  // inexistente ja seria um mapa de quantas contas ha no sistema.
  ownership.assertCanReadUser(req.user, id);

  const user = await User.findById(id);

  if (!user) {
    throw userNotFound(id);
  }

  res.json({ data: user });
}

/**
 * POST /api/users
 *
 * Nao existe auto-cadastro. Numa ferramenta que guarda cupom fiscal com CNPJ e
 * as vezes CPF de terceiros, uma tela aberta de "criar conta" e uma porta para
 * qualquer um. Quem cria pessoas e quem tem `users:write`; o primeiro cadastro
 * de todos sai pela linha de comando (`npm run users:create`).
 */
async function create(req, res) {
  const data = validator.validateCreate(req.body);

  if (await User.existsByEmail(data.email)) {
    throw emailAlreadyTaken();
  }

  const user = await User.create({
    name: data.name,
    email: data.email,
    password_hash: await password.hash(data.password),
    role: data.role,
  });

  req.log.info(
    { created_user_id: user.id, role: user.role },
    'usuario cadastrado',
  );

  res.status(201).location(`/api/users/${user.id}`).json({ data: user });
}

/**
 * Impede o sistema de ficar sem administrador.
 *
 * Sem isto, o ultimo admin consegue se rebaixar ou se apagar e ninguem mais
 * cadastra pessoa nenhuma — o unico conserto seria um UPDATE direto no banco.
 */
async function assertNotLastAdmin(target, { action }) {
  if (target.role !== 'admin') {
    return;
  }

  if ((await User.countByRole('admin')) > 1) {
    return;
  }

  throw new ValidationError({
    message: `Nao e possivel ${action} o unico administrador do sistema.`,
    action: 'Promova outra pessoa a administrador antes de tentar de novo.',
    details: [{ field: 'role', message: 'e o unico administrador' }],
  });
}

/** PATCH /api/users/:id */
async function update(req, res) {
  const id = validator.validateId(req.params.id);

  ownership.assertCanWriteUser(req.user, id);

  const canManage = hasScope(req.user, 'users:write');
  const data = validator.validateUpdate(req.body, { canManage });

  const current = await User.findById(id);

  if (!current) {
    throw userNotFound(id);
  }

  if (data.role !== undefined && data.role !== current.role) {
    await assertNotLastAdmin(current, { action: 'rebaixar' });
  }

  if (data.password !== undefined) {
    await changePassword(req, current, data);
  }

  const fields = {};

  if (data.name !== undefined) {
    fields.name = data.name;
  }

  if (data.role !== undefined) {
    fields.role = data.role;
  }

  const user = await User.update(id, fields);

  res.json({ data: user });
}

/**
 * Troca de senha.
 *
 * Trocar a **propria** senha exige a atual: uma sessao esquecida num navegador
 * alheio nao pode virar a posse definitiva da conta. Um administrador
 * redefinindo a senha de outra pessoa nao tem como saber a atual, e para ele a
 * exigencia nao faz sentido.
 *
 * Depois da troca, as demais sessoes daquela pessoa caem. Se a senha vazou,
 * quem a usou continuaria dentro ate o token vencer. A sessao corrente e
 * poupada para nao expulsar justamente quem acabou de fazer a coisa certa.
 */
async function changePassword(req, current, data) {
  const isSelf = req.user.id === current.id;

  if (isSelf) {
    const stored = await User.findByIdWithSecret(current.id);
    const confirmed =
      typeof data.current_password === 'string' &&
      (await password.verify(data.current_password, stored.password_hash));

    if (!confirmed) {
      throw new ValidationError({
        message: 'Senha atual incorreta.',
        action: 'Informe a senha atual em current_password.',
        details: [
          { field: 'current_password', message: 'senha atual incorreta' },
        ],
      });
    }
  }

  await User.updatePassword(current.id, await password.hash(data.password));

  const revoked = await Session.removeByUser(current.id, {
    exceptId: isSelf ? req.session.id : undefined,
  });

  req.log.info(
    { target_user_id: current.id, revoked_sessions: revoked },
    'senha alterada',
  );
}

/**
 * DELETE /api/users/:id
 *
 * Os relatorios de quem sai **ficam**: a coluna `owner_id` e `ON DELETE SET
 * NULL`, nao cascade. Prestacao de contas assinada e evidencia, e some da
 * vista de quem nao tem `reports:read:any` sem sumir do sistema. E a mesma
 * razao pela qual nao existe expiracao automatica dos arquivos enviados.
 */
async function destroy(req, res) {
  const id = validator.validateId(req.params.id);
  const current = await User.findById(id);

  if (!current) {
    throw userNotFound(id);
  }

  // Apagar a si mesmo tranca a porta por dentro, e o 422 aqui e mais util que
  // descobrir isso depois de a sessao morrer junto.
  if (req.user.id === id) {
    throw new ValidationError({
      message: 'Nao e possivel apagar o proprio usuario.',
      action: 'Peca a outro administrador para remover esta conta.',
      details: [{ field: 'id', message: 'e o usuario da sessao atual' }],
    });
  }

  await assertNotLastAdmin(current, { action: 'apagar' });
  await User.remove(id);

  req.log.info({ deleted_user_id: id }, 'usuario removido');

  res.status(204).send();
}

module.exports = { index, show, create, update, destroy };
