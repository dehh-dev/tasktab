import { useState } from 'react';
import { centsToInputValue, parseMoneyToCents } from '../constants';

const EMPTY = {
  title: '',
  period_start: '',
  period_end: '',
  advance_cents: '',
  main_city: '',
};

function valuesFrom(report) {
  if (!report) {
    return EMPTY;
  }

  return {
    title: report.title ?? '',
    period_start: report.period_start ?? '',
    period_end: report.period_end ?? '',
    advance_cents: centsToInputValue(report.advance_cents),
    main_city: report.main_city ?? '',
  };
}

/**
 * Criacao e edicao de relatorio. A edicao entrou na issue 44: titulo, periodo
 * e adiantamento nao se corrigiam depois de criados — e adiantamento esquecido
 * e justamente o que o procedimento manda sinalizar, porque sem ele nao ha
 * saldo.
 */
export default function ReportForm({
  report,
  onSubmit,
  onCancel,
  submitting,
  serverErrors = {},
}) {
  const editing = Boolean(report);
  const [values, setValues] = useState(() => valuesFrom(report));
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
    if (
      values.advance_cents.trim() !== '' &&
      parseMoneyToCents(values.advance_cents) === null
    ) {
      found.advance_cents = 'advance_cents deve ser um valor valido';
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
      // Vazio e "nao informado", e vai nulo — nao zero: zero e "nao houve
      // adiantamento", e os dois so se distinguem se a tela nao os misturar.
      advance_cents:
        values.advance_cents.trim() === ''
          ? null
          : parseMoneyToCents(values.advance_cents),
      main_city: values.main_city.trim() || null,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="form__title">
        {editing ? 'Editar relatorio' : 'Novo relatorio'}
      </h2>

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
            aria-invalid={Boolean(errors.advance_cents)}
            aria-describedby="report-advance-hint"
            onChange={(event) => setField('advance_cents', event.target.value)}
          />
          <span className="field__hint" id="report-advance-hint">
            Em branco: ainda nao informado. 0: nao houve adiantamento.
          </span>
          {errors.advance_cents && (
            <span className="field__error" role="alert">
              {errors.advance_cents}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="report-main-city">
            Cidade principal
          </label>
          <input
            id="report-main-city"
            className="field__input"
            type="text"
            placeholder="Itapipoca/CE"
            value={values.main_city}
            aria-invalid={Boolean(errors.main_city)}
            onChange={(event) => setField('main_city', event.target.value)}
          />
          <span className="field__hint">
            Opcional. O destino da viagem, para apontar a despesa feita fora
            dele.
          </span>
          {errors.main_city && (
            <span className="field__error" role="alert">
              {errors.main_city}
            </span>
          )}
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
          {editing
            ? submitting
              ? 'Salvando...'
              : 'Salvar relatorio'
            : submitting
              ? 'Criando...'
              : 'Criar relatorio'}
        </button>
      </div>
    </form>
  );
}
