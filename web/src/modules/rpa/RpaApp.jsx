import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import { ApiError } from '../../api';
import LaunchList from './LaunchList';
import LaunchForm from './LaunchForm';
import LaunchDetail from './LaunchDetail';
import { ErrorAlert, toError } from './common';

/**
 * O modulo "RPA de Lancamentos" (issue 43): a lista de lancamentos e, dentro
 * de um, as etapas do processo. Sem rota propria, como a Prestacao de
 * Contas: o que esta aberto e estado local. `initialLaunchId` e o atalho do
 * Inicio.
 */
export default function RpaApp({ canWrite = true, initialLaunchId }) {
  const [launches, setLaunches] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [openId, setOpenId] = useState(initialLaunchId ?? null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, companyList] = await Promise.all([
        api.listLaunches(),
        api.listRpaCompanies(),
      ]);
      setLaunches(list.data);
      setCompanies(companyList.data);
      setError(null);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(payload) {
    setSubmitting(true);
    setFieldErrors({});
    try {
      const response = await api.createLaunch(payload);
      setCreating(false);
      await load();
      setOpenId(response.data.id);
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(toError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (openId) {
    return (
      <LaunchDetail
        launchId={openId}
        canWrite={canWrite}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  return (
    <>
      <ErrorAlert error={error} />

      {creating && (
        <LaunchForm
          companies={companies}
          onSubmit={handleCreate}
          onCancel={() => {
            setCreating(false);
            setFieldErrors({});
            setError(null);
          }}
          submitting={submitting}
          serverErrors={fieldErrors}
        />
      )}

      {loading ? (
        <p className="state">Carregando lancamentos...</p>
      ) : (
        <LaunchList
          launches={launches}
          onOpen={setOpenId}
          onCreate={canWrite && !creating ? () => setCreating(true) : undefined}
        />
      )}
    </>
  );
}
