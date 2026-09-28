'use strict';

/**
 * Cadastra o primeiro usuario — ou qualquer outro — pela linha de comando.
 *
 * Existe porque nao ha auto-cadastro na API: criar pessoa exige `users:write`,
 * e num sistema recem-migrado ninguem tem escopo nenhum. Este script e a unica
 * porta que dispensa sessao, e por isso vive fora do processo do servidor: so
 * roda quem ja tem acesso a maquina e ao banco.
 *
 *   npm run users:create -- --email ana@exemplo.com --name "Ana" --role admin
 *
 * Sem `--password`, uma senha forte e sorteada e impressa uma unica vez. E o
 * caminho recomendado: senha em argumento fica no historico do shell.
 */

const db = require('../src/config/database');
const User = require('../src/models/user.model');
const password = require('../src/services/auth/password');
const { ROLES } = require('../src/services/auth/scopes');

const USAGE = `
Uso: npm run users:create -- --email <email> --name <nome> [opcoes]

  --email <email>       obrigatorio
  --name <nome>         obrigatorio
  --role <papel>        ${ROLES.join(' | ')} (padrao: user)
  --password <senha>    padrao: sorteada e impressa uma vez
  --replace             redefine a senha e o papel se o e-mail ja existir
`;

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const name = arg.slice(2);

    if (name === 'replace') {
      args.replace = true;
      continue;
    }

    args[name] = argv[index + 1];
    index += 1;
  }

  return args;
}

function fail(message) {
  process.stderr.write(`\n${message}\n${USAGE}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || '')
    .trim()
    .toLowerCase();
  const name = String(args.name || '').trim();
  const role = args.role || 'user';

  if (!email || !name) {
    return fail('Informe --email e --name.');
  }

  if (!ROLES.includes(role)) {
    return fail(`Papel invalido: ${role}.`);
  }

  const senha = args.password || password.generate();
  const gerada = !args.password;
  const hash = await password.hash(senha);

  const existente = await User.findByEmailWithSecret(email);

  if (existente && !args.replace) {
    return fail(`Ja existe um usuario com o e-mail ${email}. Use --replace.`);
  }

  let user;

  if (existente) {
    await User.updatePassword(existente.id, hash);
    user = await User.update(existente.id, { name, role });
  } else {
    user = await User.create({ name, email, password_hash: hash, role });
  }

  // Unica vez que a senha aparece. Vai para a saida padrao de proposito: se
  // fosse para o log, ficaria gravada em disco no agregador.
  process.stdout.write(
    `\nUsuario ${existente ? 'atualizado' : 'criado'}: ${user.email} (${user.role}, id ${user.id})\n` +
      (gerada
        ? `Senha sorteada: ${senha}\nGuarde-a agora — ela nao e recuperavel.\n`
        : 'Senha definida pelo argumento --password.\n'),
  );
}

main()
  .catch((error) => {
    process.stderr.write(`\nFalha ao cadastrar: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
