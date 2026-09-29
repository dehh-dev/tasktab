'use strict';

const {
  request,
  requestBinary,
  insertReport,
  insertReceipt,
  insertSession,
  createUserWithSession,
} = require('../../orchestrator');
const { ROUTES, EVERYONE, label, pathWith, byRoute } = require('../routes');

/**
 * A matriz de autorizacao, endpoint a endpoint, sobre a lista de
 * `tests/api/routes.js`.
 *
 * Vale mais que a soma dos testes de cada rota: uma rota nova entra na API
 * sem `requireScope` e passa em todos os testes dela mesma — e so aqui, ao
 * chegar autenticada como um papel que nao deveria alcanca-la, que a falta
 * aparece.
 *
 * O `:id` vira 1. Relatorio, tarefa, comprovante e emitente 1 nao existem (a
 * suite trunca com RESTART IDENTITY), entao quem passa do portao recebe 404
 * ou 422 — o que importa aqui e so nao ser 401 nem 403. Em `/api/users/1` e
 * o admin padrao: para os papeis criados no teste, o cadastro de outra
 * pessoa.
 */
const ID = 1;

/**
 * Resume a resposta ao que a matriz confere: barrou no portao, ou passou. O
 * `action` entra junto porque e o que a interface mostra para a pessoa saber
 * o que fazer, e nunca pode faltar num 401 ou 403.
 */
function gate(response) {
  if (response.status !== 401 && response.status !== 403) {
    return 'passa';
  }

  const action = response.body?.action ? '' : ' sem action';
  return `${response.status} ${response.body?.name}${action}`;
}

describe('autenticacao obrigatoria', () => {
  it('toda rota da lista responde 401 sem sessao', async () => {
    const actual = {};

    for (const route of ROUTES) {
      const response = await request(
        route.method,
        pathWith(route, ID),
        route.body,
        { token: null },
      );
      actual[label(route)] = gate(response);
    }

    expect(actual).toEqual(byRoute(ROUTES, () => '401 UnauthorizedError'));
  });
});

describe('escopo exigido em cada rota', () => {
  it('cada rota barra com 403 exatamente os papeis sem o escopo', async () => {
    const users = {};

    for (const role of EVERYONE) {
      users[role] = (await createUserWithSession({ role })).user;
    }

    const actual = {};

    for (const route of ROUTES) {
      const gates = {};

      for (const role of EVERYONE) {
        // Sessao nova a cada pedido: o POST /api/auth/logout revoga a que usa.
        const token = await insertSession(users[role].id);
        const response = await request(
          route.method,
          pathWith(route, ID),
          route.body,
          { token },
        );

        gates[role] = gate(response);
      }

      actual[label(route)] = gates;
    }

    // Um mapa rota -> papel: na falha, o diff mostra que papel escapou de
    // que rota, todas de uma vez.
    expect(actual).toEqual(
      byRoute(ROUTES, (route) =>
        Object.fromEntries(
          EVERYONE.map((role) => [
            role,
            route.roles.includes(role) ? 'passa' : '403 ForbiddenError',
          ]),
        ),
      ),
    );
  });
});

describe('papel auditor', () => {
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

  it('o 404 do alheio e identico ao do que nao existe, fora o id', async () => {
    // Qualquer campo diferente entre as duas respostas bastaria para varrer
    // os ids e descobrir quais relatorios e comprovantes existem.
    const owner = await createUserWithSession({ role: 'user' });
    const stranger = await createUserWithSession({ role: 'user' });

    const report = await insertReport({ owner_id: owner.user.id });
    const receipt = await insertReceipt(report.id);

    for (const [collection, id] of [
      ['reports', report.id],
      ['receipts', receipt.id],
    ]) {
      const missingId = id + 1000;

      const foreign = await request(
        'GET',
        `/api/${collection}/${id}`,
        undefined,
        { token: stranger.token },
      );
      const missing = await request(
        'GET',
        `/api/${collection}/${missingId}`,
        undefined,
        { token: stranger.token },
      );

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual({
        ...missing.body,
        message: missing.body.message.replace(String(missingId), String(id)),
      });
    }
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
