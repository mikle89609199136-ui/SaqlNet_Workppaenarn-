import { useEffect, useRef } from 'react';

/**
 * Общие элементы форм настроек.
 *
 * Вынесены из страницы: она отвечает за то, какие разделы существуют и
 * что в них сохраняется, а это — переиспользуемые элементы управления,
 * которые про содержимое настроек ничего не знают.
 */

export function SettingsSection({ title, description, children }) {
  return (
    <section className="settings-detail-section">
      <header>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="settings-detail-card">{children}</div>
    </section>
  );
}

export function Field({ label, multiline = false, onChange, type = 'text', value, ...props }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <label className="settings-field">
      <span>{label}</span>
      <Tag
        type={multiline ? undefined : type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={multiline ? 3 : undefined}
        {...props}
      />
    </label>
  );
}

export function ToggleRow({ label, value, onChange }) {
  return (
    <div className="settings-control-row">
      <span>{label}</span>
      <button
        type="button"
        aria-pressed={value}
        className={`settings-toggle-switch ${value ? 'is-active' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="settings-toggle-knob" />
      </button>
    </div>
  );
}

export function ChoiceRow({ label, value, options, onChange }) {
  const detailsRef = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!detailsRef.current?.contains(event.target)) {
        detailsRef.current?.removeAttribute('open');
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  function selectOption(nextValue) {
    onChange(nextValue);
    detailsRef.current?.removeAttribute('open');
  }

  return (
    <div className="settings-control-row">
      <span>{label}</span>
      <details className="settings-choice" ref={detailsRef}>
        <summary>
          <span>{selected?.label}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <div className="settings-choice-menu">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={option.value === value ? 'active' : ''}
              onClick={() => selectOption(option.value)}
            >
              <span className="settings-choice-check">{option.value === value ? '✓' : ''}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
