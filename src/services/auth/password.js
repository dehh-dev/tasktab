'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

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
const COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// 128 * N * r = 16 MB para os parametros acima. O padrao do Node (32 MB) ja
// cobre, mas deixar explicito evita que subir o N mais tarde estoure com um
// "memory limit exceeded" que nao diz de onde veio.
const MAX_MEMORY = 64 * 1024 * 1024;

// Teto do que chega a KDF. Sem ele, uma senha de 10 MB viraria um jeito barato
// de ocupar a CPU do servidor — a KDF e cara **de proposito**.
const MAX_PASSWORD_BYTES = 1024;

async function derive(password, salt, cost) {
  return scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
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
    'scrypt',
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

  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, N, r, p, salt, expected] = parts;
  const cost = { N: Number(N), r: Number(r), p: Number(p) };

  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'base64');

  let derived;

  try {
    derived = await derive(password, Buffer.from(salt, 'base64'), cost);
  } catch {
    return false;
  }

  if (derived.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, expectedBuffer);
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
};
