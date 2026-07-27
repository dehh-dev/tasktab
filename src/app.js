'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const env = require('./config/env');
const routes = require('./routes');
const {
  notFoundHandler,
  errorHandler,
} = require('./middlewares/error-handler');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use('/api', routes);

// Em desenvolvimento o Vite serve a interface e encaminha /api para ca. Em
// producao nao ha Vite: o Express entrega o build estatico na mesma origem,
// o que tambem dispensa CORS.
// Fica de fora do ambiente de teste para que a suite da API se comporte igual
// com ou sem um build presente no disco.
const WEB_DIST = path.resolve(__dirname, '../web/dist');
const serveWeb =
  !env.isTest && fs.existsSync(path.join(WEB_DIST, 'index.html'));

if (serveWeb) {
  app.use(express.static(WEB_DIST));

  // Fallback de SPA: qualquer GET que nao seja /api devolve o index.html,
  // para que as rotas do cliente funcionem em recarregamento direto.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    return res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
