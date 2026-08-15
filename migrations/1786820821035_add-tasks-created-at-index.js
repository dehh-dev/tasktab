'use strict';

exports.shorthands = undefined;

const INDEX_NAME = 'tasks_created_at_id_desc_index';

// A listagem ordena por `created_at DESC, id DESC` e pagina com LIMIT/OFFSET.
// Os indices existentes (status, due_date) nao servem a essa ordenacao, entao
// cada requisicao fazia sort da tabela inteira. O indice composto, na mesma
// direcao do ORDER BY, permite ler ja ordenado.
exports.up = (pgm) => {
  pgm.createIndex(
    'tasks',
    [
      { name: 'created_at', sort: 'DESC' },
      { name: 'id', sort: 'DESC' },
    ],
    { name: INDEX_NAME },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex('tasks', [], { name: INDEX_NAME });
};
