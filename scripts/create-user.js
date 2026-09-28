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
const Session = require('../src/models/session.model');
const password = require('../src/services/auth/password');
const validator = require('../src/validators/user.validator');
const { ROLES } = require('../src/services/auth/scopes');
const { ValidationError } = require('../infra/errors');

const USAGE = `
Uso: npm run users:create -- --email <email> --name <nome> [opcoes]

  --email <email>       obrigatorio
  --name <nome>         obrigatorio
  --role <papel>        ${ROLES.join(' | ')} (padrao: user)
  --password <senha>    padrao: sorteada e impressa uma vez
  --replace             redefine a senha de um e-mail ja cadastrado e encerra
                        as sessoes abertas dele; o papel so muda com --role
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

  let data;

  try {
    // As mesmas regras da API (tamanho minimo da senha, formato do e-mail,
    // papel valido). Um segundo conjunto so para a linha de comando
    // divergiria na primeira vez que uma delas mudasse.
    data = validator.validateCreate({
      name: args.name,
      email: args.email,
      password: args.password || password.generate(),
      role: args.role,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(
        error.details
          .map((detail) => `${detail.field}: ${detail.message}`)
          .join('\n'),
      );
    }

    throw error;
  }

  const gerada = !args.password;
  const hash = await password.hash(data.password);
  const existente = await User.findByEmail(data.email);

  if (existente && !args.replace) {
    return fail(
      `Ja existe um usuario com o e-mail ${data.email}. Use --replace.`,
    );
  }

  let user;
  let revoked = 0;

  if (existente) {
    await User.updatePassword(existente.id, hash);

    // Sem --role o papel fica como esta: redefinir a senha de quem perdeu o
    // acesso nao pode, de quebra, rebaixar o unico administrador a `user`.
    const fields = { name: data.name };

    if (data.role) {
      fields.role = data.role;
    }

    user = await User.update(existente.id, fields);

    // Redefinir pelo script e o caminho de quem recupera uma conta, as vezes
    // comprometida. Sem isto, quem estava dentro continuaria dentro ate o
    // token vencer — a troca de senha pela API ja derruba as outras sessoes.
    revoked = await Session.removeByUser(existente.id);
  } else {
    user = await User.create({
      name: data.name,
      email: data.email,
      password_hash: hash,
      role: data.role,
    });
  }

  // Unica vez que a senha aparece. Vai para a saida padrao de proposito: se
  // fosse para o log, ficaria gravada em disco no agregador.
  process.stdout.write(
    `\nUsuario ${existente ? 'atualizado' : 'criado'}: ${user.email} (${user.role}, id ${user.id})\n` +
      (existente ? `Sessoes encerradas: ${revoked}\n` : '') +
      (gerada
        ? `Senha sorteada: ${data.password}\nGuarde-a agora — ela nao e recuperavel.\n`
        : 'Senha definida pelo argumento --password.\n'),
  );
}

main()
  .catch((error) => {
    process.stderr.write(`\nFalha ao cadastrar: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
