'use strict';

const fs = require('fs');

let prepared = false;

/**
 * O `zxing-wasm` com o `.wasm` do pacote instalado.
 *
 * Por padrao ele busca o `.wasm` no jsDelivr na primeira leitura de cada
 * processo. Sem rede, ou com o CDN fora, nenhum QR era lido, e a suite, que
 * gera o QR das fixtures com ele, nao rodava. Leitura e escrita passam por
 * aqui, e o modulo e carregado sob demanda, como as outras dependencias
 * pesadas da extracao.
 */
function zxing() {
  const library = require('zxing-wasm');

  if (!prepared) {
    library.prepareZXingModule({
      overrides: {
        wasmBinary: fs.readFileSync(
          require.resolve('zxing-wasm/full/zxing_full.wasm'),
        ),
      },
    });
    prepared = true;
  }

  return library;
}

module.exports = { zxing };
