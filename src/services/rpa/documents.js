'use strict';

const { fold, squish } = require('./text');

/**
 * Os documentos do formulario (issue 41), puros: de que pergunta veio cada
 * arquivo do .zip do Drive, de quem e, que formato tem e como se chama na
 * pasta da pessoa.
 *
 * O Drive guarda as respostas numa subpasta por pergunta e cada arquivo como
 * `<nome original> - <nome da conta Google>`. As perguntas do formulario de
 * Avare: CTPS frente e verso, RG ou CNH frente e verso, comprovante de
 * endereco e dados bancarios.
 */

// Em ordem: a pergunta da CTPS ("Carteira de Trabalho") vem antes, para o
// "dados" do RG ("Lado dos Dados") nao cair em dados bancarios.
const KIND_RULES = [
  ['ctps', /\b(carteira de trabalho|ctps)\b/],
  ['id_document', /\b(rg|cnh|identidade)\b/],
  ['address_proof', /\bendereco\b/],
  ['bank_details', /\bbancari/],
];

const KIND_PREFIX = {
  ctps: 'CTPS',
  id_document: 'RG-CNH',
  address_proof: 'CE',
  bank_details: 'DB',
};

const SIDE_SUFFIX = { front: ' FRENTE', back: ' VERSO' };

function normalized(text) {
  return squish(fold(text));
}

/**
 * Tipo e lado pela pasta mais proxima do arquivo que diga alguma coisa.
 * `null` quando nenhuma pasta e de pergunta conhecida.
 */
function classify(path) {
  const folders = path.split('/').slice(0, -1).reverse();

  for (const folder of folders) {
    const text = normalized(folder);
    const rule = KIND_RULES.find(([, pattern]) => pattern.test(text));
    if (!rule) continue;

    const side = /\bfrente\b/.test(text)
      ? 'front'
      : /\bverso\b/.test(text)
        ? 'back'
        : null;
    return { kind: rule[0], side };
  }

  return null;
}

/** O nome da conta: o que vem depois do ultimo ` - `, sem a extensao. */
function accountName(path) {
  const file = path
    .split('/')
    .at(-1)
    .replace(/\.[^.]+$/, '');
  const separator = file.lastIndexOf(' - ');
  if (separator < 0) return null;

  const name = squish(file.slice(separator + 3));
  return name === '' ? null : name;
}

/**
 * O formato pelo conteudo, nunca pela extensao. Foto de iPhone chega em
 * HEIC; ela entra, mas so sai reduzida se o `sharp` souber ler.
 */
function detectType(buffer) {
  const ascii = (start, end) => buffer.toString('latin1', start, end);

  if (ascii(0, 5) === '%PDF-') {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  if (
    ascii(4, 8) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(ascii(8, 12))
  ) {
    return { contentType: 'image/heic', extension: 'heic' };
  }

  return null;
}

/** Primeiro e ultimo nome, sem acento e sem caixa. */
function nameKey(name) {
  const words = normalized(name).split(' ').filter(Boolean);
  if (words.length === 0) return null;
  return words.length === 1 ? words[0] : `${words[0]} ${words.at(-1)}`;
}

/**
 * A pessoa do lancamento com o mesmo primeiro e ultimo nome da conta. Duas
 * pessoas com a mesma chave, ou nenhuma, e `null`: alguem escolhe na mao.
 */
function matchWorker(account, workers) {
  const key = account ? nameKey(account) : null;
  if (!key) return null;

  const matches = workers.filter((worker) => nameKey(worker.name) === key);
  return matches.length === 1 ? matches[0] : null;
}

/** `NOME SOBRENOME`, a pasta da pessoa no .zip. */
function folderName(name) {
  const words = squish(name).split(' ');
  const short = words.length === 1 ? words[0] : `${words[0]} ${words.at(-1)}`;
  return short.toUpperCase();
}

/** `CTPS FRENTE.jpg`; `CTPS.jpg` quando frente e verso sao o mesmo arquivo. */
function documentFileName({ kind, side, extension }) {
  return `${KIND_PREFIX[kind]}${side ? SIDE_SUFFIX[side] : ''}.${extension}`;
}

/** Nome sem repetir dentro da mesma pasta: `CE.pdf`, `CE (2).pdf`. */
function uniqueName(name, used) {
  let candidate = name;
  let count = 1;

  while (used.has(candidate)) {
    count += 1;
    candidate = name.replace(/(\.[^.]+)$/, ` (${count})$1`);
  }

  used.add(candidate);
  return candidate;
}

module.exports = {
  KIND_PREFIX,
  classify,
  accountName,
  detectType,
  matchWorker,
  folderName,
  documentFileName,
  uniqueName,
};
