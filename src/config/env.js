'use strict';

const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';

// dotenv nao sobrescreve variaveis ja definidas em process.env. Em producao o
// arquivo simplesmente nao existe e as variaveis reais do ambiente prevalecem.
dotenv.config({ path: path.resolve(__dirname, '../..', `env.${nodeEnv}`) });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${name} (NODE_ENV=${nodeEnv})`,
    );
  }
  return value;
}

const MINUTE = 60 * 1000;

module.exports = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 3000),
  rateLimit: {
    // Desligado em teste: a suite trombaria em qualquer teto realista. A
    // variavel religa numa instancia propria da API, que e como o teste dos
    // tetos o exercita sem mudar nada para o resto da suite.
    enabled: process.env.RATE_LIMIT_ENABLED
      ? process.env.RATE_LIMIT_ENABLED === 'true'
      : nodeEnv !== 'test',
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * MINUTE),
    // Leitura e generosa: a interface recarrega a lista a cada mutacao.
    max: Number(process.env.RATE_LIMIT_MAX || 600),
    // Escrita e o que interessa conter.
    writeMax: Number(process.env.RATE_LIMIT_WRITE_MAX || 100),
    // Prestacao de contas trabalha em lote: um relatorio de 30 cupons sao
    // dezenas de escritas seguidas, feitas por uma pessoa so.
    batchWriteMax: Number(process.env.RATE_LIMIT_BATCH_WRITE_MAX || 600),
    // Login tem teto proprio e apertado: e a unica rota onde tentar de novo
    // com outro valor tem serventia para quem nao deveria estar aqui.
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'tasktab_session',
    // Uma semana. Revisar um lote de 30 cupons e trabalho de varios dias, e
    // uma sessao curta expulsaria a pessoa no meio dele. Como a sessao vive no
    // banco, encurtar isso e trocar a variavel — nao ha token solto por ai.
    ttlHours: Number(process.env.SESSION_TTL_HOURS || 168),
    // `Secure` so em producao: em desenvolvimento e no E2E o acesso e por
    // http://localhost, e um cookie Secure ali seria descartado pelo cliente.
    cookieSecure: process.env.SESSION_COOKIE_SECURE
      ? process.env.SESSION_COOKIE_SECURE === 'true'
      : nodeEnv === 'production',
  },
  password: {
    // Paralelismo do scrypt. 5 e o minimo da OWASP para N=2^14 e r=8 (~135 ms
    // por hash). O `env.test` baixa para 1: a suite cria e confere senha
    // dezenas de vezes, e o custo de producao nao e o que ela testa.
    scryptP: Number(process.env.PASSWORD_SCRYPT_P || 5),
  },
  upload: {
    // Relativo a raiz do projeto quando nao absoluto. Em container e um volume:
    // a imagem nao carrega arquivo de usuario.
    dir: path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || 'uploads'),
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES || 20 * 1024 * 1024),
    maxFiles: Number(process.env.UPLOAD_MAX_FILES || 20),
  },
  ocr: {
    // Desligavel para quem so processa PDF digital e nao quer o custo do
    // idioma nem do reconhecimento.
    enabled: process.env.OCR_ENABLED !== 'false',
    language: process.env.OCR_LANGUAGE || 'por',
    // O tesseract baixa ~2,4 MB de dados de idioma na primeira execucao e
    // guarda aqui. Fora do versionamento.
    cachePath: path.resolve(
      __dirname,
      '../..',
      process.env.OCR_CACHE_DIR || '.cache/tesseract',
    ),
    // Teto por pagina: uma imagem ruim nao pode travar o lote inteiro.
    timeoutMs: Number(process.env.OCR_TIMEOUT_MS || 20000),
  },
  database: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
  },
};
