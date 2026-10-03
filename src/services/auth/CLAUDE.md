# Autenticacao e autorizacao

Toda rota de `/api` exige sessao, menos `/api/health` (o probe do container) e
`POST /api/auth/login`. Ate a issue 32 a API era aberta: quem alcancasse a
porta baixava a imagem de qualquer cupom, com CNPJ e as vezes CPF.

## Escopo e posse

| Eixo       | Pergunta                | Onde                                           |
| ---------- | ----------------------- | ---------------------------------------------- |
| **Escopo** | que acao, em que classe | `requireScope` na **rota**                     |
| **Posse**  | quais linhas            | `loadReport` / `loadReceipt` no **controller** |

- O escopo fica na rota porque ali se le, de cima a baixo, o que cada endpoint
  exige. `requireScope` confere o nome contra `SCOPES` na carga do modulo: um
  erro de digitacao derruba o boot em vez de liberar a rota em silencio.
- `reports:read:any` e `reports:write:any` dispensam a checagem de posse — sem
  eles, "admin" viraria um `if` em cada controller.

| Papel     | O que e               | Alcance                          |
| --------- | --------------------- | -------------------------------- |
| `admin`   | administra pessoas    | tudo, inclusive relatorio alheio |
| `user`    | quem presta contas    | **os seus** relatorios           |
| `auditor` | quem confere e assina | le tudo, escreve nada            |

- O auditor e o unico com `:any` de leitura sem o de escrita: **nao junte os
  dois num escopo so**.
- A posse e do **relatorio**; comprovante, imagem e exportacao herdam a dele.
- `merchants` e `tasks` sao compartilhados: a categoria de um CNPJ vale para
  todos, e o quadro e um so. Se cada pessoa precisar do seu quadro, o caminho
  e `tasks.owner_id` mais `tasks:read:any`, como nos relatorios.
- `reports.owner_id` e anulavel: relatorio sem dono e legado, e so quem tem
  `reports:read:any` o enxerga (`owner_id = $1` nunca casa com NULL).
- O dono sai da sessao, e `owner_id` nao esta em `UPDATABLE_COLUMNS`.

## 404, e nao 403, para o que e de outra pessoa

403 confirmaria que o id existe e deixaria varrer o sistema. O 403 fica para
quando **a acao** e negada (o auditor que le e tenta editar). `loadReport` e
`loadReceipt` (`access.service.js`) sao o unico lugar de onde sai o 404 de
relatorio e de comprovante — ja houve tres copias. Ha teste comparando "nao
existe" e "nao e seu" campo a campo.

## Senha

- `scrypt` do proprio Node (`password.js`); `bcrypt` e `argon2` trariam
  binario nativo. Os parametros vao dentro do hash (`scrypt$N$r$p$salt$hash`),
  e o login refaz o hash de quem entra com custo antigo (`needsRehash`).
  `PASSWORD_SCRYPT_P` e 5 por padrao (minimo da OWASP para N=2^14, r=8); o
  `env.test` usa 1.
- O pepper (`PASSWORD_PEPPER`) entra como `HMAC-SHA256(pepper, senha)` antes
  do scrypt, e lido a cada chamada e nao tem padrao: ausente, o hash falha
  alto. Hash sem pepper (`scrypt$...`) ainda entra e e refeito como
  `scrypt-hmac$...`. **Trocar o pepper invalida todas as senhas** — a saida e
  `users:create -- --replace`.
- Comparacao com `timingSafeEqual`, e `dummyVerify` quando o e-mail nao existe;
  e-mail inexistente e senha errada devolvem a mesma mensagem. Ha teste
  comparando as duas respostas.

## Sessao

- No banco, cookie `httpOnly` + `sameSite=lax`. O ganho e revogar: sair apaga a
  linha, e trocar a senha derruba as outras sessoes. Um JWT so expiraria.
- Renova depois da metade da validade, medida no Postgres (antes disso seria
  uma escrita por requisicao): o `authenticate` estende `expires_at` e reenvia
  o cookie.
- **`sameSite=lax` e o que dispensa token de CSRF**: toda escrita daqui e POST,
  PATCH ou DELETE.
- O banco guarda o SHA-256 do token, nunca o token. Para senha nao bastaria;
  para 32 bytes aleatorios nao ha dicionario.
- O cookie e lido do header cru (`session.service.js`), sem `cookie-parser` nem
  assinatura: o valor ja e um segredo guardado como hash.
- `POST /api/auth/login` tem o `authLimiter`, o teto mais apertado.

## Cadastro de pessoas

- Nao ha auto-cadastro: criar exige `users:write`, e o primeiro sai por
  `npm run users:create` (`scripts/create-user.js`), fora do servidor. Sem
  `--password` ele sorteia e imprime uma vez. `--replace` redefine a senha,
  **encerra as sessoes** da pessoa e so muda o papel se vier `--role`. As
  regras de campo sao as do validator da API.
- Cada um le e edita o proprio cadastro sem `users:*`, menos o proprio `role` —
  a escalada de privilegio mais comum, com teste. Trocar a propria senha exige
  `current_password`; o admin que redefine a de outra pessoa nao a sabe.
- `email` nao muda por `PATCH`: e a identidade de login.
- Nao da para apagar a si mesmo nem rebaixar/apagar o **unico** admin.
- Apagar usuario nao apaga os relatorios dele: `owner_id` e
  `ON DELETE SET NULL`.
- `password_hash` nao esta em `User.COLUMNS`. So `findByEmailWithSecret`
  (login) e `findByIdWithSecret` (troca da propria senha) o trazem. **Nao
  acrescente um terceiro.**

A tela segue os escopos de `GET /api/auth/me` (ver `web/CLAUDE.md`), mas isso
e conveniencia: o servidor confere a cada requisicao, e ha teste de API de cada
recusa.
