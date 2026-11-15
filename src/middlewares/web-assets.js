'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

// O nome de todo arquivo em `assets/` leva o hash do conteudo: mudou o
// arquivo, mudou a URL. Por isso pode ficar um ano no navegador sem
// revalidar — o index.html, que aponta para eles, e que revalida a cada carga.
const ASSET_CACHE = { maxAge: '1y', immutable: true };

// tema.js e favicon.svg (de `web/public/`) nao levam hash, e o navegador os
// usa do cache na hora, revalidando por tras. O tema.js bloqueia a primeira
// pintura: esperar a revalidacao dele custava uma ida e volta em toda carga
// (154 ms no Fast 4G). Mudou num deploy, vale a partir da carga seguinte.
const PUBLIC_CACHE = 'public, max-age=0, stale-while-revalidate=604800';

// A ordem e a do servidor, e nao a do navegador: o Chrome manda
// "gzip, deflate, br, zstd", e a negociacao pela ordem dele ficaria sempre no
// gzip, maior que o brotli.
const ENCODINGS = [
  { name: 'br', extension: '.br' },
  { name: 'gzip', extension: '.gz' },
];

/**
 * Entrega o `.br` ou o `.gz` que o build grava ao lado de cada .js e .css
 * (`web/vite.config.js`), conforme o `Accept-Encoding`. A lista de arquivos e
 * lida uma vez: o build nao muda com o servidor no ar, e casar o nome contra
 * ela dispensa montar caminho a partir da URL.
 */
function precompressed(dir) {
  const files = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);

  return (req, res, next) => {
    const name = req.path.slice(1);
    const variants = ENCODINGS.filter(({ extension }) =>
      files.has(`${name}${extension}`),
    );

    if (!['GET', 'HEAD'].includes(req.method) || variants.length === 0) {
      return next();
    }

    // Vale tambem para a copia crua, que sai pelo `express.static` adiante:
    // um cache no meio do caminho nao pode entregar uma no lugar da outra.
    res.vary('Accept-Encoding');

    const chosen = variants.find(
      (variant) => req.acceptsEncodings(variant.name) === variant.name,
    );

    if (!chosen) {
      return next();
    }

    // O tipo sai do nome original: pelo `.br` o `send` diria octet-stream.
    res.type(path.extname(name));

    return res.sendFile(
      `${name}${chosen.extension}`,
      {
        ...ASSET_CACHE,
        root: dir,
        headers: { 'Content-Encoding': chosen.name },
      },
      // Variante que sumiu do disco cai na copia crua, e nao num 500. Com a
      // resposta ja comecada (conexao fechada no meio), nao ha o que fazer.
      (error) => {
        if (error && !res.headersSent) {
          next();
        }
      },
    );
  };
}

function setPublicHeaders(res, file) {
  if (path.basename(file) !== 'index.html') {
    res.setHeader('Cache-Control', PUBLIC_CACHE);
  }
}

/**
 * O build da interface (`npm run build`), na mesma origem da API: os assets
 * com hash, os arquivos de `web/public/` e o fallback de SPA.
 */
function webAssets(dist) {
  const assets = path.join(dist, 'assets');
  const index = path.join(dist, 'index.html');
  const router = express.Router();

  router.use(
    '/assets',
    precompressed(assets),
    express.static(assets, ASSET_CACHE),
  );
  router.use(express.static(dist, { setHeaders: setPublicHeaders }));

  // Fallback de SPA: qualquer GET que nao seja /api devolve o index.html,
  // para que as rotas do cliente funcionem em recarregamento direto.
  router.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    return res.sendFile(index);
  });

  return router;
}

module.exports = webAssets;
