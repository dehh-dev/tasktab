'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { request, runScript } = require('../orchestrator');

const SCRIPT = 'scripts/import-rpa-companies.js';

// Os titulos da aba EMPRESA como a consulta do UAU os traz. As empresas sao
// sinteticas: os dados reais nao entram no repositorio.
const HEADER = [
  'Codigo',
  'NomeEmpresa',
  'CNPJ',
  'Endereço',
  'Numero',
  'Setor',
  'Cidade',
  'UF',
  'CEP',
  'Tipo de Serviço',
  'Centro de Custo',
];

let dir;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-empresas-'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function writeWorkbook(name, rows, { sheet = 'EMPRESA' } = {}) {
  const workbook = new ExcelJS.Workbook();
  // Uma aba antes, como na planilha de controle: o script procura pelo nome.
  workbook.addWorksheet('PAINEL').addRow(['nada aqui']);
  const worksheet = workbook.addWorksheet(sheet);
  worksheet.addRow(HEADER);
  rows.forEach((row) => worksheet.addRow(row));

  const file = path.join(dir, name);
  await workbook.xlsx.writeFile(file);
  return file;
}

function importFile(file) {
  return runScript(SCRIPT, ['--file', file]);
}

const AVARE = [
  815,
  'Empresa Sintetica Avare SPE Ltda',
  '26048802000165',
  'Rua Sintetica',
  '',
  'Centro',
  'São João',
  'SP',
  '18700000',
  null,
  null,
];

// O CNPJ como o Excel guarda quando a celula e numero: sem o zero a
// esquerda. O centro de custo tambem vem como numero.
const PRUDENTE = [
  803,
  'Outra Empresa Sintetica Ltda',
  1234567000195,
  'Rua Sintetica',
  '58',
  'Vila Sintetica',
  'Presidente Sintetico',
  'SP',
  '19050000',
  'Prestação de Serviços Administrativos',
  71401,
];

describe('npm run rpa:companies:import', () => {
  it('cadastra as empresas da aba e lista a linha recusada, com o motivo', async () => {
    const file = await writeWorkbook('empresas.xlsx', [
      AVARE,
      PRUDENTE,
      [804, 'CNPJ com digito errado', '26048802000166'],
      [],
    ]);

    const result = importFile(file);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Empresas cadastradas: 2');
    expect(result.stdout).toContain('Empresas atualizadas: 0');
    expect(result.stdout).toContain(
      'linha 4: cnpj: cnpj tem digito verificador invalido',
    );

    const { body } = await request('GET', '/api/rpa/companies');

    expect(body.data).toEqual([
      expect.objectContaining({
        code: 803,
        cnpj: '01234567000195',
        city: 'Presidente Sintetico',
        state: 'SP',
        service_type: 'Prestação de Serviços Administrativos',
        cost_center: '71401',
      }),
      expect.objectContaining({
        code: 815,
        name: 'Empresa Sintetica Avare SPE Ltda',
        service_type: null,
        cost_center: null,
      }),
    ]);
  });

  it('reimportar atualiza pelo codigo e nao apaga o que foi preenchido aqui', async () => {
    const file = await writeWorkbook('primeira.xlsx', [AVARE]);
    importFile(file);

    const { body: listed } = await request('GET', '/api/rpa/companies');
    await request('PATCH', `/api/rpa/companies/${listed.data[0].id}`, {
      service_type: 'Prestação de Serviços Administrativos',
      cost_center: '71401',
    });

    const renamed = [...AVARE];
    renamed[1] = 'Empresa Sintetica Avare SPE Ltda (nova razao)';
    const result = importFile(await writeWorkbook('segunda.xlsx', [renamed]));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Empresas atualizadas: 1');

    const { body } = await request('GET', '/api/rpa/companies');
    expect(body.data).toEqual([
      expect.objectContaining({
        code: 815,
        name: 'Empresa Sintetica Avare SPE Ltda (nova razao)',
        service_type: 'Prestação de Serviços Administrativos',
        cost_center: '71401',
      }),
    ]);
  });

  it('recusa o .xlsb dizendo como converter', async () => {
    // Um .xlsb tambem e um zip, mas com o workbook em binario.
    const zip = new JSZip();
    zip.file('xl/workbook.bin', Buffer.from([0x83, 0x01, 0x00]));
    const file = path.join(dir, 'controle.xlsb');
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = importFile(file);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('salve como .xlsx');
  });

  it('aponta a aba que falta, com as que existem', async () => {
    const file = await writeWorkbook('sem-empresa.xlsx', [AVARE], {
      sheet: 'CADASTRO',
    });

    const result = importFile(file);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'A planilha nao tem a aba EMPRESA (abas: PAINEL, CADASTRO).',
    );
  });

  it('sem --file mostra o uso e nao toca no banco', async () => {
    const result = runScript(SCRIPT, []);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Uso: npm run rpa:companies:import');

    const { body } = await request('GET', '/api/rpa/companies');
    expect(body.meta.total).toBe(0);
  });
});
