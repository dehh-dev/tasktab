'use strict';

const net = require('net');
const env = require('../../src/config/env');

// Mensagens do cliente que executam SQL: `Q` e a consulta simples, e `E` o
// Execute do protocolo estendido, que o `pg` usa sempre que ha parametro.
const QUERY = 'Q'.charCodeAt(0);
const EXECUTE = 'E'.charCodeAt(0);

/**
 * Repasse TCP entre uma API de teste e o Postgres, contando as consultas que
 * passam por ele. Nada e alterado no caminho: a API e o banco sao os de
 * verdade, e o repasse so le os bytes que encaminha.
 *
 * Cada mensagem do cliente tem um byte de tipo e o tamanho em 4 bytes; so a
 * primeira de cada conexao (a de startup) vem sem o tipo.
 */
async function startQueryCounter() {
  let count = 0;
  const sockets = new Set();

  const server = net.createServer((client) => {
    const upstream = net.connect(env.database.port, env.database.host);
    let pending = Buffer.alloc(0);
    let startup = true;

    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }

    client.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);

      for (;;) {
        const offset = startup ? 0 : 1;

        if (pending.length < offset + 4) {
          break;
        }

        const size = offset + pending.readInt32BE(offset);

        if (pending.length < size) {
          break;
        }

        if (!startup && (pending[0] === QUERY || pending[0] === EXECUTE)) {
          count += 1;
        }

        startup = false;
        pending = pending.subarray(size);
      }
    });

    client.pipe(upstream);
    upstream.pipe(client);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    host: '127.0.0.1',
    port: server.address().port,
    count: () => count,
    reset() {
      count = 0;
    },
    stop() {
      for (const socket of sockets) {
        socket.destroy();
      }

      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { startQueryCounter };
