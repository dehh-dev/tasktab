'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApiInstance } = require('../orchestrator');

const ROOT = path.resolve(__dirname, '../..');

/**
 * Em producao e o Express que entrega a interface, sem proxy na frente
 * (`src/middlewares/web-assets.js`). A suite comum roda sem build; aqui o
 * build e o de verdade, com o plugin que grava o `.br` e o `.gz`
 * (`web/vite.config.js`), num diretorio temporario, e uma API propria o serve
 * pelo `WEB_DIST`.
 */
let dist;
let instance;
let script;
let stylesheet;

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktab-web-'));
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      dist,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
    { cwd: path.join(ROOT, 'web') },
  );

  const assets = fs.readdirSync(path.join(dist, 'assets'));
  script = assets.find((name) => /^index-.*\.js$/.test(name));
  stylesheet = assets.find((name) => /^index-.*\.css$/.test(name));

  instance = await startApiInstance({ WEB_DIST: dist });
}, 120000);

afterAll(async () => {
  await instance?.stop();
  fs.rmSync(dist, { recursive: true, force: true });
});

function get(pathname, acceptEncoding = 'identity') {
  return fetch(`${instance.baseUrl}${pathname}`, {
    headers: { 'Accept-Encoding': acceptEncoding },
  });
}

describe('assets do build', () => {
  // O Accept-Encoding de cada navegador, e o que o servidor escolhe para ele.
  const CLIENTS = {
    'chrome (gzip, deflate, br, zstd)': 'gzip, deflate, br, zstd',
    'so gzip': 'gzip',
    'br recusado': 'br;q=0, gzip',
    'sem compressao': 'identity',
  };

  it('saem no melhor formato que o navegador aceita, brotli antes de gzip', async () => {
    const chosen = {};

    for (const [client, acceptEncoding] of Object.entries(CLIENTS)) {
      for (const asset of [script, stylesheet]) {
        const response = await get(`/assets/${asset}`, acceptEncoding);
        chosen[`${client} ${path.extname(asset)}`] =
          response.headers.get('content-encoding');
      }
    }

    expect(chosen).toEqual({
      'chrome (gzip, deflate, br, zstd) .js': 'br',
      'chrome (gzip, deflate, br, zstd) .css': 'br',
      'so gzip .js': 'gzip',
      'so gzip .css': 'gzip',
      'br recusado .js': 'gzip',
      'br recusado .css': 'gzip',
      'sem compressao .js': null,
      'sem compressao .css': null,
    });
  });

  it('o comprimido descomprime no mesmo arquivo, com o tipo do original', async () => {
    const original = fs.readFileSync(path.join(dist, 'assets', script));
    const bodies = {};
    const types = {};

    for (const encoding of ['br', 'gzip', 'identity']) {
      // O fetch do Node descomprime sozinho, como o navegador.
      const response = await get(`/assets/${script}`, encoding);
      bodies[encoding] = Buffer.from(await response.arrayBuffer()).equals(
        original,
      );
      // O charset nao distingue caixa: o Express escreve `utf-8`, o `send`,
      // `UTF-8`.
      types[encoding] = response.headers.get('content-type').toLowerCase();
    }

    expect(bodies).toEqual({ br: true, gzip: true, identity: true });
    expect(new Set(Object.values(types))).toEqual(
      new Set(['application/javascript; charset=utf-8']),
    );
  });

  it('ficam um ano em cache, e avisam que variam com o Accept-Encoding', async () => {
    const headers = {};

    for (const encoding of ['br', 'identity']) {
      const response = await get(`/assets/${script}`, encoding);
      headers[encoding] = {
        cache: response.headers.get('cache-control'),
        vary: response.headers.get('vary'),
      };
    }

    const expected = {
      cache: 'public, max-age=31536000, immutable',
      vary: 'Accept-Encoding',
    };
    expect(headers).toEqual({ br: expected, identity: expected });
  });
});

describe('o que nao leva hash no nome', () => {
  it('o index.html revalida sempre; tema.js e favicon revalidam por tras', async () => {
    const cache = {};

    for (const pathname of ['/', '/tema.js', '/favicon.svg']) {
      cache[pathname] = (await get(pathname)).headers.get('cache-control');
    }

    expect(cache).toEqual({
      '/': 'public, max-age=0',
      '/tema.js': 'public, max-age=0, stale-while-revalidate=604800',
      '/favicon.svg': 'public, max-age=0, stale-while-revalidate=604800',
    });
  });

  it('rota do cliente recebe o index.html, e /api segue sendo da API', async () => {
    const page = await get('/relatorios/12');
    const api = await get('/api/nao-existe');

    expect({
      page: [page.status, page.headers.get('content-type')],
      api: [api.status, (await api.json()).name],
    }).toEqual({
      page: [200, 'text/html; charset=UTF-8'],
      api: [404, 'NotFoundError'],
    });
  });
});
