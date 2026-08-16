import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { ApiError } from '../api';
import ReportList from './ReportList';
import ReportForm from './ReportForm';
import ReportDetail from './ReportDetail';

/**
 * Conteudo da aba "Prestacao de Contas". `react-router` fica fora de escopo
 * de proposito (backlog Issue 19) — a navegacao entre lista e detalhe e so
 * estado local, sem URL propria por relatorio.
 */
export default function ExpensesApp() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // null = lista | id = detalhe daquele relatorio
  const [openReportId, setOpenReportId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.listReports();
      setReports(response.data);
      setError(null);
    } catch (caught) {
      setError({ message: caught.message, action: caught.action });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(values) {
    setSubmitting(true);
    setFieldErrors({});

    try {
      const response = await api.createReport(values);
      setCreating(false);
      await load();
      setOpenReportId(response.data.id);
    } catch (caught) {
      const byField = caught instanceof ApiError ? caught.fieldErrors() : {};

      if (Object.keys(byField).length > 0) {
        setFieldErrors(byField);
      } else {
        setError({ message: caught.message, action: caught.action });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (openReportId) {
    return (
      <ReportDetail
        reportId={openReportId}
        onBack={() => setOpenReportId(null)}
      />
    );
  }

  return (
    <>
      {error && (
        <div className="alert" role="alert">
          <div className="alert__title">{error.message}</div>
          {error.action && <div>{error.action}</div>}
        </div>
      )}

      {creating && (
        <ReportForm
          onSubmit={handleCreate}
          onCancel={() => {
            setCreating(false);
            setFieldErrors({});
          }}
          submitting={submitting}
          serverErrors={fieldErrors}
        />
      )}

      {loading ? (
        <p className="state">Carregando relatorios...</p>
      ) : (
        <ReportList
          reports={reports}
          onOpen={setOpenReportId}
          onCreate={() => setCreating(true)}
        />
      )}
    </>
  );
}
