'use strict';

const { test, expect } = require('@playwright/test');
const {
  openSection,
  clearTasks,
  createTask,
  clearReports,
  createReport,
} = require('./helpers');

/**
 * A casca: navegacao, Inicio, tema e o menu da tela estreita. O que cada
 * modulo faz tem spec propria; aqui e o caminho ate ele.
 */

function nav(page) {
  return page.getByRole('navigation', { name: 'Principal' });
}

function pageTitle(page, name) {
  return page.getByRole('heading', { level: 2, name, exact: true });
}

/** O numero de um resumo do Inicio, pelo rotulo escrito ao lado. */
function stat(widget, label) {
  return widget
    .locator('.widget__stat')
    .filter({ hasText: label })
    .getByRole('definition');
}

test('abre no Inicio, e a navegacao marca o destino aberto', async ({
  page,
}) => {
  await page.goto('/');

  const inicio = nav(page).getByRole('button', { name: 'Inicio' });
  const tarefas = nav(page).getByRole('button', { name: 'Tarefas' });

  await expect(pageTitle(page, 'Inicio')).toBeVisible();
  await expect(inicio).toHaveAttribute('aria-current', 'page');
  await expect(tarefas).not.toHaveAttribute('aria-current', 'page');

  await tarefas.click();

  await expect(pageTitle(page, 'Tarefas')).toBeVisible();
  await expect(tarefas).toHaveAttribute('aria-current', 'page');
  await expect(inicio).not.toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Tarefas — tasktab');
  // Quem clicou no menu continua nele: o foco nao pula para o conteudo.
  await expect(tarefas).toBeFocused();
});

test('o Inicio resume as tarefas, e o widget abre o modulo', async ({
  page,
  request,
}) => {
  await clearTasks(request);
  await createTask(request, { title: 'Fazendo agora', status: 'in_progress' });
  await createTask(request, {
    title: 'Na fila',
    status: 'pending',
    due_date: '2026-12-31',
  });
  await createTask(request, { title: 'Ja foi', status: 'done' });

  await page.goto('/');

  const widget = page.getByRole('region', { name: 'Tarefas', exact: true });

  await expect(stat(widget, 'Pendentes')).toHaveText('1');
  await expect(stat(widget, 'Em andamento')).toHaveText('1');
  await expect(stat(widget, 'Concluidas')).toHaveText('1');

  // So o que esta em aberto, e o que esta em andamento primeiro.
  const open = widget
    .getByRole('list', { name: 'Tarefas em aberto' })
    .getByRole('listitem');
  await expect(open).toHaveCount(2);
  await expect(open.first()).toContainText('Fazendo agora');
  await expect(open.nth(1)).toContainText('Prazo 31/12/2026');

  await widget.getByRole('button', { name: 'Abrir Tarefas' }).click();

  await expect(pageTitle(page, 'Tarefas')).toBeVisible();
  // O botao clicado sumiu junto com o Inicio: o foco vai para o titulo da
  // pagina nova, e nao para o <body>.
  await expect(pageTitle(page, 'Tarefas')).toBeFocused();
  await expect(page.locator('.task')).toHaveCount(3);
});

test('o widget da prestacao abre o relatorio direto no detalhe', async ({
  page,
  request,
}) => {
  await clearReports(request);
  const report = await createReport(request, { title: 'Relatorio do atalho' });

  await page.goto('/');

  const widget = page.getByRole('region', { name: 'Prestacao de Contas' });
  await expect(stat(widget, 'Abertos')).toHaveText('1');
  await expect(stat(widget, 'Fechados')).toHaveText('0');

  await widget.getByRole('button', { name: report.title }).click();

  await expect(page.getByRole('heading', { name: report.title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voltar' })).toBeVisible();

  // Clicar no modulo aberto volta para o comeco dele: a lista.
  await openSection(page, 'Prestacao de Contas');

  await expect(page.getByRole('button', { name: 'Voltar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: report.title })).toBeVisible();
});

test('o tema escolhido vale contra o do sistema e sobrevive a recarga', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await openSection(page, 'Ajustes');

  const html = page.locator('html');
  const tema = page.getByRole('group', { name: 'Tema' });

  await expect(tema.getByRole('radio', { name: 'Sistema' })).toBeChecked();
  await expect.poll(() => html.getAttribute('data-theme')).toBeNull();

  await tema.getByText('Escuro').click();

  await expect(tema.getByRole('radio', { name: 'Escuro' })).toBeChecked();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // O fundo escuro do tema, e nao so o atributo.
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(24, 24, 27)',
  );

  // Na carga o tema vem do `tema.js`, antes do React.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // A barra superior troca para o proximo da lista: depois do escuro, o do
  // sistema, que volta a nao levar atributo nenhum.
  await page.getByRole('button', { name: /^Tema: Escuro/ }).click();
  await expect.poll(() => html.getAttribute('data-theme')).toBeNull();

  await openSection(page, 'Ajustes');
  await expect(tema.getByRole('radio', { name: 'Sistema' })).toBeChecked();
});

test('na tela estreita a navegacao vai para o rodape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // Um menu so: a barra lateral nao e montada, e cada destino aparece uma
  // vez para o leitor de tela.
  await expect(nav(page)).toHaveCount(1);
  await expect(page.getByRole('complementary')).toHaveCount(0);

  await nav(page).getByRole('button', { name: 'Prestacao de Contas' }).click();
  await expect(pageTitle(page, 'Prestacao de Contas')).toBeVisible();

  // Preso ao rodape da tela, ao alcance do polegar.
  const box = await nav(page).boundingBox();
  expect(Math.round(box.y + box.height)).toBe(844);

  // O "Sair" da barra lateral passa para a barra superior. Nao e clicado: a
  // sessao do E2E e compartilhada pelas specs.
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
});

test('Tarefas continua funcionando depois de visitar o outro modulo', async ({
  page,
  request,
}) => {
  await clearTasks(request);

  await page.goto('/');
  await openSection(page, 'Prestacao de Contas');
  await openSection(page, 'Tarefas');

  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page
    .locator('form.form')
    .getByLabel('Titulo')
    .fill('Sobrevive a troca de modulo');
  await page.getByRole('button', { name: 'Criar tarefa' }).click();

  await expect(page.getByText('Sobrevive a troca de modulo')).toBeVisible();
});
