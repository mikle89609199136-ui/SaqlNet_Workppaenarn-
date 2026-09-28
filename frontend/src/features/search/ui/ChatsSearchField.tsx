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
  /* В поле — коротко «Поиск», как в макете; диктору — что именно ищем. */
  const placeholder = t('searchShort', 'Поиск');

  return (
    <Input
      aria-label={t('searchChatsAndPeople', 'Поиск чатов и людей')}
      className="min-w-0 flex-1"
      icon="search"
      /* Прозрачное, в тонкой рамке: поиск принадлежит списку, а не форме. */
      inputClassName="bg-transparent"
      size="search"
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
            className="flex size-8 items-center justify-center rounded-field text-ink-3 transition-colors hover:layer-hover hover:text-ink"
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
