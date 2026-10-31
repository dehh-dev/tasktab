'use strict';

const { runScript } = require('../orchestrator');

/**
 * A rede de seguranca do log (issue 36): CPF, PIS, RG, conta, chave Pix e o
 * texto do cupom saem como `[Redacted]` mesmo quando alguem loga o objeto
 * inteiro. A regra continua sendo logar so o `id` — o `redact` casa caminho,
 * e um CPF no meio de uma mensagem passaria.
 */
describe('redact do logger', () => {
  it('nao deixa dado pessoal sair no log, e mantem o id', () => {
    const result = runScript('tests/helpers/log-sample.script.js', [], {
      env: { LOG_LEVEL: 'info' },
    });

    expect(result.status).toBe(0);

    const line = JSON.parse(result.stdout.trim().split('\n').pop());

    expect(line).toMatchObject({
      msg: 'amostra de log',
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
    expect(result.stdout).not.toMatch(/52998224725|11144477735|exemplo\.com/);
  });
});
