import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/shared/ui';
import { searchSettings } from '../model/settingsIndex';

/**
 * Поиск по настройкам.
 *
 * Прежняя строка ничего не находила: запрос сверялся со строкой-описанием
 * текущего раздела, и раздел целиком показывался или исчезал. По запросу
 * «пароль» человек видел весь «Аккаунт», а находясь во «Внешнем виде» —
 * пустой экран, потому что проверялся только открытый раздел.
 *
 * Теперь ищется по всем пунктам сразу, включая те, что лежат на
 * подстраницах и в меню не видны, — ради них поиск и нужен. Результат
 * ведёт по адресу: разделы получили собственные адреса в #476.
 */
export function SettingsSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => searchSettings(query, t), [query, t]);
  const isOpen = query.trim().length > 0;

  function open(path: string) {
    navigate(path);
    setQuery('');
    setActive(0);
    inputRef.current?.blur();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('');
      return;
    }
    if (!isOpen || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % results.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + results.length) % results.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      open(results[active].path);
    }
  }

  return (
    <div className="relative px-3 pb-2">
      {/* По макету (#828): поле 42 px на панели меню, рамка — линия. */}
      <label className="flex h-10.5 items-center gap-2.5 rounded-icon border border-divider px-3.5 text-ink-3 transition-colors duration-fast focus-within:border-brand">
        <Icon aria-hidden="true" className="size-4.25 shrink-0 stroke-[1.8px]" name="search" />
        <input
          aria-label={t('settings.search.label', 'Поиск по настройкам')}
          className="min-w-0 flex-1 border-0 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('settings.search.label', 'Поиск по настройкам')}
          ref={inputRef}
          type="text"
          value={query}
        />
        {query && (
          <button
            aria-label={t('clearSearch', 'Очистить поиск')}
            className="-mr-1.5 flex size-8 cursor-pointer items-center justify-center rounded-field text-ink-3 transition-colors hover:layer-hover hover:text-ink active:layer-press"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
              setActive(0);
              inputRef.current?.focus();
            }}
            type="button"
          >
            <Icon name="cross" />
          </button>
        )}
      </label>

      {isOpen && (
        /* Список поверх содержимого, а не вместо него: человек ищет, не
           теряя из виду, где находится. */
        <div className="absolute inset-x-3 top-full z-20 mt-1 overflow-hidden rounded-bubble border border-divider bg-menu shadow-[var(--shadow-menu)]">
          {results.length === 0 ? (
            <p className="text-caption p-4 text-center text-ink-2">
              {t('settings.search.empty', 'Ничего не нашлось')}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-divider overflow-y-auto">
              {results.map((entry, index) => (
                <li key={`${entry.path}-${entry.title}`}>
                  <button
                    className="flex w-full cursor-pointer flex-col gap-0.5 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-sheet-2 hover:layer-hover active:layer-press data-[state=active]:bg-sheet-2"
                    data-state={index === active ? 'active' : undefined}
                    onClick={() => open(entry.path)}
                    onMouseEnter={() => setActive(index)}
                    type="button"
                  >
                    <span className="text-body truncate text-ink">{entry.title}</span>
                    {/* Второй строкой — где пункт лежит: без неё непонятно,
                        куда уведёт нажатие. */}
                    <span className="text-caption truncate text-ink-2">{entry.section}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
