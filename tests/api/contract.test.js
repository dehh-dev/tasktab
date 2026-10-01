'use strict';

const {
  request,
  insertTask,
  insertReport,
  insertReceipt,
  insertMerchant,
  currentUser,
  DEFAULT_USER,
  DEFAULT_PASSWORD,
} = require('../orchestrator');
const { ROUTES, label, pathWith, byRoute } = require('./routes');

/**
 * O contrato que toda rota cumpre, conferido a partir da mesma lista da
 * matriz de autorizacao.
 *
 * Eram 26 testes espalhados por 18 arquivos, cada rota repetindo o proprio
 * "404 para id inexistente" — e o 400 de id invalido so aparecia em 3 das 23
 * rotas com id. Aqui cada checagem e um mapa: a falha mostra de uma vez todas
 * as rotas que sairam do contrato.
 */
const WITH_ID = ROUTES.filter((route) => route.path.includes(':id'));
const EDITS = WITH_ID.filter((route) => route.body);

/**
 * Colunas que nenhuma rota de edicao pode escrever, por colecao: a identidade
 * do registro e, no relatorio, o dono — transferir posse por um PATCH que
 * passou por acaso seria a forma mais silenciosa de burlar a autorizacao.
 */
const IDENTITY = {
  users: { id: 999, password_hash: 'scrypt$1$1$1$sal$hash' },
  tasks: { id: 999, created_at: '2020-01-01T00:00:00Z' },
  reports: { id: 999, owner_id: 999 },
  receipts: { id: 999, report_id: 999, file_hash: 'outro', page_number: 9 },
  merchants: { id: 999, cnpj: '58080015000197' },
};

/** Status e classe do erro — e o `action`, que a interface exibe sempre. */
function summary(response) {
  const action = response.body?.action ? '' : ' sem action';
  return `${response.status} ${response.body?.name}${action}`;
}

async function hitAll(routes, pathFor, bodyFor = () => undefined) {
  const actual = {};

  for (const route of routes) {
    const response = await request(
      route.method,
      pathFor(route),
      bodyFor(route),
    );
    actual[label(route)] = response;
  }

  return actual;
}

function summarize(responses, describe) {
  return Object.fromEntries(
    Object.entries(responses).map(([route, response]) => [
      route,
      describe(response),
    ]),
  );
}

describe('contrato das rotas com :id', () => {
  it('id que nao e numero responde 400', async () => {
    const responses = await hitAll(
      WITH_ID,
      (route) => pathWith(route, 'abc'),
      (route) => route.body,
    );

    expect(summarize(responses, summary)).toEqual(
      byRoute(WITH_ID, () => '400 BadRequestError'),
    );
  });

  it('id inexistente responde 404', async () => {
    const responses = await hitAll(
      WITH_ID,
      (route) => pathWith(route, 999999),
      (route) => route.body,
    );

    expect(summarize(responses, summary)).toEqual(
      byRoute(WITH_ID, () => '404 NotFoundError'),
    );
  });

  it('o erro sai exatamente no formato do toJSON, sem request_id nos 4xx', async () => {
    // O `request_id` vai so nos 5xx, que sao os que alguem precisa casar com
    // o log. Acrescenta-lo aqui mudaria o contrato sem ganho nenhum.
    const response = await request('GET', '/api/tasks/999999');

    expect(response.body).toEqual({
      name: 'NotFoundError',
      message: 'Task 999999 nao encontrada.',
      action: 'Verifique o id informado ou liste as tarefas disponiveis.',
      status_code: 404,
    });
  });
});

describe('contrato das rotas de edicao', () => {
  it('corpo so com colunas de identidade responde 422 apontando o corpo', async () => {
    const report = await insertReport();
    const ids = {
      users: currentUser().id,
      tasks: (await insertTask()).id,
      reports: report.id,
      receipts: (await insertReceipt(report.id)).id,
      merchants: (await insertMerchant()).id,
    };
    const collection = (route) => route.path.split('/')[2];

    const responses = await hitAll(
      EDITS,
      (route) => pathWith(route, ids[collection(route)]),
      (route) => IDENTITY[collection(route)],
    );

    // Coluna fora de UPDATABLE_COLUMNS e ignorada, e sem nenhuma que sobre o
    // corpo e recusado — em vez de responder 200 sem ter feito nada.
    expect(
      summarize(
        responses,
        (response) =>
          `${summary(response)} ${(response.body?.details || [])
            .map((detail) => detail.field)
            .join(',')}`,
      ),
    ).toEqual(byRoute(EDITS, () => '422 ValidationError body'));
  });
});

describe('contrato do corpo JSON', () => {
  it('JSON malformado responde 400, antes de chegar a qualquer rota', async () => {
    const response = await request('POST', '/api/tasks', '{"title": ');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      name: 'BadRequestError',
      message: 'JSON invalido.',
    });
  });
});

describe('contrato de cache', () => {
  const NO_STORE = 'no-store, no-cache, max-age=0, must-revalidate';
  const LOGOUT = 'POST /api/auth/logout';

  it('nenhuma rota deixa a resposta no cache do navegador', async () => {
    // A imagem do comprovante tem politica propria quando entrega a imagem
    // (`receipts/image.test.js`); com id inexistente cai no 404 como as
    // outras. O logout vai por ultimo: ele derruba a sessao das seguintes.
    const routes = [
      ...ROUTES.filter((route) => label(route) !== LOGOUT),
      ...ROUTES.filter((route) => label(route) === LOGOUT),
    ];

    const responses = await hitAll(
      routes,
      (route) => pathWith(route, 999999),
      (route) => route.body,
    );

    expect(
      summarize(responses, (response) => response.headers.get('cache-control')),
    ).toEqual(byRoute(routes, () => NO_STORE));
  });

  it('vale tambem para as rotas publicas e para a rota inexistente', async () => {
    const anonymous = { token: null };
    const responses = {
      health: await request('GET', '/api/health', undefined, anonymous),
      // A que mais importa: e a resposta que traz o cookie da sessao.
      login: await request(
        'POST',
        '/api/auth/login',
        { email: DEFAULT_USER.email, password: DEFAULT_PASSWORD },
        anonymous,
      ),
      notFound: await request('GET', '/api/nao-existe', undefined, anonymous),
    };

    expect(
      summarize(
        responses,
        (response) =>
          `${response.status} ${response.headers.get('cache-control')}`,
      ),
    ).toEqual({
      health: `200 ${NO_STORE}`,
      login: `200 ${NO_STORE}`,
      notFound: `404 ${NO_STORE}`,
    });
  });
});
