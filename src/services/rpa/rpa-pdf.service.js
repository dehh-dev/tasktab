'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const format = require('./rpa-format');

/**
 * O RPA no layout do FORM.DRH.03 (issue 40): pagina Carta, o formulario de
 * 507 x 630 pt a 71 pt da esquerda e 80 pt do topo — a area A1:L56 da aba,
 * reduzida como o Excel a imprimia.
 *
 * A grade vem da propria aba: largura das colunas A-L (em caracteres) e
 * altura das linhas 1-56 (em pontos), proporcionais. Cada campo ocupa a
 * mesma celula mesclada que ocupava la. So o rotulo e a posicao vieram da
 * planilha; nenhum valor.
 *
 * O logo e o cabecalho de controle de documentos da empresa nao entram no
 * repositorio, que e publico: `assets/rpa-logo.png` e `assets/rpa-form.json`
 * sao sinteticos (`npm run generate:rpa-assets`), trocados na instalacao.
 */
const PAGE = { width: 612, height: 792 };
const FORM = { left: 71, top: 80, width: 507, height: 630 };

const COLUMN_CHARS = [
  11.43, 17.57, 1.86, 3.86, 12.14, 11.57, 10.43, 12.57, 13.43, 19.43, 9.57,
  22.86,
];
const ROW_POINTS = [
  17.25, 17.25, 17.25, 17.25, 33.75, 5.25, 32.25, 27, 22.5, 27.75, 5.25, 21,
  22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 6.75, 21, 21, 21, 21, 21, 21,
  21, 6, 21, 15.75, 15.75, 15.75, 15.75, 15.75, 15.75, 15.75, 15.75, 15.75,
  15.75, 15, 19.5, 15, 15.75, 15, 15.75, 15.75, 15.75, 15.75, 15.75, 15.75,
  15.75, 15.75, 15.75, 15.75, 15.75,
];

// Largura em pixels do Excel (7 por caractere + 5 de margem), proporcional.
const COLUMN_WIDTHS = scale(
  COLUMN_CHARS.map((chars) => chars * 7 + 5),
  FORM.width,
);
const ROW_HEIGHTS = scale(ROW_POINTS, FORM.height);

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.85, 0.85, 0.85);
const LINE = 0.5;
const PADDING = 2;
const FONT_SIZE = 7;
const MIN_FONT_SIZE = 4.5;

const ASSETS = path.resolve(__dirname, '../../../assets');

function scale(values, total) {
  const sum = values.reduce((acc, value) => acc + value, 0);
  return values.map((value) => (value * total) / sum);
}

function offsets(sizes) {
  const result = [0];
  for (const size of sizes) result.push(result.at(-1) + size);
  return result;
}

const COLUMN_X = offsets(COLUMN_WIDTHS);
const ROW_Y = offsets(ROW_HEIGHTS);

/** `B31:E33` -> o retangulo em pontos da pagina (origem embaixo, como no PDF). */
function rect(range) {
  const [from, to = from] = range.split(':');
  const cell = (ref) => {
    const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(ref);
    return { col: letters.charCodeAt(0) - 65, row: Number(row) - 1 };
  };
  const a = cell(from);
  const b = cell(to);
  const x = FORM.left + COLUMN_X[a.col];
  const top = PAGE.height - FORM.top - ROW_Y[a.row];

  return {
    x,
    y: PAGE.height - FORM.top - ROW_Y[b.row + 1],
    width: COLUMN_X[b.col + 1] - COLUMN_X[a.col],
    height: top - (PAGE.height - FORM.top - ROW_Y[b.row + 1]),
  };
}

/**
 * Texto que a fonte padrao (WinAnsi) escreve: acento, ç, ª e º passam; o que
 * ela nao tem perde o acento e, se ainda nao der, vira `?`. Nome de terceiro
 * nunca derruba a emissao.
 */
function encodable(font, text) {
  const supported = new Set(font.getCharacterSet());
  return [...String(text ?? '')]
    .map((character) => {
      if (character === '\n' || supported.has(character.codePointAt(0))) {
        return character;
      }
      const plain = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return [...plain].every((part) => supported.has(part.codePointAt(0)))
        ? plain
        : '?';
    })
    .join('');
}

/** Encolhe a fonte ate caber na celula; no limite, corta com reticencias. */
function fit(font, text, size, width) {
  let current = size;
  while (
    current > MIN_FONT_SIZE &&
    font.widthOfTextAtSize(text, current) > width
  ) {
    current -= 0.25;
  }

  let value = text;
  while (value.length > 1 && font.widthOfTextAtSize(value, current) > width) {
    value = `${value.slice(0, -2)}…`;
  }

  return { text: value, size: current };
}

