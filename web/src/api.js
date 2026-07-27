const BASE_URL = '/api/tasks';

/**
 * Erro de API que preserva os detalhes por campo devolvidos pelo backend
 * (status 422), para que o formulario possa exibi-los no campo correto.
 */
export class ApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ApiError';
    this.details = details ?? [];
  }

  /** Converte os detalhes em { campo: mensagem } para consumo do formulario. */
  fieldErrors() {
    return this.details.reduce((acc, detail) => {
      if (detail.field && !acc[detail.field]) {
        acc[detail.field] = detail.message;
      }
      return acc;
    }, {});
  }
}

async function request(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new ApiError('Nao foi possivel falar com o servidor.');
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ?? `Falha na requisicao (${response.status})`,
      body?.error?.details,
    );
  }

  return body;
}

export function listTasks({ status } = {}) {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  const query = params.toString();
  return request(query ? `${BASE_URL}?${query}` : BASE_URL);
}

export function createTask(data) {
  return request(BASE_URL, { method: 'POST', body: JSON.stringify(data) });
}

export function updateTask(id, data) {
  return request(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteTask(id) {
  return request(`${BASE_URL}/${id}`, { method: 'DELETE' });
}
