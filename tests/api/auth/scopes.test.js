'use strict';

const {
  request,
  requestBinary,
  insertTask,
  insertReport,
  insertReceipt,
  insertMerchant,
  createUserWithSession,
} = require('../../orchestrator');

/**
 * A matriz de autorizacao, endpoint a endpoint.
 *
 * Vale mais que a soma dos testes de cada rota: uma rota nova entra na API
 * sem `requireScope` e passa em todos os testes dela mesma — e so aqui, ao
 * chegar autenticada como um papel que nao deveria alcanca-la, que a falta
 * aparece. Por isso a lista tem **todas** as rotas que exigem sessao: a que
 * ficar de fora e uma rota que ninguem confere.
 */
const EVERYONE = ['admin', 'user', 'auditor'];
const WRITERS = ['admin', 'user'];
const ADMIN = ['admin'];

// [metodo, caminho, papeis que passam do portao da rota]
//
// Os ids nao existem (a suite trunca com RESTART IDENTITY), entao quem passa
// do portao recebe 404 ou 422 — o que importa aqui e so nao ser 401 nem 403.
// A excecao e o `/api/users/1`: e o admin padrao, que para os papeis criados
// em cada teste e sempre o cadastro de outra pessoa.
const ROUTES = [
  ['POST', '/api/auth/logout', EVERYONE],
  ['GET', '/api/auth/me', EVERYONE],

  ['GET', '/api/users', ADMIN],
  ['POST', '/api/users', ADMIN],
  ['GET', '/api/users/1', ADMIN],
  ['PATCH', '/api/users/1', ADMIN],
  ['DELETE', '/api/users/1', ADMIN],

  ['GET', '/api/tasks', EVERYONE],
  ['POST', '/api/tasks', WRITERS],
  ['GET', '/api/tasks/1', EVERYONE],
  ['PUT', '/api/tasks/1', WRITERS],
  ['PATCH', '/api/tasks/1', WRITERS],
  ['DELETE', '/api/tasks/1', WRITERS],

  ['GET', '/api/reports', EVERYONE],
  ['POST', '/api/reports', WRITERS],
  ['GET', '/api/reports/1', EVERYONE],
  ['PATCH', '/api/reports/1', WRITERS],
  ['DELETE', '/api/reports/1', WRITERS],
  ['GET', '/api/reports/1/receipts', EVERYONE],
  ['POST', '/api/reports/1/receipts', WRITERS],
  ['GET', '/api/reports/1/validation', EVERYONE],
  ['GET', '/api/reports/1/export.xlsx', EVERYONE],
  ['GET', '/api/reports/1/export/anexo-i.xlsx', EVERYONE],
  ['GET', '/api/reports/1/export.pdf', EVERYONE],

  ['GET', '/api/receipts/1', EVERYONE],
  ['PATCH', '/api/receipts/1', WRITERS],
  ['DELETE', '/api/receipts/1', WRITERS],
  ['POST', '/api/receipts/1/reprocess', WRITERS],
  ['GET', '/api/receipts/1/image', EVERYONE],

  ['GET', '/api/merchants', EVERYONE],
  ['GET', '/api/merchants/by-cnpj/26048802000165', EVERYONE],
  ['POST', '/api/merchants', WRITERS],
  ['PATCH', '/api/merchants/1', WRITERS],
];

/** Resume a resposta ao que a matriz confere: barrou no portao, ou passou. */
function gate(response) {
  return response.status === 401 || response.status === 403
    ? `${response.status} ${response.body?.name}`
    : 'passa';
}

describe('autenticacao obrigatoria', () => {
  it.each(ROUTES)('responde 401 em %s %s sem sessao', async (method, path) => {
    const response = await request(method, path, undefined, { token: null });

    expect(response.status).toBe(401);
    expect(response.body.name).toBe('UnauthorizedError');
    // O `action` diz o que fazer a seguir, e a interface o exibe.
    expect(response.body.action).toBeTruthy();
  });

  it('o health check e o login continuam publicos', async () => {
    // O probe do container consulta o health; exigir sessao nele faria o
    // HEALTHCHECK do Dockerfile derrubar o container que esta saudavel.
    const health = await request('GET', '/api/health', undefined, {
      token: null,
    });
    expect(health.status).toBe(200);

    // Sem corpo o login recusa por validacao, e nao por falta de sessao.
    const login = await request('POST', '/api/auth/login', {}, { token: null });
    expect(login.status).toBe(422);
  });

  it('rota inexistente continua respondendo 404, com ou sem sessao', async () => {
    const withoutSession = await request('GET', '/api/nao-existe', undefined, {
      token: null,
    });
    const withSession = await request('GET', '/api/nao-existe');

    expect(withoutSession.status).toBe(404);
    expect(withSession.status).toBe(404);
  });
});

