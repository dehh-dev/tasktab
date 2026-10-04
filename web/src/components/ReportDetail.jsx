import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { ApiError } from '../api';
import ReceiptUpload from './ReceiptUpload';
import ReceiptSummary from './ReceiptSummary';
import ReceiptList from './ReceiptList';
import ReceiptReview from './ReceiptReview';
import ConfirmDialog from './ConfirmDialog';
import FinalCheck from './FinalCheck';
import ReportForm from './ReportForm';
import ValidationPanel from './ValidationPanel';
import { formatDate, formatMoney, reportStatusLabel } from '../constants';

const POLL_INTERVAL_MS = 1500;
// Teto da espera depois de falhas seguidas: o bastante para nao insistir num
// servidor que respondeu 429, curto o bastante para a tela voltar sozinha.
const POLL_MAX_INTERVAL_MS = 15000;
const EMPTY_META = { total: 0, total_cents: 0, by_category: {} };

function isProcessing(receipt) {
  return receipt.status === 'pending' || receipt.status === 'processing';
}

/** Ids dos comprovantes que ainda precisam de revisao, na ordem da lista. */
function needsReviewQueue(receipts) {
  return receipts
    .filter((receipt) => receipt.status === 'needs_review')
    .map((receipt) => receipt.id);
}

/**
 * Como o comprovante aparece no dialogo de exclusao. Sem emitente extraido a
 * linha nao tem nome nenhum — data e valor sao o que permite conferir que se
 * esta apagando o cupom certo antes de confirmar.
 */
function receiptLabel(receipt) {
  const name = receipt.merchant_name || `Comprovante #${receipt.id}`;
  const details = [
    formatDate(receipt.issued_at),
    receipt.amount_cents !== null ? formatMoney(receipt.amount_cents) : null,
  ].filter(Boolean);

  return details.length > 0 ? `${name} — ${details.join(' · ')}` : name;
}

/** Link de download que vira botao desabilitado quando nao ha o que exportar. */
function ExportLink({ href, download, enabled, children }) {
  if (!enabled) {
    return (
      <button type="button" className="btn" disabled>
        {children}
      </button>
    );
  }

  return (
    <a className="btn" href={href} download={download}>
      {children}
    </a>
  );
}

