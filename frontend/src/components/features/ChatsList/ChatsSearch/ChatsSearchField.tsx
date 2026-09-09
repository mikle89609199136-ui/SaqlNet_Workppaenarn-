import { Input } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
}

/**
 * Поле поиска в шапке списка чатов.
 *
 * Раньше на этом месте стояла ссылка, притворявшаяся полем: она уводила
 * на отдельную страницу контактов, и человек терял из виду и список, и
 * открытую переписку.
 */
export function ChatsSearchField({ value, onChange, onReset }: Props) {
  const { t } = useTranslation();
  const placeholder = t('search', 'Поиск чатов и людей...');

  return (
    <Input
      aria-label={placeholder}
      className="min-w-0 flex-1"
      icon="search"
      onChange={(event) => onChange(event.target.value)}
      /* Escape очищает поле, не выпуская из него фокус: продолжить набор
         нового запроса можно сразу, не возвращаясь к полю мышью. */
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value) {
          event.preventDefault();
          onReset();
        }
      }}
      placeholder={placeholder}
      type="search"
      value={value}
      addon={
        value ? (
          <button
            aria-label={t('clearSearch', 'Очистить поиск')}
            className="flex items-center justify-center rounded-pill p-1 text-ink-3 transition-colors hover:text-ink"
            onClick={onReset}
            type="button"
          >
            <Icon name="cross" />
          </button>
        ) : undefined
      }
    />
  );
}
