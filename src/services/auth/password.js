'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const env = require('../../config/env');

const scrypt = promisify(crypto.scrypt);

/**
 * Hash de senha com `scrypt`, do proprio Node.
 *
 * Nao entra `bcrypt` nem `argon2` aqui: os dois trazem binario nativo para
 * fazer o que a biblioteca padrao ja faz, e o projeto e deliberadamente
 * enxuto. `scrypt` e uma KDF de verdade — custo de memoria configuravel, e nao
 * um digest rapido como SHA-256, que uma GPU testa aos bilhoes por segundo.
 *
 * Os parametros vao **dentro** do hash (`scrypt$N$r$p$salt$hash`). Endurecer o
 * custo depois passa a valer para as senhas novas sem invalidar as antigas: a
 * verificacao le o custo de cada registro em vez de assumir o atual.
 */
const COST = { N: 16384, r: 8, p: env.password.scryptP };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// 128 * N * r = 16 MB para os parametros acima. O padrao do Node (32 MB) ja
// cobre, mas deixar explicito evita que subir o N mais tarde estoure com um
// "memory limit exceeded" que nao diz de onde veio.
const MAX_MEMORY = 64 * 1024 * 1024;

// Teto do que chega a KDF. Sem ele, uma senha de 10 MB viraria um jeito barato
// de ocupar a CPU do servidor — a KDF e cara **de proposito**.
const MAX_PASSWORD_BYTES = 1024;

// `scrypt-hmac` passa a senha pelo HMAC do pepper antes da KDF; `scrypt` e o
// formato anterior, sem pepper, que so continua sendo lido ate o proximo login
// refazer o hash (`needsRehash`).
const SCHEME = 'scrypt-hmac';
const LEGACY_SCHEME = 'scrypt';

/**
 * Segredo que nao mora no banco: com ele, uma copia do banco sozinha nao basta
 * para testar senhas fora do sistema.
 *
 * Lido a cada chamada, e nao no carregamento do modulo, e sem valor padrao:
 * pepper ausente e falha de configuracao, e cair num valor fixo gravaria hashes
 * que deixam de bater no dia em que o pepper real for configurado.
 *
 * **Trocar o pepper invalida todas as senhas** — cada pessoa precisa de
 * `npm run users:create -- --replace` para entrar de novo.
 */
function pepper() {
  const value = process.env.PASSWORD_PEPPER;

  if (!value) {
    throw new Error('PASSWORD_PEPPER ausente: configure o pepper das senhas');
  }

  return value;
}

/**
 * HMAC e nao concatenacao: a saida tem tamanho fixo, entao nem o teto de
 * `MAX_PASSWORD_BYTES` nem uma senha longa empurram o pepper para fora do que a
 * KDF le.
 */
function withPepper(password) {
  return crypto
    .createHmac('sha256', pepper())
    .update(password.normalize('NFKC'))
    .digest();
}

async function derive(password, salt, cost, scheme = SCHEME) {
  const input =
    scheme === SCHEME ? withPepper(password) : password.normalize('NFKC');

  return scrypt(input, salt, KEY_LENGTH, {
    N: cost.N,
    r: cost.r,
    p: cost.p,
    maxmem: MAX_MEMORY,
  });
}

async function hash(password) {
  assertLength(password);

  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await derive(password, salt, COST);

  return [
    SCHEME,
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

function assertLength(password) {
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new Error('senha acima do limite aceito pela KDF');
  }
}

/**
 * Confere a senha contra o hash gravado.
 *
 * A comparacao e `timingSafeEqual` e nao `===`: o `===` sai no primeiro byte
 * diferente, e o tempo da resposta acaba contando quantos bytes bateram.
 */
async function verify(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') {
    return false;
  }

  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    return false;
  }

  const parts = stored.split('$');

  if (parts.length !== 6 || ![SCHEME, LEGACY_SCHEME].includes(parts[0])) {
    return false;
  }

  const [scheme, N, r, p, salt, expected] = parts;
  const cost = { N: Number(N), r: Number(r), p: Number(p) };

  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'base64');

  // Sem catch: o hash vem do banco, e se a KDF recusa os parametros dele o
  // defeito e do registro, nao da senha. Responder "senha incorreta" mandaria
  // a pessoa tentar de novo ate o limitador bloquear, sem nada no log.
  const derived = await derive(
    password,
    Buffer.from(salt, 'base64'),
    cost,
    scheme,
  );

  if (derived.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, expectedBuffer);
}

/**
 * O hash gravado foi feito com outro custo que o atual.
 *
 * Vale tambem para o formato sem pepper. Endurecer o custo so alcancaria as senhas novas: quem ja tem conta seguiria
 * com o custo antigo para sempre. O login e o unico momento em que a senha em
 * claro passa pelo servidor, entao e ali que o hash e refeito.
 */
function needsRehash(stored) {
  const [scheme, N, r, p] = stored.split('$');

  return (
    scheme !== SCHEME ||
    Number(N) !== COST.N ||
    Number(r) !== COST.r ||
    Number(p) !== COST.p
  );
}

/**
 * Hash descartavel para conferir contra e-mail inexistente.
 *
 * Sem isso o login responderia na hora quando o e-mail nao existe e apos a KDF
 * quando existe — e a diferenca de tempo entrega quais e-mails estao
 * cadastrados. Fica em cache porque so o custo importa, nao o valor.
 */
let dummy = null;

async function dummyVerify(password) {
  if (!dummy) {
    dummy = await hash(crypto.randomBytes(32).toString('base64'));
  }

  return verify(typeof password === 'string' ? password : '', dummy);
}

/** Senha aleatoria para o primeiro cadastro, feito pela linha de comando. */
function generate(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = {
  hash,
  verify,
  dummyVerify,
  generate,
  COST,
  MAX_PASSWORD_BYTES,
  needsRehash,
};