export default function ReportDetail({ reportId, onBack, canWrite = true }) {
  const [report, setReport] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [meta, setMeta] = useState(EMPTY_META);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // null = lista | id = revisando aquele comprovante
  const [reviewingId, setReviewingId] = useState(null);

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingReprocess, setPendingReprocess] = useState(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [pollError, setPollError] = useState(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [changingStatus, setChangingStatus] = useState(false);
  const [finalCheck, setFinalCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [editingReport, setEditingReport] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [reportErrors, setReportErrors] = useState({});

  /**
   * Devolve os comprovantes recem-buscados, e nao so os grava no estado.
   * Quem confirma um comprovante precisa decidir o proximo da fila a partir
   * do dado fresco — o `receipts` do estado, lido logo apos um `await`,
   * ainda seria o array de antes da mutacao.
   */
  const load = useCallback(async () => {
    const [reportResponse, receiptsResponse, validationResponse] =
      await Promise.all([
        api.getReport(reportId),
        api.listReceipts(reportId),
        api.getValidation(reportId),
      ]);

    setReport(reportResponse.data);
    setReceipts(receiptsResponse.data);
    setMeta(receiptsResponse.meta);
    setAlerts(validationResponse.data);
    // A tela acabou de ser recarregada inteira: um aviso de falha do
    // acompanhamento, se havia, ja nao diz a verdade.
    setPollError(null);
    setPollFailures(0);

    return receiptsResponse.data;
  }, [reportId]);

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => setError(null))
      .catch((caught) =>
        setError({ message: caught.message, action: caught.action }),
      )
      .finally(() => setLoading(false));
  }, [load]);

  // O comprovante em revisao pode sumir da lista entre um poll e outro (por
  // exemplo, deletado em outra aba) — fecha a revisao em vez de quebrar.
  useEffect(() => {
    if (
      reviewingId &&
      !receipts.some((receipt) => receipt.id === reviewingId)
    ) {
      setReviewingId(null);
    }
  }, [reviewingId, receipts]);

  /**
   * Um ciclo do acompanhamento: so a lista, que e o que muda enquanto a
   * extracao roda. Relatorio e conferencia so mudam quando ela termina, e
   * busca-los a cada 1,5 s gastava o teto de leitura — tres requisicoes por
   * ciclo esgotavam os 600 da janela em cinco minutos de OCR, e a conferencia
   * ainda custa consultas por comprovante.
   */
  const poll = useCallback(async () => {
    try {
      const response = await api.listReceipts(reportId);

      // Terminou: recarrega tudo de uma vez. Se essa recarga falhar, a lista
      // de antes continua dizendo "em processamento", e o ciclo seguinte tenta
      // de novo — em vez de parar com a conferencia desatualizada.
      if (response.data.some(isProcessing)) {
        setReceipts(response.data);
        setMeta(response.meta);
      } else {
        await load();
      }

      setPollError(null);
      setPollFailures(0);
    } catch (caught) {
      // Antes, o erro era engolido e nenhum ciclo novo era agendado: a tela
      // ficava em "processando" para sempre, sem dizer nada. Agora avisa e
      // tenta de novo, cada vez esperando mais.
      setPollError({ message: caught.message, action: caught.action });
      setPollFailures((failures) => failures + 1);
    }
  }, [reportId, load]);

  // Acompanha so enquanto houver comprovante em processamento; para sozinho
  // quando nao ha mais nenhum, para nao ficar batendo a toa.
  useEffect(() => {
    if (!receipts.some(isProcessing)) {
      return undefined;
    }

    const delay = Math.min(
      POLL_INTERVAL_MS * 2 ** pollFailures,
      POLL_MAX_INTERVAL_MS,
    );
    const timer = setTimeout(poll, delay);
    return () => clearTimeout(timer);
  }, [receipts, pollFailures, poll]);

  /** Recarrega e avanca para o proximo pendente — ou fecha, se a fila esvaziou. */
  async function handleAction() {
    const fresh = await load();
    const queue = needsReviewQueue(fresh);
    setReviewingId(queue.length > 0 ? queue[0] : null);
  }

  /**
   * Excluir e definitivo: o backend apaga tambem o PDF do disco quando nenhuma
   * outra pagina o referencia. Por isso passa pelo ConfirmDialog, e por isso o
   * recarregamento vem do servidor — remover so do estado local deixaria o
   * total do ReceiptSummary contando um comprovante que ja nao existe.
   */
  async function handleDelete() {
    setDeleting(true);

    try {
      await api.deleteReceipt(pendingDelete.id);
      setPendingDelete(null);

      // Quem estava revisando quer o proximo pendente; quem estava na lista
      // quer continuar na lista. `handleAction` abre a revisao do primeiro
      // pendente, entao chama-lo dos dois lados sequestraria a tela de quem
      // so apagou uma linha de la.
      if (reviewingId) {
        await handleAction();
      } else {
        await load();
      }
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Reenfileira a pagina. O status volta para `pending`, e o poll ja existente
   * retoma sozinho ate a extracao terminar.
   */
  async function handleReprocess(receipt, { discardReview = false } = {}) {
    setReprocessing(true);

    try {
      await api.reprocessReceipt(receipt.id, { discardReview });
      setPendingReprocess(null);
      await load();
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
      setPendingReprocess(null);
    } finally {
      setReprocessing(false);
    }
  }

  /**
   * O que uma pessoa ja conferiu — confirmou, ou corrigiu a mao — so e
   * reprocessado depois do dialogo: a extracao regrava data, valor e
   * categoria por cima. A API confere de novo e recusa sem a confirmacao.
   */
  function requestReprocess(receipt) {
    const reviewed =
      receipt.status === 'confirmed' || receipt.extraction_source === 'manual';

    if (reviewed) {
      setPendingReprocess(receipt);
      return;
    }

    handleReprocess(receipt);
  }

  /**
   * Fechar trava a escrita no servidor (409 em tudo que altera comprovante), e
   * a tela acompanha: some o upload, a exclusao e o reprocessamento, e a
   * revisao abre somente leitura. Reabrir e o caminho de volta.
   */
  async function handleStatusChange(status) {
    setChangingStatus(true);

    try {
      await api.setReportStatus(reportId, status);
      await load();
      setError(null);
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setChangingStatus(false);
    }
  }

  /**
   * Antes de fechar, a checagem final do procedimento (issue 57). Informa,
   * nao bloqueia: com algo em aberto o botao vira "Fechar mesmo assim", e
   * se a checagem nao responder, o dialogo diz isso e deixa fechar igual.
   */
  async function requestClose() {
    setChecking(true);

    try {
      const { data } = await api.getFinalCheck(reportId);
      setFinalCheck({ items: data });
    } catch (caught) {
      setFinalCheck({ error: caught.message });
    } finally {
      setChecking(false);
    }
  }

  async function handleClose() {
    await handleStatusChange('closed');
    setFinalCheck(null);
  }

  /**
   * Titulo, periodo, adiantamento e cidade principal (issue 44). O erro de
   * campo volta no formulario, preservando o que foi digitado.
   */
  async function handleSaveReport(values) {
    setSavingReport(true);
    setReportErrors({});

    try {
      await api.updateReport(reportId, values);
      setEditingReport(false);
      await load();
    } catch (caught) {
      const byField = caught instanceof ApiError ? caught.fieldErrors() : {};

      if (Object.keys(byField).length > 0) {
        setReportErrors(byField);
      } else {
        setError({ message: caught.message, action: caught.action });
      }
    } finally {
      setSavingReport(false);
    }
  }

  /**
   * O giro gravado na revisao volta para a lista. Sem isto, reabrir o mesmo
   * comprovante partia do giro antigo — a revisao remonta com o `receipt` da
   * lista —, e girar para o outro lado para desfazer gravava 270 em vez de 0.
   */
  function handleRotated(id, rotation) {
    setReceipts((current) =>
      current.map((item) => (item.id === id ? { ...item, rotation } : item)),
    );
  }

  /** Prev/anterior dentro da fila, sem mutar nada — usa o estado atual. */
  function handleNavigate(direction) {
    const queue = needsReviewQueue(receipts);

    if (queue.length === 0) {
      setReviewingId(null);
      return;
    }

    const index = queue.indexOf(reviewingId);
    const base = index === -1 ? 0 : index;
    const step = direction === 'next' ? 1 : -1;
    const nextIndex = (base + step + queue.length) % queue.length;

    setReviewingId(queue[nextIndex]);
  }

  if (loading) {
    return <p className="state">Carregando relatorio...</p>;
  }

  const closed = report?.status === 'closed';
  // Quem pode escrever, num relatorio que ainda aceita escrita.
  const editable = canWrite && !closed;

  // Montado uma vez e incluido nos dois retornos: o ramo da revisao sai antes
  // do return final, entao um dialogo declarado so la embaixo nunca chegaria a
  // renderizar para o botao da ReceiptReview.
  const deleteDialog = pendingDelete && (
    <ConfirmDialog
      title="Deletar comprovante?"
      target={receiptLabel(pendingDelete)}
      confirmLabel="Deletar"
      onConfirm={handleDelete}
      onCancel={() => setPendingDelete(null)}
      busy={deleting}
    />
  );

  const reprocessDialog = pendingReprocess && (
    <ConfirmDialog
      title="Reprocessar comprovante conferido?"
      target={receiptLabel(pendingReprocess)}
      message="A data, o valor e a categoria conferidos serao substituidos pelo que a extracao ler, e o comprovante volta para a revisao."
      confirmLabel="Reprocessar"
      busyLabel="Reprocessando..."
      onConfirm={() =>
        handleReprocess(pendingReprocess, { discardReview: true })
      }
      onCancel={() => setPendingReprocess(null)}
      busy={reprocessing}
    />
  );

  const openChecks = finalCheck?.items?.filter((item) => !item.ok).length;
  const closeDialog = finalCheck && (
    <ConfirmDialog
      title="Fechar relatorio?"
      message="Fechado, o relatorio fica somente leitura ate alguem reabrir."
      confirmLabel={
        openChecks === 0 ? 'Fechar relatorio' : 'Fechar mesmo assim'
      }
      busyLabel="Fechando..."
      onConfirm={handleClose}
      onCancel={() => setFinalCheck(null)}
      busy={changingStatus}
    >
      <FinalCheck result={finalCheck} />
    </ConfirmDialog>
  );

  if (reviewingId) {
    const receipt = receipts.find((item) => item.id === reviewingId);
    const queue = needsReviewQueue(receipts);
    const queuePosition = queue.indexOf(reviewingId) + 1;

    // O useEffect acima fecha a revisao no proximo render quando isso
    // acontece; ate la, so nao renderiza com um receipt inexistente.
    if (!receipt) {
      return null;
    }

    return (
      <>
        <ReceiptReview
          // Forca remontagem ao trocar de comprovante: sem isso, zoom, valores
          // digitados e o estado de carregamento da imagem vazariam de um
          // comprovante para o proximo, porque React reaproveitaria a mesma
          // instancia (mesma posicao na arvore).
          key={receipt.id}
          receipt={receipt}
          alerts={alerts.filter((alert) => alert.receipt_id === reviewingId)}
          queuePosition={queuePosition > 0 ? queuePosition : 1}
          queueTotal={queue.length}
          onNavigate={handleNavigate}
          onBack={() => setReviewingId(null)}
          onAction={handleAction}
          onRotated={(rotation) => handleRotated(receipt.id, rotation)}
          onDelete={setPendingDelete}
          canWrite={editable}
          readOnlyReason={
            canWrite && closed
              ? 'Relatorio fechado: reabra-o para alterar os comprovantes.'
              : undefined
          }
        />
        {deleteDialog}
      </>
    );
  }

  // So o confirmado entra na planilha, entao sem nenhum confirmado o arquivo
  // sairia com o resumo zerado — melhor dizer o que falta do que entregar uma
  // planilha vazia que parece um erro da exportacao.
  const confirmedCount = receipts.filter(
    (receipt) => receipt.status === 'confirmed',
  ).length;

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn" onClick={onBack}>
          Voltar
        </button>

        <div className="toolbar__group">
          {confirmedCount === 0 && (
            <span className="field__hint">
              Confirme um comprovante para poder exportar.
            </span>
          )}

          {
            // Download por <a href>, nao por fetch: entregar o arquivo baixado
            // exigiria um `blob:`, que a CSP do projeto nao libera. Excel e
            // Anexo I so levam o confirmado; os PDFs levam todo comprovante.
          }
          <ExportLink
            href={api.reportXlsxUrl(reportId)}
            download={`relatorio-${reportId}.xlsx`}
            enabled={confirmedCount > 0}
          >
            Exportar Excel
          </ExportLink>
          <ExportLink
            href={api.reportAnexoIUrl(reportId)}
            download={`anexo-i-${reportId}.xlsx`}
            enabled={confirmedCount > 0}
          >
            Anexo I
          </ExportLink>
          <ExportLink
            href={api.reportPdfUrl(reportId)}
            download={`relatorio-${reportId}.pdf`}
            enabled={receipts.length > 0}
          >
            PDF consolidado
          </ExportLink>
          <ExportLink
            href={api.reportCategoryPdfsUrl(reportId)}
            download={`comprovantes-${reportId}.zip`}
            enabled={receipts.length > 0}
          >
            PDFs por categoria
          </ExportLink>

          {editable && !editingReport && (
            <button
              type="button"
              className="btn"
              onClick={() => setEditingReport(true)}
            >
              Editar relatorio
            </button>
          )}

          {canWrite && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                closed ? handleStatusChange('open') : requestClose()
              }
              disabled={changingStatus || checking}
            >
              {closed ? 'Reabrir relatorio' : 'Fechar relatorio'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}

      {pollError && (
        <div className="alert" role="status">
          <div className="alert__title">
            Nao foi possivel acompanhar o processamento: {pollError.message}
          </div>
          <div>
            {pollError.action} A tela tenta de novo sozinha em instantes.
          </div>
        </div>
      )}

      {editingReport && report && (
        <ReportForm
          report={report}
          onSubmit={handleSaveReport}
          onCancel={() => {
            setEditingReport(false);
            setReportErrors({});
          }}
          submitting={savingReport}
          serverErrors={reportErrors}
        />
      )}

      {report && !editingReport && (
        <div className="form" aria-label="Dados do relatorio">
          <h2 className="form__title">{report.title}</h2>
          <div className="task__meta">
            <span className={`badge badge--${report.status}`}>
              {reportStatusLabel(report.status)}
            </span>
            <span>
              {formatDate(report.period_start)} a{' '}
              {formatDate(report.period_end)}
            </span>
            {
              // Nulo e "nao informado", zero e "nao houve" (issue 44): sem
              // adiantamento nao ha saldo, e a tela diz qual dos dois e.
            }
            <span>
              {report.advance_cents === null
                ? 'Adiantamento nao informado'
                : report.advance_cents === 0
                  ? 'Sem adiantamento'
                  : `Adiantamento: ${formatMoney(report.advance_cents)}`}
            </span>
            {report.main_city && (
              <span>Cidade principal: {report.main_city}</span>
            )}
          </div>
        </div>
      )}

      {canWrite && closed && (
        <p className="field__hint" role="status">
          Relatorio fechado: os comprovantes estao travados. Reabra para
          alterar.
        </p>
      )}

      {
        // Quem so confere (auditor) le o relatorio inteiro e nao anexa nada;
        // relatorio fechado tambem nao recebe comprovante novo.
        editable && <ReceiptUpload reportId={reportId} onUploaded={load} />
      }
      <ReceiptSummary meta={meta} />
      <ValidationPanel alerts={alerts} onOpen={setReviewingId} />
      <ReceiptList
        receipts={receipts}
        onOpen={setReviewingId}
        onDelete={editable ? setPendingDelete : undefined}
        onReprocess={editable ? requestReprocess : undefined}
        busy={deleting || reprocessing}
      />

      {deleteDialog}
      {reprocessDialog}
      {closeDialog}
    </>
  );
}