function drawCell(page, fonts, range, content, options = {}) {
  const box = rect(range);

  if (options.fill) {
    page.drawRectangle({ ...box, color: options.fill });
  }

  if (options.border !== false) {
    page.drawRectangle({ ...box, borderColor: BLACK, borderWidth: LINE });
  }

  if (content === undefined || content === null || content === '') return;

  const font = options.bold
    ? options.italic
      ? fonts.boldItalic
      : fonts.bold
    : fonts.regular;
  const lines = encodable(font, content).split('\n');
  const size = options.size ?? FONT_SIZE;
  const lineHeight = size * 1.15;
  const blockHeight = lineHeight * lines.length;
  let baseline = box.y + (box.height + blockHeight) / 2 - size * 0.95;

  for (const line of lines) {
    const fitted = fit(font, line, size, box.width - 2 * PADDING);
    const width = font.widthOfTextAtSize(fitted.text, fitted.size);
    const x =
      options.align === 'center'
        ? box.x + (box.width - width) / 2
        : options.align === 'right'
          ? box.x + box.width - PADDING - width
          : box.x + PADDING;

    page.drawText(fitted.text, { x, y: baseline, size: fitted.size, font });
    baseline -= lineHeight;
  }
}

const upper = (value) => (value ? String(value).toUpperCase() : '');

/**
 * As faixas do IRRF como o formulario as imprime: "Ate", "de ... ate" e
 * "acima de", com aliquota e parcela a deduzir.
 */
function irrfRows(table) {
  let previous = null;
  return table.irrf_brackets.map((bracket) => {
    const label =
      previous === null
        ? 'Até'
        : bracket.up_to_cents === null
          ? `acima de ${format.formatMoney(previous)}`
          : `de ${format.formatMoney(previous + 1)} até`;
    const row = {
      label,
      limit:
        bracket.up_to_cents === null
          ? ''
          : format.formatMoney(bracket.up_to_cents),
      rate: format.formatRate(bracket.rate_bp),
      deduction: format.formatMoney(bracket.deduction_cents),
    };
    previous = bracket.up_to_cents;
    return row;
  });
}

function bankLine(worker) {
  const name = upper(worker.bank_name);
  return worker.bank_code ? `${worker.bank_code} - ${name}` : name;
}

function agencyLine(worker) {
  return worker.bank_operation
    ? `${worker.agency ?? ''} op. ${worker.bank_operation}`
    : (worker.agency ?? '');
}

