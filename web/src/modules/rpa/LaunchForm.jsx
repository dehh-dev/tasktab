import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  WEEKDAYS,
  centsToInputValue,
  formatDate,
  parseMoneyToCents,
} from '../../constants';
import { Field } from './common';

const TIME_FIELDS = [
  ['start_time', 'Entrada'],
  ['lunch_out', 'Saida almoco'],
  ['lunch_in', 'Volta almoco'],
  ['end_time', 'Saida'],
];

const DEFAULT_DAY = {
  enabled: false,
  quantity: '1',
  start_time: '08:00',
  lunch_out: '12:00',
  lunch_in: '13:00',
  end_time: '17:00',
};

/** Segunda a sexta das 8h as 17h com 1h de almoco: o horario de Avare. */
function scheduleFrom(launch) {
  return WEEKDAYS.map(({ value }) => {
    const day = launch?.schedule?.find((entry) => entry.weekday === value);
    if (day) {
      return {
        enabled: true,
        quantity: String(day.quantity),
        start_time: day.start_time ?? '',
        lunch_out: day.lunch_out ?? '',
        lunch_in: day.lunch_in ?? '',
        end_time: day.end_time ?? '',
      };
    }
    return { ...DEFAULT_DAY, enabled: !launch && value <= 5 };
  });
}

function ratesFrom(launch) {
  if (!launch?.rates?.length) {
    return [{ role: '', daily: '', bonus: '', starts_on: '', ends_on: '' }];
  }
  return launch.rates.map((rate) => ({
    role: rate.role,
    daily: centsToInputValue(rate.daily_cents),
    bonus: rate.promoted_bonus_cents
      ? centsToInputValue(rate.promoted_bonus_cents)
      : '',
    starts_on: rate.starts_on,
    ends_on: rate.ends_on,
  }));
}

/** `20/11/2026, 02/11/2026` <-> `['2026-11-02', '2026-11-20']`. */
function parseDates(text) {
  return text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(part);
      return match
        ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
        : part;
    });
}

function valuesFrom(launch) {
  return {
    company_id: launch ? String(launch.company_id) : '',
    development: launch?.development ?? '',
    city: launch?.city ?? '',
    state: launch?.state ?? '',
    starts_on: launch?.starts_on ?? '',
    ends_on: launch?.ends_on ?? '',
    service_type: launch?.service_type ?? '',
    cost_center: launch?.cost_center ?? '',
    site: launch?.site ?? '',
    product: launch?.product ?? '',
    supply: launch?.supply ?? '',
    email_to: (launch?.email_to ?? []).join(', '),
    email_cc: (launch?.email_cc ?? []).join(', '),
    holidays: (launch?.holidays ?? []).map(formatDate).join(', '),
    first_payment_daily_only: launch?.first_payment_daily_only ?? true,
  };
}

const emails = (text) =>
  text
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);

/**
 * Criacao e edicao do lancamento: os dados do RPA e do e-mail, o horario
 * padrao por dia da semana (a grade do ponto nasce dele) e as diarias por
 * funcao, com vigencia. A empresa so se escolhe ao criar: ela da o codigo de
 * todo RPA do lancamento.
 */
