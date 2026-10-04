'use strict';

const { test: setup, expect } = require('@playwright/test');
const { STORAGE_STATE, E2E_USER } = require('./constants');

/**
 * Faz o login uma vez e guarda o cookie de sessao em disco.
 *
 * Roda como um projeto de dependencia (ver `playwright.config.js`), e nao no
 * `globalSetup`: o `globalSetup` acontece antes de o `webServer` subir, e
 * ninguem faz login num servidor que ainda nao existe. O estado gravado
 * alimenta tanto o `page` quanto o `request` das specs, entao nenhuma delas
 * precisa saber que ha autenticacao no caminho.
 */
setup('autentica e guarda a sessao', async ({ page }) => {
  await page.goto('/');

  const form = page.locator('form.form');

  await form.getByLabel('E-mail').fill(E2E_USER.email);
  await form.getByLabel('Senha').fill(E2E_USER.password);
  await form.getByRole('button', { name: 'Entrar' }).click();

  // A sessao so esta de pe quando a aplicacao aparece — esperar pelo cookie
  // passaria antes de o `me` responder e a proxima spec pegaria a tela ainda
  // no login.
  await expect(
    page.getByRole('navigation', { name: 'Principal' }),
  ).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
