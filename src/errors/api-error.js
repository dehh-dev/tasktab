'use strict';

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    if (details) {
      this.details = details;
    }
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static notFound(message = 'Recurso nao encontrado') {
    return new ApiError(404, message);
  }

  static unprocessable(message, details) {
    return new ApiError(422, message, details);
  }
}

module.exports = ApiError;
