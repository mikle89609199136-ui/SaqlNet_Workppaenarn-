import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui';
import { searchSettings } from './settingsIndex';

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
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => searchSettings(query), [query]);
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
    <div className="relative px-5 pt-5 pb-6">
      <label className="flex h-9 items-center gap-2 rounded-field border border-line bg-ground px-3 text-ink-2 focus-within:border-brand">
        <Icon aria-hidden="true" className="shrink-0" name="search" size="sm" />
        <input
          aria-label="Поиск по настройкам"
          className="text-caption min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-ink-3"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Поиск по настройкам…"
          ref={inputRef}
          type="text"
          value={query}
        />
      </label>

      {isOpen && (
        /* Список поверх содержимого, а не вместо него: человек ищет, не
           теряя из виду, где находится. */
        <div className="absolute inset-x-5 top-full z-20 -mt-2 overflow-hidden rounded-bubble border border-line bg-sheet shadow-[var(--elev-3)]">
          {results.length === 0 ? (
            <p className="text-caption p-4 text-center text-ink-2">Ничего не нашлось</p>
          ) : (
            <ul className="max-h-80 divide-y divide-line-soft overflow-y-auto">
              {results.map((entry, index) => (
                <li key={`${entry.path}-${entry.title}`}>
                  <button
                    className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-sheet-2 data-[state=active]:bg-sheet-2"
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
