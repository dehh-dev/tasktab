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