describe('escopo exigido em cada rota', () => {
  it.each(ROUTES)(
    '%s %s so deixa passar os papeis com o escopo',
    async (method, path, allowed) => {
      const actual = {};
      const expected = {};

      for (const role of EVERYONE) {
        const { token } = await createUserWithSession({ role });
        const response = await request(method, path, undefined, { token });

        actual[role] = gate(response);
        expected[role] = allowed.includes(role)
          ? 'passa'
          : '403 ForbiddenError';
      }

      // Comparar o mapa inteiro mostra, na falha, qual papel escapou.
      expect(actual).toEqual(expected);
    },
  );
});

describe('papel user', () => {
  it('escreve nas proprias tarefas e no cadastro de emitentes', async () => {
    const { token } = await createUserWithSession({ role: 'user' });

    expect(
      (
        await request(
          'POST',
          '/api/tasks',
          { title: 'Comprar cafe' },
          { token },
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await request(
          'POST',
          '/api/merchants',
          { cnpj: '26048802000165', name: 'Padaria' },
          { token },
        )
      ).status,
    ).toBe(201);
  });
});

describe('papel auditor', () => {
  it('le tarefas, relatorios e emitentes', async () => {
    const { token } = await createUserWithSession({ role: 'auditor' });

    await insertTask();
    await insertMerchant();

    expect(
      (await request('GET', '/api/tasks', undefined, { token })).status,
    ).toBe(200);
    expect(
      (await request('GET', '/api/merchants', undefined, { token })).status,
    ).toBe(200);
    expect(
      (await request('GET', '/api/reports', undefined, { token })).status,
    ).toBe(200);
  });

  it('le o relatorio de outra pessoa, mas nao o edita', async () => {
    // E o papel de quem confere e assina: enxerga tudo, muda nada.
    const dono = await createUserWithSession({ role: 'user' });
    const auditor = await createUserWithSession({ role: 'auditor' });

    const criado = await request(
      'POST',
      '/api/reports',
      {
        title: 'Viagem de junho',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
      },
      { token: dono.token },
    );

    const id = criado.body.data.id;

    const leitura = await request('GET', `/api/reports/${id}`, undefined, {
      token: auditor.token,
    });
    expect(leitura.status).toBe(200);

    const escrita = await request(
      'PATCH',
      `/api/reports/${id}`,
      { title: 'Editado pelo auditor' },
      { token: auditor.token },
    );
    expect(escrita.status).toBe(403);

    const remocao = await request('DELETE', `/api/reports/${id}`, undefined, {
      token: auditor.token,
    });
    expect(remocao.status).toBe(403);
  });
});

describe('posse dos relatorios', () => {
  it('a listagem so mostra os relatorios da propria pessoa', async () => {
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    await insertReport({ title: 'Da Ana', owner_id: ana.user.id });
    await insertReport({ title: 'Do Bruno', owner_id: bruno.user.id });
    await insertReport({ title: 'Sem dono (legado)' });

    const response = await request('GET', '/api/reports', undefined, {
      token: ana.token,
    });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Da Ana');
    // O `meta.total` conta o que foi filtrado, e nao o que existe no banco:
    // a paginacao mentiria se contasse relatorio que a pessoa nao pode abrir.
    expect(response.body.meta.total).toBe(1);
  });

  it('um administrador enxerga tudo, inclusive o legado sem dono', async () => {
    const ana = await createUserWithSession({ role: 'user' });

    await insertReport({ title: 'Da Ana', owner_id: ana.user.id });
    await insertReport({ title: 'Sem dono (legado)' });

    const response = await request('GET', '/api/reports');

    expect(response.body.meta.total).toBe(2);
  });

  it('o relatorio alheio responde 404, e nao 403', async () => {
    // 403 confirmaria que o relatorio existe para quem so queria descobrir
    // isso, e daria para varrer os ids mapeando o sistema inteiro.
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const doBruno = await insertReport({ owner_id: bruno.user.id });

    const response = await request(
      'GET',
      `/api/reports/${doBruno.id}`,
      undefined,
      { token: ana.token },
    );

    expect(response.status).toBe(404);
  });

  it('nao aceita `owner_id` vindo do corpo', async () => {
    // O dono sai da sessao. Aceita-lo do cliente deixaria qualquer um criar
    // relatorio em nome de outra pessoa.
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const response = await request(
      'POST',
      '/api/reports',
      {
        title: 'Tentativa',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        owner_id: bruno.user.id,
      },
      { token: ana.token },
    );

    expect(response.status).toBe(201);
    expect(response.body.data.owner_id).toBe(ana.user.id);
  });

  it('nao permite transferir a posse por PATCH', async () => {
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const relatorio = await insertReport({ owner_id: ana.user.id });

    const response = await request(
      'PATCH',
      `/api/reports/${relatorio.id}`,
      { owner_id: bruno.user.id },
      { token: ana.token },
    );

    // `owner_id` nao esta em UPDATABLE_COLUMNS, entao o corpo e recusado por
    // nao trazer nenhum campo atualizavel.
    expect(response.status).toBe(422);

    const depois = await request(
      'GET',
      `/api/reports/${relatorio.id}`,
      undefined,
      { token: ana.token },
    );
    expect(depois.body.data.owner_id).toBe(ana.user.id);
  });
});

describe('posse herdada pelos comprovantes', () => {
  it('o comprovante do relatorio alheio responde 404 em toda rota', async () => {
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const doBruno = await insertReport({ owner_id: bruno.user.id });
    const receipt = await insertReceipt(doBruno.id);

    const rotas = [
      ['GET', `/api/receipts/${receipt.id}`],
      ['PATCH', `/api/receipts/${receipt.id}`],
      ['DELETE', `/api/receipts/${receipt.id}`],
      ['POST', `/api/receipts/${receipt.id}/reprocess`],
      ['GET', `/api/reports/${doBruno.id}/receipts`],
    ];

    for (const [method, path] of rotas) {
      const response = await request(
        method,
        path,
        method === 'PATCH' ? { amount_cents: 1 } : undefined,
        { token: ana.token },
      );

      expect(response.status).toBe(404);
    }
  });

  it('a imagem do cupom alheio nao sai pela rota de imagem', async () => {
    // E por aqui que sairia o documento com CNPJ e, as vezes, CPF de
    // terceiros. A rota herda a posse do relatorio como todas as outras.
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const doBruno = await insertReport({ owner_id: bruno.user.id });
    const receipt = await insertReceipt(doBruno.id);

    const response = await requestBinary(
      'GET',
      `/api/receipts/${receipt.id}/image`,
      { token: ana.token },
    );

    expect(response.status).toBe(404);
  });

  it('as exportacoes do relatorio alheio tambem respondem 404', async () => {
    // Cada uma leva o relatorio inteiro num arquivo: sao a leitura mais
    // completa que existe do recurso.
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const doBruno = await insertReport({ owner_id: bruno.user.id });

    for (const caminho of [
      'export.xlsx',
      'export/anexo-i.xlsx',
      'export.pdf',
      'validation',
    ]) {
      const response = await requestBinary(
        'GET',
        `/api/reports/${doBruno.id}/${caminho}`,
        { token: ana.token },
      );

      expect(response.status).toBe(404);
    }
  });

  it('o upload no relatorio alheio e recusado', async () => {
    const ana = await createUserWithSession({ role: 'user' });
    const bruno = await createUserWithSession({ role: 'user' });

    const doBruno = await insertReport({ owner_id: bruno.user.id });

    const response = await request(
      'POST',
      `/api/reports/${doBruno.id}/receipts`,
      undefined,
      { token: ana.token },
    );

    expect(response.status).toBe(404);
  });
});
