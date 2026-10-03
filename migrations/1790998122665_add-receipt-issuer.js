'use strict';

/**
 * Nome e cidade do emitente como estao no proprio comprovante (issue 42).
 *
 * O emitente cadastrado nasce do CNPJ, e comprovante sem CNPJ legivel — o
 * recibo manuscrito, onde se concentra a Alimentacao — saia na planilha sem
 * nome e sem cidade, duas das cinco colunas que o procedimento exige. Estas
 * colunas guardam o que o papel diz: a extracao as preenche quando o texto
 * traz, e a revisao as corrige. As saidas usam o emitente cadastrado quando
 * ha, e estas quando nao ha.
 *
 * A cidade e a do documento, nunca a do destino da viagem.
 */
exports.up = (pgm) => {
  pgm.addColumns('receipts', {
    issuer_name: { type: 'varchar(255)' },
    issuer_city: { type: 'varchar(255)' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('receipts', ['issuer_name', 'issuer_city']);
};
