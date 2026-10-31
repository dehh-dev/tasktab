'use strict';

const format = require('../../../src/services/rpa/rpa-format');

describe('formatacao do RPA', () => {
  it.each([
    ['formatCpf', '52998224725', '529.982.247-25'],
    ['formatCpf', '5299822472', '5299822472'],
    ['formatPis', '12056412545', '120.56412.54-5'],
    ['formatCep', '18700000', '18700-000'],
    ['formatDate', '2026-10-20', '20/10/2026'],
    ['formatDate', null, ''],
    ['formatMoney', 73033, 'R$ 730,33'],
    ['formatMoney', 847555, 'R$ 8.475,55'],
    ['formatMoney', 123456789, 'R$ 1.234.567,89'],
    ['formatMoney', 5, 'R$ 0,05'],
    ['formatMoney', -15438, '-R$ 154,38'],
    ['formatRate', 1100, '11%'],
    ['formatRate', 750, '7,5%'],
    ['accountTypeLabel', 'savings', 'POUPANÇA'],
  ])('%s(%j) = %j', (fn, input, expected) => {
    expect(format[fn](input)).toBe(expected);
  });
});

describe('nome do arquivo', () => {
  it('e o da planilha, com a hora da emissao em Brasilia', () => {
    expect(
      format.rpaFileName({
        number: 1,
        workerName: 'Maria da Conceição Sintética',
        issuedAt: '2026-10-20T17:30:05Z',
      }),
    ).toBe(
      'Solicitação - RPA - 1ª Pagto -Maria Sintética_20-10-2026_143005.pdf',
    );
  });

  it('a hora de Brasilia vira o dia quando o UTC ja virou', () => {
    expect(format.brasiliaStamp('2026-10-21T02:30:00Z')).toEqual({
      date: '20-10-2026',
      time: '233000',
    });
  });

  it.each([
    ['  Maria   da   Silva  ', 'Maria Silva'],
    ['Joana', 'Joana'],
    ['Ana / Maria: Souza', 'Ana Souza'],
  ])('primeira e ultima palavra de %j', (name, expected) => {
    expect(format.shortName(name)).toBe(expected);
  });

  it('a alternativa ASCII tira acento, ª e aspas', () => {
    expect(
      format.asciiFileName('Solicitação - RPA - 2ª Pagto -"João" Ünal.pdf'),
    ).toBe('Solicitacao - RPA - 2a Pagto -_Joao_ Unal.pdf');
  });

  it('o Content-Disposition leva as duas formas', () => {
    expect(format.contentDisposition('RPAs - 1ª Pagto (São João).zip')).toBe(
      'attachment; filename="RPAs - 1a Pagto (Sao Joao).zip"; ' +
        "filename*=UTF-8''RPAs%20-%201%C2%AA%20Pagto%20%28S%C3%A3o%20Jo%C3%A3o%29.zip",
    );
  });
});

describe('e-mail de solicitacao', () => {
  const LAUNCH = {
    city: 'Avaré',
    state: 'SP',
    company_code: 815,
    company_name: 'Empresa Sintética SPE Ltda',
    site: 'Residencial <Sintético> & Cia',
    product: 'Lançamento',
    supply: null,
    email_to: ['financeiro@exemplo.test'],
    email_cc: ['obra@exemplo.test'],
  };

  it('o 1o pagamento abre a conversa', () => {
    const email = format.requestEmail({
      launch: LAUNCH,
      number: 1,
      paymentDates: ['2026-10-20'],
      count: 12,
    });

    expect(email.subject).toBe(
      'SOLICITAÇÃO DE EMISSÃO RPA - LANÇAMENTO AVARÉ/SP - EMP. 815',
    );
    expect(email.reply).toBe(false);
    expect(email.to).toEqual(['financeiro@exemplo.test']);
    expect(email.cc).toEqual(['obra@exemplo.test']);
    expect(email.text).toBe(
      [
        'Solicito emissão de RPA da equipe administrativa de lançamento em Avaré/SP.',
        '',
        'Empresa: 815 - Empresa Sintética SPE Ltda',
        'Obra: Residencial <Sintético> & Cia',
        'Produto: Lançamento',
        'Data para pagamento: 20/10/2026',
        '',
        'Seguem em anexo 12 RPAs.',
      ].join('\n'),
    );
  });

  it('no HTML os campos vao em negrito vermelho, escapados', () => {
    const { html } = format.requestEmail({
      launch: LAUNCH,
      number: 1,
      paymentDates: ['2026-10-20'],
      count: 1,
    });

    expect(html).toContain(
      'Obra: <strong style="color:#c00000">Residencial &lt;Sintético&gt; &amp; Cia</strong>',
    );
    expect(html).toContain(
      'Data para pagamento: <strong style="color:#c00000">20/10/2026</strong>',
    );
    expect(html).toContain('<p>Segue em anexo 1 RPA.</p>');
    expect(html).not.toContain('Insumo');
  });

  it('do 2o pagamento em diante e a resposta na mesma conversa, com o mesmo assunto', () => {
    const first = format.requestEmail({
      launch: LAUNCH,
      number: 1,
      paymentDates: ['2026-10-20'],
      count: 2,
    });
    const second = format.requestEmail({
      launch: LAUNCH,
      number: 2,
      paymentDates: ['2026-10-27'],
      count: 2,
    });

    expect(second.subject).toBe(first.subject);
    expect(second.reply).toBe(true);
    expect(second.text).toMatch(
      /^Solicito emissão de RPA do 2º pagamento da equipe administrativa/,
    );
  });
});
