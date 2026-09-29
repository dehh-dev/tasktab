'use strict';

const { test, expect } = require('@playwright/test');
const { E2E_USER } = require('./constants');

/**
 * Todo este arquivo roda **sem** o estado gravado pelo projeto de setup, e
 * quem precisa de sessao faz o proprio login.
 *
 * Nao e preciosismo: a sessao do `storageState` e uma linha no banco,
 * compartilhada por todas as specs. Um teste de logout que usasse essa sessao
 * a revogaria de verdade, e as specs seguintes cairiam no login com um erro
 * que nao tem nada a ver com o que elas testam. Aconteceu.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function entrar(page) {
  await page.goto('/');

  const form = page.locator('form.form');
  await form.getByLabel('E-mail').fill(E2E_USER.email);
  await form.getByLabel('Senha').fill(E2E_USER.password);
  await form.getByRole('button', { name: 'Entrar' }).click();

  // Entrou de verdade: a aplicacao aparece, com o nome de quem esta nela.
  await expect(page.getByRole('tab', { name: 'Tarefas' })).toBeVisible();
  await expect(page.getByText(E2E_USER.name)).toBeVisible();
}

test.describe('sessao', () => {
  test('sem sessao a aplicacao mostra o login, e nao os dados', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Entrar no tasktab' }),
    ).toBeVisible();

    // O que a autenticacao existe para impedir: nenhuma aba, nenhuma lista.
    await expect(page.getByRole('tab', { name: 'Tarefas' })).toHaveCount(0);
  });

  test('senha errada mostra a mensagem e mantem o e-mail digitado', async ({
    page,
  }) => {
    await page.goto('/');

    const form = page.locator('form.form');
    await form.getByLabel('E-mail').fill(E2E_USER.email);
    await form.getByLabel('Senha').fill('senha-que-nao-e-a-certa');
    await form.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByRole('alert')).toContainText('E-mail ou senha');
    // Refazer o login nao pode custar digitar o e-mail de novo.
    await expect(form.getByLabel('E-mail')).toHaveValue(E2E_USER.email);
  });

  test('quando a sessao cai no meio do uso, volta ao login e diz por que', async ({
    page,
  }) => {
    await entrar(page);

    // Revoga a sessao por fora da tela, como fariam a troca de senha em outro
    // navegador ou o fim do prazo. O `page.request` divide os cookies com a
    // pagina, entao o logout derruba justamente a sessao dela.
    await page.request.post('/api/auth/logout');

    // E a proxima conversa com a API que descobre a queda.
    await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();

    await expect(
      page.getByRole('heading', { name: 'Entrar no tasktab' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(
      'Sessao ausente ou expirada',
    );
  });
});

test.describe('sair', () => {
  test('Sair devolve o login, e recarregar nao devolve a sessao', async ({
    page,
  }) => {
    await entrar(page);
    await page.getByRole('button', { name: 'Sair' }).click();

    await expect(
      page.getByRole('heading', { name: 'Entrar no tasktab' }),
    ).toBeVisible();
    // Quem saiu por vontade propria nao recebe aviso de sessao perdida.
    await expect(page.getByRole('alert')).toHaveCount(0);

    // A sessao morre no banco, e nao so no estado da tela: e o que uma sessao
    // revogavel entrega e um token que so expira nao entregaria.
    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'Entrar no tasktab' }),
    ).toBeVisible();
  });
});
