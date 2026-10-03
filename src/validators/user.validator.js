'use strict';

const { BadRequestError, ValidationError } = require('../../infra/errors');
const { isBlank, parseId, parsePagination } = require('./rules');
const { ROLES } = require('../services/auth/scopes');
const { MAX_PASSWORD_BYTES } = require('../services/auth/password');

const BODY_NOT_OBJECT = {
  message: 'Corpo da requisicao deve ser um objeto JSON.',
  action: 'Envie um objeto com os campos do usuario.',
};

const INVALID_ID = {
  message: 'id deve ser um inteiro positivo.',
  action: 'Use o id numerico devolvido pela listagem de usuarios.',
};

const NAME_MAX_LENGTH = 255;
const EMAIL_MAX_LENGTH = 255;

/**
 * Minimo de 10 caracteres, sem exigencia de simbolo ou maiuscula.
 *
 * Comprimento e o que de fato encarece um ataque; regra de composicao produz
 * `Senha@123` e a sensacao de que isso e forte. A KDF (scrypt) cuida do resto.
 */
const PASSWORD_MIN_LENGTH = 10;

/**
 * Validacao de e-mail deliberadamente frouxa: um `@` com algo dos dois lados e
 * sem espaco. O regex "completo" de e-mail e famoso por recusar endereco
 * valido, e quem erra o proprio e-mail descobre no primeiro login, nao aqui.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertValid(errors) {
  if (errors.length > 0) {
    throw new ValidationError({ details: errors });
  }
}

function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(BODY_NOT_OBJECT);
  }
}

function validateName(value, errors) {
  if (typeof value !== 'string') {
    errors.push({ field: 'name', message: 'name deve ser uma string' });
    return undefined;
  }

  const name = value.trim();

  if (name === '') {
    errors.push({ field: 'name', message: 'name e obrigatorio' });
    return undefined;
  }

  if (name.length > NAME_MAX_LENGTH) {
    errors.push({
      field: 'name',
      message: `name deve ter no maximo ${NAME_MAX_LENGTH} caracteres`,
    });
    return undefined;
  }

  return name;
}

/**
 * O e-mail e normalizado para minusculas aqui, e o banco tem uma constraint
 * exigindo o mesmo. Sem a normalizacao, "Ana@x" e "ana@x" seriam dois
 * cadastros e o login viraria loteria.
 */
function validateEmail(value, errors) {
  if (typeof value !== 'string') {
    errors.push({ field: 'email', message: 'email deve ser uma string' });
    return undefined;
  }

  const email = value.trim().toLowerCase();

  if (email === '') {
    errors.push({ field: 'email', message: 'email e obrigatorio' });
    return undefined;
  }

  if (email.length > EMAIL_MAX_LENGTH) {
    errors.push({
      field: 'email',
      message: `email deve ter no maximo ${EMAIL_MAX_LENGTH} caracteres`,
    });
    return undefined;
  }

  if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'email', message: 'email invalido' });
    return undefined;
  }

  return email;
}

function validatePassword(value, errors, field = 'password') {
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} deve ser uma string` });
    return undefined;
  }

  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push({
      field,
      message: `${field} deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
    });
    return undefined;
  }

  // O teto protege a KDF: scrypt e caro de proposito, e uma senha enorme
  // viraria um jeito barato de ocupar a CPU do servidor.
  if (Buffer.byteLength(value) > MAX_PASSWORD_BYTES) {
    errors.push({
      field,
      message: `${field} deve ter no maximo ${MAX_PASSWORD_BYTES} bytes`,
    });
    return undefined;
  }

  return value;
}

function validateRole(value, errors) {
  if (typeof value !== 'string' || !ROLES.includes(value)) {
    errors.push({
      field: 'role',
      message: `role deve ser um de: ${ROLES.join(', ')}`,
    });
    return undefined;
  }

  return value;
}

function validateCreate(body) {
  assertObject(body);

  const errors = [];
  const data = {};

  for (const field of ['name', 'email', 'password']) {
    if (isBlank(body[field])) {
      errors.push({ field, message: `${field} e obrigatorio` });
    }
  }

  if (!isBlank(body.name)) {
    data.name = validateName(body.name, errors);
  }

  if (!isBlank(body.email)) {
    data.email = validateEmail(body.email, errors);
  }

  if (!isBlank(body.password)) {
    data.password = validatePassword(body.password, errors);
  }

  if (body.role !== undefined) {
    data.role = validateRole(body.role, errors);
  }

  assertValid(errors);

  return data;
}

/**
 * Update parcial. `canManage` diz se quem faz a requisicao carrega
 * `users:write`: sem isso a pessoa mexe no proprio cadastro, mas nao no
 * proprio papel — do contrario qualquer conta viraria administradora sozinha,
 * que e a falha de escalonamento de privilegio mais comum que existe.
 */
function validateUpdate(body, { canManage = false } = {}) {
  assertObject(body);

  const errors = [];
  const data = {};

  if (body.name !== undefined) {
    data.name = validateName(body.name, errors);
  }

  if (body.role !== undefined) {
    if (!canManage) {
      errors.push({
        field: 'role',
        message: 'apenas um administrador pode alterar o papel',
      });
    } else {
      data.role = validateRole(body.role, errors);
    }
  }

  if (body.password !== undefined) {
    data.password = validatePassword(body.password, errors);

    // Quem troca a propria senha prova que e quem diz ser. E o que impede que
    // uma sessao esquecida num navegador alheio vire a posse definitiva da
    // conta. Um administrador redefinindo a senha de outra pessoa nao tem como
    // saber a atual — por isso a exigencia so vale para si mesmo, e o
    // controller e quem sabe de quem e o cadastro.
    if (body.current_password !== undefined) {
      data.current_password = body.current_password;
    }
  }

  if (body.email !== undefined) {
    errors.push({
      field: 'email',
      message: 'email nao pode ser alterado por esta rota',
    });
  }

  assertValid(errors);

  if (Object.keys(data).length === 0) {
    throw new ValidationError({
      message: 'Informe ao menos um campo para atualizar.',
      details: [
        { field: 'body', message: 'campos aceitos: name, password, role' },
      ],
    });
  }

  return data;
}

function validateLogin(body) {
  assertObject(body);

  const errors = [];

  if (isBlank(body.email)) {
    errors.push({ field: 'email', message: 'email e obrigatorio' });
  }

  // A senha nao passa pelas regras de forca aqui. Recusar por tamanho no login
  // diria ao atacante que a regra existe e encurtaria a busca dele; alem
  // disso, endurecer a regra depois trancaria quem cadastrou antes.
  if (isBlank(body.password) || typeof body.password !== 'string') {
    errors.push({ field: 'password', message: 'password e obrigatorio' });
  }

  assertValid(errors);

  return {
    email: String(body.email).trim().toLowerCase(),
    password: body.password,
  };
}

function validateId(rawId) {
  return parseId(rawId, INVALID_ID);
}

function validateListQuery(query = {}) {
  const errors = [];
  const result = { limit: 50, offset: 0 };

  Object.assign(result, parsePagination(query, errors));

  assertValid(errors);
  return result;
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  NAME_MAX_LENGTH,
  validateCreate,
  validateUpdate,
  validateLogin,
  validateId,
  validateListQuery,
};
