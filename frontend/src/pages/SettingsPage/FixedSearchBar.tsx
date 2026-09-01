import { Icon } from '@/components/ui/Icon';

interface Props {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

/**
 * Строка поиска над меню настроек.
 *
 * Пока ничего не находит: запрос сверяется со строкой-описанием текущего
 * раздела, и раздел целиком показывается или прячется. Судьба самой
 * строки решается в #477 — здесь она приведена к токенам, чтобы не
 * тянуть за собой классы списка чатов.
 */
export function FixedSearchBar({ onSearchChange, searchQuery }: Props) {
  return (
    <div className="px-5 pt-5 pb-6">
      <label className="flex h-9 items-center gap-2 rounded-field border border-line bg-ground px-3 text-ink-2 focus-within:border-brand">
        <Icon aria-hidden="true" className="shrink-0" name="search" size="sm" />
        <input
          className="text-caption min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-ink-3"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Поиск по настройкам…"
          type="text"
          value={searchQuery}
        />
      </label>
    </div>
  );
}
