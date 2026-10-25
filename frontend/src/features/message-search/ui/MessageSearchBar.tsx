import { Button, Icon, Input } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { useMessageSearchStore } from '../model/messageSearchStore';

export function MessageSearchBar() {
  const { t } = useTranslation();
  const query = useMessageSearchStore((state) => state.query);
  const searchedQuery = useMessageSearchStore((state) => state.searchedQuery);
  const total = useMessageSearchStore((state) => state.results.length);
  const currentIndex = useMessageSearchStore((state) => state.currentIndex);
  const historyStatus = useMessageSearchStore((state) => state.historyStatus);
  const scannedCount = useMessageSearchStore((state) => state.scannedCount);
  const setQuery = useMessageSearchStore((state) => state.setQuery);
  const older = useMessageSearchStore((state) => state.older);
  const newer = useMessageSearchStore((state) => state.newer);
  const close = useMessageSearchStore((state) => state.close);

  const nothingFound = {
    loading: t('messageSearch.searching', 'Ищем…'),
    complete: t('messageSearch.nothing', 'Не найдено'),
    partial: t('messageSearch.nothingRecent', 'Нет в последних {{count}}', { count: scannedCount }),
    failed: t('messageSearch.historyFailed', 'Не удалось дочитать историю'),
  };

  const counter = total
    ? t('messageSearch.counter', '{{current}} из {{total}}', { current: currentIndex + 1, total })
    : query.trim()
      ? nothingFound[query.trim() === searchedQuery ? historyStatus : 'loading']
      : '';

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" role="search">
      <Input
        addon={
          <span
            aria-live="polite"
            className="px-2 text-caption whitespace-nowrap text-ink-3 tabular-nums"
          >
            {counter}
          </span>
        }
        aria-label={t('messageSearch.label', 'Поиск по переписке')}
        autoFocus
        className="min-w-0 flex-1"
        icon="search"
        inputClassName="[&::-webkit-search-cancel-button]:appearance-none"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) newer();
            else older();
          }
        }}
        placeholder={t('searchShort', 'Поиск')}
        size="search"
        type="search"
        value={query}
      />
      <div className="flex shrink-0 items-center rounded-field bg-sheet-2">
        <Button
          aria-label={t('messageSearch.older', 'Предыдущее совпадение')}
          disabled={currentIndex >= total - 1}
          iconOnly
          onClick={older}
          size="sm"
          variant="ghost"
        >
          <Icon className="size-4.5 rotate-180" name="chevronDown" />
        </Button>
        <Button
          aria-label={t('messageSearch.newer', 'Следующее совпадение')}
          disabled={currentIndex <= 0}
          iconOnly
          onClick={newer}
          size="sm"
          variant="ghost"
        >
          <Icon className="size-4.5" name="chevronDown" />
        </Button>
      </div>
      <Button
        aria-label={t('messageSearch.close', 'Закрыть поиск')}
        iconOnly
        onClick={close}
        variant="ghost"
      >
        <Icon className="size-5" name="cross" />
      </Button>
    </div>
  );
}