/** O conteudo de cada celula, na ordem das linhas da aba. */
function layout(rpa, header) {
  const { worker, launch, company } = rpa;
  const label = { bold: true };
  const section = { bold: true, fill: GRAY, size: 8 };
  const place = [company.city ?? launch.city, company.state ?? launch.state]
    .filter(Boolean)
    .join('-');
  const dependentDeduction =
    rpa.dependents * rpa.irrf_table.irrf_dependent_deduction_cents;
  const cells = [
    // Cabecalho: logo e codigo, titulo, controle do documento.
    ['A1:B5', null],
    ['C1:I2', header.title, { bold: true, align: 'center', size: 9 }],
    ['C3:I5', header.subtitle, { bold: true, align: 'center', size: 12 }],
    ['J1:K1', 'Identificação', { ...label, align: 'center' }],
    ['L1', 'Versão', { ...label, align: 'center' }],
    ['J2:K2', header.identification, { align: 'center' }],
    ['L2', header.version, { align: 'center' }],
    ['J3:K3', 'Data Aprovação', { ...label, align: 'center' }],
    ['L3', 'Pág.', { ...label, align: 'center' }],
    ['J4:K4', format.formatDate(header.approved_on), { align: 'center' }],
    ['L4', '1', { align: 'center' }],
    ['J5:L5', 'código RH:', label],

    ['A7:B7', 'Empresa\n(Nº UAU e nome Completo)', label],
    ['C7', null],
    ['D7:H7', `${company.code} - ${company.name}`],
    ['I7', 'Cidade/Estado:', label],
    ['J7:L7', upper(place)],
    ['A8:B8', 'Nome do prestador:', label],
    ['C8', null],
    ['D8:L8', upper(worker.name)],
    ['A9:B9', 'Tipo de serviço:', label],
    ['C9', null],
    ['D9:G9', launch.service_type],
    ['H9:I9', 'Obra/Centro de Custo:', label],
    ['J9:L9', launch.cost_center],
    ['A10:B10', 'Data da prestação de serviço:', label],
    ['C10', null],
    [
      'D10:L10',
      `${format.formatDate(rpa.period_start)} até ${format.formatDate(rpa.period_end)}`,
    ],

    ['A12:L12', '01. Dados Pessoais', section],
    ['A13:B13', 'Nome da Mãe:', label],
    ['C13', null],
    ['D13:I13', upper(worker.mother_name)],
    ['J13', 'Nº RG:', label],
    ['K13:L13', upper(worker.rg)],
    ['A14:B14', 'Nome do Pai:', label],
    ['C14', null],
    ['D14:I14', upper(worker.father_name)],
    ['J14', 'DATA EMISSÃO RG:', label],
    ['K14:L14', format.formatDate(worker.rg_issued_on)],
    ['A15:B15', 'Data de nascimento:', label],
    ['C15', null],
    ['D15:F15', format.formatDate(worker.birth_date)],
    ['G15:H15', 'CPF:', label],
    ['I15:L15', format.formatCpf(worker.cpf)],
    ['A16:B16', 'Local de Nascimento:', label],
    ['C16', null],
    ['D16:F16', upper(worker.birth_place)],
    ['G16:H16', 'PIS:', label],
    ['I16:L16', format.formatPis(worker.pis)],
    ['A17:B17', 'Endereço:', label],
    ['C17', null],
    ['D17:L17', upper(worker.address)],
    ['A18', 'Cidade:', label],
    ['B18:H18', upper(worker.city)],
    ['I18', 'Bairro:', label],
    ['J18', upper(worker.district)],
    ['K18', 'CEP:', label],
    ['L18', format.formatCep(worker.cep)],
    ['A19:L19', 'Dados bancários:', { ...label, border: false }],
    ['A20', 'Banco', label],
    ['B20:D20', bankLine(worker)],
    ['E20', 'Agência', label],
    ['F20:G20', agencyLine(worker)],
    ['H20', 'Conta', label],
    ['I20:J20', worker.account],
    ['K20', 'Tipo', label],
    ['L20', format.accountTypeLabel(worker.account_type)],

    ['A22:L22', '02. Dependentes Imposto de Renda', section],
  ];

  // Tres dependentes em branco, para preencher a mao como no papel.
  for (const row of [23, 25, 27]) {
    cells.push(
      [`A${row}`, 'Nome:', label],
      [`B${row}:H${row}`, null],
      [`I${row}:J${row}`, 'Grau de Parentesco:', label],
      [`K${row}:L${row}`, null],
      [`A${row + 1}`, 'CPF:', label],
      [`B${row + 1}:H${row + 1}`, null],
      [`I${row + 1}:J${row + 1}`, 'Data de Nascimento:', label],
      [`K${row + 1}:L${row + 1}`, '______/______/_______'],
    );
  }

  cells.push(
    ['A30:L30', '03. Cálculo RPA', section],
    ['A31:A33', 'Valor:', label],
    [
      'B31:E33',
      format.formatMoney(rpa.gross_cents),
      { bold: true, size: 10, align: 'center' },
    ],
    ['F31:H31', 'DESCRIÇÃO', { ...label, align: 'center' }],
    ['I31:J31', 'ALÍQUOTA', { ...label, align: 'center' }],
    ['K31:L31', 'VALOR', { ...label, align: 'center' }],
    ['F32:H32', 'INSS'],
    [
      'I32:J32',
      format.formatRate(rpa.inss_table.inss_rate_bp),
      { align: 'center' },
    ],
    ['K32:L32', format.formatMoney(rpa.inss_cents), { align: 'right' }],
    ['F33:H33', 'IRRF'],
    ['I33:J33', '-', { align: 'center' }],
    ['K33:L33', format.formatMoney(rpa.irrf_cents), { align: 'right' }],
    ['J35:K35', 'TOTAL IMPOSTO', label],
    [
      'L35',
      format.formatMoney(rpa.inss_cents + rpa.irrf_cents),
      { align: 'right' },
    ],
    ['B37:I37', 'Dedução por Dependentes', label],
    ['J37:L37', format.formatMoney(dependentDeduction), { align: 'right' }],
    ['B38:I38', 'Qntd. Dependentes I.R.R.F', label],
    ['J38:L38', String(rpa.dependents), { align: 'right' }],
    ['B39:I39', 'Base de Cálculo IRRF', label],
    ['J39:L39', format.formatMoney(rpa.irrf_base_cents), { align: 'right' }],
    ['B40:I40', 'Desconto Simplificado I.R.R.F', label],
    [
      'J40:L40',
      format.formatMoney(rpa.irrf_table.irrf_simplified_discount_cents),
      { align: 'right' },
    ],
    ['B42:E42', 'DATA DO PAGAMENTO', label],
    ['F42:G42', format.formatDate(rpa.payment_date), { align: 'center' }],
    ['J42:K42', 'VALOR LÍQUIDO RPA', label],
    ['L42', format.formatMoney(rpa.net_cents), { bold: true, align: 'right' }],

    // A tabela de IRRF vigente na emissao (a que o RPA guardou).
    ['B44:E44', 'Base de Cal.', label],
    ['F44:G44', 'Mensal', { ...label, align: 'center' }],
    ['H44:I44', 'Alíquota', { ...label, align: 'center' }],
    ['J44:K44', 'Imposto', { ...label, align: 'center' }],
  );

  irrfRows(rpa.irrf_table)
    .slice(0, 5)
    .forEach((row, index) => {
      const line = 45 + index;
      cells.push(
        [`B${line}:E${line}`, row.label],
        [`F${line}:G${line}`, row.limit, { align: 'right' }],
        [`H${line}:I${line}`, row.rate, { align: 'center' }],
        [`J${line}:K${line}`, row.deduction, { align: 'right' }],
      );
    });

  cells.push(
    ['B50:E50', 'Dedução IRRF', label],
    [
      'F50:G50',
      format.formatMoney(rpa.irrf_table.irrf_dependent_deduction_cents),
      { align: 'right' },
    ],
  );

  const reduction = rpa.irrf_table.irrf_reduction;
  if (reduction) {
    cells.push([
      'B51:K51',
      `Redução da Lei 15.270/2025: isento até ${format.formatMoney(reduction.full_up_to_cents)}; parcial até ${format.formatMoney(reduction.partial_up_to_cents)}`,
      { border: false, size: 6 },
    ]);
  }

  // O formulario tinha as faixas do empregado (todas a 11%); o contribuinte
  // individual tem uma so, e o teto vem logo abaixo dela.
  const ceiling = rpa.inss_table.inss_ceiling_cents;
  cells.push(
    ['B52:D52', 'Tabela INSS', label],
    ['E52:G52', 'Vr. Mínimo', { ...label, align: 'center' }],
    ['H52:I52', 'Vr. Máximo', { ...label, align: 'center' }],
    ['J52:K52', 'Alíquota', { ...label, align: 'center' }],
    ['B53:D53', 'Contribuinte individual'],
    ['E53:G53', format.formatMoney(1), { align: 'right' }],
    ['H53:I53', format.formatMoney(ceiling), { align: 'right' }],
    [
      'J53:K53',
      format.formatRate(rpa.inss_table.inss_rate_bp),
      { align: 'center' },
    ],
    ['B54:D54', 'Teto'],
    ['E54:G54', format.formatMoney(ceiling), { align: 'right' }],
    [
      'H54:I54',
      format.formatMoney(
        Math.floor((ceiling * rpa.inss_table.inss_rate_bp) / 10000),
      ),
      { align: 'right' },
    ],
  );

  return cells;
}

