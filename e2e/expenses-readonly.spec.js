'use strict';

const { test, expect } = require('@playwright/test');
const {
  clearReports,
  createReport,
  addReceipts,
  createUser,
  deleteUser,
} = require('./helpers');
const { makeReceiptPdf } = require('../tests/fixtures/pdf');

/**
 * O auditor confere e assina: le tudo e nao escreve nada. A API ja recusa
 * cada escrita dele (ha teste de cada recusa), e esta spec cobre a outra
 * metade — a tela nao oferecer o botao que so responderia 403.
 *
 * O arranjo usa o `request` do projeto, autenticado como o admin do E2E, e a
 * pagina entra como o auditor. Os cookies da pagina sao limpos em vez de
 * clicar em "Sair": a sessao do `storageState` e compartilhada por todas as
 * specs, e um logout de verdade a revogaria para as seguintes.
 */

let auditor = null;

test.beforeEach(async ({ request }) => {
  await clearReports(request);
  auditor = await createUser(request, {
    name: 'Auditora do E2E',
    role: 'auditor',
  });
});

test.afterEach(async ({ request }) => {
  if (auditor) {
    await deleteUser(request, auditor.id);
    auditor = null;
  }
});

async function enterAs(page, user) {
  await page.context().clearCookies();
  await page.goto('/');

  const form = page.locator('form.form');
  await form.getByLabel('E-mail').fill(user.email);
  await form.getByLabel('Senha').fill(user.password);
  await form.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByText(user.name)).toBeVisible();
}

test('o auditor nao ve os botoes de criar', async ({ page }) => {
  await enterAs(page, auditor);

  await expect(page.getByRole('button', { name: 'Nova tarefa' })).toHaveCount(
    0,
  );

  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();

  await expect(
    page.getByRole('button', { name: 'Novo relatorio' }),
  ).toHaveCount(0);
});

test('o auditor le o relatorio e o comprovante, sem nada que os altere', async ({
  page,
  request,
}) => {
  const report = await createReport(request, {
    title: 'Conferencia do auditor',
  });
  await addReceipts(request, report.id, [
    await makeReceiptPdf({ total: '37,60', date: '19/06/2026' }),
  ]);

  await enterAs(page, auditor);
  await page.getByRole('tab', { name: 'Prestacao de Contas' }).click();
  await page.getByRole('button', { name: report.title }).click();

  await expect(
    page.locator('.list-item').getByText('Aguardando revisao'),
  ).toBeVisible();

  await expect(page.locator('.dropzone')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deletar' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Editar relatorio' }),
  ).toHaveCount(0);

  await page.locator('.list-item .link-button').first().click();
  await page.waitForSelector('.review__fields');

  // Nem girar a pagina: o giro e gravado, e o auditor nao escreve.
  await expect(
    page.getByRole('button', { name: 'Girar para a direita' }),
  ).toHaveCount(0);

  // O que foi extraido esta la para ser conferido...
  await expect(page.locator('#review-amount')).toHaveValue('37,60');

  // ...mas nenhum campo aceita edicao, e nao ha o que confirmar nem apagar.
  await expect(page.locator('#review-date')).toBeDisabled();
  await expect(page.locator('#review-amount')).toBeDisabled();
  await expect(page.locator('#review-category')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deletar' })).toHaveCount(0);
  await expect(page.getByText('Somente leitura')).toBeVisible();
});
