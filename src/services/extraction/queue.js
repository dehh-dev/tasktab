'use strict';

const { logger } = require('../../../infra/logger');

/**
 * Fila de processamento **em processo**, uma tarefa por vez.
 *
 * OCR de 30 paginas nao cabe num ciclo de request: o upload responde 202 e o
 * trabalho segue aqui. Serial de proposito — o OCR ja e pesado, e rodar varias
 * paginas em paralelo disputaria CPU sem ganhar tempo de parede.
 *
 * **Quando trocar por fila de verdade (BullMQ + Redis):** quando houver uso
 * concorrente, porque hoje um segundo processo nao ve esta fila e um reinicio
 * perde o que estava na memoria. A unidade de trabalho ja e "uma pagina, um
 * registro", entao a migracao e local: troca-se o `enqueue` e o consumidor,
 * sem mexer no resto.
 */
const pending = [];
let draining = false;

async function drain() {
  if (draining) {
    return;
  }

  draining = true;

  while (pending.length > 0) {
    const { task, name } = pending.shift();

    try {
      await task();
    } catch (error) {
      // Uma tarefa que falha nao pode parar a fila: o lote de 30 cupons e o
      // caso de uso, e perder os 29 restantes seria pior que a planilha
      // manual que este projeto substitui.
      logger.error({ err: error, task: name }, 'tarefa da fila falhou');
    }
  }

  draining = false;
}

function enqueue(name, task) {
  pending.push({ name, task });
  // Sem await: quem enfileira nao espera. O `drain` roda em segundo plano.
  drain();
}

/** Quantas tarefas ainda nao terminaram. Usado por health e diagnostico. */
function size() {
  return pending.length + (draining ? 1 : 0);
}

module.exports = { enqueue, size };
