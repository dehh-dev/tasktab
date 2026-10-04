'use strict';

const { test, expect } = require('@playwright/test');
const { openSection, createUser, deleteUser } = require('./helpers');

/**
 * Pessoa propria, e nao o usuario do E2E: trocar a senha dele quebraria o
 * login do setup na execucao seguinte. Os cookies sao limpos em vez de clicar
 * em "Sair", pelo mesmo motivo da spec do auditor.
 */
let person = null;

test.beforeEach(async ({ request }) => {
  person = await createUser(request, { name: 'Troca de Senha' });
});

test.afterEach(async ({ request }) => {
  if (person) {
    await deleteUser(request, person.id);
    person = null;
  }
});

async function enter(page, email, password) {
  await page.context().clearCookies();
  await page.goto('/');

  const form = page.locator('form.form');
  await form.getByLabel('E-mail').fill(email);
  await form.getByLabel('Senha').fill(password);
  await form.getByRole('button', { name: 'Entrar' }).click();
}

test('troca a propria senha, e a nova passa a valer no login', async ({
  page,
}) => {
  const newPassword = 'outra-senha-do-e2e-456';

  await enter(page, person.email, person.password);
  await expect(
    page.getByRole('complementary').getByText(person.name),
  ).toBeVisible();

  // A troca de senha mora nos Ajustes, junto dos dados da conta.
  await openSection(page, 'Ajustes');
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  const form = page.locator('form.form', { hasText: 'Alterar senha' });

  // Senha atual errada: o erro aparece no campo, e nada muda.
  await form.getByLabel('Senha atual').fill('nao-e-essa-123');
  await form.getByLabel('Nova senha').fill(newPassword);
  await form.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(form.getByText('senha atual incorreta')).toBeVisible();

  await form.getByLabel('Senha atual').fill(person.password);
  await form.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.getByRole('status')).toHaveText(/Senha alterada/);

  await enter(page, person.email, newPassword);
  await expect(
    page.getByRole('complementary').getByText(person.name),
  ).toBeVisible();
});