export default function LaunchForm({
  launch,
  companies,
  onSubmit,
  onCancel,
  submitting,
  serverErrors = {},
}) {
  const editing = Boolean(launch);
  const [values, setValues] = useState(() => valuesFrom(launch));
  const [schedule, setSchedule] = useState(() => scheduleFrom(launch));
  const [rates, setRates] = useState(() => ratesFrom(launch));

  const set = (field) => (event) =>
    setValues((current) => ({
      ...current,
      [field]:
        event.target.type === 'checkbox'
          ? event.target.checked
          : event.target.value,
    }));

  function setDay(index, field, value) {
    setSchedule((current) =>
      current.map((day, at) =>
        at === index ? { ...day, [field]: value } : day,
      ),
    );
  }

  function setRate(index, field, value) {
    setRates((current) =>
      current.map((rate, at) =>
        at === index ? { ...rate, [field]: value } : rate,
      ),
    );
  }

  function handleSubmit(event) {
    event.preventDefault();

    const text = (value) => value.trim() || null;
    const payload = {
      development: values.development.trim(),
      city: values.city.trim(),
      state: values.state.trim().toUpperCase(),
      starts_on: values.starts_on,
      ends_on: values.ends_on,
      service_type: text(values.service_type),
      cost_center: text(values.cost_center),
      site: text(values.site),
      product: text(values.product),
      supply: text(values.supply),
      email_to: emails(values.email_to),
      email_cc: emails(values.email_cc),
      holidays: parseDates(values.holidays),
      first_payment_daily_only: values.first_payment_daily_only,
      schedule: schedule.flatMap((day, index) =>
        day.enabled
          ? [
              {
                weekday: WEEKDAYS[index].value,
                quantity: Number(day.quantity),
                start_time: day.start_time,
                lunch_out: day.lunch_out || null,
                lunch_in: day.lunch_in || null,
                end_time: day.end_time,
              },
            ]
          : [],
      ),
      rates: rates
        .filter((rate) => rate.role.trim() !== '')
        .map((rate) => ({
          role: rate.role.trim(),
          daily_cents: parseMoneyToCents(rate.daily),
          promoted_bonus_cents: parseMoneyToCents(rate.bonus) ?? 0,
          starts_on: rate.starts_on || values.starts_on,
          ends_on: rate.ends_on || values.ends_on,
        })),
    };

    if (!editing) {
      payload.company_id = Number(values.company_id);
      // Vazio no lancamento novo e "herdar da empresa": o campo nao vai.
      if (!payload.service_type) delete payload.service_type;
      if (!payload.cost_center) delete payload.cost_center;
    }

    onSubmit(payload);
  }

  const error = (field) => serverErrors[field];

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h3 className="form__title">
        {editing ? 'Editar lancamento' : 'Novo lancamento'}
      </h3>

      <div className="form__grid">
        {!editing && (
          <Field
            id="launch-company"
            label="Empresa"
            error={error('company_id')}
            full
            hint={
              companies.length === 0
                ? 'Nenhuma empresa cadastrada: importe a aba EMPRESA (npm run rpa:companies:import).'
                : undefined
            }
          >
            <select
              id="launch-company"
              className="field__input"
              value={values.company_id}
              onChange={set('company_id')}
              aria-invalid={Boolean(error('company_id'))}
            >
              <option value="">Escolha a empresa</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.code} - {company.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field
          id="launch-development"
          label="Empreendimento"
          error={error('development')}
          full
        >
          <input
            id="launch-development"
            className="field__input"
            value={values.development}
            onChange={set('development')}
            aria-invalid={Boolean(error('development'))}
          />
        </Field>
        <Field id="launch-city" label="Cidade" error={error('city')}>
          <input
            id="launch-city"
            className="field__input"
            value={values.city}
            onChange={set('city')}
            aria-invalid={Boolean(error('city'))}
          />
        </Field>
        <Field id="launch-state" label="UF" error={error('state')}>
          <input
            id="launch-state"
            className="field__input"
            maxLength={2}
            value={values.state}
            onChange={set('state')}
            aria-invalid={Boolean(error('state'))}
          />
        </Field>
        <Field id="launch-start" label="Inicio" error={error('starts_on')}>
          <input
            id="launch-start"
            className="field__input"
            type="date"
            value={values.starts_on}
            onChange={set('starts_on')}
            aria-invalid={Boolean(error('starts_on'))}
          />
        </Field>
        <Field id="launch-end" label="Fim" error={error('ends_on')}>
          <input
            id="launch-end"
            className="field__input"
            type="date"
            value={values.ends_on}
            onChange={set('ends_on')}
            aria-invalid={Boolean(error('ends_on'))}
          />
        </Field>
        <Field
          id="launch-service"
          label="Tipo de servico"
          error={error('service_type')}
          hint={editing ? undefined : 'Vazio: o da empresa.'}
        >
          <input
            id="launch-service"
            className="field__input"
            value={values.service_type}
            onChange={set('service_type')}
          />
        </Field>
        <Field
          id="launch-cost-center"
          label="Centro de custo"
          error={error('cost_center')}
          hint={editing ? undefined : 'Vazio: o da empresa.'}
        >
          <input
            id="launch-cost-center"
            className="field__input"
            value={values.cost_center}
            onChange={set('cost_center')}
          />
        </Field>
        <Field id="launch-site" label="Obra">
          <input
            id="launch-site"
            className="field__input"
            value={values.site}
            onChange={set('site')}
          />
        </Field>
        <Field id="launch-product" label="Produto">
          <input
            id="launch-product"
            className="field__input"
            value={values.product}
            onChange={set('product')}
          />
        </Field>
        <Field id="launch-supply" label="Insumo">
          <input
            id="launch-supply"
            className="field__input"
            value={values.supply}
            onChange={set('supply')}
          />
        </Field>
        <Field
          id="launch-holidays"
          label="Feriados"
          error={error('holidays')}
          hint="Datas dd/mm/aaaa separadas por virgula."
        >
          <input
            id="launch-holidays"
            className="field__input"
            value={values.holidays}
            onChange={set('holidays')}
          />
        </Field>
        <Field
          id="launch-email-to"
          label="E-mail: para"
          error={error('email_to')}
          full
        >
          <input
            id="launch-email-to"
            className="field__input"
            value={values.email_to}
            onChange={set('email_to')}
          />
        </Field>
        <Field
          id="launch-email-cc"
          label="E-mail: copia"
          error={error('email_cc')}
          full
        >
          <input
            id="launch-email-cc"
            className="field__input"
            value={values.email_cc}
            onChange={set('email_cc')}
          />
        </Field>
        <div className="field field--checkbox field--full">
          <input
            id="launch-daily-only"
            type="checkbox"
            checked={values.first_payment_daily_only}
            onChange={set('first_payment_daily_only')}
          />
          <label htmlFor="launch-daily-only">
            1o pagamento de cada pessoa so com diarias (os extras vao no
            seguinte)
          </label>
        </div>
      </div>

      <fieldset className="rpa-fieldset">
        <legend>Horario padrao</legend>
        <table className="rpa-table">
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Quantidade</th>
              <th scope="col">Entrada</th>
              <th scope="col">Saida almoco</th>
              <th scope="col">Volta almoco</th>
              <th scope="col">Saida</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((day, index) => {
              const name = WEEKDAYS[index].label;
              return (
                <tr key={name}>
                  <th scope="row">
                    <label>
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        onChange={(event) =>
                          setDay(index, 'enabled', event.target.checked)
                        }
                      />{' '}
                      {name}
                    </label>
                  </th>
                  <td>
                    <select
                      className="field__input"
                      aria-label={`Quantidade de ${name}`}
                      value={day.quantity}
                      disabled={!day.enabled}
                      onChange={(event) =>
                        setDay(index, 'quantity', event.target.value)
                      }
                    >
                      <option value="1">1 diaria</option>
                      <option value="0.5">1/2 diaria</option>
                    </select>
                  </td>
                  {TIME_FIELDS.map(([field, title]) => (
                    <td key={field}>
                      <input
                        type="time"
                        className="field__input"
                        aria-label={`${title} de ${name}`}
                        value={day[field]}
                        disabled={!day.enabled}
                        onChange={(event) =>
                          setDay(index, field, event.target.value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </fieldset>

      <fieldset className="rpa-fieldset">
        <legend>Diarias por funcao</legend>
        <table className="rpa-table">
          <thead>
            <tr>
              <th scope="col">Funcao</th>
              <th scope="col">Diaria (R$)</th>
              <th scope="col">Promovido (+R$)</th>
              <th scope="col">Vigencia: inicio</th>
              <th scope="col">Vigencia: fim</th>
              <th scope="col">
                <span className="sr-only">Acoes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate, index) => (
              <tr key={index}>
                <td>
                  <input
                    className="field__input"
                    aria-label={`Funcao da diaria ${index + 1}`}
                    value={rate.role}
                    onChange={(event) =>
                      setRate(index, 'role', event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    className="field__input"
                    inputMode="decimal"
                    aria-label={`Valor da diaria ${index + 1}`}
                    value={rate.daily}
                    onChange={(event) =>
                      setRate(index, 'daily', event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    className="field__input"
                    inputMode="decimal"
                    aria-label={`Adicional de promovido ${index + 1}`}
                    value={rate.bonus}
                    onChange={(event) =>
                      setRate(index, 'bonus', event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className="field__input"
                    aria-label={`Inicio da vigencia ${index + 1}`}
                    value={rate.starts_on}
                    onChange={(event) =>
                      setRate(index, 'starts_on', event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className="field__input"
                    aria-label={`Fim da vigencia ${index + 1}`}
                    value={rate.ends_on}
                    onChange={(event) =>
                      setRate(index, 'ends_on', event.target.value)
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    aria-label={`Remover diaria ${index + 1}`}
                    onClick={() =>
                      setRates((current) =>
                        current.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="field__hint">
          Vigencia vazia vale o periodo do lancamento.
        </p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            setRates((current) => [
              ...current,
              { role: '', daily: '', bonus: '', starts_on: '', ends_on: '' },
            ])
          }
        >
          <Plus size={14} aria-hidden="true" />
          Outra funcao
        </button>
      </fieldset>

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
          {submitting ? 'Salvando...' : editing ? 'Salvar' : 'Criar lancamento'}
        </button>
      </div>
    </form>
  );
}
