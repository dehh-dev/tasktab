'use strict';

const db = require('../src/config/database');

/** Retorna uma data ISO 'YYYY-MM-DD' deslocada em N dias a partir de hoje. */
function daysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const TASKS = [
  {
    title: 'Configurar ambiente de desenvolvimento',
    description: 'Subir o Postgres via docker compose e rodar as migrations.',
    status: 'done',
    due_date: daysFromNow(-7),
  },
  {
    title: 'Modelar a tabela de tarefas',
    description: 'Definir colunas, enum de status e indices necessarios.',
    status: 'done',
    due_date: daysFromNow(-3),
  },
  {
    title: 'Implementar endpoints REST do CRUD',
    description: 'index, show, create, update e delete em /api/tasks.',
    status: 'in_progress',
    due_date: daysFromNow(2),
  },
  {
    title: 'Escrever testes automatizados',
    description: null,
    status: 'pending',
    due_date: daysFromNow(5),
  },
  {
    title: 'Publicar a API em producao',
    description:
      'Injetar as variaveis de ambiente reais e rodar as migrations.',
    status: 'pending',
    due_date: null,
  },
];

async function seed() {
  await db.query('TRUNCATE TABLE tasks RESTART IDENTITY');

  for (const task of TASKS) {
    await db.query(
      `INSERT INTO tasks (title, description, status, due_date)
       VALUES ($1, $2, $3, $4)`,
      [task.title, task.description, task.status, task.due_date],
    );
  }

  console.log(`Seed concluido: ${TASKS.length} tarefas inseridas.`);
}

seed()
  .catch((error) => {
    console.error('Falha ao rodar o seed:', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
