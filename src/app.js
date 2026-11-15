'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const env = require('./config/env');
const routes = require('./routes');
const controller = require('../infra/controller');
const { httpLogger } = require('../infra/logger');
const noStore = require('./middlewares/no-store');
const webAssets = require('./middlewares/web-assets');
const { readLimiter } = require('./middlewares/rate-limit');

const app = express();

app.disable('x-powered-by');

// Primeiro de todos: assim ate o que for barrado pelo limitador aparece no log
// ja com um request id.
app.use(httpLogger);

// Front e back ficam sempre na mesma origem, entao a CSP padrao do helmet
// ('self' para tudo) atende o build do Vite sem excecoes.
app.use(helmet());

app.use(express.json({ limit: '100kb' }));

// Os tetos de escrita sao por familia de rota e ficam em `routes/index.js`.
app.use('/api', noStore, readLimiter, routes);

// Em desenvolvimento o Vite serve a interface e encaminha /api para ca. Em
// producao nao ha Vite: o Express entrega o build estatico na mesma origem,
// o que tambem dispensa CORS. Fora do teste, salvo `WEB_DIST` (`env.js`).
if (env.web.enabled && fs.existsSync(path.join(env.web.dist, 'index.html'))) {
  app.use(webAssets(env.web.dist));
}

app.use(controller.errorHandlers.onNoMatch);
app.use(controller.errorHandlers.onError);

module.exports = app;