let cachedAssets = null;

/** Logo e cabecalho da instalacao; sem logo, o quadro fica vazio. */
function loadAssets() {
  if (cachedAssets) return cachedAssets;

  const header = JSON.parse(
    fs.readFileSync(path.join(ASSETS, 'rpa-form.json'), 'utf8'),
  );
  let logo = null;

  try {
    logo = fs.readFileSync(path.join(ASSETS, 'rpa-logo.png'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  cachedAssets = { header, logo };
  return cachedAssets;
}

async function drawRpa(doc, fonts, rpa, assets) {
  const page = doc.addPage([PAGE.width, PAGE.height]);

  for (const [range, content, options] of layout(rpa, assets.header)) {
    drawCell(page, fonts, range, content, options);
  }

  // Logo nas quatro primeiras linhas do quadro; o codigo, em negrito
  // italico, na quinta.
  const box = rect('A1:B4');
  if (fonts.logo) {
    const fitted = fonts.logo.scaleToFit(box.width - 8, box.height - 6);
    page.drawImage(fonts.logo, {
      x: box.x + (box.width - fitted.width) / 2,
      y: box.y + (box.height - fitted.height) / 2,
      width: fitted.width,
      height: fitted.height,
    });
  }
  drawCell(page, fonts, 'A5:B5', rpa.code, {
    bold: true,
    italic: true,
    align: 'center',
    size: 9,
    border: false,
  });
}

/**
 * Um PDF com um RPA por pagina. As datas do documento sao a da emissao: gerar
 * de novo da o mesmo arquivo, byte a byte.
 */
async function buildRpaPdf(rpas) {
  const doc = await PDFDocument.create();
  const assets = loadAssets();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    logo: assets.logo ? await doc.embedPng(assets.logo) : null,
  };
  const issuedAt = new Date(rpas[0].issued_at);

  doc.setTitle(`RPA ${rpas.map((rpa) => rpa.code).join(', ')}`);
  doc.setCreator('tasktab');
  doc.setProducer('tasktab');
  doc.setCreationDate(issuedAt);
  doc.setModificationDate(issuedAt);

  for (const rpa of rpas) {
    await drawRpa(doc, fonts, rpa, assets);
  }

  return Buffer.from(await doc.save());
}

module.exports = { PAGE, FORM, buildRpaPdf, rect };
