import { FILTER_OPTIONS } from '../constants';

export default function StatusFilter({ value, onChange, total }) {
  return (
    <div className="toolbar__group">
      <div className="filter" role="group" aria-label="Filtrar por status">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className="filter__option"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {total !== null && (
        <span className="filter__count" aria-live="polite">
          {total} {total === 1 ? 'tarefa' : 'tarefas'}
        </span>
      )}
    </div>
  );
}
