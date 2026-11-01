const AUTH_URL = '/api/auth';
const TASKS_URL = '/api/tasks';
const REPORTS_URL = '/api/reports';
const RECEIPTS_URL = '/api/receipts';
const MERCHANTS_URL = '/api/merchants';
const USERS_URL = '/api/users';

/**
 * Erro de API que preserva os detalhes por campo devolvidos pelo backend
 * (status 422), para que o formulario possa exibi-los no campo correto.
 */
export class ApiError extends Error {
  constructor(message, { action, details, status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.action = action ?? null;
    this.details = details ?? [];
    // E pelo status que o `request` reconhece a sessao que caiu (401) e avisa
    // o App — ver `onSessionLost`.
    this.status = status ?? null;
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

/**
 * Quem precisa saber que a sessao caiu. O App se inscreve enquanto ha alguem
 * logado: um 401 no meio do uso quer dizer que a sessao venceu ou foi
 * revogada (troca de senha em outro navegador, conta removida), e a unica
 * saida util e a tela de login. Sem isso cada painel mostrava o proprio alerta
 * de "sessao ausente", e a pessoa so saia dele recarregando a pagina.
 */
let sessionLostListener = null;

export function onSessionLost(listener) {
  sessionLostListener = listener;

  return () => {
    if (sessionLostListener === listener) {
      sessionLostListener = null;
    }
  };
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
    // `same-origin` e o padrao do fetch e ja mandaria o cookie de sessao;
    // explicito aqui porque e do que a autenticacao inteira depende.
    response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
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
    const error = new ApiError(
      body?.message ?? `Falha na requisicao (${response.status})`,
      {
        action: body?.action,
        details: body?.details,
        status: response.status,
      },
    );

    // As rotas de /api/auth tratam o proprio 401: no login ele e senha errada,
    // no logout e sessao que ja nao existia, e no `me` da abertura e so
    // ninguem logado ainda. Nenhum deles e sessao perdida no meio do uso.
    if (error.status === 401 && !url.startsWith(AUTH_URL)) {
      sessionLostListener?.(error);
    }

    throw error;
  }

  return body;
}

// ---------- sessao ----------

/**
 * Quem esta na sessao, com os escopos do papel.
 *
 * A interface usa os escopos para nao oferecer o que a API vai recusar — um
 * auditor nao ve o botao de criar relatorio. E conveniencia de tela, e nao
 * autorizacao: quem decide continua sendo o servidor, a cada requisicao.
 */
export function getMe() {
  return request(`${AUTH_URL}/me`);
}

export function login(email, password) {
  return request(`${AUTH_URL}/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return request(`${AUTH_URL}/logout`, { method: 'POST' });
}

/**
 * Troca a propria senha. A API exige a atual e, depois da troca, derruba as
 * outras sessoes da pessoa — a corrente segue valendo.
 */
export function changeOwnPassword(userId, currentPassword, newPassword) {
  return request(`${USERS_URL}/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      current_password: currentPassword,
      password: newPassword,
    }),
  });
}

// ---------- tarefas ----------

