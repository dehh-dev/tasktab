import { useState } from 'react';
import { parseMoneyToCents } from '../constants';

const EMPTY = {
  title: '',
  period_start: '',
  period_end: '',
  advance_cents: '',
};

/**
 * Criacao de relatorio. So criacao por enquanto — o backlog nao pede edicao
 * de relatorio na interface, e inventar isso seria alem do que foi pedido.
 */
export default function ReportForm({
  onSubmit,
  onCancel,
  submitting,
  serverErrors = {},
}) {
  const [values, setValues] = useState(EMPTY);
  const [localErrors, setLocalErrors] = useState({});

  const errors = { ...serverErrors, ...localErrors };

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setLocalErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  function validate() {
    const found = {};
    if (!values.title.trim()) {
      found.title = 'title e obrigatorio';
    }
    if (!values.period_start) {
      found.period_start = 'period_start e obrigatorio';
    }
    if (!values.period_end) {
      found.period_end = 'period_end e obrigatorio';
    }
    setLocalErrors(found);
    return Object.keys(found).length === 0;
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    onSubmit({
      title: values.title.trim(),
      period_start: values.period_start,
      period_end: values.period_end,
      // Entrada vazia ou invalida vira 0 aqui, e nao no parser: o parser
      // devolve null para "nao sei o que e isto", e 0 e uma decisao de
      // produto ("sem adiantamento informado"), nao a mesma coisa.
      advance_cents: parseMoneyToCents(values.advance_cents) ?? 0,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="form__title">Novo relatorio</h2>

      <div className="form__grid">
        <div className="field field--full">
          <label className="field__label" htmlFor="report-title">
            Titulo
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="report-title"
            className="field__input"
            type="text"
            value={values.title}
            aria-invalid={Boolean(errors.title)}
            onChange={(event) => setField('title', event.target.value)}
          />
          {errors.title && (
            <span className="field__error" role="alert">
              {errors.title}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="report-start">
            Periodo — inicio
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="report-start"
            className="field__input"
            type="date"
            value={values.period_start}
            aria-invalid={Boolean(errors.period_start)}
            onChange={(event) => setField('period_start', event.target.value)}
          />
          {errors.period_start && (
            <span className="field__error" role="alert">
              {errors.period_start}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="report-end">
            Periodo — fim
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="report-end"
            className="field__input"
            type="date"
            value={values.period_end}
            aria-invalid={Boolean(errors.period_end)}
            onChange={(event) => setField('period_end', event.target.value)}
          />
          {errors.period_end && (
            <span className="field__error" role="alert">
              {errors.period_end}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="report-advance">
            Adiantamento recebido (R$)
          </label>
          <input
            id="report-advance"
            className="field__input"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={values.advance_cents}
            onChange={(event) => setField('advance_cents', event.target.value)}
          />
          <span className="field__hint">Opcional</span>
        </div>
      </div>

      <div className="form__actions">
        <button
          type="button"
          className="btn"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting}
        >
          {submitting ? 'Criando...' : 'Criar relatorio'}
        </button>
      </div>
    </form>
  );
}
