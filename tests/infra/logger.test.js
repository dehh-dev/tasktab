'use strict';

const { runScript } = require('../orchestrator');

/**
 * A rede de seguranca do log (issue 36): CPF, PIS, RG, conta, chave Pix e o
 * texto do cupom saem como `[Redacted]` mesmo quando alguem loga o objeto
 * inteiro. A regra continua sendo logar so o `id` — o `redact` casa caminho,
 * e um CPF no meio de uma mensagem passaria.
 */
describe('redact do logger', () => {
  let result;
  let lines;

  beforeAll(() => {
    result = runScript('tests/helpers/log-sample.script.js', [], {
      env: { LOG_LEVEL: 'info' },
    });
    lines = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  });

  it('o script de amostra roda limpo', () => {
    expect(result.status).toBe(0);
  });

  it('nao deixa dado pessoal sair no log, e mantem o id', () => {
    expect(lines.find((line) => line.msg === 'amostra de log')).toMatchObject({
      cpf: '[Redacted]',
      raw_text: '[Redacted]',
      worker: {
        id: 7,
        cpf: '[Redacted]',
        pis: '[Redacted]',
        rg: '[Redacted]',
        agency: '[Redacted]',
        account: '[Redacted]',
        pix_key: '[Redacted]',
      },
    });
  });

  it('o erro do Postgres sai sem a linha que violou a constraint', () => {
    expect(lines.find((line) => line.msg === 'erro do banco')).toMatchObject({
      err: {
        constraint: 'log_sample_n_check',
        detail: '[Redacted]',
      },
    });
  });

  it('nenhum dos valores aparece em lugar nenhum da saida', () => {
    expect(result.stdout).not.toMatch(/52998224725|11144477735|exemplo\.com/);
  });
});
