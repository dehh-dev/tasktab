'use strict';

const db = require('../src/config/database');

function truncateTasks() {
  return db.query('TRUNCATE TABLE tasks RESTART IDENTITY');
}

/** Insere uma task direto no banco, sem passar pela API. */
async function insertTask(overrides = {}) {
  const task = {
    title: 'Tarefa de teste',
    description: null,
    status: 'pending',
    due_date: null,
    ...overrides,
  };

  const { rows } = await db.query(
    `INSERT INTO tasks (title, description, status, due_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, description, status, due_date, created_at, updated_at`,
    [task.title, task.description, task.status, task.due_date],
  );

  return rows[0];
}

module.exports = { truncateTasks, insertTask, db };
