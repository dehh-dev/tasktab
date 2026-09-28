'use strict';

const db = require('../config/database');

/**
 * `password_hash` **nunca** entra aqui. Toda leitura da API passa por estas
 * colunas, e o unico caminho que traz o hash e o `findByEmailWithSecret`, que
 * so o login chama. Fosse por omissao no controller, bastaria um `res.json`
 * distraido para o hash sair na resposta.
 */
const COLUMNS = 'id, name, email, role, created_at, updated_at';

// Colunas que um update parcial pode alterar. `email` fica de fora: trocar o
// e-mail troca a identidade de login, e o caminho para isso e um endpoint
// proprio, nao um PATCH que passou por acaso.
const UPDATABLE_COLUMNS = ['name', 'role'];

async function findAll({ limit = 50, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM users ORDER BY name, id LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function count() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM users');
  return rows[0].total;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Os dois unicos caminhos que devolvem o hash: o login (que so tem o e-mail) e
 * a troca da propria senha (que precisa conferir a atual). Qualquer outra
 * leitura passa por `COLUMNS`, onde o hash nao existe.
 */
async function findByEmailWithSecret(email) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

async function findByIdWithSecret(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, password_hash FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function existsByEmail(email) {
  const { rows } = await db.query('SELECT 1 FROM users WHERE email = $1', [
    email,
  ]);
  return rows.length > 0;
}

async function create({ name, email, password_hash, role }) {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, COALESCE($4::user_role, 'user'::user_role))
     RETURNING ${COLUMNS}`,
    [name, email, password_hash, role || null],
  );
  return rows[0];
}

async function update(id, data) {
  const assignments = [];
  const params = [];

  for (const column of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(data, column)) {
      params.push(data[column]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length === 0) {
    return findById(id);
  }

  // `updated_at` fica por conta do trigger users_set_updated_at.
  params.push(id);

  const { rows } = await db.query(
    `UPDATE users SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] || null;
}

/** Troca de senha. Separado do update por nao aceitar valor cru em lote. */
async function updatePassword(id, passwordHash) {
  const { rows } = await db.query(
    `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
    [passwordHash, id],
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await db.query(
    'DELETE FROM users WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}

/**
 * Quantos usuarios tem um papel. E o que sustenta a regra de nao ficar sem
 * administrador: sem ela, o ultimo admin pode se rebaixar e ninguem mais
 * consegue cadastrar pessoa nenhuma.
 */
async function countByRole(role) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM users WHERE role = $1',
    [role],
  );
  return rows[0].total;
}

module.exports = {
  COLUMNS,
  UPDATABLE_COLUMNS,
  findAll,
  count,
  findById,
  findByEmailWithSecret,
  findByIdWithSecret,
  existsByEmail,
  create,
  update,
  updatePassword,
  remove,
  countByRole,
};
