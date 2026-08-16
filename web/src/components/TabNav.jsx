const ARROW_KEYS = ['ArrowLeft', 'ArrowRight'];

/**
 * Lista de abas no padrao WAI-ARIA tabs: uma tabpanel por aba, ativacao
 * automatica ao navegar com as setas (o foco move e a aba seleciona junto).
 */
export default function TabNav({ tabs, active, onChange }) {
  function handleKeyDown(event) {
    if (!ARROW_KEYS.includes(event.key)) {
      return;
    }

    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.value === active);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];

    onChange(next.value);
    document.getElementById(`tab-${next.value}`)?.focus();
  }

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Secoes do tasktab"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          id={`tab-${tab.value}`}
          role="tab"
          className="tabs__tab"
          aria-selected={active === tab.value}
          aria-controls={`panel-${tab.value}`}
          tabIndex={active === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
