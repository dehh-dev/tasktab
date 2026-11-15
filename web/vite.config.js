import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Grava ao lado de cada .js e .css do build uma copia em brotli e outra em
 * gzip. Em producao nao ha proxy na frente: e o Express que entrega o build
 * (`src/middlewares/web-assets.js`), e sem isto o bundle saia cru — 229 kB em
 * vez de ~65 kB. Comprimir aqui, uma vez, poupa a CPU de cada requisicao e
 * dependencia nova.
 */
function precompress() {
  return {
    name: 'tasktab-precompress',
    apply: 'build',
    async writeBundle(options, bundle) {
      const files = Object.keys(bundle).filter((name) =>
        /\.(js|css)$/.test(name),
      );

      await Promise.all(
        files.map(async (name) => {
          const file = path.join(options.dir, name);
          const source = await readFile(file);

          await Promise.all([
            writeFile(
              `${file}.br`,
              brotliCompressSync(source, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
              }),
            ),
            writeFile(`${file}.gz`, gzipSync(source, { level: 9 })),
          ]);
        }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), precompress()],
  server: {
    // O E2E sobe o proprio Vite em outra porta (WEB_PORT): reaproveitar o de
    // desenvolvimento na 5173 levaria a suite ate a API e o banco de dev.
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    // Encaminha /api para o Express. Mantem front e back na mesma origem
    // durante o desenvolvimento, dispensando CORS.
    proxy: {
      '/api': {
        // O E2E aponta para a API de teste (:3001) via API_URL, para nunca
        // tocar no banco de desenvolvimento.
        target: process.env.API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
