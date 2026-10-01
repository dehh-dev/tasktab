'use strict';

/**
 * Base de toda resposta de erro da API. O `toJSON()` e o unico lugar que define
 * o formato publico — nenhum handler monta objeto de erro na mao.
 *
 * A `cause` sempre carrega o erro original, para que o log tenha o rastro
 * completo mesmo quando a mensagem devolvida ao cliente e generica.
 */
class BaseError extends Error {
  constructor({ message, action, statusCode, cause, details }) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.action = action;
    this.statusCode = statusCode;

    if (details) {
      this.details = details;
    }

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      action: this.action,
      status_code: this.statusCode,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** 500 — erro inesperado. A mensagem publica nunca revela o interno. */
class InternalServerError extends BaseError {
  constructor({ cause } = {}) {
    super({
      message: 'Um erro interno nao esperado aconteceu.',
      action: 'Entre em contato com o suporte informando o request_id.',
      statusCode: 500,
      cause,
    });
  }
}

/**
 * 503 — a aplicacao esta de pe, mas uma dependencia nao esta respondendo.
 * Diferente do 500, comunica que o problema e transitorio e externo.
 */
class ServiceError extends BaseError {
  constructor({ message, action, cause } = {}) {
    super({
      message: message || 'Servico indisponivel no momento.',
      action: action || 'Verifique se as dependencias estao no ar.',
      statusCode: 503,
      cause,
    });
  }
}

/** 400 — a requisicao esta malformada antes mesmo de validar o dominio. */
class BadRequestError extends BaseError {
  constructor({ message, action, cause } = {}) {
    super({
      message: message || 'A requisicao enviada esta malformada.',
      action: action || 'Verifique o formato dos dados enviados.',
      statusCode: 400,
      cause,
    });
  }
}

/** 404 — recurso ou rota inexistente. */
class NotFoundError extends BaseError {
  constructor({ message, action, cause } = {}) {
    super({
      message: message || 'O recurso solicitado nao foi encontrado.',
      action: action || 'Verifique se o identificador informado esta correto.',
      statusCode: 404,
      cause,
    });
  }
}

/**
 * 401 — nao ha sessao valida na requisicao.
 *
 * Distinto do 403: aqui a resposta muda se o cliente se identificar. O
 * `WWW-Authenticate` fica de fora de proposito — a autenticacao e por cookie
 * de sessao, e o header faria o browser abrir a caixa de Basic Auth.
 */
class UnauthorizedError extends BaseError {
  constructor({ message, action, cause } = {}) {
    super({
      message: message || 'Sessao ausente ou expirada.',
      action: action || 'Entre com seu e-mail e senha para continuar.',
      statusCode: 401,
      cause,
    });
  }
}

/**
 * 403 — a sessao e valida, mas nao alcanca este recurso.
 *
 * A mensagem nao diz **se** o recurso existe: responder "relatorio 7 nao e
 * seu" confirmaria a existencia do relatorio 7 para quem so queria descobrir
 * isso. Quando a diferenca entre 403 e 404 vazaria informacao, o controller
 * escolhe o 404 — ver `src/services/auth/ownership.js`.
 */
class ForbiddenError extends BaseError {
  constructor({ message, action, cause } = {}) {
    super({
      message: message || 'Voce nao tem permissao para esta operacao.',
      action: action || 'Peca a um administrador o acesso necessario.',
      statusCode: 403,
      cause,
    });
  }
}

/**
 * 405 — o caminho existe, mas nao com este metodo.
 *
 * Distinto do 404: a pessoa acertou o endereco e errou o verbo, e o header
 * `Allow` (posto pelo middleware que lanca este erro) diz quais servem.
 */
class MethodNotAllowedError extends BaseError {
  constructor({ method, allow, cause } = {}) {
    super({
      message: `Metodo ${method} nao e aceito neste caminho.`,
      action: `Use um dos metodos aceitos: ${allow.join(', ')}.`,
      statusCode: 405,
      cause,
    });
  }
}

/**
 * 422 — a requisicao esta bem formada, mas o conteudo nao passa nas regras.
 * O `details` traz `{ field, message }` por campo: e o que permite a interface
 * exibir cada erro no campo correspondente em vez de um alerta generico.
 */
class ValidationError extends BaseError {
  constructor({ message, action, cause, details } = {}) {
    super({
      message: message || 'Falha de validacao.',
      action:
        action || 'Ajuste os campos indicados em details e tente de novo.',
      statusCode: 422,
      cause,
      details,
    });
  }
}

module.exports = {
  BaseError,
  InternalServerError,
  ServiceError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  ValidationError,
};
