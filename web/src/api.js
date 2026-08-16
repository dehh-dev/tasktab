const TASKS_URL = '/api/tasks';
const REPORTS_URL = '/api/reports';
const RECEIPTS_URL = '/api/receipts';

/**
 * Erro de API que preserva os detalhes por campo devolvidos pelo backend
 * (status 422), para que o formulario possa exibi-los no campo correto.
 */
export class ApiError extends Error {
  constructor(message, { action, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.action = action ?? null;
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

  // FormData (upload multipart) precisa que o browser defina o Content-Type
  // sozinho, com o boundary — um header manual quebraria o corpo.
  const headers =
    options.body instanceof FormData
      ? options.headers
      : { 'Content-Type': 'application/json', ...options.headers };

  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiError('Nao foi possivel falar com o servidor.', {
      action: 'Verifique sua conexao e se a API esta no ar.',
    });
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => null);

  // O backend serializa erro em { name, message, action, status_code,
  // details? } — o `action` diz ao usuario o que fazer a seguir.
  if (!response.ok) {
    throw new ApiError(
      body?.message ?? `Falha na requisicao (${response.status})`,
      { action: body?.action, details: body?.details },
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
  return request(query ? `${TASKS_URL}?${query}` : TASKS_URL);
}

export function createTask(data) {
  return request(TASKS_URL, { method: 'POST', body: JSON.stringify(data) });
}

export function updateTask(id, data) {
  return request(`${TASKS_URL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteTask(id) {
  return request(`${TASKS_URL}/${id}`, { method: 'DELETE' });
}

// ---------- prestacao de contas ----------

export function listReports() {
  return request(REPORTS_URL);
}

export function createReport(data) {
  return request(REPORTS_URL, { method: 'POST', body: JSON.stringify(data) });
}

export function getReport(id) {
  return request(`${REPORTS_URL}/${id}`);
}

export function getValidation(reportId) {
  return request(`${REPORTS_URL}/${reportId}/validation`);
}

export function listReceipts(reportId, { status, category } = {}) {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  if (category) {
    params.set('category', category);
  }
  const query = params.toString();
  const base = `${REPORTS_URL}/${reportId}/receipts`;
  return request(query ? `${base}?${query}` : base);
}

/** Envia 1..N PDFs. `files` e uma FileList ou array de File. */
export function uploadReceipts(reportId, files) {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  return request(`${REPORTS_URL}/${reportId}/receipts`, {
    method: 'POST',
    body: form,
  });
}

export function updateReceipt(id, data) {
  return request(`${RECEIPTS_URL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function reprocessReceipt(id) {
  return request(`${RECEIPTS_URL}/${id}/reprocess`, { method: 'POST' });
}

/** URL da imagem renderizada do comprovante — usada direto num <img src>. */
export function receiptImageUrl(id) {
  return `${RECEIPTS_URL}/${id}/image`;
}