/** `?status=...&limit=...`, so com o que veio: a API tem padrao para o resto. */
function listUrl(base, { status, limit } = {}) {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  if (limit) {
    params.set('limit', String(limit));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function listTasks({ status, limit } = {}) {
  return request(listUrl(TASKS_URL, { status, limit }));
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

export function listReports({ status, limit } = {}) {
  return request(listUrl(REPORTS_URL, { status, limit }));
}

export function createReport(data) {
  return request(REPORTS_URL, { method: 'POST', body: JSON.stringify(data) });
}

export function getReport(id) {
  return request(`${REPORTS_URL}/${id}`);
}

/** Titulo, periodo, adiantamento e cidade principal (issue 44). */
export function updateReport(id, data) {
  return request(`${REPORTS_URL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Fechar (`closed`) trava a escrita; reabrir (`open`) e o unico PATCH aceito ali. */
export function setReportStatus(id, status) {
  return request(`${REPORTS_URL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function getValidation(reportId) {
  return request(`${REPORTS_URL}/${reportId}/validation`);
}

/** A checagem final (issue 57), mostrada antes de fechar o relatorio. */
export function getFinalCheck(reportId) {
  return request(`${REPORTS_URL}/${reportId}/final-check`);
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

export function deleteReceipt(id) {
  return request(`${RECEIPTS_URL}/${id}`, { method: 'DELETE' });
}

/**
 * Reenfileira a pagina. O que uma pessoa ja conferiu so e reprocessado com
 * `discardReview`: a extracao regrava data, valor e categoria por cima.
 */
export function reprocessReceipt(id, { discardReview = false } = {}) {
  return request(`${RECEIPTS_URL}/${id}/reprocess`, {
    method: 'POST',
    body: JSON.stringify(discardReview ? { discard_review: true } : {}),
  });
}

/** Categoria padrao do emitente: vale para os proximos cupons daquele CNPJ. */
export function setMerchantCategory(id, category) {
  return request(`${MERCHANTS_URL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ default_category: category }),
  });
}

/**
 * URL da imagem renderizada do comprovante — usada direto num <img src>. O
 * giro vai na URL so para o navegador nao reaproveitar a imagem de antes de
 * girar; quem decide a rotacao e o servidor, pelo que esta gravado.
 */
export function receiptImageUrl(id, rotation = 0) {
  const base = `${RECEIPTS_URL}/${id}/image`;
  return rotation ? `${base}?rotacao=${rotation}` : base;
}

/**
 * URL da planilha do relatorio, para um <a href download>. Nao passa por
 * `request()` de proposito: baixar por fetch exigiria entregar o arquivo como
 * `blob:`, e a CSP do projeto so libera `'self'`.
 */
export function reportXlsxUrl(id) {
  return `${REPORTS_URL}/${id}/export.xlsx`;
}

/** Anexo I oficial preenchido. Mesmo motivo do `reportXlsxUrl` para nao usar fetch. */
export function reportAnexoIUrl(id) {
  return `${REPORTS_URL}/${id}/export/anexo-i.xlsx`;
}

/** PDF consolidado com os comprovantes carimbados. */
export function reportPdfUrl(id) {
  return `${REPORTS_URL}/${id}/export.pdf`;
}

/** Um PDF por categoria, com as paginas originais, num ZIP. */
export function reportCategoryPdfsUrl(id) {
  return `${REPORTS_URL}/${id}/export/pdfs-por-categoria.zip`;
}

// ---------- RPA de lancamentos ----------

const RPA_URL = '/api/rpa';

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function getRpaSummary() {
  return request(`${RPA_URL}/summary`);
}

export function listRpaCompanies() {
  return request(`${RPA_URL}/companies?limit=100`);
}

export function listLaunches({ status, limit = 100 } = {}) {
  return request(`${RPA_URL}/launches${query({ status, limit })}`);
}

export function getLaunch(id) {
  return request(`${RPA_URL}/launches/${id}`);
}

export function createLaunch(data) {
  return request(`${RPA_URL}/launches`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateLaunch(id, data) {
  return request(`${RPA_URL}/launches/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** O .xlsx ou .csv das respostas do formulario, no campo `file`. */
export function importTeam(launchId, file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${RPA_URL}/launches/${launchId}/import`, {
    method: 'POST',
    body: form,
  });
}

export function listWorkers(launchId) {
  return request(`${RPA_URL}/launches/${launchId}/workers`);
}

export function updateWorker(id, data) {
  return request(`${RPA_URL}/workers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function getTimesheet(launchId, { from, to } = {}) {
  return request(`${RPA_URL}/launches/${launchId}/days${query({ from, to })}`);
}

export function saveDays(launchId, days) {
  return request(`${RPA_URL}/launches/${launchId}/days`, {
    method: 'PUT',
    body: JSON.stringify({ days }),
  });
}

export function listPayments(launchId, { number } = {}) {
  return request(
    `${RPA_URL}/launches/${launchId}/payments${query({ number, limit: 100 })}`,
  );
}

/** Previa (`preview: true`) ou emissao: a mesma conta nos dois. */
export function postPayments(launchId, body, { preview = false } = {}) {
  return request(
    `${RPA_URL}/launches/${launchId}/payments${preview ? '?preview=true' : ''}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function cancelPayment(id, reason) {
  return request(`${RPA_URL}/payments/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function getRequestEmail(launchId, number) {
  return request(
    `${RPA_URL}/launches/${launchId}/email${query({ payment: number })}`,
  );
}

/**
 * Links de download, para um <a href download> sem nome: o nome vem do
 * servidor, com acento e o "1ª" (`filename*`). Nao passam por `request()`
 * pelo mesmo motivo das exportacoes do relatorio (CSP so com `'self'`).
 */
export function rpaPdfUrl(paymentId) {
  return `${RPA_URL}/payments/${paymentId}/rpa.pdf`;
}

export function rpasZipUrl(launchId, number) {
  return `${RPA_URL}/launches/${launchId}/rpas.zip${query({ payment: number })}`;
}

export function documentsZipUrl(launchId, { email = false } = {}) {
  return `${RPA_URL}/launches/${launchId}/documents.zip${email ? '?email=true' : ''}`;
}

export function receiptsZipUrl(launchId, number) {
  return `${RPA_URL}/launches/${launchId}/receipts.zip${query({ payment: number })}`;
}

export function uploadDocuments(launchId, file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${RPA_URL}/launches/${launchId}/documents`, {
    method: 'POST',
    body: form,
  });
}

export function listDocuments(launchId) {
  return request(`${RPA_URL}/launches/${launchId}/documents`);
}

export function updateDocument(id, data) {
  return request(`${RPA_URL}/files/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** O PDF escaneado com todos, ou um PDF por pessoa: todos no campo `file`. */
export function uploadSignedReceipts(launchId, number, files) {
  const form = new FormData();
  for (const file of [files].flat()) form.append('file', file);
  return request(
    `${RPA_URL}/launches/${launchId}/receipts${query({ payment: number })}`,
    { method: 'POST', body: form },
  );
}

export function getReceiptBatch(id) {
  return request(`${RPA_URL}/receipt-batches/${id}`);
}
