import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as api from '../../api';
import {
  DAY_KINDS,
  WEEKDAYS,
  formatDate,
  formatMinutes,
  formatSubcents,
  labelOf,
} from '../../constants';
import { ErrorAlert, Field, toError } from './common';

// Conta de dia em UTC: `new Date('2026-10-13')` na timezone local anda um dia.
function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function minDate(a, b) {
  return a < b ? a : b;
}

const FLAG_LABELS = {
  short_day: 'dia curto',
  no_rate: 'sem diaria',
  overnight: 'passa da meia-noite',
};

/** O que a celula diz, em texto: folga, falta, horario e o valor. */
function cellText(day) {
  if (day.quantity === 0) {
    return day.source === 'off' ? 'Folga' : 'Falta';
  }
  const half = day.quantity === 0.5 ? '1/2 · ' : '';
  return `${half}${day.start_time}-${day.end_time}`;
}

function DayEditor({ launch, worker, day, onSaved, onCancel }) {
  const [values, setValues] = useState({
    quantity: String(day.quantity),
    start_time: day.start_time ?? '',
    lunch_out: day.lunch_out ?? '',
    lunch_in: day.lunch_in ?? '',
    end_time: day.end_time ?? '',
    note: day.note ?? '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(entry) {
    setSaving(true);
    try {
      await api.saveDays(launch.id, [
        { worker_id: worker.id, date: day.date, ...entry },
      ]);
      onSaved();
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setSaving(false);
    }
  }

  function save(event) {
    event.preventDefault();
    const quantity = Number(values.quantity);
    submit(
      quantity === 0
        ? { quantity: 0, note: values.note.trim() || null }
        : {
            quantity,
            start_time: values.start_time,
            lunch_out: values.lunch_out || null,
            lunch_in: values.lunch_in || null,
            end_time: values.end_time,
            note: values.note.trim() || null,
          },
    );
  }

  const working = values.quantity !== '0';

  return (
    <form
      className="form rpa-inline-form"
      onSubmit={save}
      noValidate
      aria-label="Editar dia"
    >
      <h4 className="form__title">
        {worker.name} — {labelOf(DAY_KINDS, day.kind)} {formatDate(day.date)}
      </h4>
      <div className="form__grid">
        <Field id="day-quantity" label="Quantidade">
          <select
            id="day-quantity"
            className="field__input"
            value={values.quantity}
            onChange={set('quantity')}
          >
            <option value="1">Diaria</option>
            <option value="0.5">Meia diaria</option>
            <option value="0">Falta</option>
          </select>
        </Field>
        <Field id="day-start" label="Entrada">
          <input
            id="day-start"
            type="time"
            className="field__input"
            value={values.start_time}
            onChange={set('start_time')}
            disabled={!working}
          />
        </Field>
        <Field id="day-lunch-out" label="Saida almoco">
          <input
            id="day-lunch-out"
            type="time"
            className="field__input"
            value={values.lunch_out}
            onChange={set('lunch_out')}
            disabled={!working}
          />
        </Field>
        <Field id="day-lunch-in" label="Volta almoco">
          <input
            id="day-lunch-in"
            type="time"
            className="field__input"
            value={values.lunch_in}
            onChange={set('lunch_in')}
            disabled={!working}
          />
        </Field>
        <Field id="day-end" label="Saida">
          <input
            id="day-end"
            type="time"
            className="field__input"
            value={values.end_time}
            onChange={set('end_time')}
            disabled={!working}
          />
        </Field>
        <Field id="day-note" label="Observacao" full>
          <input
            id="day-note"
            className="field__input"
            value={values.note}
            onChange={set('note')}
          />
        </Field>
      </div>
      <ErrorAlert error={error} />
      <div className="form__actions">
        <button
          type="button"
          className="btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </button>
        {day.source === 'exception' && (
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => submit({ reset: true })}
          >
            Voltar ao padrao
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar dia'}
        </button>
      </div>
    </form>
  );
}

/**
 * Ponto: a grade ja preenchida com o horario padrao, uma semana por vez. So a
 * excecao se lanca (falta, meio periodo, horario diferente). O valor de cada
 * dia vem calculado do servidor, com a fracao de centavo.
 */
export default function TimesheetTab({ launch, canWrite }) {
  const [from, setFrom] = useState(launch.starts_on);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const to = minDate(addDays(from, 6), launch.ends_on);

  const load = useCallback(async () => {
    try {
      const response = await api.getTimesheet(launch.id, { from, to });
      setGrid(response.data);
      setError(null);
    } catch (caught) {
      setError(toError(caught));
    }
  }, [launch.id, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);

  const weekdayLabel = (date) => {
    const [year, month, day] = date.split('-').map(Number);
    const iso = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
    return WEEKDAYS[iso - 1].label;
  };

  return (
    <section aria-labelledby="timesheet-title" className="rpa-section">
      <h3 id="timesheet-title" className="rpa-section__title">
        Ponto
      </h3>

      <div className="toolbar">
        <div className="toolbar__group">
          <button
            type="button"
            className="btn btn--sm"
            disabled={from <= launch.starts_on}
            onClick={() =>
              setFrom(
                addDays(from, -7) < launch.starts_on
                  ? launch.starts_on
                  : addDays(from, -7),
              )
            }
          >
            <ChevronLeft size={14} aria-hidden="true" />
            Semana anterior
          </button>
          <span aria-live="polite">
            {formatDate(from)} a {formatDate(to)}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={to >= launch.ends_on}
            onClick={() => setFrom(addDays(from, 7))}
          >
            Proxima semana
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <ErrorAlert error={error} />

      {editing && (
        <DayEditor
          key={`${editing.worker.id}-${editing.day.date}`}
          launch={launch}
          worker={editing.worker}
          day={editing.day}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {!grid ? (
        <p className="state">Carregando o ponto...</p>
      ) : grid.workers.length === 0 ? (
        <p className="state">
          Ninguem na equipe: importe as respostas na aba Equipe.
        </p>
      ) : (
        <div className="rpa-grid-scroll">
          <table className="rpa-table rpa-grid">
            <caption className="sr-only">
              Ponto de {formatDate(from)} a {formatDate(to)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                {dates.map((date) => (
                  <th scope="col" key={date}>
                    {weekdayLabel(date)} {formatDate(date).slice(0, 5)}
                    {grid.holidays.includes(date) && (
                      <span className="rpa-flag"> feriado</span>
                    )}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {grid.workers.map((worker) => {
                const byDate = new Map(
                  worker.days.map((day) => [day.date, day]),
                );
                return (
                  <tr key={worker.id}>
                    <th scope="row">
                      {worker.number}. {worker.name}
                    </th>
                    {dates.map((date) => {
                      const day = byDate.get(date);
                      if (!day) {
                        return (
                          <td key={date} className="rpa-grid__out">
                            fora do periodo
                          </td>
                        );
                      }
                      const content = (
                        <>
                          <span>{cellText(day)}</span>
                          {day.quantity > 0 && (
                            <span className="rpa-grid__value">
                              {formatSubcents(day.value_subcents)}
                              {day.extra_minutes > 0 &&
                                ` (+${formatMinutes(day.extra_minutes)})`}
                            </span>
                          )}
                          {day.source === 'exception' && (
                            <span className="rpa-flag">alterado</span>
                          )}
                          {day.flags.map((flag) => (
                            <span
                              key={flag.code}
                              className="rpa-flag"
                              title={flag.message}
                            >
                              {FLAG_LABELS[flag.code] ?? flag.code}
                            </span>
                          ))}
                        </>
                      );
                      return (
                        <td
                          key={date}
                          className={`rpa-grid__cell rpa-grid__cell--${day.source}`}
                        >
                          {canWrite ? (
                            <button
                              type="button"
                              className="rpa-grid__button"
                              aria-label={`${worker.name}, ${formatDate(date)}: ${cellText(day)}`}
                              onClick={() => setEditing({ worker, day })}
                            >
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                    <td className="rpa-grid__total">
                      {formatSubcents(worker.totals.value_subcents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
